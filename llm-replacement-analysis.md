# 设计分析报告（修订版 v2）：以传统算法与机器学习替代 LLM 的可行性分析

> **副标题**：在明确的能力边界内，把 LLM 依赖降到最低——核心智能层由确定性算法 + 经典 ML 承担，LLM 退居生成 / 语义判断 / 对话
> **范围**：`ai-interview-questions` 项目（local-first AI 面试教练）
> **关联决策**：ADR-019 / ADR-036（变体与评分的 LLM 隔离）、ADR-037（Concept×Angle 证据）、ADR-038 / ADR-039（6 大能力域 taxonomy）
> **版本**：v1 初稿 → **v2 修订（2026-08-25）**，采纳"另一 AI 评审" + 本轮架构复审 12 项意见
> **建议落地**：本报告结论凝结为 **ADR-040（Phase 0 → Phase 3 路线图，v2）**，见第 6 节
> **代码状态（v2 撰写时实测）**：测试 278 例，276 通过 / 2 失败（见第 7 节）

---

## 0. 摘要（TL;DR，v2 修订）

1. **LLM 调用点极少且已被严格隔离**：全库仅 4 处真正调用 LLM（变体/生成、开放题评分、Agent 决策循环、Copilot 对话），且最终分数所有权已归 `domain` 层。这是做减法的坚实前提。
2. **`Concept×Angle coverage` 是确定性选题策略的核心信号之一，但不是"单一智能来源"**。它只回答"还没考察什么"，而 Trainer 需要回答"下一步考什么最有价值"。选题必须由多因子加权和驱动（见 3.3）。
3. **开放题评分 = 证据探测器 + 反证探测器 + LLM 语义裁判**，三者叠加；embedding 仅做 evidence detector，且必须补充 contradiction / polarity 信号，否则高相似 ≠ 正确。
4. **选择题是最便宜、最确定的学习信号源**：应记录 `selectedOptions / expectedOptions / misconceptionIds`，使 learner profile 直接获得 misconception 证据，**完全不需要 LLM**。
5. **题目生成应拆为确定性 Plan + LLM Surface**：考什么（concept/angle/difficulty/requiredPoints/misconceptions）由算法决定，LLM 只负责把 blueprint 落成漂亮的题目。
6. **模型分层（Tier 0–3）**：纯确定性 / 本地嵌入 / 经典 ML / LLM。注意 embedding 本身也是 ML 模型，不属于"无模型依赖"。
7. **不宣称"效果不打折"**：这是待验证假设。所有替代方案须先建离线评测集（precision/recall/F1、coverage/weakness/repetition 指标），替代后通过评测验证。
8. **路线图重定义**：P0 改为 5 个能力基座；Phase 2 用 **BKT / 贝叶斯掌握度估计**（**删除 DKT**），IRT 仅在具备跨用户 telemetry 时启动；Phase 3 Bandit 明确定义为"question policy 优化工具"，而非"天然优于确定性自适应"。

---

## 1. 背景与目标

### 1.1 产品定位
local-first 的个人 AI 面试教练：内置题库（选择 / 多选 / 开放）、自适应选题、作答评分、学习画像、可选 AI 副驾驶对话。

### 1.2 核心问题
> 分析当前设计，哪些地方可以用 machine learning 或传统算法而非大语言模型实现？**要求实现效果不打折。**

### 1.3 对"不打折"的精确表述（v2 修订）
原报告多处直接宣称"效果不打折"，这是**当前无法证明的工程主张**。修订为：

> 在**明确的能力边界内**，**不预期**降低效果；任何替代方案在落地前须建立离线评测集，替代后通过量化指标验证，方可宣布等价。

理由：例如 embedding 证据探测，在尚未有 benchmark 的情况下不能说"不降低效果"——必须先有 100 条带人工标注 required-point 的开放回答，测出 precision/recall/F1，再与 LLM judge 比较（见 6.5）。

---

## 2. 当前 LLM 调用点清单（事实基础）

> 方法学（外部评审认可）：任何"替代 LLM"的讨论，第一步必须是**先确认 LLM 到底在哪里被调用**，否则容易空谈。

