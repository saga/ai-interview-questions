"""Offline question-bank audit using only the Python standard library.

This script is intentionally advisory: TypeScript/Zod remains the source of
truth for the runtime data contract. Use ``npm run question:audit``.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_DIR = ROOT / "src" / "data" / "questions"
KNOWLEDGE_DIR = ROOT / "src" / "data" / "knowledge"
VALID_ANGLES = {
    "definition",
    "fundamental",
    "mechanism",
    "calculation",
    "comparison",
    "tradeoff",
    "scenario",
    "debugging",
    "system-design",
    "design",
}
PLACEHOLDER_RE = re.compile(r"^(?:参见解析|见解析|略|同上|待补充|todo|tbd)$", re.IGNORECASE)
VOLATILE_RE = re.compile(r"(?:aws|amazon|openai|anthropic|google|azure|api|sdk|模型版本|版本号|version|认证考试|claude|gpt|gemini)", re.IGNORECASE)
# 题型门禁阈值（AGENTS.md §4.2）：单选题在选择题中的占比上限。
MAX_SINGLE_RATIO = 1 / 3


def read_bundles(directory: Path) -> list[tuple[str, list[dict[str, Any]]]]:
    bundles: list[tuple[str, list[dict[str, Any]]]] = []
    for path in sorted(directory.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            continue
        bundles.append((path.name, [item for item in payload if isinstance(item, dict)]))
    return bundles


def normalized_text(value: str) -> str:
    folded = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\W_]+", "", folded, flags=re.UNICODE)


def add_issue(issues: list[dict[str, str]], severity: str, code: str, question_id: str, file_name: str, detail: str) -> None:
    issues.append(
        {
            "severity": severity,
            "code": code,
            "id": question_id,
            "file": file_name,
            "detail": detail,
        }
    )


def audit() -> dict[str, Any]:
    question_bundles = read_bundles(QUESTIONS_DIR)
    knowledge_bundles = read_bundles(KNOWLEDGE_DIR)
    questions = [(file_name, question) for file_name, bundle in question_bundles for question in bundle]
    nodes = [node for _, bundle in knowledge_bundles for node in bundle]
    node_ids = {str(node.get("id")) for node in nodes}
    issues: list[dict[str, str]] = []
    ids: dict[str, tuple[str, str]] = {}
    texts: dict[str, tuple[str, str]] = {}
    topic_counts: Counter[str] = Counter()
    difficulty_counts: Counter[str] = Counter()
    angle_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()
    format_counts: Counter[str] = Counter()
    covered_cells: set[tuple[str, str]] = set()

    for file_name, question in questions:
        question_id = str(question.get("id", "<missing-id>"))
        topic = str(question.get("topic", ""))
        angle = str(question.get("angle", ""))
        topic_counts[topic] += 1
        difficulty_counts[str(question.get("difficulty", "<missing>"))] += 1
        angle_counts[angle or "<missing>"] += 1
        category_counts[str(question.get("category", "<missing>"))] += 1

        if question_id in ids:
            add_issue(issues, "P0", "duplicate-id", question_id, file_name, f"also in {ids[question_id][0]}")
        else:
            ids[question_id] = (file_name, question_id)

        question_text = question.get("question")
        if isinstance(question_text, str):
            key = normalized_text(question_text)
            if key and key in texts:
                add_issue(issues, "P1", "duplicate-question", question_id, file_name, f"also in {texts[key][0]} ({texts[key][1]})")
            elif key:
                texts[key] = (file_name, question_id)

        if topic not in node_ids:
            add_issue(issues, "P0", "unmapped-topic", question_id, file_name, f"topic={topic or '<missing>'}")
        if angle not in VALID_ANGLES:
            add_issue(issues, "P0", "invalid-angle", question_id, file_name, f"angle={angle or '<missing>'}")
        elif topic in node_ids:
            covered_cells.add((topic, angle))

        formats = question.get("formats")
        if not isinstance(formats, dict) or not formats:
            add_issue(issues, "P0", "missing-format", question_id, file_name, "formats is empty")
            continue
        choice = formats.get("choice")
        if isinstance(choice, dict):
            format_counts[str(choice.get("type", "<missing>"))] += 1
            options = choice.get("options", [])
            answers = choice.get("answer", [])
            if any(isinstance(option, str) and PLACEHOLDER_RE.fullmatch(option.strip()) for option in options):
                add_issue(issues, "P1", "placeholder-option", question_id, file_name, "choice contains placeholder text")
            normalized_options = [normalized_text(option) for option in options if isinstance(option, str)]
            if len(normalized_options) != len(set(normalized_options)):
                add_issue(issues, "P1", "duplicate-option", question_id, file_name, "choice options repeat")
            if choice.get("type") == "single" and len(answers) != 1:
                add_issue(issues, "P0", "single-answer-count", question_id, file_name, "single choice must have one answer")
            if choice.get("type") == "multiple" and len(answers) < 2:
                add_issue(issues, "P0", "multiple-answer-count", question_id, file_name, "multiple choice needs at least two answers")
            if len(answers) != len(set(answers)):
                add_issue(issues, "P0", "duplicate-answer-index", question_id, file_name, "answer indexes repeat")
            if any(not isinstance(index, int) or index < 0 or index >= len(options) for index in answers):
                add_issue(issues, "P0", "answer-index-range", question_id, file_name, "answer index is outside options")
        else:
            format_counts["open-only"] += 1

        if VOLATILE_RE.search(f"{question_text or ''} {question.get('explanation', '')}") and not question.get("source"):
            add_issue(issues, "P2", "missing-source", question_id, file_name, "volatile vendor/API/model fact has no source")

    expected_cells = {(str(node.get("id")), angle) for node in nodes for angle in node.get("angles", [])}
    gaps = sorted(expected_cells - covered_cells)
    return {
        "summary": {
            "questions": len(questions),
            "knowledgeNodes": len(nodes),
            "files": len(question_bundles),
            "expectedCoverageCells": len(expected_cells),
            "coveredCoverageCells": len(expected_cells) - len(gaps),
            "coverageGaps": len(gaps),
            "issueCounts": dict(Counter(issue["severity"] for issue in issues)),
        },
        "distributions": {
            "category": dict(sorted(category_counts.items())),
            "difficulty": dict(sorted(difficulty_counts.items())),
            "angle": dict(sorted(angle_counts.items())),
            "topic": dict(sorted(topic_counts.items())),
            "choiceFormat": dict(sorted(format_counts.items())),
        },
        "coverageGaps": [{"topic": topic, "angle": angle} for topic, angle in gaps],
        "issues": issues,
    }


def single_ratio(report: dict[str, Any]) -> float:
    """单选题在全部选择题中的占比；无选择题时返回 0。"""
    fmt = report["distributions"]["choiceFormat"]
    total = fmt.get("single", 0) + fmt.get("multiple", 0)
    return fmt.get("single", 0) / total if total else 0.0


def print_choice_format(report: dict[str, Any]) -> None:
    """题型分布只做可见性输出；硬门禁在 question:add（仅约束新导入批次）。"""
    fmt = report["distributions"]["choiceFormat"]
    total = fmt.get("single", 0) + fmt.get("multiple", 0)
    if not total:
        return
    ratio = single_ratio(report)
    flag = "" if ratio <= MAX_SINGLE_RATIO else "  ← 偏低，新题请以多选为主"
    extra = f" · open-only {fmt['open-only']}" if fmt.get("open-only") else ""
    print(
        f"Choice format: single {fmt.get('single', 0)} · multiple {fmt.get('multiple', 0)}"
        f"{extra}（single {ratio * 100:.1f}%，目标 ≤ 33.3%）{flag}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit the question bank without external Python dependencies")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--output", type=Path, help="also write the JSON report to this path")
    parser.add_argument(
        "--gate-format-ratio",
        action="store_true",
        help="exit non-zero when the whole bank skews to single-choice (single ratio > 1/3, per AGENTS.md §4.2). "
        "Off by default: the historical bank is single-heavy, so enabling it today would fail until that is rebalanced. "
        "New-batch enforcement is already a hard gate in `npm run question:add`.",
    )
    args = parser.parse_args()
    report = audit()
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    if args.json:
        print(serialized, end="")
    else:
        summary = report["summary"]
        print(f"Question bank: {summary['questions']} questions / {summary['knowledgeNodes']} knowledge nodes")
        print(f"Coverage: {summary['coveredCoverageCells']}/{summary['expectedCoverageCells']} cells covered; {summary['coverageGaps']} gaps")
        print(f"Issues: {summary['issueCounts'] or 'none'}")
        print_choice_format(report)
        for issue in report["issues"]:
            print(f"[{issue['severity']}] {issue['code']} {issue['id']} ({issue['file']}): {issue['detail']}")
        if args.output:
            print(f"Report written to {args.output}")
    failed = bool(report["summary"]["issueCounts"].get("P0", 0))
    if args.gate_format_ratio and single_ratio(report) > MAX_SINGLE_RATIO:
        print(
            f"✗ 题型门禁失败：全库单选题占比 {single_ratio(report) * 100:.1f}% 超过 1/3（AGENTS.md §4.2）",
            file=sys.stderr,
        )
        failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())