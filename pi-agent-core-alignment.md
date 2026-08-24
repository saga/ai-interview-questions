# pi-agent-core 路线与历史设计的一致性分析报告（Lessons-Learned 对齐）

> **副标题**：当前 `pi-agent-core` 路线在"边界卫生"上正确，但在"范围"上重复了两个曾被明确否定的历史设计——需统一到"Agent 是交互层、确定性 Question Policy 是真理来源"
> **范围**：`src/agent/*`（pi-agent-core 运行时）与 `docs/DECISIONS.md` / `AGENTS.md` 历史决策的一致性审查
> **关联文档**：`llm-replacement-analysis.md`（v2，核心架构图）、`docs/DECISIONS.md`、`AGENTS.md`
> **日期**：2026-08-25
> **结论前置**：报告不主张删除 `pi-agent-core`，而主张**重新锚定它的定位**——这同时消解了 ADR-019/030 与 ADR-034 在 DECISIONS.md 中的内部矛盾。

---

## 0. 摘要（TL;DR）

1. **好的一面（边界卫生已遵守历史 lesson）**：`src/agent/*` 正确地做到了——
   - 分数所有权归 `domain`（`tools.evaluateAnswer` 调 `gradeChoice` / `evaluateOpenAnswer`，Agent 只读 `EvaluationResult`）；
   - 持久化复用既有管线（`sessionRecordFromAgent → sessionFromQuiz → updateLearner`）；
   - 工具是确定性薄包装（`tools.ts` 不新增业务决策）；
   - LLM 输出不被直接信任（评分经 `aggregateOverall` 聚合）。
   这些与 ADR-019 / ADR-036 / ADR-006 完全一致。

2. **需要修正的一面（范围重复了历史错误）**：当前路线把"**下一题问什么 / 是否追问 / 何时结束**"交给 LLM Agent 在运行时实时决策（`prompt.ts` + `interviewAgent.ts`）。这重复了两个曾被明确否决的历史设计：
   - **(a) 运行时 LLM 决策**（ADR-024→027 删除的"运行时题型变换"的**选题版**）；
   - **(b) Agent loop / LLM 策略 Agent**（ADR-019 移除 pi-agent-core、ADR-030 明写"Agent loop 明确不做"、ADR-019"保留不动：确定性自适应策略（不引入 LLM 策略 Agent）"）。

3. **统一原则（与 v2 报告架构图一致）**：
   ```
   Trainer Policy（确定性 / ML）  →  candidate questions  →  pi-agent-core（ask / follow-up / finish）  →  LLM
   ```
   **Agent 是 interaction intelligence（交互层），不是 policy owner（选题/追问/结束的决策权）。** 确定性 `Question Policy`（`pickNextAdaptive` / 覆盖率 / 薄弱度）必须是选题的唯一真理来源，Agent 在其上做对话式包装。

---

## 1. 当前 pi-agent-core 路线概况

### 1.1 文件与职责
| 文件 | 职责 |
|------|------|
| `src/agent/interviewAgent.ts` | 构建 `pi-agent-core` Agent，跑 `observe → decide → tool → observe` 循环；`shouldStopAfterTurn` 在 `finishInterview` 或达 `MAX_AGENT_QUESTIONS=10` 时停止 |
| `src/agent/tools.ts` | 把既有 `domain/learner/evaluation/ai` 包装成 `AgentTool`（searchQuestions / getQuestion / evaluateAnswer / getUserWeaknesses / getWeakAngles / getCoverageGaps / finishInterview）——**纯确定性执行** |
| `src/agent/types.ts` | 运行时会话 `InterviewAgentSession`（App 持有，工具读写） |
| `src/agent/prompt.ts` | 系统提示词：定义 Agent 为"面试官决策中心"，负责"决定本轮考察哪道题" |
| `src/agent/runtime.ts` | 把 `pi-ai` 的 `streamSimple` 适配为 `pi-agent-core` 的 `streamFn` |

### 1.2 当前路线把什么交给了 LLM
- **选题决策在运行时由 LLM 做**：`prompt.ts` 明确要求 Agent"先用 `searchQuestions` 浏览候选，再用 `getQuestion` 选定"——即 LLM 实时决定"下一题问什么"。
- **依赖 LLM 才能运行**：`createInterviewAgent` 经 `buildAgentRuntime(entry)` 需要 `model`；无有效 engine（无 key / 未启用）时 Agent 整体无法启动。`beforeToolCall` 仅拦截了开放题评估，选题本身无 LLM 退化路径。

