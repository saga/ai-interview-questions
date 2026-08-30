# 架构 / Prompt / Context 工程 / 代码 评审报告

> 评审时间：2026-08-30
> 评审范围：`src/` 全部源码（ai / agent / application / domain / schemas / storage / hooks / components / data）
> 评审基线：`main` 分支，含 DeepSeek 优化（JSON Mode / KV Cache / 能力协商）、评分序级重构、VARIANT v2、session 持久化

---

## 总体评价

这是一个**架构意识远高于平均水平的个人项目**。

你已经建立了几条非常关键、且被严格执行的架构红线：

- **Domain 决策，LLM 只增强** —— 评分聚合、选题策略、掌握度计算全在纯函数 domain 层，LLM 只做语言生成/评价；
- **LLM 不拥有分数** —— `overall` 由 `aggregateOverall` 计算，LLM 只输出序级 + evidence；
- **确定性护栏兜底** —— Agent 失败由确定性引擎接管，杜绝「无限选题中」卡死；
- **Schema 边界（Zod）与业务不变量（domain）分离** —— 加载期 fail-fast，不在用户操作时才暴露坏数据；
- **稳定前缀 / 动态数据分离** —— 三套系统提示都是稳定契约前缀，利于 KV Cache 命中。

这些原则不仅写在文档里，而且在代码里被真实执行。`ai/` 只做适配、`domain/` 不依赖 React/网络、`agent/tools.ts` 只做薄包装——边界非常清晰。

但正因为基线已经很高，下面指出的问题**不是「做得不好」，而是「在正确方向上的系统性盲区」**——它们不会在单次使用中暴露，但会在题库增长、用户量增长、或 LLM 成本上升时集中爆发。

**综合评分：8.0 / 10**（架构 8.5 / Prompt 7.5 / Context 7.0 / 代码 8.5）

扣分点集中在：**Agent 与确定性引擎的语义不对称**、**变体语义校验空洞**、**Learner Memory 证据链不完整**、**无成本控制**。

---

## 一、做得好的地方（不展开，仅列出供对照）

| 维度 | 做得好的点 |
| --- | --- |
| 架构 | 分层清晰（schemas/domain/ai/agent/application/storage），依赖方向单向；`LLMProvider` 接口收敛了两种底层实现；FallbackProvider 降级链 |
| Prompt | 三套系统提示（VARIANT/EVAL/CHALLENGER）都是稳定前缀 + 动态 user，利于 KV Cache；EVAL v2 的序级设计（0-4 ordinal）比 0-100 更符合 LLM 真实区分力；VARIANT v2 的分层约束（不变量/变化维度/distractor 规则/抗暗示）比普通「改写一道题」prompt 好很多 |
| Context | Agent 用 append-only messages 维持多轮（KV Cache 友好）；one-shot 路径无状态；session 持久化到 Dexie 可续面 |
| 代码 | Zod 边界校验 + domain 不变量双层保障；纯函数 domain 全部可单测（349 测试通过）；错误处理有明确兜底策略；Chrome AI 的并发/超时/取消有完整 executor |

---

## 二、系统性问题（按严重程度分级）

### P0 —— 会导致功能缺陷或数据错误

#### 1. `getQuestion` 的 topic 兜底可能选到已问过的题

**文件**：`src/agent/tools.ts` 第 157-162 行

```typescript
const byTopic = bank.filter((x) => x.topic === params.id || x.category === params.id);
const unasked = byTopic.filter(
  (x) => !session.answers[x.id] && !session.evaluations[x.id] && session.currentQuestion?.question.id !== x.id,
);
q = unasked[0] ?? byTopic[0];  // ← 问题在这里
```

当 `unasked` 为空（该 topic 所有题都已问过）时，`q = byTopic[0]` 会选到**该 topic 的第一道题**，而这道题可能已经在 `session.answers` 或 `session.evaluations` 里。结果是**重复出题**——用户会再次看到已经答过的题。

**修复**：`unasked` 为空时不应该兜底到 `byTopic[0]`，而应该返回 not_found 或从全题库选一道未问的题。

---

#### 2. `validateVariant` 的语义校验是空实现

**文件**：`src/domain/variant.ts` 第 74 行

