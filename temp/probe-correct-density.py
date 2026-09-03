"""P1-6 校准探针：正确项「信息密度 / 认知层级」相对干扰项的信号分布。

只读，不改题库。目的：在把它写进 question_curate.py 之前，先量清楚
阈值的命中量与误杀量——本轮所有门禁阈值都要求「先量再定」。

用法：python3 temp/probe-correct-density.py [样本条数]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS_DIR = ROOT / "src" / "data" / "questions"

# 具体度标记：数字（含量词/百分比）与拉丁术语。与 audit-question-quality.ts ③ 同口径。
SPEC_RE = re.compile(r"[0-9]+(\.[0-9]+)?%?|[A-Za-z]{2,}")

# 空泛 / 永远正确 / 无诊断价值的正确项措辞。
# 注意：「取决于」**不能**入表——中文技术写作里它绝大多数是「X 取决于 Y」的技术性因果
# 表述（实测 5 条命中全是这种，精确率 0/5）。真正要抓的是「不作判断」的套话。
HEDGE_RE = re.compile(
    r"视情况而定|视具体情况|看情况|需要权衡|因地制宜|不能一概而论|无法一概而论|"
    r"没有固定答案|没有标准答案|以上都对|以上均正确|以上都不对|均不正确|"
    r"无法判断|难以确定|不一定|因场景而异"
)

# 「取决于」的技术性用法（用于把上面误纳的排除掉）
DEPENDS_TECH_RE = re.compile(r"取决于[^，。；]{0,12}(是否|具体实现|配置|场景|策略|参数|需求)")

# 低层级（纯定义复述）措辞
DEFINITION_RE = re.compile(r"^(是指|指的是|即|就是|是一种|本质是)\b|定义为")


def spec(text: str) -> int:
    return len(SPEC_RE.findall(text))


def load() -> list[dict]:
    out: list[dict] = []
    for f in sorted(QUESTIONS_DIR.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        if isinstance(data, list):
            out.extend(q for q in data if isinstance(q, dict))
    return out


def choice_of(q: dict):
    fmts = q.get("formats") or {}
    ch = fmts.get("choice") if isinstance(fmts, dict) else None
    return ch if isinstance(ch, dict) else None


def main() -> int:
    n_sample = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    qs = load()
    rows: list[dict] = []
    for q in qs:
        ch = choice_of(q)
        if not ch:
            continue
        opts = [str(o) for o in ch.get("options", [])]
        ans = set(i for i in ch.get("answer", []) if isinstance(i, int) and 0 <= i < len(opts))
        if not opts or not ans:
            continue
        correct = [opts[i] for i in sorted(ans)]
        distr = [o for i, o in enumerate(opts) if i not in ans]
        if not distr:
            continue
        mlen_c = sum(len(t) for t in correct) / len(correct)
        mlen_d = sum(len(t) for t in distr) / len(distr)
        spec_c = sum(spec(t) for t in correct) / len(correct)
        spec_d = sum(spec(t) for t in distr) / len(distr)
        rows.append(
            {
                "id": str(q.get("id")),
                "type": ch.get("type"),
                "mlen_c": mlen_c,
                "mlen_d": mlen_d,
                "ratio": mlen_c / mlen_d if mlen_d else 1.0,
                "spec_c": spec_c,
                "spec_d": spec_d,
                "hedged": [t for t in correct if HEDGE_RE.search(t)],
                "defish": [t for t in correct if DEFINITION_RE.search(t)],
                "correct": correct,
                "distr": distr,
            }
        )

    total = len(rows)
    ratios = sorted(r["ratio"] for r in rows)
    print(f"选择题总数：{total}")
    print(
        "正确项/干扰项 均长比 分位："
        f"p5={ratios[int(total * 0.05)]:.2f} "
        f"p25={ratios[int(total * 0.25)]:.2f} "
        f"p50={ratios[total // 2]:.2f} "
        f"p75={ratios[int(total * 0.75)]:.2f} "
        f"p95={ratios[int(total * 0.95)]:.2f}"
    )

    # 候选规则 1：密度泄题（正确项显著更具体）
    for thr in (1.5, 1.6, 1.8, 2.0):
        hit = [r for r in rows if r["ratio"] >= thr and r["spec_c"] > r["spec_d"]]
        print(f"  K1 ratio>={thr} 且 spec_c>spec_d → {len(hit)} 条（{len(hit) / total * 100:.1f}%）")

    # 候选规则 2：正确项空泛（显著短于干扰项）
    for thr in (0.5, 0.6, 0.7):
        hit = [r for r in rows if r["ratio"] <= thr]
        print(f"  K2 ratio<={thr} → {len(hit)} 条（{len(hit) / total * 100:.1f}%）")

    # 候选规则 3：正确项是空泛/不可证伪措辞
    hedged = [r for r in rows if r["hedged"]]
    print(f"  K3 正确项命中空泛措辞 → {len(hedged)} 条（{len(hedged) / total * 100:.1f}%）")

    # 候选规则 2b：正确项「既更短、又更不具体」——才是真的空泛；
    # 只短不空（干扰项被塞长）归 ② 管，不应重复计数。
    for thr in (0.6, 0.7, 0.8):
        hit = [r for r in rows if r["ratio"] <= thr and r["spec_c"] < r["spec_d"]]
        print(f"  K2b ratio<={thr} 且 spec_c<spec_d → {len(hit)} 条（{len(hit) / total * 100:.1f}%）")

    # 候选规则 4：认知层级倒挂——正确项只是定义/命名，干扰项反而带条件/量化
    for thr in (1.0, 1.5, 2.0):
        hit = [
            r
            for r in rows
            if r["defish"] and any(not DEFINITION_RE.search(t) for t in r["correct"]) is False
            and r["spec_d"] >= thr * max(r["spec_c"], 0.01)
        ]
        print(f"  K4 纯定义型正确项 且 干扰项具体度 ≥{thr}× → {len(hit)} 条（{len(hit) / total * 100:.1f}%）")

    def show(title: str, items: list[dict], key=lambda r: -r["ratio"]) -> None:
        print(f"\n── {title}（展示 {min(n_sample, len(items))}/{len(items)}）──")
        for r in sorted(items, key=key)[:n_sample]:
            print(f"\n[{r['id']}] ratio={r['ratio']:.2f} spec {r['spec_c']:.1f} vs {r['spec_d']:.1f} ({r['type']})")
            for t in r["correct"]:
                print(f"    ✓ {t[:90]}")
            for t in r["distr"][:3]:
                print(f"    · {t[:90]}")

    show("K1 密度泄题（≥1.5）", [r for r in rows if r["ratio"] >= 1.5 and r["spec_c"] > r["spec_d"]])
    show("K2 正确项更短（≤0.6）", [r for r in rows if r["ratio"] <= 0.6], key=lambda r: r["ratio"])
    show("K2b 正确项既短又空（≤0.7 且更不具体）", [r for r in rows if r["ratio"] <= 0.7 and r["spec_c"] < r["spec_d"]], key=lambda r: r["ratio"])
    show("K3 空泛措辞正确项", hedged)
    show("K4 层级倒挂（正确项纯定义、干扰项更具体）", [r for r in rows if r["defish"] and all(DEFINITION_RE.search(t) for t in r["correct"]) and r["spec_d"] >= 1.5 * max(r["spec_c"], 0.01)])
    return 0


if __name__ == "__main__":
    sys.exit(main())