### 1.3 关键事实：确定性选题策略已存在却被绕过
- `src/domain/adaptive.ts` 的 `pickNextAdaptive`（4 策略：deep-dive / gap-probe / broaden / move-on）是**已落地、已测试**的确定性选题策略。
- `tools.ts` 的 `getUserWeaknesses` 调了 `recommendWeakTopics`、`getWeakAngles` 调了 `weakAnglesOf`——但**真正的"选哪道题"没有调用 `pickNextAdaptive`**，而是由 LLM 在 `searchQuestions` 结果上自由点将。
- 这正是 §3 中 L2 / L8 两处 lesson 的落点。

---

## 2. 从历史设计提炼的 Lessons Learned（与 Agent 相关）

以下条目均来自 `docs/DECISIONS.md` 与 `AGENTS.md`，按主题归类。每条都曾以"被采纳的 ADR"或"明确的不做清单"形式确立。

| # | Lesson | 出处 | 一句话 |
|---|--------|------|--------|
| **L1** | 不要"为用 Agent 而 Agent 化"；不要引入 Agent loop | ADR-012、ADR-019（移除 pi-agent-core）、ADR-030（"Agent loop 明确不做"） | Agent 是可有可无的增强，不是默认架构 |
| **L2** | 运行时路径不要现场用 LLM 生成/决策并直接使用；出题与选题职责不混 | ADR-024→027（删运行时题型变换）、ADR-032（"运行时永不现场生成并直接使用题目"） | 服务路径零 LLM 决策，生成离线做 |
| **L3** | LLM 只是增强层；关闭后仍要能跑完链路 | ADR-031（"LLM 只是增强层"，关闭后出题→作答→判分全不依赖 LLM） | 无 LLM = 退化到确定性，而非整体不可用 |
| **L4** | LLM 输出必须被 domain 校验；分数/决策所有权在 domain | ADR-019（分数所有权）、ADR-036（"LLM 提候选、domain 决定"）、ADR-006（answer key 来自原题） | LLM 给候选，domain 拍板 |
| **L5** | 出题(Generator) ≠ 选题(Selector)；LLM 不得自主扩张知识图谱 | ADR-032（避免"LLM 发现概念→自动建节点→自动生成题"爆炸）、ADR-029（知识是 curated 一等公民） | Agent 只能从 curated 池选，不能造题/建节点 |
| **L6** | 永不把策略接口加进 LLMProvider | ADR-030（固化 `LLMProvider` 边界，永不扩展 `recommendNextQuestion` / `buildLearningPlan`） | 策略不进 Provider 接口 |
| **L7** | 确定性、可测、服务路径零 LLM 成本 | ADR-027（"零 LLM 成本、行为完全确定性、可测"）、ADR-014（Agent 集成测试 mock `streamFn`） | 引入非确定性要有 fallback + 测试 |
| **L8** | 接通既有机制，而非新增抽象 | ADR-020（"当前不缺架构能力，缺的是把已有机制接通"） | 优先复用 `pickNextAdaptive` 等，而非另算 |
| **L9** | Knowledge 是中心，Learner Memory 驱动下一次训练，InterviewEngine 掌管流程 | ADR-030 四句话原则 | 决策权属于 Policy，不属于 Agent |
| **L10** | 当前规模不做"大架构" | ADR-030（"数据库 / Agent loop / Repository 层 / 图抽象都明确不做"） | 用真实需求证明 Agent 必要性，否则 over-design |
| **P1–P4** | AGENTS.md 原则：不要 over design / 文档代码一致 / 删死代码 / 关键测试 | `AGENTS.md` | 大改动需计划→设计→确认；文档随代码同步 |

---

## 3. 对齐矩阵：每条 lesson 当前路线是否遵守

| Lesson | 当前状态 | 判定 | 说明 |
|--------|----------|------|------|
| **L1** Agent loop | `src/agent/*` 引入了完整 Agent 决策循环 | ⚠️ **冲突** | ADR-034 在 ADR-019/030 之后重新启用 Agent loop，形成 DECISIONS.md 内部矛盾（见 §4） |
| **L2** 运行时 LLM 决策 | 选题在运行时由 LLM 决定 | ⚠️ **风险** | 是"选"非"生成"且从 curated 池选，危害小于 ADR-024，但仍应在确定性 policy 候选集内交互，不能自由点将 |
| **L3** LLM 关闭仍可跑 | Agent 无 LLM 无法启动 | ⚠️ **违反风险** | 确定性 Engine 才是 local-first 主路径；Agent 必须能在无 LLM 时整体退化到确定性 policy，而非不可用 |
| **L4** 分数/决策归 domain | `evaluateAnswer` 调 `gradeChoice`/`evaluateOpenAnswer`，Agent 只读结果 | ✅ **遵守** | 边界卫生正确 |
| **L5** 不生成/不扩图 | 仅 `searchQuestions`+`getQuestion` 从池选 | ✅ **基本遵守** | 须在工具/测试层钉死，防 prompt 漂移到"生成题" |
| **L6** 策略不进 Provider | ADR-034 未动 `LLMProvider` | ✅ **遵守** | policy 不应回流进 `LLMProvider` |
| **L7** 确定性/可测 | 已引入非确定性+LLM 成本；有 mock `streamFn` 测试 | 🟡 **部分** | 需保留确定性 fallback 与"无 LLM 退化"测试 |
| **L8** 接通既有机制 | `tools.ts` 包装了 domain，但**选题未调 `pickNextAdaptive`** | 🟡 **部分** | 应让 Agent 消费既有策略而非 LLM 自由选 |
| **L9** Policy 中心性 | Agent 被定位为"决策中心" | ⚠️ **风险** | 须确立 Policy 优先于 Agent |
| **L10** 不做大架构 | 新运行时层 vs "当前规模不做 Agent loop" | ⚠️ **张力** | 需用"真实对话式 follow-up 需求"证伪 over-design（P1） |