| # | 文件 | 函数 | LLM 角色 | 可无 LLM 运行 |
|---|------|------|----------|---------------|
| 1 | `src/ai/variant.ts` | `generateVariant` | 基于"知识契约"生成真正不同的题面变体 | 可降级为模板；但应拆 Plan（确定性）/ Surface（LLM） |
| 2 | `src/ai/evaluate.ts` | `evaluateOpenAnswer` | LLM-as-Judge 四维评分 | 选择题确定性判分无 LLM；开放题需 LLM 兜底 |
| 3 | `src/agent/interviewAgent.ts` + `src/agent/tools.ts` | `createInterviewAgent` / AgentTool | `pi-agent-core` 决策循环 | 大部分是：选题/评分/读画像走确定性 tools |
| 4 | `CopilotSidebar` | — | 副驾驶自由对话 | 否（本质就是对话） |

### 2.1 架构已有的"LLM 隔离"事实
- **接口隔离**：`LLMProvider` 抽象 + `useAI` 开关，底层可换（云端 / Chrome 本地 / 关闭）。
- **分数所有权**（ADR-019 / ADR-036）：LLM 只出四维 `dimensions`，综合分由 `domain/aggregateOverall` 算——**LLM 不拥有最终分数**。
- **变体约束**（ADR-036）：LLM 可重构 Presentation，但须保持知识契约不变量，输出经 `domain` 校验。
- **Agent 分工**（ADR-034）：Agent 只决策，确定性逻辑全在 `tools.ts`。

### 2.2 对生成环节的修正（v2 新增）
调用点 1 不应理解为"变体 = LLM 一件事"。题目生成应拆为两层（详见 3.1）：
- **Plan（确定性）**：由算法决定考什么——concept / angle / difficulty / requiredPoints / misconceptions / 场景约束。
- **Surface（LLM）**：LLM 只把 blueprint 落成自然语言题目。
这与项目既有的 **knowledge → question blueprint → question generation** 架构完全契合。

---

## 3. 逐调用点：替代方案与效果边界（v2 重审）

### 3.1 变体 / 题目生成（`variant.ts`）
- **模板变体（等价，可立刻做）**：`scenario` / `calculation` / `comparison` 三类用参数化模板 + 题库元数据生成，更可控。
- **rich variant（保留 LLM）**：真正"换一种考察角度"的变体（如 MHA→GQA 显存权衡、精妙 distractor）仍是 LLM 强项；模板只能表面改写，做不了语义重构。
- **路线**：`LLM rich gen + 确定性校验`（用 embedding 做 semantic validation，而非二次 LLM）。
- **关键架构原则（v2 新增）**：**LLM 不应决定"考什么"**。应当由算法产出 Question Plan（确定性），LLM 只做 Surface realization。

```
                   Question Generation
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
         Question Plan              Surface
              │                         │
       deterministic              LLM generation
              │
       Concept / Angle / Difficulty
       Required points / Misconceptions
       Scenario constraints
```

### 3.2 开放题评分（`evaluate.ts`）
- **三层评估（外部评审核心主张，采纳）**：
  1. **确定性层**：结构校验、关键术语命中、格式。
  2. **语义证据层**：embedding + cosine 判断回答**是否命中 required-points**（"提到没"）。
  3. **LLM judge 层**：复杂开放题的最终"对不对 / 好不好"判断，作兜底。
- **embedding 是 evidence detector，不是 grader（采纳并强化，v2）**：它能判"覆盖哪些要点"，但判不了"说得对不对"。
  - **隐藏风险（v2 新增）**：高语义相似 ≠ 正确。反例——required point 为"KV Cache 保存之前 token 的 K/V 张量"，用户答"KV cache 不需要保存 K/V，因为 Transformer 每次重新计算 attention"，embedding 仍可能命中 `KV cache / K/V / attention` 关键词，cosine 超阈值，从而**误判为已覆盖**。
  - **修正**：至少叠加 **contradiction / polarity 信号**，不能是"cosine > threshold ⇒ covered"。
- **requiredPoints 改造为"证据 + 反证"（v2 核心新增，见 3.5 同理）**：评分 = **evidence detector + misconception detector + LLM semantic judge**。

