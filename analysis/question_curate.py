"""Offline curation planner for the existing question bank.

This is the bridge the audit/semantic analysis was missing: it turns the
"find anomalies" signals into concrete KEEP / REWRITE / REMOVE (+ review)
recommendations for the *existing* 1300+ questions, without ever touching the
bank. A human (or the content challenger) consumes the plan and acts.

Deterministic signals (always on, stdlib only):
  * topic×angle density (from question_audit)            -> saturation
  * option length ratio / answer-is-longest              -> distractor quality
  * hard + definition/fundamental                        -> pseudo-hard
  * definition-heavy topic (>=4 definitions)             -> low diagnostic value
  * P0/P1/P2 issues already emitted by question_audit    -> priority

Optional semantic signal (--semantic-report PATH):
  * conceptual-cluster density (oversaturated near-duplicate clusters) -> remove extras

Run:
    npm run question:curate
    npm run question:curate:semantic        # also runs question:analysis --semantic

Output: analysis/curation-plan.json (an object with `summary` and `plan`).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from question_audit import (
    ROOT,
    QUESTIONS_DIR,
    VALID_ANGLES,
    audit,
    read_bundles,
)

MAX_LENGTH_RATIO = 1.8
LOW_COGNITIVE_ANGLES = {"definition", "fundamental"}
DEFINITION_OVERLOAD_MIN = 4          # a topic with >=4 definitions is overloaded
KEEP_DEFINITIONS_PER_TOPIC = 2       # keep the first N definitions, rewrite the rest
CELL_SATURATION_MIN = 4              # (topic, angle) with >=4 questions is saturated
SEMANTIC_OVERSATURATION = 3         # cluster size strictly greater => oversaturated

# §四② pseudo-single-choice: stems phrased as "最准确/最贴切" with multiple
# arguably-correct options should flip to multiple-choice. Detection is advisory.
PSEUDO_SINGLE_STEMS = ("最准确", "最贴切", "最合适", "最确切", "最正确")

# §四④ strawman distractor: obviously-absurd options. Reuses the canonical
# strawmen the check skill already forbids. Advisory review only.
STRAWMAN_PHRASES = (
    "删测试", "删库", "直接删除所有", "只看 token", "完全自动化",
    "换一个模型", "完全相反", "明显荒谬", "忽略所有", "随机选一个",
)

# Higher cognitive value first; used to pick the "best" question in a semantic cluster.
ANGLE_VALUE_RANK = {
    "system-design": 9,
    "design": 8,
    "debugging": 7,
    "scenario": 6,
    "tradeoff": 5,
    "comparison": 4,
    "calculation": 3,
    "mechanism": 2,
    "fundamental": 1,
    "definition": 0,
}

ACTION_RANK = {"keep": 0, "review": 1, "rewrite": 2, "remove": 3}
PRIORITY_RANK = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}


def option_signals(question: dict[str, Any]) -> tuple[float, bool]:
    """Return (max/min option length ratio, is-a-correct-option-the-longest)."""
    formats = question.get("formats") or {}
    choice = formats.get("choice") if isinstance(formats, dict) else None
    if not isinstance(choice, dict):
        return 1.0, False
    options = choice.get("options", [])
    lengths = [len(str(o)) for o in options if isinstance(o, str)]
    if len(lengths) < 2:
        return 1.0, False
    max_len, min_len = max(lengths), min(lengths)
    ratio = max_len / min_len if min_len > 0 else 1.0
    answer = choice.get("answer", [])
    answer_is_longest = any(
        isinstance(i, int) and 0 <= i < len(options) and i in answer and len(str(options[i])) == max_len
        for i in answer
    )
    return ratio, answer_is_longest


def classify_density(n: int) -> str:
    if n == 0:
        return "gap"
    if n == 1:
        return "sparse"
    if n == 2:
        return "healthy"
    if n == 3:
        return "deep"
    return "oversaturated"


def load_semantic_report(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    # question_analysis.py prints the result object directly.
    return data if isinstance(data, dict) else {}


def best_in_cluster(ids: list[str], meta: dict[str, dict[str, Any]]) -> str:
    """Pick the question to KEEP from a near-duplicate cluster.

    Heuristic: highest cognitive-value angle wins; ties broken by better option
    length balance (lower ratio) and finally by id for determinism.
    """
    def sort_key(qid: str):
        m = meta.get(qid, {})
        angle = m.get("angle") or ""
        ratio = m.get("lengthRatio", 1.0)
        return (-ANGLE_VALUE_RANK.get(angle, 0), ratio, qid)

    return sorted(ids, key=sort_key)[0]


def build_plan(audit_report: dict[str, Any], semantic_report: dict[str, Any] | None) -> dict[str, Any]:
    raw = read_bundles(QUESTIONS_DIR)
    questions = [(file_name, q) for file_name, bundle in raw for q in bundle if isinstance(q, dict)]

    # cell density from audit
    cell_counts: Counter[tuple[str, str]] = Counter()
    for d in audit_report.get("topicAngleDensity", []):
        cell_counts[(d["topic"], d["angle"])] = d["count"]

    # per-topic definition ordering (file order)
    topic_definitions: dict[str, list[str]] = {}
    for file_name, q in questions:
        if q.get("angle") == "definition" and q.get("topic"):
            topic_definitions.setdefault(q["topic"], []).append(str(q.get("id")))

    # meta lookup for semantic cluster selection
    meta: dict[str, dict[str, Any]] = {}
    for file_name, q in questions:
        qid = str(q.get("id"))
        ratio, _ = option_signals(q)
        meta[qid] = {"angle": q.get("angle"), "lengthRatio": ratio, "topic": q.get("topic")}

    # accumulator
    acc: dict[str, dict[str, Any]] = {}
    for file_name, q in questions:
        qid = str(q.get("id", "<missing>"))
        acc[qid] = {
            "id": qid,
            "action": "keep",
            "reasons": set(),
            "suggestedAngle": None,
            "priority": "P3",
            "file": file_name,
            "actionRank": 0,
            "priorityRank": 3,
        }

    def apply(qid: str, action: str, priority: str, reasons: list[str], suggested_angle: str | None = None) -> None:
        e = acc[qid]
        e["actionRank"] = max(e["actionRank"], ACTION_RANK[action])
        e["priorityRank"] = min(e["priorityRank"], PRIORITY_RANK[priority])
        for r in reasons:
            e["reasons"].add(r)
        if suggested_angle and action in ("rewrite",):
            e["suggestedAngle"] = suggested_angle

    # ---- Rule A: option length imbalance that actually leaks the answer ----
    # The dangerous pattern (user §③) is the *correct* option being a
    # kitchen-sink answer that dwarfs the others in length/completeness — that
    # lets a test-taker pick it by verbosity instead of judgment. Arbitrary
    # length variance (a longer correct definition, or one *distractor* phrased
    # longer) is benign and must NOT auto-trigger a rewrite, otherwise we would
    # "fix" hundreds of good questions. Empirically, even the most extreme
    # cases in this bank are benign (definition questions, or wrong options that
    # are themselves long). Per our own review principle ("选项长度偏差是启发式
    # 信号，soft 命中不要直接当作错误"), length imbalance is therefore an
    # *advisory review* signal, not an automatic rewrite. The genuine fix (if a
    # distractor is trivially short) is to expand it to equal granularity — done
    # manually via `question:review`, not blindly here.
    for file_name, q in questions:
        qid = str(q.get("id"))
        ratio, answer_longest = option_signals(q)
        if ratio > MAX_LENGTH_RATIO and answer_longest:
            apply(qid, "review", "P2", ["option-length-leak", "answer-leaks-by-length"])

    # ---- Rule B: pseudo-single-choice (§四②) ----
    # A single-choice stem phrased as "最准确/最贴切/…" with multiple arguably
    # correct options is a pseudo-single that should become multiple-choice.
    # Advisory only — a human must confirm the flip, otherwise good questions
    # would be mutated.
    for file_name, q in questions:
        qid = str(q.get("id"))
        fmts = q.get("formats")
        ch = fmts.get("choice") if isinstance(fmts, dict) else None
        if not isinstance(ch, dict) or ch.get("type") != "single":
            continue
        stem = str(q.get("question", ""))
        if any(k in stem for k in PSEUDO_SINGLE_STEMS):
            apply(qid, "review", "P2", ["pseudo-single-choice"])

    # ---- Rule H: kitchen-sink correct answer (§四③) ----
    # The correct option is a compound list of many sub-points (A+B+C+D) while the
    # distractors are single concepts, so test-takers can pick it by verbosity.
    # Only meaningful for single-choice (a multi-select's correct options are
    # legitimately several independent statements). Very conservative: the correct
    # option must (a) be the longest, (b) exceed 1.8x the shortest, and (c) read
    # as an explicit list (>=2 list separators). Otherwise we would flag every
    # legitimately detailed correct answer.
    LIST_SEPS = ("、", "+", "以及", "同时", "与", "且", "；", "/")
    for file_name, q in questions:
        qid = str(q.get("id"))
        ratio, answer_longest = option_signals(q)
        if not answer_longest or ratio <= MAX_LENGTH_RATIO:
            continue
        ch = (q.get("formats") or {}).get("choice") if isinstance(q.get("formats"), dict) else None
        if not isinstance(ch, dict) or ch.get("type") != "single":
            continue
        opts = ch.get("options", [])
        ans = set(ch.get("answer", []))
        if not opts or not ans:
            continue
        correct_idx = next((i for i in ans if isinstance(i, int) and 0 <= i < len(opts)), None)
        if correct_idx is None:
            continue
        correct_text = str(opts[correct_idx])
        list_sep_count = sum(correct_text.count(sep) for sep in LIST_SEPS)
        if list_sep_count >= 2:
            apply(qid, "review", "P2", ["kitchen-sink-answer"])

    # ---- Rule I: strawman distractor (§四④) ----
    # Distractors that are obviously absurd ('删测试', '完全自动化', …) are
    # strawmen. Advisory review — the real fix is a content rewrite.
    for file_name, q in questions:
        qid = str(q.get("id"))
        ch = (q.get("formats") or {}).get("choice") if isinstance(q.get("formats"), dict) else None
        if not isinstance(ch, dict):
            continue
        opts = ch.get("options", [])
        ans = set(ch.get("answer", []))
        for i, o in enumerate(opts):
            if i in ans:
                continue
            if any(p in str(o) for p in STRAWMAN_PHRASES):
                apply(qid, "review", "P2", ["strawman-distractor"])
                break

    # ---- Rule C: pseudo-hard (hard + low-cognitive angle) ----
    for file_name, q in questions:
        qid = str(q.get("id"))
        if q.get("difficulty") == "hard" and q.get("angle") in LOW_COGNITIVE_ANGLES:
            apply(qid, "rewrite", "P1", ["hard-but-low-cognitive"], suggested_angle="tradeoff")

    # ---- Rule D: definition-heavy topic -> rewrite the 3rd+ definitions ----
    for topic, def_ids in topic_definitions.items():
        if len(def_ids) >= DEFINITION_OVERLOAD_MIN:
            for idx, qid in enumerate(def_ids):
                if idx >= KEEP_DEFINITIONS_PER_TOPIC:
                    apply(qid, "rewrite", "P2", ["definition-heavy", "same-topic-angle-overloaded"], suggested_angle="mechanism")

    # ---- Rule E: cell saturation on non-trivial angles (signal only) ----
    for (topic, angle), n in cell_counts.items():
        if n >= CELL_SATURATION_MIN and angle not in LOW_COGNITIVE_ANGLES:
            for file_name, q in questions:
                if q.get("topic") == topic and q.get("angle") == angle:
                    apply(str(q.get("id")), "review", "P2", ["same-topic-angle-overloaded"])

    # ---- Rule F: semantic clusters ----
    if semantic_report:
        density = semantic_report.get("conceptualClusterDensity", {})
        for cluster in density.get("oversaturatedClusters", []):
            ids = cluster.get("questionIds", [])
            if len(ids) > SEMANTIC_OVERSATURATION:
                keep_id = best_in_cluster(ids, meta)
                for qid in ids:
                    if qid == keep_id:
                        continue
                    apply(qid, "remove", "P1", ["semantic-duplicate"])
        # small near-duplicate pairs -> review
        for pair in semantic_report.get("semanticDuplicateCandidates", []):
            left, right = pair.get("left"), pair.get("right")
            for qid in (left, right):
                if qid in acc and acc[qid]["actionRank"] < ACTION_RANK["review"]:
                    apply(qid, "review", "P2", ["semantic-near-duplicate"])

    # ---- Rule G: reuse audit issues for priority / schema fixes ----
    audit_action = {
        "duplicate-id": ("rewrite", "P0", "duplicate-id"),
        "invalid-angle": ("rewrite", "P0", "invalid-angle"),
        "unmapped-topic": ("review", "P0", "unmapped-topic"),
        "single-answer-count": ("rewrite", "P0", "answer-schema-error"),
        "multiple-answer-count": ("rewrite", "P0", "answer-schema-error"),
        "answer-index-range": ("rewrite", "P0", "answer-schema-error"),
        "duplicate-answer-index": ("rewrite", "P0", "answer-schema-error"),
        "duplicate-question": ("review", "P1", "duplicate-question-text"),
        "placeholder-option": ("rewrite", "P1", "placeholder-option"),
        "duplicate-option": ("rewrite", "P1", "duplicate-option"),
        "missing-source": ("review", "P2", "missing-source"),
    }
    for issue in audit_report.get("issues", []):
        mapping = audit_action.get(issue["code"])
        if not mapping:
            continue
        action, priority, reason = mapping
        apply(issue["id"], action, priority, [reason])

    # finalize
    plan = []
    for qid, e in acc.items():
        plan.append({
            "id": e["id"],
            "action": e["action"] if e["actionRank"] == 0 else list(ACTION_RANK)[e["actionRank"]],
            "reasons": sorted(e["reasons"]),
            "suggestedAngle": e["suggestedAngle"],
            "priority": list(PRIORITY_RANK)[e["priorityRank"]],
            "file": e["file"],
        })
    # stable sort: priority (P0 first), action severity, id
    plan.sort(key=lambda p: (PRIORITY_RANK[p["priority"]], ACTION_RANK[p["action"]], p["id"]))
    return {"plan": plan, "meta": meta, "cellCounts": dict(cell_counts)}


def summarize(plan: list[dict[str, Any]]) -> dict[str, Any]:
    by_action: Counter[str] = Counter(p["action"] for p in plan)
    by_priority: Counter[str] = Counter(p["priority"] for p in plan)
    by_reason: Counter[str] = Counter(r for p in plan for r in p["reasons"])
    return {
        "total": len(plan),
        "byAction": dict(by_action),
        "byPriority": dict(by_priority),
        "byReason": dict(by_reason.most_common()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Propose KEEP/REWRITE/REMOVE for the existing bank (read-only)")
    parser.add_argument("--semantic-report", type=Path, help="optional JSON from `question:analysis --semantic --json`")
    parser.add_argument("--output", type=Path, default=ROOT / "analysis" / "curation-plan.json", help="where to write the plan")
    parser.add_argument("--json", action="store_true", help="print the full plan JSON to stdout")
    parser.add_argument("--action", choices=["keep", "review", "rewrite", "remove"], help="only print entries with this action")
    args = parser.parse_args()

    audit_report = audit()
    semantic_report = load_semantic_report(args.semantic_report) if args.semantic_report else None
    built = build_plan(audit_report, semantic_report)
    plan = built["plan"]
    if args.action:
        plan = [p for p in plan if p["action"] == args.action]

    summary = summarize(plan if args.action else built["plan"])
    doc = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "semanticUsed": semantic_report is not None,
        "summary": summary,
        "plan": plan,
    }
    serialized = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(serialized, encoding="utf-8")

    if args.json:
        print(serialized, end="")
    else:
        print(f"Question bank: {audit_report['summary']['questions']} questions")
        print("Curation plan (read-only — does not modify the bank):")
        print(f"  keep    {summary['byAction'].get('keep', 0)}")
        print(f"  review  {summary['byAction'].get('review', 0)}")
        print(f"  rewrite {summary['byAction'].get('rewrite', 0)}")
        print(f"  remove  {summary['byAction'].get('remove', 0)}")
        print(f"  by priority: {summary['byPriority']}")
        print("  top reasons:")
        for reason, count in list(summary["byReason"].items())[:10]:
            print(f"    {reason}: {count}")
        if semantic_report is None:
            print("  (semantic signal OFF — run `npm run question:curate:semantic` to include near-duplicate clusters)")
        print(f"Plan written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