```typescript
// 语义：requiredConcepts 的浅校验仅作提示，不阻断（避免测试短文本误伤）；真正的语义漂移由人工/覆盖率保障
```

这行注释**就是全部的语义校验**——没有任何代码。这意味着：

- LLM 可以生成一道结构完全合法、但知识点完全偏离原题的变体（比如原题考「LayerNorm 为什么适合 Transformer」，变体考「BatchNorm 的缺点」），只要 JSON 结构正确就会通过校验；
- 「Knowledge Contract」的 invariant（requiredConcepts 必须被实际考察）**只存在于 prompt 层面**，没有任何代码层的兜底。

这与你 VARIANT v2 里精心设计的「requiredConcepts 必须被实际考察，而不仅仅是出现」形成了落差——prompt 说了，但代码没验证。

**修复**（按成本从低到高）：
- 低成本：把 `requiredConcepts` 作为关键词列表，检查变体题干是否至少包含其中一个（浅校验，可能误伤但比没有强）；
- 中成本：用 `detectOptionLengthBias` 的思路，做一个「concept drift 启发式」——如果变体题干与原题的 requiredConcepts 交集为空，标记为可疑；
- 高成本：引入二次 LLM 校验（另一个 LLM 判断变体是否保持知识契约），但这会增加成本和延迟。

---

#### 3. `getCoverageGaps` 工具是半成品

**文件**：`src/agent/tools.ts` 第 318-322 行

```typescript
execute: async () => {
  // 覆盖缺口需基于题库的 topicRefs；此处返回通用提示，实际由调用方聚合
  const weak = recommendWeakTopics(profile, 5, deps.masteryThreshold);
  return textResult(`覆盖缺口（薄弱优先）：${weak.join('、') || '（暂无）'}`, { weakTopics: weak });
},
```

这个工具的 `description` 承诺「读取当前题库的覆盖缺口（未练或前置未掌握的 topic）」，但实际实现只是 `recommendWeakTopics` 的包装——和 `getUserWeaknesses` 几乎一样，只是 limit 从 3 改成 5。注释说「实际由调用方聚合」但**没有任何调用方实现了这个聚合**。

Agent 在系统提示里被告知可以用 `getCoverageGaps` 做「全局选题与补漏」，但它拿到的只是薄弱主题列表，不是真正的覆盖缺口（未练的 topic、前置未掌握的 topic）。

**修复**：要么实现真正的覆盖缺口逻辑（用 `computeCoverage` + `collectTopicRefs`），要么从工具列表里删掉这个工具，避免 Agent 被误导。

---

### P1 —— 影响可维护性或用户体验

> **进度（2026-08-30）**：本节 5 条中，第 4 条复核后关闭（误报），第 5、6、7 条已修复，仅剩第 8 条待办。

#### 4. ✅ 已复核关闭 · 选择题快路径跳过的是 **LLM 循环**，不是 adaptive 决策

**文件**：`src/agent/interviewAgent.ts:212-234` → `:160-188` → `src/domain/adaptive.ts:114`

> **2026-08-30 复核更正**：原判定「选择题的面试流程**完全不经过 Agent 决策**」不成立，已修正。
> 该表述把「Agent 决策能力」与「LLM 调用」错误地绑定了。实测调用链如下。

```
choiceAdvance()                          interviewAgent.ts:212   选择题提交后
  ├─ evaluateSessionQuestion()           → gradeChoice（确定性判分，不触 LLM）
  └─ fallbackNextQuestion()              interviewAgent.ts:160
       ├─ pool    = 传入 Agent 的 bank（已排除 disabledCategories）
       │            − 已问过的题，并按 generateOpenQuestions 开关过滤形态
       ├─ signals = 从 session.evaluations **实时重建**（topic / score / difficulty）
       └─ pickNextAdaptive(pool, signals, profile, Math.random)   adaptive.ts:114
```

`pickNextAdaptive` 是**真自适应**，不是「取下一道未问题」：