**结论**：边界卫生（L4/L5/L6）已对齐；**范围**（L1/L2/L3/L8/L9/L10）与历史 lesson 存在冲突或风险，需统一。

---

## 4. 核心冲突：DECISIONS.md 的内部自相矛盾（必须裁决）

DECISIONS.md 里存在一条直接对立的决策链，当前 `pi-agent-core` 路线正踩在这条裂缝上：

- **ADR-019（"架构收敛"）**：明确**移除 pi-agent-core**（"当前所有 LLM 调用都是 one-shot 结构化生成，不需要 Agent"），并列入"保留不动：确定性自适应策略（**不引入 LLM 策略 Agent**）"。
- **ADR-030（"概念层级统一"）**：四句话原则之一"当前规模下不需要任何'大架构'（数据库 / **Agent loop** / Repository 层 / 图抽象都明确不做）"；并固化"`LLMProvider` … 永不扩展 `recommendNextQuestion` / `buildLearningPlan` 等策略接口"。
- **ADR-034（"Agent 面试"）**：又启用 pi-agent-core 作为"**面试决策中心**"，把"下一题问什么 / 是否追问 / 何时收尾"交给 Agent 实时判断——**直接推翻了 ADR-019/030 的"不做"**。

这是本仓库最严重的一致性缺陷：**同一份决策记录里，先说"不要 Agent loop / 不要 LLM 策略 Agent"，后又说"Agent 是决策中心"**。当前路线沿用的是后者，因此天然处在与历史 lesson 对立的位置。

> **不解决这个矛盾，任何"pi-agent-core 该不该用"的讨论都缺乏根基。** 本报告主张：保留 Agent（ADR-034 的边界纪律有价值），但**重新界定其范围**——从"决策中心"降为"交互层"（见 §5），从而与 ADR-019/030 的"不要 LLM 策略 Agent / 不要 Agent loop 作为决策机制"在精神上统一。

---

## 5. 统一方案（Unification）：把 pi-agent-core 重新锚定到历史 lesson

目标：让 `pi-agent-core` 路线既享受 ADR-034 的边界纪律，又不违反 ADR-019/030/027/032 的 lesson。与 `llm-replacement-analysis.md`（v2）的架构图完全一致。

### 5.1 定位重写（解决 L1 / L9 / L10）
- **现在**：`prompt.ts` 称 Agent 为"面试官决策中心"，"决定本轮考察哪道题"。
- **改为**：Agent 是**交互层 / 对话编排层**。"**考什么**由确定性 `Question Policy` 决定；Agent 决定**怎么用对话推进**（怎么问、何时追问、何时结束、怎么解释）。"
- 这把"决策权"还给了 Policy（L9），把 Agent loop 从"决策机制"降级为"交互机制"（L1/L10 精神）。

### 5.2 选题决策回流确定性层（解决 L2 / L8）
- 现状：`getQuestion` 由 LLM 在 `searchQuestions` 结果上自由选。
- 改为：新增/强化 `Question Policy`（`pickNextAdaptive` 已是起点；v2 报告 P0-3 的多因子 `NextQuestionScore` 是其升级目标）。Agent 的 `getQuestion` 从 **Policy 产出的 ranked candidate 列表**中取题，而非自由 `search+select`。
- 效果：把已被测过的确定性策略重新接入服务路径，避免运行时 LLM 选题（L2），并接通既有机制（L8）。

### 5.3 离线优先 + 优雅退化（解决 L3）
- 现状：无 LLM → Agent 整体不可用。
- 改为：LLM 不可用时，整场访谈由**确定性 Engine + `pickNextAdaptive`** 跑完（选题+评分均确定）。Agent 仅作为可选交互增强；`beforeToolCall` 的退化逻辑扩展到"无 LLM 时走确定性选题"，而非只拦开放题评估。
- 这落实 ADR-031 的"LLM 只是增强层"。

