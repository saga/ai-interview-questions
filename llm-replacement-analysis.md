# 设计分析报告：以传统算法与机器学习替代 LLM 的可行性分析

> **副标题**：在不降低效果的前提下，哪些环节可以用 ML / 传统算法取代大语言模型
> **范围**：`ai-interview-questions` 项目（local-first AI 面试教练）
> **关联决策**：ADR-019 / ADR-036（变体与评分的 LLM 隔离）、ADR-037（Concept×Angle 证据）、ADR-038 / ADR-039（6 大能力域 taxonomy）
> **建议落地**：本报告结论凝结为 **ADR-040（Phase 0 → Phase 3 路线图）**，见第 6 节
> **撰写日期**：2026-08-25
> **代码状态（撰写时实测）**：测试 278 例，276 通过 / 2 失败（见第 7 节）

---

## 0. 摘要（TL;DR）

本项目的 LLM 调用点**非常少且已被严格隔离**——全代码库只有 4 处真正调用 LLM（变体生成、开放题评分、Agent 决策循环、Copilot 对话），且最终分数所有权已归 `domain` 层（`LLMProvider` 只出维度分，`aggregateOverall` 算综合分）。

结论先行：**LLM 可以大幅退居"rich generation + judge 兜底"的角色，核心智能层（选题 / 证据 / 覆盖）应当由确定性算法 + 经典 ML 承担，整体效果不打折**。但必须**分阶段渐进**——`Bandit` / `IRT` 这类数据饥饿型算法在题库信号稀疏时反而有害，应当排在 Phase 3。

本报告第 4 节完整收录了外部 AI 的独立评审意见（critique），第 5 节给出我方自评与采纳结论。

---

## 1. 背景与目标

### 1.1 产品定位
local-first 的个人 AI 面试教练：内置题库（选择题 / 多选题 / 开放题）、自适应选题、作答评分、学习画像、以及可选的 AI 副驾驶对话。

### 1.2 核心问题
> 分析当前的设计，哪些地方可以用 machine learning 或者传统算法，而不是大语言模型来实现？**要求不希望实现效果打折。**

即：在**保持或提升**面试教练效果的前提下，把对 LLM 的依赖降到最低，把"智能"从"调用大模型"转为"用确定性算法 + 经典 ML 系统性地组织"。

### 1.3 关键约束
- **不打折**：任何替代方案不得牺牲考察质量、评分公正性或学习有效性。
- **可解释 / 可离线**：local-first 定位要求核心路径在无 API Key 时仍可运行（当前 `beforeToolCall` 已对开放题评估做开关拦截，选择题确定性判分不受影响）。

---

## 2. 当前 LLM 调用点清单（事实基础）

> 方法学（外部评审也认可）：任何"替代 LLM"的讨论，第一步必须是**先确认 LLM 到底在哪里被调用**，否则容易空谈。以下是基于代码实查的清单。

| # | 文件 | 函数 | LLM 角色 | 当前是否可无 LLM 运行 |
|---|------|------|----------|----------------------|
| 1 | `src/ai/variant.ts` | `generateVariant` | 基于"知识契约"生成一道**真正不同**的题面变体（题干 / 场景 / 选项 / 解析 / distractor 重构） | 否（无 LLM 则无变体；可降级为模板变体） |
| 2 | `src/ai/evaluate.ts` | `evaluateOpenAnswer` | LLM-as-Judge：对开放 / 编程题给四维评分（correctness / completeness / architecture / communication）+ 反馈 | 部分（选择题确定性判分 `gradeChoice` 无 LLM；开放题需 LLM） |
| 3 | `src/agent/interviewAgent.ts` + `src/agent/tools.ts` | `createInterviewAgent` / AgentTool 集 | `pi-agent-core` 决策循环：选题、追问、结束面试 | **大部分是**：Agent 只做"不确定决策"，选题 / 评分 / 读画像全部走**确定性 tools**（`gradeChoice`、薄弱主题推荐、`angleCoverage` 读取） |
| 4 | `CopilotSidebar` | — | 副驾驶自由对话（答疑 / 提示） | 否（本质就是对话） |

### 2.1 架构已有的"LLM 隔离"事实（重要）
- **接口隔离**：`LLMProvider` 抽象 + `useAI` 开关，底层可换（云端 / Chrome 本地 / 关闭）。
- **分数所有权**（ADR-019 / ADR-036）：`evaluate.ts` 中 LLM 只输出四维 `dimensions`，综合分 `overall` 一律由 `domain/aggregateOverall` 按权重算——**LLM 不拥有最终分数**。
- **变体约束**（ADR-036）：LLM 可重构所有 Presentation，但必须保持"知识契约"不变量，输出经 `domain` 校验。
- **Agent 分工**（ADR-034）：Agent 只决策，确定性逻辑全在 `tools.ts`；开放题评估需 LLM 时由 `beforeToolCall` 在无效 key 下拦截。