| 输入 | 在选题中的作用 |
| --- | --- |
| 上一题 `score` | `decideStrategy`：`< 60` → `gap-probe`；`≥ 80` 且有相关主题 → `broaden`；否则同主题 `deep-dive` |
| `difficulty` | `deep-dive` 取更难题；`gap-probe` 取更简题 |
| `relatedOf(topic)` | `broaden` 时切到相关主题 |
| `prerequisiteClosure(topic)` | `gap-probe` 时沿前置链回退（近的前置优先） |
| `profile` → `recommendWeakTopics` | `move-on` 时优先薄弱主题 |
| `profile` → `angleWeakRank` / `angleEvidence` | 每个策略子集内按 (topic, angle) 掌握度细选：弱角度优先、证据最少次之 |

**准确表述应是**：

> 选择题跳过 **LLM Agent loop**，但仍经过**确定性的 adaptive engine**。

这是 **algorithmic agent**，不是「没有 agent」。项目的 `Adaptive Interview Engine` 本就把选题 / mastery / coverage / prerequisite / ranking 尽可能下沉到 deterministic 的 domain / application 层——**Agent ≠ 每一道题都必须经过 LLM**。

用「全选择题场景下还有没有自适应」这条验收标准检验：**有**。

**一个需要精确说明的边界**：`profile`（跨会话 `mastery` / `angleCoverage`）在会话进行中是**会话开始时的快照**，只在会话结束时经
`finalize → onComplete → handleAgentComplete → updateLearner → saveLearner` 落库。这**两条路径完全一致**
（确定性引擎 `useTrainingSession.ts:216/265` 同样只在会话结束调用 `updateLearner`），因此不是本项缺陷，也不构成双引擎分叉。
即：**会话内自适应由 `signals` 实时驱动，跨会话掌握度按会话边界更新**。

**保留的可选改进（命名 / 可解释性，非功能缺陷）**：

- `fallbackNextQuestion()` 的命名易被误读为「LLM 失败后的降级」，但它同时承担选择题的**正常确定性选题**路径。
  建议更名 `selectNextDeterministically()` / `advanceDeterministically()`。
- UI 若已展示 Adaptive / Topic / Difficulty / Progress，则**无需**额外标注「本轮是否调用了 LLM」——
  用户关心的是「为什么下一题是这个」，而不是底层走没走模型。

**明确不建议**：把选择题塞进 LLM 决策循环。确定性代码已知 `correct` 与 `score`，再让模型把已有的
deterministic decision 复述一遍，只增加 latency / token / failure surface / prompt 复杂度，不增加实际效果。

---

#### 5. ✅ 已修复（2026-08-30）· `OPENING_INSTRUCTION` 硬编码，不可配置

**原文件**：`src/hooks/useAgentInterview.ts` 第 49-54 行

```typescript
const OPENING_INSTRUCTION = `你是一位资深 AI 技术面试官，主持一次约 6–10 题的模拟面试。流程：
1) 先调用 getUserWeaknesses 了解我的薄弱主题；
2) 用 searchQuestions 在相关主题找候选题，再用 getQuestion 选定一道题呈现给我；
...
`;
```

Agent 的系统提示词可以通过 `config.prompts?.agentSystem` 覆盖，但**开场指令（OPENING_INSTRUCTION）是硬编码的**，用户无法通过设置页修改。这造成「能改系统提示但不能改开场指令」的不对称——如果用户想调整面试流程（比如改成 15 题、或者不查薄弱主题），只能改系统提示，不能改开场指令。

**原建议**：把 `OPENING_INSTRUCTION` 也纳入 `config.prompts`（比如 `config.prompts?.agentOpening`），或者作为 `createInterviewAgent` 的可选参数。

**实际修复（2026-08-30，ADR-051）**：采用 `config.prompts?.agentOpening`。理由是只有这条路能让**用户通过设置页修改**；做成 `createInterviewAgent` 的可选参数只解决代码侧可注入性，不解决本条诉求。