### 5.4 钉死"不生成 / 不扩图"（巩固 L5）
- 在 `tools.ts` 与测试层明确：Agent **只能从 `bank` 选已存在题目**，任何"生成新题 / 新建知识点节点"的动作都不在工具集中；`searchQuestions` 的 `topic` 过滤只允许落在 taxonomy 内的合法 topic。
- 防止 `prompt.ts` 未来漂移成"让 LLM 出题"（ADR-032 的图谱爆炸教训）。

### 5.5 策略接口不入 LLMProvider（巩固 L6）
- 维持 ADR-030 固化：`LLMProvider` 只保留 `generateVariant` / `evaluateOpenAnswer`；选题策略永不加进 Provider，留在 `domain/adaptive.ts` 与 Agent 运行时之外。

### 5.6 测试纪律（落实 L7 / P4）
- 保留现有 mock `streamFn` 集成测试（ADR-014）。
- 新增两类测试：①"无 LLM 时整体退化到确定性 Engine 仍能跑完"；②"Agent 不越界触发出题/建节点"。
- 把"确定性 policy 产候选 → Agent 取题"的契约用单测钉死。

### 5.7 文档一致性（落实 P2）
- 在 `docs/DECISIONS.md` 显式裁决 ADR-019/030 与 ADR-034 的矛盾：**修订 ADR-034 的范围表述**（Agent = 交互层，非决策中心），或新增一条 ADR 说明"Agent loop 作为交互机制被重新允许，但决策权归确定性 Policy"。
- `docs/ARCHITECTURE.md` 同步：明确 `src/agent/*` 在"Question Policy → Agent 交互 → LLM"链路中的位置，与 v2 报告架构图对齐。

---

## 6. 结论与建议落地

1. **当前路线"边界卫生"正确**（L4/L5/L6 已遵守），不应推倒重来；问题在**范围**——把 LLM 放进了本可由确定性 Policy 承担的运行时选题决策。
2. **统一到一句话**：`pi-agent-core` 是 **interaction intelligence（交互层）**，不是 **policy owner**；确定性 `Question Policy` 是选题的唯一真理来源。这同时消解了 DECISIONS.md 中 ADR-019/030 与 ADR-034 的内部矛盾，并与 v2 报告核心架构图一致。
3. **最优先动作**：
   - (a) 裁决 DECISIONS.md 矛盾（修订 ADR-034 / 新增 ADR）；
   - (b) 把 `pickNextAdaptive` 接入 Agent 选题路径（Policy 产候选，Agent 取题）；
   - (c) 补"无 LLM 退化到确定性"与"Agent 不越界出题"测试。
4. **不做的事**：不要删除 `pi-agent-core`（其边界纪律有价值）；不要在 `LLMProvider` 加策略接口；不要让 Agent 在运行时生成题目或扩张知识图谱。

---

## 附录 A：关键文件引用
| 文件 | 角色 / 与 lesson 的关系 |
|------|------------------------|
| `src/agent/interviewAgent.ts` | Agent 运行时循环（L1 风险点） |
| `src/agent/prompt.ts` | 系统提示词称 Agent 为"决策中心"（L1/L9 风险点，需改写） |
| `src/agent/tools.ts` | 确定性工具包装（L4/L5 已遵守；选题未接 Policy，L8 部分） |
| `src/agent/types.ts` | 运行时会话（App 持有） |
| `src/domain/adaptive.ts` | `pickNextAdaptive` 确定性选题策略（L8 应被 Agent 消费） |
| `src/domain/learner.ts` | `recommendWeakTopics` / `weakAnglesOf`（已被 tools 部分消费） |
| `docs/DECISIONS.md` | ADR-019/027/030/032/034/036 等（lesson 出处） |
| `AGENTS.md` | 四大原则（P1–P4） |
| `llm-replacement-analysis.md` | v2 报告，核心架构图（Trainer Policy → candidate → pi-agent-core → LLM） |

## 附录 B：术语
- **Agent loop**：`observe → decide → tool → observe` 的 LLM 驱动循环。ADR-030 曾明确"不做"，ADR-034 重新引入——本报告建议将其限定为"交互机制"而非"决策机制"。
- **Question Policy**：确定性选题策略（覆盖率 + 薄弱度 + 重要性 + 难度拟合 + 信息增益 + 新近度 − 重复），`pickNextAdaptive` 是其起点。是选题的真理来源。
- **Trainer Policy vs Agent**：Policy 决定"考什么/为什么/多难"，Agent 负责"怎么用对话推进"——前者确定性，后者交互式。
- **local-first 主路径**：确定性 Engine（4 页 + `pickNextAdaptive`）可在无 LLM 时完整运行；Agent 是其 LLM 增强分支。