**结论**：本项目不是"LLM 驱动一切"，而是"LLM 已被框在 4 个窄接口里"。这正是可以安全做减法的前提。

---

## 3. 逐调用点：替代方案与效果评估

对每个 LLM 调用点，给出**等价替代 / 更优替代 / 会打折 / 路线**。

### 3.1 变体生成（`variant.ts`）
- **模板变体（等价，可立刻做）**：对 `scenario`（换场景背景）、`calculation`（换数值）、`comparison`（换对比对象）三类变体，用参数化模板 + 题库元数据生成，**效果等同甚至更可控**。
- **rich variant（会打折，保留 LLM）**：真正"换一种考察角度"的变体（如 MHA → GQA 的显存权衡、精妙 distractor 设计）目前仍是 LLM 强项。模板只能做"表面改写"，做不了"语义重构"。
- **路线**：`LLM rich gen + 确定性校验`。LLM 生成后，用嵌入相似度 / 知识契约校验做 **semantic validation**（确认正确选项语义一致、未引入无依据结论），失败则回退模板变体。

### 3.2 开放题评分（`evaluate.ts`）
- **三层评估（外部评审核心主张，见第 4 节）**：
  1. **确定性层**：结构校验（是否答出必含要素、格式、关键术语命中）、规则打分（长度 / 要点计数）。
  2. **语义证据层**：用句向量（embedding）+ cosine，判断回答**是否命中 required-points**（"提到没"）。
  3. **LLM judge 层**：复杂开放题的最终质量判断（"对不对 / 好不好"）仍交给 LLM，**作为兜底而非唯一裁判**。
- **关键点**：embedding 是 **evidence detector（证据探测器）**，不是 **grader（判分器）**。它能判"覆盖了哪些要点"，但判不了"说得对不对"——后者仍是 LLM 或人工的领地。

### 3.3 选题决策（`adaptive.ts` + `tools.ts`）
- **确定性 ranking（等价且更稳，立刻做）**：当前 `pickNextAdaptive` 已经基于 `Concept×Angle coverage` + 薄弱主题 + 难度梯度做决策（`deep-dive` / `gap-probe` / `broaden` / `move-on`）。这层**完全不需要 LLM**，且比"让 LLM 自由选"更可复现、更公平。
- **经典 ML（更优，Phase 2）**：`BKT` / `DKT` 掌握度追踪、`IRT` 难度校准——在数据充足后比当前启发式更准确。
- **反模式**：一开始就上 `Bandit`（强化学习选题）——**数据不够时会选出垃圾题**，应先 deterministic ranking。

### 3.4 去重 / 检索（`coverage.ts` / 题库质检）
- **TF-IDF / 嵌入 + MMR（等价）**：题目去重、相似题检索、coverage 缺口推荐，用传统检索 + 最大边际相关（MMR）即可，无需 LLM。
- **概念重要性（反模式）**：用 `PageRank` / `HITS` 给概念排重要性——**over-design**，拓扑排序（prerequisite 闭包）已足够表达依赖与重要性。

### 3.5 Copilot 对话（保留 LLM）
自由问答 / 提示 / 解释，本质就是对话，**没有等价替代**，保留 LLM（且已受 `useAI` 开关与 key 校验保护）。

---

## 4. 外部 AI 评审意见（完整收录）

> 以下为另一 AI 对本项目所做独立 critique 的结构化转述，原样收录，未做删改。其方法学被我方采纳，三处过强判断被我方认错（见第 5 节）。

### 4.1 方法论认可
- 先**确认 LLM 调用点**再谈替代——方向正确，避免了空谈。

### 4.2 三处纠偏（原分析"过强"的地方）
1. **变体生成**：模板变体只能覆盖 `scenario` / `calculation` / `comparison` 三类；**rich variant**（如 MHA→GQA 显存权衡、distractor 语义精妙度）仍是 LLM 强项。正确做法：模板当 **fallback**，配合 **semantic validation**，而非"模板可全面替代"。
2. **句向量评分**：embedding 只能判"**提到没**"，不能判"**对不对**"。反例：问 KV Cache 存什么，回答"存 attention score"与"存 K/V 矩阵"余弦相似度可能很高，但前者正确、后者错误——高相似 ≠ 正确。因此 **embedding 是 evidence detector，不是 grader**。
3. **不要立即上 Bandit**：数据量不足以支撑强化学习选题，提前上 Bandit 会选出劣质题、污染画像。**先 deterministic ranking**，等信号充足再升级。