### 3.3 选题决策（`adaptive.ts` + `tools.ts`）
> **本节点是 v2 最大修正：coverage 不是"单一智能来源"。**

- **coverage 只回答"我们还没考察什么"**，而 Trainer 需要回答"下一步考什么最有价值"——这是两个问题。
- 反例：
  ```
  Transformer
  ├── attention / mechanism       coverage = 20%
  ├── KV cache / mechanism        coverage = 80%
  └── GQA / tradeoff              coverage = 0%
  ```
  仅按 coverage 会选 `GQA / tradeoff`；但若 `Transformer/attention` 的 mastery 仅 20%，实际应继续考 attention。
- **正确模型（v2）**：`Concept×Angle coverage` 是确定性选题策略的**核心信号之一**，与下列信号共同构成加权和：
  ```
  NextQuestionScore =
        coverageGap
      + weakness
      + importance
      + difficultyFit
      + informationGain
      + recency
      - repetition
  ```
  而非 `coverage → next question`。
- 当前 `pickNextAdaptive` 的 4 策略（deep-dive / gap-probe / broaden / move-on）是**确定性 ranking 的合理起点**，但应升级为上述多因子打分，而非以 coverage 为唯一依据。

### 3.4 去重 / 检索（`coverage.ts` / 题库质检）
- **TF-IDF / 嵌入 + MMR（等价）**：题目去重、相似题检索、coverage 缺口推荐，无需 LLM。
- **分层定位（v2）**：MMR 依赖 embedding，属于 **Tier 1（本地嵌入模型）**，不是纯确定性，也不是"无模型依赖"。

### 3.5 选择题：确定性 misconception 信号（v2 核心新增）
选择题是**极好的确定性学习信号**，当前只记录 `correct = false` 太浪费。应记录：
```
QuestionResult
├── correct
├── selectedOptions
├── expectedOptions
├── score
├── concept
├── angle
├── difficulty
└── misconceptionIds
```
例：KV Cache / mechanism 题，用户选了选项 B，而 B 挂载 misconception `"KV cache stores attention output"`，则 learner profile 直接得到：
```
KV Cache / mechanism → misconception: "cache stores attention output" → weakness evidence
```
**完全不需要 LLM。** 对选择题尤其有价值，也是 3.2 中"证据 + 反证"探测器在结构化题型上的直接落地。

### 3.6 Copilot 对话（保留 LLM）
自由问答 / 提示 / 解释，本质就是对话，**无等价替代**，保留 LLM（受 `useAI` 开关与 key 校验保护）。

---

## 4. 外部 AI 评审意见（完整收录，v1 已采纳）

> 以下为另一 AI 对本项目所做独立 critique 的结构化转述，原样收录。其方法学、三处纠偏、P0 五条与分阶段建议已在 v1 中采纳。

### 4.1 方法论认可
先确认 LLM 调用点再谈替代——方向正确。

### 4.2 三处纠偏（v1 已认错并采纳）
1. **变体生成**：模板仅覆盖 scenario/calculation/comparison；rich variant 仍 LLM 强项。改为"模板 fallback + semantic validation"。
2. **句向量评分**：embedding 只能判"提到没"，不能判"对不对"（KV Cache 反例）。embedding 是 evidence detector，非 grader。
3. **不要立即上 Bandit**：数据不够时会选垃圾题，先 deterministic ranking。

### 4.3 核心主张
- 开放题三层评估；**Concept×Angle coverage 立为确定性智能层核心**（v2 已修正为"核心信号之一"）；难度 declared vs observed；去重 = embedding + MMR；概念重要性不靠 PageRank（over-design）。
- **Agent = interaction intelligence，非全部 intelligence**。

### 4.4 落地优先级（v1 版 P0 五条，v2 已重定义为 §6 的 P0-1..P0-5）
原 P0：① coverage 接运行时 ② 确定性选题排序 ③ 嵌入去重 ④ 开放题 required-point 嵌入证据 ⑤ 变体 = LLM gen + 校验。v2 将其升级为以"能力基座"组织的 P0-1..P0-5（见 §6.1）。

---

## 5. 本轮架构复审意见采纳记录（v2，用户对 v1 的 12 项修订）

