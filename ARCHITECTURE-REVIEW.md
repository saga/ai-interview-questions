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

#### 4. Agent 的「选择题快路径」跳过了 Agent 决策

**文件**：`src/agent/interviewAgent.ts` 第 212-234 行

```typescript
async function choiceAdvance(answer: AnswerValue): Promise<void> {
  // ...
  session.evaluations[qid] = await evaluateSessionQuestion(sq, answer, provider);
  // 确定性交付下一题（或收尾），不设置 usingFallback
  if (!fallbackNextQuestion()) { ... }
}
```

当当前题是选择题时，`submitAnswer` 会走 `choiceAdvance`——完全跳过 LLM 循环，用确定性逻辑评分 + 选题。这是性能优化（选择题判分是确定性的，不需要 LLM），但意味着：

- **选择题的面试流程完全不经过 Agent 决策**——Agent 只负责开放题的评估决策；
- Agent 面试在「全选择题」场景下退化成「确定性引擎自动播放」，Agent 的自适应能力（根据表现调整难度/主题）没有发挥作用。

这不是 bug，是设计上的 trade-off（性能 vs 决策完整性）。但值得注意：**如果用户关闭了 `generateOpenQuestions`（默认关闭），Agent 面试几乎不会用到 Agent 的决策能力**——它变成了一个「有 Agent 外壳的确定性引擎」。

**建议**：在 UI 上明确告知「选择题由系统自动评分并选题，开放题由 AI 评估」，或者在选择题场景下也让 Agent 参与选题决策（把 `pickNextAdaptive` 的结果作为「建议」交给 Agent，Agent 可以接受或调整）。

---

#### 5. `OPENING_INSTRUCTION` 硬编码，不可配置

**文件**：`src/hooks/useAgentInterview.ts` 第 49-54 行

```typescript
const OPENING_INSTRUCTION = `你是一位资深 AI 技术面试官，主持一次约 6–10 题的模拟面试。流程：
1) 先调用 getUserWeaknesses 了解我的薄弱主题；
2) 用 searchQuestions 在相关主题找候选题，再用 getQuestion 选定一道题呈现给我；
...
`;
```

Agent 的系统提示词可以通过 `config.prompts?.agentSystem` 覆盖，但**开场指令（OPENING_INSTRUCTION）是硬编码的**，用户无法通过设置页修改。这造成「能改系统提示但不能改开场指令」的不对称——如果用户想调整面试流程（比如改成 15 题、或者不查薄弱主题），只能改系统提示，不能改开场指令。

**修复**：把 `OPENING_INSTRUCTION` 也纳入 `config.prompts`（比如 `config.prompts?.agentOpening`），或者作为 `createInterviewAgent` 的可选参数。

---

#### 6. Prompt 里的「工具调用铁律」说明浪费 token

**文件**：`src/agent/prompt.ts` 第 25 行

```typescript
（说明：「只调一次 searchQuestions / 不编造 id / not_found 回列表挑真 id」已由工具代码确定性保证：getQuestion 找不到 id 时会回带可用题号，searchQuestions 重复调用幂等复用缓存列表，无需在 prompt 中约束。）
```

这段说明**放在了系统提示里**，LLM 每次调用都会读到。但它的内容是「你不需要遵守这些规则，因为代码已经保证了」——这是给开发者看的注释，不是给 LLM 的指令。

这段文字约 80 个 token，在每次 Agent 调用中都会被发送。如果一场面试有 30 次 LLM 调用，就是 2400 个 token 的浪费。

**修复**：把这段说明从系统提示里删掉，只保留在代码注释里。系统提示应该只包含 LLM 需要遵守的规则，不包含「不需要遵守的规则」的说明。

---

#### 7. Chrome 的 `renderTools` 把完整 JSON Schema 塞进 prompt，可能膨胀

**文件**：`src/ai/chromeAgent.ts` 第 132-146 行

```typescript
function renderTools(tools?: Tool[]): string {
  return tools.map((t) => {
    let schema = '{}';
    try { schema = JSON.stringify(t.parameters ?? {}); } catch { schema = '{}'; }
    return `- ${t.name}: ${schema} — ${t.description ?? ''}`;
  }).join('\n');
}
```

7 个工具 × 每个工具的 JSON Schema（几十到几百字符）+ description，会让 Chrome 的 prompt 快速膨胀。Chrome Prompt API 的上下文窗口有限（约 4K-8K tokens），如果工具 schema 太长，可能挤占对话历史的空间。

**修复**：Chrome 的 renderTools 可以只输出工具名 + 关键参数说明，不输出完整 JSON Schema。比如 `- getQuestion(id: string, format?: "choice" | "open") — 按 id 选定题目`。这样更紧凑，也更适合 Chrome 的小上下文窗口。

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

1. **`getQuestion` topic 兜底重复出题**（tools.ts:161）——`unasked` 为空时不要兜底到 `byTopic[0]`，改为从全题库选未问的题或返回 not_found。
2. **`getCoverageGaps` 半成品**（tools.ts:318）——要么实现真正的覆盖缺口逻辑，要么从工具列表删掉。

### 短期修复（P1，1-2 天内可完成）

3. **删掉 prompt.ts 第 25 行的「不需要遵守的规则」说明**——只保留在代码注释里。
4. **`OPENING_INSTRUCTION` 纳入 config.prompts**——让用户可以通过设置页修改开场指令。
5. **Chrome renderTools 简化**——只输出工具名 + 关键参数，不输出完整 JSON Schema。
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
- **P1 问题**（choiceAdvance 跳过决策、OPENING_INSTRUCTION 硬编码、prompt 浪费 token）是「设计上的 trade-off 没有被显式记录」——性能优化牺牲了决策完整性，但用户不知道；
- **P2 问题**（证据链不完整、无成本控制、选题逻辑重复）是「长期演进方向」——不影响当前使用，但会在规模增长时暴露。

**最值得立即修复的是 P0 的三个问题**——它们都是「承诺了但没兑现」，修复成本低（每个不超过 50 行代码），但能消除真实的功能缺陷。

**最值得长期投入的是 P2 的「Learner Memory 证据链」**——这是产品的核心竞争力（个性化推荐），但目前的证据链主要依赖开放题，而开放题默认被禁用。如果能解决「选择题也产生 gap 信号」这个问题，Learner Memory 的薄弱分析会从一个「只有分数的壳」变成「真正有洞察的教练」。

---

*本报告基于 2026-08-30 的 main 分支代码，含 DeepSeek 优化、评分序级重构、VARIANT v2、session 持久化等最新改动。*