### 4.3 核心主张
- **开放题三层评估**：确定性 → 语义证据 → LLM judge（第 3.2 节已采）。
- **Concept×Angle coverage 立为"确定性智能层"的核心**：它不是生产端的度量，而应成为运行时选题 / 追问 / 补漏的**单一智能来源**。
- **难度 declared vs observed**：题目声明难度（`q.difficulty`）与实测难度（用户作答分布）应拆为两个字段，用实测校准声明。
- **去重 = embedding + MMR**；**概念重要性不靠 PageRank**（over-design）。
- **Agent 的角色**：Agent 是"interaction intelligence"（交互智能），不是"trainer 的全部 intelligence"——确定性智能应留在 `domain` 层。

### 4.4 落地优先级（P0 五条 + 分阶段）
**P0（立刻可做，零新增 ML 依赖）：**
1. 把 `Concept×Angle coverage` 接进运行时选题（`angleCoverage` / `weakAnglesOf` 已落地于 ADR-037，可直接消费）。
2. 确定性选题排序（基于 coverage + 薄弱度 + 难度梯度）。
3. 嵌入去重（题库质检 / 相似题检索）。
4. 开放题 `required-point` 用嵌入做**证据命中**（非判分）。
5. 变体 = `LLM rich gen + 确定性校验`。

**Phase 2（数据就绪后）：** `BKT` / `DKT` 掌握度、`IRT` 难度校准。
**Phase 3（信号充足后）：** `Bandit` 自适应选题。

---

## 5. 我方自评与采纳结论

### 5.1 认错三处过强（已采纳外部评审）
- **variant**：原"模板可等价替代"过强——rich variant 仍需 LLM。修正为"模板 fallback + semantic validation"。
- **embedding**：原"句向量可判要点正确性"过强——embedding 只能做 evidence detector。修正为"证据命中，非判分"。
- **Bandit**：原"可上 Bandit 选题"过强——数据不够时有害。修正为"先 deterministic，Phase 3 再上"。

### 5.2 完全采纳的核心洞察
- **Concept×Angle coverage 是确定性智能层核心**——这把原本"生产端度量"升级为"运行时智能"，与 ADR-037 的逐角度证据天然闭环，应当成为 ADR-040 的骨架。
- **Agent = interaction intelligence，非全部 intelligence**——与现有 `tools.ts` 的"Agent 只决策、确定性全在 domain"分工一致，确认方向正确。

### 5.3 我方补充（边际增强）
- **拓扑排序排 prerequisite 路径仍合理**：`conceptGraph.prerequisiteClosure` + `relatedOf` 已是确定性选题的可靠依赖表达，保留。
- **validation 用 embedding 而非二次 LLM**：变体 / 答案校验用嵌入相似度做确定性校验，避免"用 LLM 校验 LLM"的循环与成本。
- **Phase 2 地基已埋**：`QuestionResult` 已带 `concept` / `subtopic` / `angle` / `difficulty` / `score` / `attempt` 雏形，掌握度追踪与 IRT 可直接消费，无需重构数据层。
- **declared vs observed 难度应当拆字段**：当前 `q.difficulty` 单字段，建议拆 `declaredDifficulty` 与运行时 `observedDifficulty`，用作答分布回填。

### 5.4 对评审的保留意见（无冲突，仅补充边界）
- 外部评审未提及 `CopilotSidebar`——确认其保留 LLM，不纳入替代范围。
- P0⑤（变体 = LLM gen + 校验）意味着**变体生成仍依赖 LLM**，这与"尽量去 LLM 化"的目标不矛盾：变体是"锦上添花"的多样性功能，非核心学习路径；核心路径（选题 / 评分 / 覆盖）已去 LLM。

---

## 6. 建议落地路线（ADR-040 草案）

| 阶段 | 内容 | 是否依赖 LLM | 数据门槛 |
|------|------|--------------|----------|
| **Phase 0（P0 五条）** | ① Concept×Angle coverage 接运行时选题 ② 确定性选题排序 ③ 嵌入去重 ④ 开放题 required-point 嵌入证据 ⑤ 变体 = LLM gen + 确定性校验 | 仅 ⑤ | 低（现有题库即可） |
| **Phase 1** | 难度 declared/observed 双字段；去重升级为 embedding + MMR | 否 | 低 |
| **Phase 2** | BKT / DKT 掌握度；IRT 难度校准 | 否 | 中（需足量作答记录） |
| **Phase 3** | Bandit 自适应选题 | 否 | 高（需千级作答样本） |

**何时仍必须保留 LLM（不可降级）：**
- rich variant 生成（语义重构型变体）；
- 复杂开放题的 judge 层（"对不对 / 好不好"）；
- Copilot 自由对话。

---

## 7. 当前状态与风险（撰写时实测）