> 为可追溯，以下原样记录本轮复审的 12 项意见及采纳结果。报告正文（§0/§3/§6）已按此修订。

| # | 议题 | v1 报告 | 复审建议 | 采纳 |
|---|------|---------|----------|------|
| 1 | Concept×Angle | "单一智能来源" | 改为**核心 signal 之一**；选题用多因子加权和 | ✅ 已改（§3.3） |
| 2 | Embedding 可靠性 | evidence detector | 正确，但须补 **contradiction / polarity** 信号 | ✅ 已改（§3.2） |
| 3 | requiredPoints | 单一 embedding 证据 | 改**证据 + 反证**（requiredPoints + misconceptions） | ✅ 已改（§3.2/§3.5） |
| 4 | 选择题信号 | deterministic grading | 进一步成为 **misconception 信号源** | ✅ 已改（§3.5） |
| 5 | BKT | Phase 2 | ✅ 保留 | ✅ |
| 6 | DKT | Phase 2 | ❌ **删除**（本地小规模无需神经序列模型） | ✅ 已删（§6） |
| 7 | IRT | Phase 2 | 🟡 仅在有**跨用户 telemetry** 时启动 | ✅ 已改（§6） |
| 8 | Bandit | Phase 3 | 🟡 保留，但定义为 **policy 优化**（学习收益目标，非 engagement） | ✅ 已改（§6） |
| 9 | Variant | LLM + validation | ✅ 正确；补 **Plan 确定性 / Surface LLM** | ✅ 已改（§3.1） |
| 10 | Question generation | LLM | 🟡 **Plan 应确定性，Surface 交 LLM** | ✅ 已改（§2.2/§3.1） |
| 11 | PageRank | 不推荐 | ✅ 正确（over-design） | ✅ |
| 12 | "效果不打折" | 直接宣称 | ❌ 改为**"边界内不预期降级 + 离线评测验证"** | ✅ 已改（§1.3/§6.5） |

补充采纳项：
- **Embedding 也是模型（Tier 分类）**：报告标题"以 ML 替代 LLM"但 embedding 属 ML；须区分 Tier 0 纯确定性 / Tier 1 本地嵌入 / Tier 2 经典 ML / Tier 3 LLM（§6.4）。
- **pi-agent-core 定位**：不应让 Agent 自由决定"下一题"；应是 `Trainer Policy（确定性/ML）→ candidate → pi-agent-core（ask/follow-up/finish）→ LLM`，Agent 价值在于连接确定性 learner model 与 LLM 对话智能（§6.6）。
- **P0 重写**：原 P0 偏"技术实现清单"，改为 5 个能力基座 P0-1..P0-5（§6.1）。
- **IRT 难度定义**：`observedDifficulty ≠ 1 - correctRate`，因 `P(correct)` 受 difficulty + ability + discrimination + guessing 共同影响；字段改为 `difficulty: { declared, estimated: null }`（§6.2）。

---

## 6. 建议落地路线（ADR-040 草案，v2 修订）

### 6.1 P0：五个能力基座（重写，非技术清单）
- **P0-1 统一 Question Evidence Model**：每题带 `concept / subtopic / angle / difficulty / requiredPoints / misconceptions`。
- **P0-2 确定性 learner signal**：选择对错、开放分、concept mastery 证据、angle 证据、**misconception 证据**（来自选择题 `misconceptionIds`，无需 LLM）。
- **P0-3 Question Policy**：以 `weakness + coverage + importance + difficultyFit + informationGain + recency − repetition` 对候选题排序，产出 candidate ranking。
- **P0-4 embedding 用于检索 / 去重 / 证据探测**（非泛化为"embedding validation"）：明确其 Tier 1 定位。
- **P0-5 LLM 负责 generation / semantic judgment / conversation**：架构边界更清晰。

### 6.2 Phase 1：难度双字段 + 去重升级
- **难度**：`declared`（题面声明）与 `estimated`（运行时反推，**可空**）分离；`estimated` 不得简单等于 `1 - correctRate`，因混淆了 difficulty / ability / discrimination / guessing（IRT 要解决的问题）。
- 去重升级为 embedding + MMR（Tier 1）。