1. 默认值从 `useAgentInterview.ts` 的模块常量**上移到 `agent/prompt.ts`**（`INTERVIEW_AGENT_OPENING_INSTRUCTION`），与 `INTERVIEW_AGENT_SYSTEM_PROMPT` 同处，成为单一出处，设置页「恢复默认值」可直接引用。
2. `schemas/ai-config.ts` 的 `promptConfigSchema` 新增 `agentOpening: z.string().optional()`；设置页的 Monaco JSON 编辑器借已有的 `z.toJSONSchema(aiConfigSchema)` 自动获得校验与补全，无需额外接线。
3. 回退逻辑抽为纯函数 `resolveOpeningInstruction(agentOpening)`——空白串与 `undefined` 都回退默认（用户清空输入框不能把空指令发给模型），并新增 `src/agent/prompt.test.ts` 5 例覆盖。
4. 设置页新增「Agent 开场指令」编辑区，说明中写明**题数硬上限由代码控制**（`MAX_AGENT_QUESTIONS`），此处只是给模型的软目标。
5. `storage/settings.ts` 的 `safeConfigSnapshot` 同步新增 `agentOpening`，保持审计日志不落提示词正文。

> ⚠️ 遗留项（非本次引入）：`loadConfig` 对 `prompts` 是**透传不校验**的，只有 JSON 编辑器走的 `parseConfigJSON` 才经 Zod。
> 因此手改 localStorage 写入非字符串时，新字段与既有的 `agentSystem` 一样会在下游 `.trim()` 处抛错。
> 该问题已作为 `深度审查报告.md` 的 A3（storage 层 Zod 边界承诺未兑现）跟踪，不在本条修复范围内。

---

#### 6. ✅ 已修复（2026-08-30）· Prompt 里的「工具调用铁律」说明浪费 token

**文件**：`src/agent/prompt.ts` 第 25 行

```typescript
（说明：「只调一次 searchQuestions / 不编造 id / not_found 回列表挑真 id」已由工具代码确定性保证：……无需在 prompt 中约束。）
```

这段说明**放在了系统提示里**，LLM 每次调用都会读到。但它的内容是「你不需要遵守这些规则，因为代码已经保证了」——这是给开发者看的注释，不是给 LLM 的指令。实测 141 字符（约 100 token，略高于原报告的 80 估算）；system 前缀每轮重发，30 轮就是约 3000 token。

**已做的修复**：从 `INTERVIEW_AGENT_SYSTEM_PROMPT` 中删除，内容原样保留在 `prompt.ts` 的文件头注释里（紧邻被描述的工具行为，比埋在字符串里更好找）。系统提示只留 LLM 需**主动遵守**的规则；由代码兜底的部分留给注释。

顺带把版本标记 `[PROMPT-VERSION v1]` → `v2`——用户若保存过自定义 `config.prompts.agentSystem`，可据此判断副本是否过期（自定义副本不会被自动迁移，这是有意的：用户手改过的提示不应被静默覆盖）。

**回归门禁**：`src/agent/prompt.test.ts` 的「系统提示词只写 LLM 需主动遵守的规则」描述块：
- 断言 `说明：` / `已由工具代码确定性保证` / `幂等复用缓存列表` / `无需在 prompt 中约束` 均**不出现**（把注释塞回去就红）；
- 同时断言 `不要自己打分` / `禁止自己计算或编造评分` / `禁止修改 learner state` / `finishInterview` **仍在**（防止下次清理提示时把真规则一起删了）；
- 断言版本号格式 `^\[PROMPT-VERSION v\d+\]$`。

---

#### 7. ✅ 已修复（2026-08-30）· Chrome 的 `renderTools` 把完整 JSON Schema 塞进 prompt

**文件**：`src/ai/chromeAgent.ts`

```typescript
// 修复前：整段 schema 进 prompt
return `- ${t.name}: ${JSON.stringify(t.parameters ?? {})} — ${t.description ?? ''}`;
```

7 个工具 × 完整 JSON Schema + description 会让 Chrome 的 prompt 膨胀，挤占对话历史空间（Chrome Prompt API 上下文窗口约 4K-8K token）。

**已做的修复**：`renderTools` 改为输出**紧凑签名**，只保留模型产出 args 所需的三件事——参数名、类型、是否必填：

```typescript
- getQuestion(id: string, format?: "choice" | "open") — 按 id 选定题目并写入会话
- finishInterview() — 结束本轮面试
```

