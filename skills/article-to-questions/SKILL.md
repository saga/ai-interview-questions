---
name: article-to-questions
description: "把一篇技术文章转成题库题目。用户提供文章链接或正文，要求据此出题、生成面试题或补充题库时使用。"
---

# 文章转题库

把一篇 AI/ML 技术文章转化为可写入题库的选择题，衔接内容生成与题库校验两个阶段。

## 流程

1. 获取文章全文（用户粘贴的正文，或用网页抓取工具取正文；遵守 AGENTS.md 第 5 条：不要高频/反复抓取同一页面，抓一次后离线处理）。
2. 确认题目生成的来源：
   - 如果用户已经把 `docs/prompt.md` 粘到其他在线大模型生成过题目草稿，直接使用该草稿，跳到第 3 步做转换和校验；不要重新生成一遍。
   - 如果用户还没有生成草稿，且要求当前 agent 直接出题，则按 `docs/prompt.md` 的完整规则自行生成：先识别文章中最有面试价值的知识点，覆盖角度用 `src/schemas/common.ts` 的 `questionAngleSchema` 枚举（definition/fundamental/mechanism/comparison/calculation/tradeoff/scenario/debugging/system-design/design），题目必须 self-contained，选项按 `docs/prompt.md` 的去偏规则设计。
   - `docs/prompt.md` 本身是给外部在线大模型使用的独立提示词，不是可被当前 skill 系统调用的子 skill，只作为内容质量标准引用，不要修改它。
3. 判断文章内容归属哪个已有 topic（`src/data/questions/<topic>.json` 与对应 `src/data/knowledge/` 节点），不要为一篇文章随意新建 topic；如果确实是新主题，先确认是否需要在 `src/data/taxonomy.ts` 登记骨架。
4. 把生成结果转成题库 schema 结构：
   - `id`：全局唯一、可读、体现主题（参考同 topic 现有 id 风格）
   - `category`/`topic`：与目标知识节点一致
   - `angle`：来自枚举，不得自造
   - `difficulty`：easy/medium/hard，依题目认知要求判断
   - `formats.choice`：`type`/`options`/`answer`，single 恰好 1 个答案、multiple 至少 2 个
   - `explanation`：解释正确答案和关键误区
5. 运行 `npm run question:coverage`，确认这些题解决的是真实缺口而不是已饱和的 topic × angle 组合；如果发现更值得补的缺口，改用 **fill-coverage-gap** skill 的蓝图再决定题目方向。
6. 把草稿交给 **add-question-to-bank** skill 的完整校验与写入流程（`question:add --check`、去重、语义重复检查、`validate:questions`、`typecheck`、`test`）。本 skill 不重复实现写入逻辑。

## 内容质量把关

- 生成阶段严格执行 `docs/prompt.md` 的 self-contained 要求：转成题库题后，题干不能依赖"文中提到 / 上述方法"等指代原文的表达。
- 文章只提供事实和案例，不能直接把文章里的产品功能名或内部术语变成考点。删掉厂商和产品名后，题目仍必须考察可迁移的 Agent/AI 工程机制、权衡、故障排查或治理原则；否则重写或删除。
- 禁止“某产品中的 X 主要做什么”式名词识别题。专有名词只能出现在来源 metadata 或背景中，正确答案必须能由通用工程知识推导，而不是记忆文章原句。
- 每题只考一个知识点，并在题干中写清目标、约束和判定标准。干扰项要代表真实工程误区，不能用明显荒谬的“删掉测试/换模型/只看 token/完全自动化”等选项凑成四选一。
- 在写入前逐题做产品脱钩审查：移除产品名后独立阅读题干、选项和解析，确认仍可作答且存在真实决策或机制；不通过的题不得进入题库。
- 文章中的时效性事实（版本号、API、基准数据）需要标注核验来源或谨慎处理，不写成绝对结论。
- 若文章内容与已有题库知识点冲突或过时，先向用户报告冲突，不要静默覆盖已有解释。

## 边界

- 本 skill 只负责"内容生成 + 转换成 schema"，不重复实现契约校验、去重、语义分析和写入逻辑，这些统一走 **add-question-to-bank**。
- 不要因为文章篇幅长就机械覆盖全文；只选最有面试价值的部分（`docs/prompt.md` 已有明确的优先级标准）。
- 最终报告需包含：文章来源、生成的题目 id 列表、对应知识点、去重/语义检查结果、仍需人工核实的时效性事实。