### 6.3 Phase 2：BKT / 贝叶斯掌握度估计（删除 DKT）
- **BKT / Bayesian mastery**：适合"概念 → 掌握概率"的 domain 建模，local-first 小规模下合理。
- **IRT**：仅在具备**足够跨用户交叉作答 telemetry** 时启动（否则题目难度估计不稳定）。
- **DKT 明确删除**：Deep Knowledge Tracing 是神经序列模型，对个人 local-first、题库有限、用户数据极少、无 learner population 的场景无必要。

### 6.4 模型分层（Tier 0–3，v2 新增）
| 能力 | 技术 | Tier |
|------|------|------|
| 选择题判分 | deterministic | 0 |
| Coverage | deterministic | 0 |
| Question Policy 排序 | deterministic | 0 |
| MMR 去重 | embedding | 1 |
| 语义证据探测 | embedding | 1 |
| 掌握度 | BKT | 2 |
| 题目难度 | IRT（条件） | 2 |
| 题目生成 | LLM | 3 |
| 开放题语义 | LLM | 3 |
| 对话 | LLM | 3 |

> 若目标是"local-first / 无 API key / 尽量少模型依赖"，则 Tier 1–3 都计入模型依赖；应据此评估"去 LLM 化"的真实边界。

### 6.5 评测门槛（v2 新增，"不打折"的验证方式）
所有替代方案落地前须建离线评测集：
- **证据探测**：100 条带人工 required-point 标注的开放回答 → embedding detector 的 precision / recall / F1；与 LLM judge 对比。
- **确定性 ranking vs 当前 adaptive**：测 coverage improvement / weakness improvement / question repetition / difficulty calibration。
未过评测，不宣布等价。

### 6.6 pi-agent-core 定位（v2 新增）
不要让它成为"Agent → 下一题是什么 → LLM 自由发挥"。正确结构：
```
                  Trainer Policy（确定性 / ML）
                       │  candidate questions
                       ▼
                pi-agent-core
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
      ask question   follow-up     finish
                       │
                       ▼
                     LLM
```
Agent 的价值 = **把确定性 learner model 与 LLM 对话智能连接起来**，而非取代 Question Policy 与 Learner Model。

### 6.7 何时必须保留 LLM（不可降级）
- rich variant 生成（语义重构型）；
- 复杂开放题 judge 层（"对不对 / 好不好"）；
- Copilot 自由对话。

---

## 7. 当前状态与风险（v2 实测）

### 7.1 测试状态
- **实测**：278 例，276 通过 / **2 失败**，均在确定性选择层：
  - `src/domain/adaptive.test.ts` → `move-on：传入 profile 时优先薄弱主题`
  - `src/domain/learner.test.ts` → `suggestNextTopics：...readyToLearn 建议`
- **根因**：非生产逻辑回归。`adaptive.move-on` 的测试 fixture 把 `idempotency` 设为薄弱主题但 `POOL` 里只有 `reliability`（弱主题加权无法命中，反证逻辑本身正确）；`learner` 测试对 reason 字符串断言过约束。**在让确定性层替代 LLM 选题前，应先修对、钉死契约。**

### 7.2 数据就绪度风险（决定 ML 阶段能否启动）
- 87 道孤儿题（topic 是旧 slug 非知识点 id）→ coverage 信号稀疏。
- 7 个空白 topic（cnn / sequence-models / multimodal / mcp / planning / data-leakage / tool-security）。
- 大量题未标 `angle` → `angleCoverage` 证据稀薄 → BKT/IRT 短期不可行（印证 §6.3 的 Phase 排序）。
- 6 道 Agent 多选由 Agent 生成，非用户原版，待核对。

### 7.3 功能缺口
- IndexedDB 查询 API 未暴露 → 运行时消费 `angleCoverage` / 画像做选题的取数通道需补。
- subtopic 级证据尚未做 → Concept×Angle 闭环目前到 angle 层。

---

## 8. 结论