新增两个内部函数：`renderType()`（`enum` / `const` / `anyOf`+`oneOf` 联合 / `array` / `integer`→`number` 的类型塌缩，>40 字符退化为 `any`）与 `renderParams()`（必填无 `?`、选填带 `?`；整条签名 >120 字符折叠为 `args: object`）。

**实测效果**（7 个真实工具，见 `tools.test.ts` 的体积断言）：

| | 完整 schema | 紧凑签名 |
|---|---|---|
| 工具清单总长 | 1312 字符 | **947 字符** |
| 其中 schema 部分 | 513 字符（39%） | 0 |

净省 365 字符（**−28%**）。

> **对原报告估值的修正**：原报告称 schema「几十到几百字符」「会让 prompt 快速膨胀」。实测 schema 只占 39%，改签名后净省 28%，**不是数量级的变化**——真正的体积大头是 7 条工具 `description`（644 字符，占紧凑版的 68%）。这些描述是模型判断「该调哪个工具」的唯一依据，不能砍。所以这条修复的价值是「把确定性的、模型不需要的信息（schema 结构）清零」，而不是「把 prompt 压小一个数量级」。

**一个有意的信息取舍**：参数级 `description` 会被丢弃（如 `getWeakAngles` 的 `topic` 参数原本带「要查询的 topic id」）。工具级 `description` 一字不减。若将来某个参数名不自明，正确做法是**改参数名或写进工具级 description**，而不是把参数级描述塞回签名。

**回归门禁**：
- `src/ai/chromeAgent.test.ts`：签名形态（联合字面量塌缩为 `"choice" | "open"`、必填/选填 `?`、空参数 `()`、`string[]`、`minimum` 等校验字段不出现）、过长退化、无工具占位；
- `src/agent/tools.test.ts`：用**真实** `createAgentTools` 产物做体积门禁——相对阈值 `< 80%` 等效 JSON 渲染（schema 被塞回来时两边都是 1312，直接失败）+ 绝对上限 `< 1100` 字符（防描述逐条变长的温水膨胀）+ 7 个工具名必须都在。

---

### P2 —— 长期演进方向

#### 8. Learner Memory 的证据链不完整：选择题答错不贡献 gaps

**文件**：`src/domain/evaluation.ts` 第 79-82 行 + `src/domain/learner.ts` 第 248 行

```typescript
// gradeChoice
gaps: [],  // 选择题判定性打分，不知道用户漏了哪个知识点，不伪造 gap

// sessionFromQuiz
gaps: format === 'choice' ? [] : (g.gaps ?? []),  // 选择题不产生 gaps
```

这是设计上的取舍（不伪造 gap），但导致：

- 如果用户只做选择题（`generateOpenQuestions` 默认 false），Learner Memory 的 `commonWeaknesses` 永远是空的；
- 题库 1078/1084 题是选择题+开放题双形态，但选择题答错不会为 Learner Memory 贡献任何 gap 信号。

这意味着 Learner Memory 的薄弱分析主要依赖开放题，而开放题默认被禁用。结果是：**大多数用户的 Learner Memory 只有分数，没有薄弱点描述**。

`missingConcepts` 已经在 `EvaluationResult` 里采集（EVAL v2），但**没有接入 Learner Memory**——`updateLearner` 不读 `missingConcepts`，`commonWeaknesses` 只来自 `gaps`。

**建议**：
- 短期：把 `missingConcepts` 也写入 `commonWeaknesses`（作为 gaps 的补充）；
- 中期：为选择题也生成 gap 信号——比如「答错的题的 requiredConcepts」可以作为「可能薄弱的概念」写入 Learner Memory（标注为「推断」而非「确认」）。

---

#### 9. 无 LLM 成本控制或速率限制

**文件**：全局缺失

浏览器直连 LLM，没有：

- 速率限制（rate limiting）——如果 Agent 在短时间内多次调用 LLM，可能触发 API 限流；
- 成本追踪——没有 `usage` 聚合或成本估算，用户不知道一场面试花了多少 token / 多少钱；
- 变体缓存——同一道题在不同会话中会重复调用 LLM 生成变体，浪费 token。