### 7.1 测试状态
- **实测**：278 例，276 通过 / **2 失败**。
- 失败项均在**确定性选择层**（即本报告主张要"扛大梁"的层）：
  - `src/domain/adaptive.test.ts` → `move-on：传入 profile 时优先薄弱主题`
  - `src/domain/learner.test.ts` → `suggestNextTopics：无可推荐薄弱项时按拓扑序给出 readyToLearn 建议`
- **根因判断**：非生产逻辑回归。
  - `adaptive.move-on`：测试 fixture 把 `idempotency` 设为薄弱主题，但 `POOL` 里只有 `reliability` 没有 `idempotency`——弱主题加权无法命中，**反而证明弱主题优先逻辑本身正确，是测试数据自相矛盾**。
  - `learner.suggestNextTopics`：断言所有 `readyToLearn` 建议 reason 必须为 `'前置知识已具备，适合开始学习'`，但 `suggestNextTopics` 也会返回薄弱主题（reason 为"已练 N 次、均分 X，尚未达到掌握线"），断言过约束。
- **结论**：这 2 个失败是**测试漂移**，但恰好提醒我们——在让确定性层真正替代 LLM 选题之前，应先把这些测试修对、把该层的契约钉死。

### 7.2 数据就绪度风险（决定 ML 阶段能否启动）
- **87 道孤儿题**：`topic` 是旧 slug 而非知识点 id，覆盖矩阵统计不到 → coverage 信号稀疏。
- **7 个空白 topic**：`cnn` / `sequence-models` / `multimodal` / `mcp` / `planning` / `data-leakage` / `tool-security` 暂无任何知识点。
- **角度标注缺失**：大量题未标 `angle`，`angleCoverage` 证据稀薄 → `Bandit` / `IRT` 短期不可行（印证外部评审的 Phase 3 排序）。
- **6 道 Agent 多选**：由 Agent 按标准知识生成，非用户原版，待与用户原题核对。

### 7.3 功能缺口（与替代方案相关）
- IndexedDB 查询 API 未暴露 → 运行时消费 `angleCoverage` / 画像做选题时，取数通道需补。
- subtopic 级证据尚未做 → Concept×Angle 闭环目前到 angle 层，subtopic 待补。

---

## 8. 结论

1. **LLM 已被良好隔离**，全库仅 4 处调用，且分数所有权在 `domain`——这是做减法的坚实前提。
2. **核心智能层（选题 / 证据 / 覆盖）应由确定性算法 + 经典 ML 承担，效果不打折**：确定性 ranking 等价且更稳，BKT/DKT/IRT 更优，embedding 做证据探测。
3. **LLM 退居两类不可降级场景**：rich variant 生成、复杂开放题 judge、Copilot 对话。
4. **必须分阶段**：P0（确定性智能层）→ Phase 1（难度双字段 / MMR）→ Phase 2（BKT/IRT）→ Phase 3（Bandit）。数据饥饿型算法（Bandit/IRT）不可提前。
5. **落地前的硬门槛**：先修对确定性层的 2 个漂移测试、补 87 孤儿题挂靠与角度标注——否则 coverage 信号不足以支撑任何 ML 升级。

---

## 附录 A：关键文件引用

| 文件 | 角色 |
|------|------|
| `src/ai/variant.ts` | 变体生成（LLM 调用点 1） |
| `src/ai/evaluate.ts` | 开放题评分（LLM 调用点 2，分数所有权归 domain） |
| `src/agent/interviewAgent.ts` | Agent 决策循环（LLM 调用点 3） |
| `src/agent/tools.ts` | 确定性工具层（选题 / 评分 / 薄弱读取） |
| `src/domain/adaptive.ts` | 确定性自适应选题（4 策略） |
| `src/domain/learner.ts` | 学习画像 / 薄弱推荐 / 掌握度 |
| `src/domain/coverage.ts` | topic×angle 覆盖矩阵（生产端度量） |
| `src/data/taxonomy.ts` | 6 大能力域 → 28 topic + 角度白名单（ADR-038） |
| `docs/DECISIONS.md` | ADR-019 / 036 / 037 / 038 / 039 |
| `CHECKLIST.md` | 根目录待办清单（结构 / 内容 / 数据流缺口） |

## 附录 B：术语
- **Concept×Angle coverage**：以"概念 × 考察角度"为格子的覆盖 / 证据矩阵，本项目确定性智能层的核心。
- **evidence detector vs grader**：embedding 只能探测"是否命中要点"，不能判定"是否正确"——前者是证据探测，后者是判分。
- **deterministic ranking**：基于 coverage + 薄弱度 + 难度梯度的可复现选题排序，非 LLM 自由选。
- **declared / observed difficulty**：题目声明的难度 vs 用户实测作答分布反推的难度，应拆为两字段。
- **MMR（Maximal Marginal Relevance）**：最大边际相关，用于去重时兼顾相关性与多样性。
