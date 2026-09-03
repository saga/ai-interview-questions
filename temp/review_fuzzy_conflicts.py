"""题库知识错误检测器（二）：近义选项跨题正误冲突（模糊匹配）。

用字符 3-gram 倒排做候选生成（低频 gram 阻塞），再对候选对算 3-gram Dice 相似度。
只比较**不同题目**之间的选项，且过滤掉「以上都对」这类无信息量选项。
"""
import json, pathlib, re, collections, sys

THRESHOLD = float(sys.argv[1]) if len(sys.argv) > 1 else 0.72
MIN_LEN = 12

NORM = re.compile(r"[\s　,.。;；:：!！?？、（）()\[\]【】\"'“”‘’\-—_/\\]+")
TRIVIAL = re.compile(r"^(以上|以下|都对|都不对|都正确|都不正确|全部|无法确定|无法判断|略|参见解析|见解析)")

def norm(s: str) -> str:
    return NORM.sub("", s).lower()

qs = []
for p in sorted(pathlib.Path("src/data/questions").glob("*.json")):
    for q in json.loads(p.read_text(encoding="utf-8")):
        qs.append((p.name, q))

items = []  # (qid, topic, file, question, is_correct, text, gramset)
for f, q in qs:
    ch = (q.get("formats") or {}).get("choice")
    if not ch:
        continue
    ans = set(ch.get("answer") or [])
    for i, opt in enumerate(ch.get("options") or []):
        t = norm(opt)
        if len(t) < MIN_LEN or TRIVIAL.match(t):
            continue
        grams = {t[j:j + 3] for j in range(len(t) - 2)}
        items.append((q["id"], q.get("topic", ""), f, q.get("question", ""), i in ans, t, grams))

print(f"可比较选项 {len(items)} 条（来自 {len({x[0] for x in items})} 道题）")

# 倒排 + 低频 gram 阻塞
postings = collections.defaultdict(list)
for idx, it in enumerate(items):
    for g in it[6]:
        postings[g].append(idx)

MAX_DF = 150
cand = collections.Counter()
for g, pl in postings.items():
    if len(pl) > MAX_DF or len(pl) < 2:
        continue
    for a in range(len(pl)):
        for b in range(a + 1, len(pl)):
            cand[(pl[a], pl[b])] += 1

def dice(a, b):
    return 2 * len(a & b) / (len(a) + len(b))

id2q = {q["id"]: (f, q) for f, q in qs}
hits = []
for (i, j), _ in cand.items():
    A, B = items[i], items[j]
    if A[0] == B[0]:            # 同一题内不比
        continue
    if A[4] == B[4]:            # 正误一致，不构成冲突
        continue
    s = dice(A[6], B[6])
    if s >= THRESHOLD:
        hits.append((s, A, B))

hits.sort(key=lambda x: -x[0])
print(f"\n近义冲突候选（Dice ≥ {THRESHOLD}）：{len(hits)} 组\n" + "=" * 110)

for s, A, B in hits:
    pos, neg = (A, B) if A[4] else (B, A)
    print(f"\n[相似度 {s:.3f}]  topic: {pos[1]} ↔ {neg[1]}")
    print(f"  ✔ 判对 {pos[0]} ({pos[2]})")
    print(f"       {pos[5][:150]}")
    print(f"       题干: {pos[3][:100]}")
    print(f"  ✘ 判错 {neg[0]} ({neg[2]})")
    print(f"       {neg[5][:150]}")
    print(f"       题干: {neg[3][:100]}")

print(f"\n总计 {len(hits)} 组")