**建议**：
- 短期：在 `callLLM` 层面加一个简单的速率限制器（比如每秒最多 N 次调用）；
- 中期：按 `question.id` 缓存变体（同一道题的变体可以复用，或者至少在同一 session 内复用）；
- 长期：聚合 `usage` 到 Learner Memory，让用户看到「本次面试消耗了 X tokens」。

---

#### 10. Agent 与确定性引擎的选题逻辑重复实现

**文件**：`src/agent/interviewAgent.ts` 第 160-188 行 vs `src/application/interviewEngine.ts` 第 78-105 行

Agent fallback 的 `fallbackNextQuestion` 和确定性引擎的 `nextAdaptiveStep` 都调用 `pickNextAdaptive`，但：

- Agent fallback 自己组装 pool/signals（`bank.filter(...)` + `Object.entries(session.evaluations).map(...)`）；
- 确定性引擎在 `nextAdaptiveStep` 里过滤 pool（`bank.questions.filter(...)` + `session.questions.map(...)`）。

两者的 pool 组装逻辑**不完全一致**：

- Agent fallback 的 pool 过滤条件是 `!asked.has(q.id) && availableFormats(q, fmtsAllowed).length > 0`；
- 确定性引擎的 pool 过滤条件是 `availableFormats(q, formats).length > 0 && !asked.has(q.id)`，但还额外过滤了 `disabledCategories` 和 `def.categories/difficulties`。

这意味着 Agent fallback 和确定性引擎在同样的状态下可能选出不同的题——**两个平行实现，容易漂移**。

**建议**：把 pool 组装逻辑抽成一个共享函数（比如 `buildCandidatePool(bank, session, config)`），Agent fallback 和确定性引擎都调用它，保证一致性。

---

#### 11. 题库全量 eager 加载，无法按需加载

**文件**：`src/data/questionBank.ts` 第 12 行

```typescript
const modules = import.meta.glob('./questions/*.json', { eager: true, import: 'default' });
```

1084 题全量 eager 加载。注释说「规模到达需要按需加载时再引入动态 import」，但目前没有实现。如果题库增长到 10K 题，初始加载时间会很长（每题都要过 Zod 校验）。

**建议**：题库增长到 5K+ 题时，引入「按 category 懒加载」——初始只加载 index（category → 文件映射），用户进入某个 category 时才加载对应的 JSON 文件。

---

#### 12. `finalizeQuestion` 的回退逻辑可能掩盖系统性失败

**文件**：`src/application/sessionEvaluator.ts` 第 59-76 行

```typescript
export async function finalizeQuestion(sq: SessionQuestion, provider: LLMProvider | null): Promise<SessionQuestion> {
  if (!provider) return sq;
  try {
    const variant = await provider.generateVariant(sq.question);
    // ...
  } catch (error) {
    console.warn(`变体生成失败(${sq.question.id})，回退到原题：`, error);
    return sq;
  }
}
```

变体生成失败时回退原题，只 `console.warn`。如果 LLM 引擎配置错误（比如 API key 无效）导致**所有**变体都失败，用户看到的全是原题，没有任何提示说「变体功能失效」。

**建议**：在 `buildSession` 或 `nextAdaptiveStep` 层面统计变体失败率，如果失败率超过阈值（比如 >50%），在 UI 上提示「变体生成功能当前不可用，正在使用原题」。

---

## 三、修复优先级路线图

### 立即修复（P0，会导致功能缺陷）

1. ~~**`getQuestion` topic 兜底重复出题**（tools.ts:161）~~ → ✅ 已修复（2026-08-30，ADR-048）
2. ~~**`getCoverageGaps` 半成品**（tools.ts:318）~~ → ✅ 已修复（2026-08-30，ADR-049：保留工具并重定义为 coverage-based 事实查询，与 mastery-based 的 `getUserWeaknesses` 正交）

### 短期修复（P1，1-2 天内可完成）

3. ~~**删掉 prompt.ts 第 25 行的「不需要遵守的规则」说明**~~ → ✅ 已修复（2026-08-30，ADR-052）
4. ~~**`OPENING_INSTRUCTION` 纳入 config.prompts**~~ → ✅ 已修复（2026-08-30，ADR-051）
5. ~~**Chrome renderTools 简化**~~ → ✅ 已修复（2026-08-30，ADR-052：改输出紧凑签名，实测 1312 → 947 字符）
6. **`missingConcepts` 接入 Learner Memory**——作为 gaps 的补充写入 `commonWeaknesses`。

