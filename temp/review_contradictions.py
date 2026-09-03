"""题库知识错误检测器（一）：跨题正误冲突。

原理：把每个选项抽成 (题目, 是否正确) 二元组。若同一表述在 A 题是正确项、在 B 题是干扰项，
则至少有一题的答案键错了。这是全库扫描里信噪比最高的一类信号——精确匹配优先。
"""
import json, pathlib, re, collections, sys

NORM = re.compile(r"[\s　,.。;；:：!！?？、（）()\[\]【】\"'“”‘’\-—_/\\]+")

def norm(s: str) -> str:
    return NORM.sub("", s).lower()

TRIVIAL = re.compile(r"^(以上|以下|都对|都不对|都正确|都不正确|全部|无法确定|无法判断|略|参见解析|见解析)")

qs = []
for p in sorted(pathlib.Path("src/data/questions").glob("*.json")):
    for q in json.loads(p.read_text(encoding="utf-8")):
        qs.append((p.name, q))

# (norm_text) -> {True: [ids], False: [ids]}
claims = collections.defaultdict(lambda: {True: [], False: []})
for f, q in qs:
    ch = (q.get("formats") or {}).get("choice")
    if not ch:
        continue
    ans = set(ch.get("answer") or [])
    for i, opt in enumerate(ch.get("options") or []):
        t = norm(opt)
        if len(t) < 12 or TRIVIAL.match(t):
            continue
        claims[t][i in ans].append(q["id"])

conflicts = [(t, v[True], v[False]) for t, v in claims.items() if v[True] and v[False]]
print(f"精确冲突：{len(conflicts)} 组\n" + "=" * 100)

# 选项索引，便于回看原文
opt_by_id = {}
for f, q in qs:
    ch = (q.get("formats") or {}).get("choice")
    if ch:
        ans = set(ch.get("answer") or [])
        opt_by_id[q["id"]] = (f, q.get("question", ""), ch.get("options") or [], ans)

id2q = {q["id"]: (f, q) for f, q in qs}

for t, yes, no in sorted(conflicts, key=lambda x: -min(len(x[1]), len(x[2]))):
    print(f"\n【冲突】共 {len(yes)} 题判对 / {len(no)} 题判错")
    print(f"  表述: {t[:110]}")
    for side, ids in ((("✔ 正确项", yes)), ("✘ 干扰项", no)):
        for i in ids[:4]:
            f, qq = id2q[i]
            print(f"    {side} {i}  ({f})")
            print(f"       题干: {qq.get('question','')[:95]}")
        if len(ids) > 4:
            print(f"    …另有 {len(ids)-4} 题")
print(f"\n总计 {len(conflicts)} 组精确冲突")