1. **LLM 已被良好隔离**，全库仅 4 处调用，分数所有权在 `domain`——做减法的坚实前提。
2. **核心智能层（选题 / 证据 / 覆盖 / 掌握度）应由确定性算法 + 经典 ML 承担**，但 coverage 只是**核心信号之一**，选题须多因子加权和；开放题评分须 evidence + misconception + LLM judge 三层。
3. **选择题是最便宜的确定性 misconception 信号源**，应丰富 `QuestionResult` 字段，使 learner profile 免 LLM 获得反证证据。
4. **LLM 退居三类不可降级场景**：rich variant 生成、复杂开放题 judge、Copilot 对话；且生成应 Plan 确定性 / Surface LLM。
5. **分阶段且数据驱动**：P0 五基座 → Phase 1 难度双字段/MMR → Phase 2 BKT（删 DKT，IRT 条件化）→ Phase 3 Bandit（policy 优化，学习收益目标）。
6. **不宣称"效果不打折"**：在明确边界内不预期降级，且须经离线评测（precision/recall/F1、coverage/weakness/repetition）验证。
7. **pi-agent-core 的定位**：Trainer Policy（确定性/ML）→ candidate → pi-agent-core（交互循环）→ LLM，Agent 负责连接确定性 learner model 与对话智能。

### 核心架构原则（v2 终稿）
```
             KNOWLEDGE
                 │
                 ▼
       ┌──────────────────┐
       │ Question Policy  │  ← deterministic / ML
       │  what / why /    │
       │  difficulty /    │
       │  angle /         │
       │  misconceptions  │
       └────────┬─────────┘
                │
                ▼
        Question Blueprint
                │
                ▼
       ┌──────────────────┐
       │       LLM        │
       │  how to ask /    │
       │  explain /       │
       │  converse        │
       └────────┬─────────┘
                │
                ▼
             ANSWER
       ┌────────┴────────┐
       ▼                 ▼
 deterministic / ML      LLM
 evidence              semantics
 mastery               reasoning
 coverage              nuance
       │
       ▼
 Learner Model
       │
       └──────────→ Question Policy
```
**这比"LLM + Agent + 一堆工具"的架构更有价值**，且为 `pi-agent-core` 留出了清晰位置：它负责 conversational / interaction loop，而非取代 Question Policy 与 Learner Model。

---

## 附录 A：关键文件引用
| 文件 | 角色 |
|------|------|
| `src/ai/variant.ts` | 变体生成（LLM 调用点 1；应拆 Plan/Surface） |
| `src/ai/evaluate.ts` | 开放题评分（LLM 调用点 2；分数所有权归 domain） |
| `src/agent/interviewAgent.ts` | Agent 决策循环（LLM 调用点 3） |
| `src/agent/tools.ts` | 确定性工具层（选题 / 评分 / 薄弱读取） |
| `src/domain/adaptive.ts` | 确定性自适应选题（4 策略 → 待升级多因子） |
| `src/domain/learner.ts` | 学习画像 / 薄弱推荐 / 掌握度 |
| `src/domain/coverage.ts` | topic×angle 覆盖矩阵（生产端度量） |
| `src/data/taxonomy.ts` | 6 大能力域 → 28 topic + 角度白名单（ADR-038） |
| `docs/DECISIONS.md` | ADR-019 / 036 / 037 / 038 / 039 |
| `CHECKLIST.md` | 根目录待办清单 |

## 附录 B：术语
- **Concept×Angle coverage**：概念×考察角度的覆盖/证据矩阵；确定性选题的**核心信号之一**（非单一来源）。
- **evidence detector vs grader**：embedding 探测"是否命中要点"，不能判定"是否正确"。
- **misconception detector**：反证探测器，捕捉"看似相关实则错误"的表述（如把 KV Cache 说成存 attention 输出）。
- **Question Plan / Surface**：Plan（考什么，确定性）= concept/angle/difficulty/requiredPoints/misconceptions；Surface（怎么问，LLM）= 自然语言实现。
- **NextQuestionScore**：多因子加权和（coverageGap + weakness + importance + difficultyFit + informationGain + recency − repetition）。
- **Tier 0–3**：纯确定性 / 本地嵌入 / 经典 ML / LLM 的模型依赖分层。
- **MMR**：最大边际相关，去重时兼顾相关性与多样性（依赖 embedding，属 Tier 1）。