### 中期改进（P2，1-2 周）

7. **`validateVariant` 语义校验**——至少做一个 requiredConcepts 关键词的浅校验。
8. **抽共享的 pool 组装逻辑**——Agent fallback 和确定性引擎用同一份 `buildCandidatePool`。
9. **LLM 速率限制**——在 `callLLM` 层面加简单的 rate limiter。
10. **变体缓存**——按 question.id 缓存变体，同一 session 内复用。

### 长期演进（P3，需要设计讨论）

11. **选择题也产生 gap 信号**——答错的题的 requiredConcepts 可以作为「推断薄弱概念」写入 Learner Memory。
12. **题库按需加载**——5K+ 题时引入按 category 懒加载。
13. **成本追踪**——聚合 usage 到 Learner Memory，让用户看到 token 消耗。

---

## 四、总结

这个项目的架构基线已经很高——分层清晰、边界明确、原则被执行。上面指出的问题**不是「做错了」，而是「在正确方向上的系统性盲区」**：

- **P0 问题**（topic 兜底重复、validateVariant 语义空洞、getCoverageGaps 半成品）是「承诺了但没兑现」——prompt/工具描述说了，但代码没实现；
  （2026-08-30：topic 兜底重复已由 ADR-048 修复，getCoverageGaps 已由 ADR-049 重定义为 coverage-based 事实查询，validateVariant 已由 ADR-047 接入真实校验——三项均已关闭）
- **P1 问题**（prompt 浪费 token）是「设计上的 trade-off 没有被显式记录」——性能优化牺牲了决策完整性，但用户不知道；
  （2026-08-30：**choiceAdvance 跳过决策**一项经复核为误报，已关闭——见第 4 条，它跳过的是 LLM 循环，确定性 adaptive 决策照常执行；
  **OPENING_INSTRUCTION 硬编码**已修复——见第 5 条，纳入 `config.prompts.agentOpening`；
  **prompt 里的开发者注释**与 **Chrome 工具 schema 膨胀**已修复——见第 6、7 条，ADR-052）
- **P2 问题**（证据链不完整、无成本控制、选题逻辑重复）是「长期演进方向」——不影响当前使用，但会在规模增长时暴露。

**最值得立即修复的是 P0 的三个问题**——它们都是「承诺了但没兑现」，修复成本低（每个不超过 50 行代码），但能消除真实的功能缺陷。

**最值得长期投入的是 P2 的「Learner Memory 证据链」**——这是产品的核心竞争力（个性化推荐），但目前的证据链主要依赖开放题，而开放题默认被禁用。如果能解决「选择题也产生 gap 信号」这个问题，Learner Memory 的薄弱分析会从一个「只有分数的壳」变成「真正有洞察的教练」。

---

*本报告基于 2026-08-30 的 main 分支代码，含 DeepSeek 优化、评分序级重构、VARIANT v2、session 持久化等最新改动。*

*2026-08-30 复核记录：第 4 条（选择题快路径）经逐跳核实调用链后判定为**误报并关闭**——原结论把「Agent 决策」与「LLM 调用」绑定，实际选择题路径仍经 `pickNextAdaptive` 做完整自适应选题。同时关闭两项已修复的 P0（ADR-047 / 048 / 049）。复核方法：从 `choiceAdvance` 逐跳跟到 `pickNextAdaptive`，并对照 `useTrainingSession.ts` 确认两条路径的 profile 更新时机一致（均在会话结束 `updateLearner`）。*

*2026-08-30 第二批评审修复（ADR-051 / 052）：第 5 条开场指令可配置、第 6 条 prompt 注释瘦身、第 7 条 Chrome 工具签名化。三项均为「把确定性信息从 LLM 的输入里挪走或原地降级」——不新增能力，只减少每轮重复发送的字符。第 7 条实测后修正了原报告的估值：schema 只占工具清单 39%，净省 28% 而非数量级，体积大头是必须保留的工具描述。所有新增断言均做过反向验证（临时改回旧实现确认测试变红后再改回）。*
