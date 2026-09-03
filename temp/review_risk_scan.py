"""题库知识错误检测器（三）：高风险表述扫描。

三类信号，按「最容易藏事实错误」排序：
  A. 正确项里的绝对量词（所有/任何/必然/总是/绝不…）—— 正确答案通常需要有界，绝对化多半是过断言。
  B. 硬数值断言（复杂度、阈值、年份、倍数、维度）—— 可核对，也最容易记错。
  C. 否定式题干（哪项不正确/不属于/除外）—— 答案键取反，历史上最容易写反。
"""
import json, pathlib, re, collections, sys

ABSOLUTE = re.compile(r"(所有|任何|任意|一切|全都|必然|必定|一定|总是|永远|绝不|绝不会|永远不会|无一例外|不存在.{0,6}情况|只能|唯一)")
NUMBER = re.compile(
    r"(O\([^)]{1,14}\)|Θ\([^)]{1,14}\)|Ω\([^)]{1,14}\)"
    r"|\b(19|20)\d{2}\s*年|\d+(\.\d+)?\s*%|\d+(\.\d+)?\s*(倍|个百分点)"
    r"|\b\d{2,}\s*(ms|毫秒|秒|GB|TB|亿|万|层|维|头|个头)\b)")
NEG_STEM = re.compile(r"(不正确|错误的是|错误的一项|不属于|不是|除外|不包括|不能|不会|无法|有误|不当|不该|避免的是|缺点|缺陷|失败原因|风险是|问题是|瓶颈是|误的是)")

qs = []
for p in sorted(pathlib.Path("src/data/questions").glob("*.json")):
    for q in json.loads(p.read_text(encoding="utf-8")):
        qs.append((p.name, q))

abs_hits, num_hits, neg_hits = [], [], []
for f, q in qs:
    ch = (q.get("formats") or {}).get("choice")
    if not ch:
        continue
    ans = set(ch.get("answer") or [])
    stem = q.get("question", "")
    for i, opt in enumerate(ch.get("options") or []):
        if i not in ans:
            continue                      # 只看正确项：干扰项本来就该是绝对化的错误断言
        if ABSOLUTE.search(opt):
            abs_hits.append((q["id"], f, q.get("topic", ""), stem, opt, ABSOLUTE.findall(opt)))
        if NUMBER.search(opt):
            num_hits.append((q["id"], f, q.get("topic", ""), stem, opt, NUMBER.findall(opt)[:3]))
    if NEG_STEM.search(stem):
        neg_hits.append((q["id"], f, q.get("topic", ""), stem,
                         ch.get("options") or [], sorted(ans), ch.get("type")))

print(f"A. 正确项含绝对量词：{len(abs_hits)} 条")
print(f"B. 正确项含硬数值断言：{len(num_hits)} 条")
print(f"C. 否定式题干：{len(neg_hits)} 条")

which = sys.argv[1] if len(sys.argv) > 1 else "C"
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 25

if which == "A":
    print("\n" + "=" * 108)
    for qid, f, topic, stem, opt, toks in abs_hits[:limit]:
        print(f"\n{qid}  ({f} · {topic})")
        print(f"  题干: {stem[:105]}")
        print(f"  ✔正确项: {opt[:150]}")
        print(f"  命中: {set(toks)}")
elif which == "B":
    print("\n" + "=" * 108)
    for qid, f, topic, stem, opt, toks in num_hits[:limit]:
        print(f"\n{qid}  ({f} · {topic})")
        print(f"  题干: {stem[:105]}")
        print(f"  ✔正确项: {opt[:150]}")
        print(f"  数值: {toks}")
else:
    print("\n" + "=" * 108)
    for qid, f, topic, stem, opts, ans, typ in neg_hits[:limit]:
        print(f"\n{qid}  ({f} · {topic})  type={typ}  answer={ans}")
        print(f"  题干: {stem[:115]}")
        for i, o in enumerate(opts):
            mark = "✔答案键" if i in ans else " "
            print(f"   [{i}]{mark} {o[:120]}")
    print(f"\n（共 {len(neg_hits)} 条，当前显示前 {limit} 条）")
