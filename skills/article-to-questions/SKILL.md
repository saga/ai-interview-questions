---
name: article-to-questions
description: "把一篇技术文章转成题库题目。用户提供文章链接或正文，要求据此出题、生成面试题或补充题库时使用。"
---

# 文章转题库

把一篇 AI/ML 技术文章转化为可写入题库的选择题，衔接内容生成与题库校验两个阶段。

## 流程

1. 获取文章全文（用户粘贴的正文，或用网页抓取工具取正文；遵守 AGENTS.md 第 5 条：不要高频/反复抓取同一页面，抓一次后离线处理）。
2. 确认题目生成的来源：
   - 如果用户已经把 `docs/添加题库prompt.md` 粘到其他在线大模型生成过题目草稿，直接使用该草稿，跳到第 3 步做转换和校验；不要重新生成一遍。
   - 如果用户还没有生成草稿，且要求当前 agent 直接出题，则按 `docs/添加题库prompt.md` 的完整规则自行生成：先识别文章中最有面试价值的知识点，覆盖角度用 `src/schemas/common.ts` 的 `questionAngleSchema` 枚举（definition/fundamental/mechanism/comparison/calculation/tradeoff/scenario/debugging/system-design/design），题目必须 self-contained，选项按 `docs/添加题库prompt.md` 的去偏规则设计。
   - `docs/添加题库prompt.md` 是本仓库统一的内容质量标准（Concept Scope / Answer Determinism / Option-level consistency / Diagnostic Value 等核心约束的来源），也是各出题 skill 共同引用的规范；如需调整质量标准，直接改它，并同步更新本 skill 与 `add-question-to-bank`、`check-question-bank-quality` 中的引用。
3. 判断文章内容归属哪个已有 topic（`src/data/questions/<topic>.json` 与对应 `src/data/knowledge/` 节点），不要为一篇文章随意新建 topic；如果确实是新主题，先确认是否需要在 `src/data/taxonomy.ts` 登记骨架。
4. 把生成结果转成题库 schema 结构：
   - `id`：全局唯一、可读、体现主题（参考同 topic 现有 id 风格）
   - `category`/`topic`：与目标知识节点一致
   - `angle`：来自枚举，不得自造
   - `difficulty`：easy/medium/hard，依题目认知要求判断
   - `formats.choice`：`type`/`options`/`answer`，single 恰好 1 个答案、multiple 至少 2 个；**默认按 multiple 起草**，只有结论唯一的题才用 single，并确认本批 multiple 占比 ≥ 2/3
   - `explanation`：解释正确答案和关键误区
5. 运行 `npm run question:coverage`，确认这些题解决的是真实缺口而不是已饱和的 topic × angle 组合；如果发现更值得补的缺口，改用 **fill-coverage-gap** skill 的蓝图再决定题目方向。
6. 把草稿交给 **add-question-to-bank** skill 的完整校验与写入流程（`question:add --check`、去重、语义重复检查、`validate:questions`、`typecheck`、`test`）。本 skill 不重复实现写入逻辑。

## 内容质量把关

- 生成阶段严格执行 `docs/添加题库prompt.md` 的 self-contained 要求：转成题库题后，题干不能依赖"文中提到 / 上述方法"等指代原文的表达。
- **题干与解析会被检索出来并带引用直接展示**（ADR-063 §8）：Copilot 把 `explanation` 原样拼进 prompt 并附 `[Q] <题干>` 引用标记。因此解析必须脱离原文独立成立——"见上文 / 文中方案"这类指代表述被单独引用后就是废话；题干同理，单独出现时也要能自证。
- 文章只提供事实和案例，不能直接把文章里的产品功能名或内部术语变成考点。删掉厂商和产品名后，题目仍必须考察可迁移的 Agent/AI 工程机制、权衡、故障排查或治理原则；否则重写或删除。
- 来源框架、Lens、认证考纲和文章标题不能成为答题前提。禁止"哪种做法符合某 Lens/框架""某框架建议什么"这类来源分类记忆题；必须将原则改写为自包含的目标、约束和验收标准，来源名称只能出现在 `source` metadata。
- 禁止"某产品中的 X 主要做什么"式名词识别题。专有名词只能出现在来源 metadata 或背景中，正确答案必须能由通用工程知识推导，而不是记忆文章原句。
- 每题只考一个知识点，并在题干中写清目标、约束和判定标准。干扰项要代表真实工程误区，不能用明显荒谬的"删掉测试/换模型/只看 token/完全自动化"等选项凑成四选一。
- **题型以多选题为主**（AGENTS.md §4.2）：一批题里 multiple 应 ≥ 2/3，single 只用于结论唯一、无法拆成多个独立判断的情形。遇到"下列哪项描述最准确"这类把多个独立判断压成最优选项的单选题，应改写为多选。
- **选项必须逼出思考**：干扰项要"差点就对"——半对（部分正确但漏前提）、条件错配（机制对但场景错）、因果倒置、程度/范围偏差、概念邻近混淆，让考生必须逐条推理而非靠排除法秒选。
- 在写入前逐题做产品脱钩审查：移除产品名后独立阅读题干、选项和解析，确认仍可作答且存在真实决策或机制；不通过的题不得进入题库。
- 文章中的时效性事实（版本号、API、基准数据）需要标注核验来源或谨慎处理，不写成绝对结论。
- 若文章内容与已有题库知识点冲突或过时，先向用户报告冲突，不要静默覆盖已有解释。

### 内容质量核查清单

每道题在转成 schema 并交给 **add-question-to-bank** 之前，逐题确认：

- **Core Concept**：能否一句话说清这道题考的是哪个核心 Concept？`concepts` 第一个元素是否就是它？除 comparison/design/system-design 外，是否没有混入多个独立 Concept？
- **Cognitive Task**：这道题要求的是哪种真实认知任务（判断机制 / 比较权衡 / 定位故障 / 做工程判断）？是否与题干的 angle 一致，而不是"记住术语 / 文章原句"？
- **Answer Determinism**：在题干约束下，正确答案（或正确集合）是否唯一稳定？`single` 是否恰好一个选项恒成立；`multiple` 各正确项是否独立成立、各错误项是否独立可解释地错？是否依赖了题干未写出的隐藏前提？
- **Option Quality**：所有选项是否同一决策层级与粒度？正确项是否仅因"更完整 / 更多组件 / 更多条件"自然胜出？难度是否来自技术判断而非信息量？干扰项是否"差点就对"而非稻草人？
- **Diagnostic Value**：考生答错时，能否较明确地定位他缺哪个 Concept、机制或工程判断？如果做错了却说不清缺在哪，诊断价值低，应重写。
- **Retrieval Visibility**：遮住正确项后，题干+选项在 hint 模式下是否仍然不指向唯一答案？`explanation` 被 `[Q]` 引用单独展示时是否仍能自证？`misconceptions` 是否已填（hint 模式下"错在哪"的唯一证据）？

**注意**：`npm run question:coverage` 的"缺口数"是选题信号，不是质量通过条件。覆盖率达标不代表题目合格；质量门以本清单 + **add-question-to-bank** 的"结构质量门槛"为准。

## 边界

- 本 skill 只负责"内容生成 + 转换成 schema"，不重复实现契约校验、去重、语义分析和写入逻辑，这些统一走 **add-question-to-bank**。
- 不要因为文章篇幅长就机械覆盖全文；只选最有面试价值的部分（`docs/添加题库prompt.md` 已有明确的优先级标准）。
- 最终报告需包含：文章来源、生成的题目 id 列表、对应知识点、去重/语义检查结果、仍需人工核实的时效性事实。
