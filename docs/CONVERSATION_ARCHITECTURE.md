# 统一交互入口架构设计（三通道 + 个性化 Copilot）

状态：ADR-061 / ADR-062 / ADR-063 / ADR-064 / ADR-065 已实施 · 2026-08-31
关联决策：`docs/DECISIONS.md` ADR-061~ADR-065
关联清单：`ACTION_CHECKLIST.md` · `docs/improvement_plan/plan0831_4_checklist.md` · `docs/ARCHITECTURE.md`「统一交互入口」节

## 1. 问题定义

系统有四条交互链：训练页、模拟面试、Agent 面试、Copilot Chat。底层题库、评分、Learner Memory 已复用，但没有统一的 Conversation 应用层，导致：

- Copilot Chat 说「给我出一道题」可能只生成文本，不进「出题→回答→评分→继续」闭环（旧 `router.ts` 把一切先过 LLM `classifyIntent`，再把 `explain_topic / general_chat` 当垃圾桶）；
- 「这道题我不会，给我详细解读」会被路由层挡成「请明确说命令」或误判成一次作答去评分；
- Copilot 从未真正从知识库检索，只是把上下文拼进 prompt 直连 LLM（ADR-063 前）。

目标：让 Chat 成为自然语言入口，训练/面试/Chat 共享确定性 application capabilities，且 Copilot 是「**个性化、有依据**」的教练，不是泛知识解释器。

## 2. 目标架构（三条通道，确定性决策）

```text
User
  ↓
Conversation UI（CopilotSidebar）
  ↓
routeUserMessage（唯一通道决策点，命令检测器）   ← 纯正则，无 LLM 意图分类
  ├─ command  → handleCommand    （改训练状态：5 个确定性动作）
  ├─ answer   → handleAnswer     （提交当前题作答 + 评分）
  └─ copilot  → handleCopilotChat（解释/提示/对比/追问/知识问答，零副作用）
          ↓
Application Layer（共享 capability，不重复实现）
  ├─ Question Bank        ├─ Evaluation      ├─ Learner Memory   ├─ Session
  └─ Structured Knowledge RAG（ADR-063/065：检索 → 组装 → LLM → 引用）
          ↑
Agent Runtime（面试模式的可选消费者，不拥有业务能力）
```

核心原则（与 ADR-064/065 一致）：

1. **命令检测器不调用 LLM。** 命令只有 5 个确定性动作，正则足够；不再有「意图不确定 → 请说命令」的阻断——不确定就是 Copilot。
2. **求助优先于作答。** `isHelpSeeking` 命中即走 Copilot，「这道题我不会，给我详细解读」不再被误判成评分（`answer` 通道仅在「确有待作答题目且输入可解析为作答」时成立）。
3. **检索范围与答案可见性是安全边界，由确定性 planner 决定，不交给模型。** scope `current_question / topic / knowledge / global` + mode `answer / explain / hint / quiz`（ADR-065 扩为四模式）。
4. **真值隔离在检索层。** `questionDocument` 把真值隔离进 `sensitiveText`，`renderDocument(doc, mode)` 硬裁剪——这是「检索不能绕过 assessment boundary」的硬保证，不是请求模型自觉。
5. **不新增 abstraction。** ADR-065 只在既有 `KnowledgeSearchQuery` / `CopilotTurnInput` / prompt 上加字段，不引入新的层/agent/reranker。

## 3. 核心模型

### 3.1 Conversation Context（`src/schemas/conversation.ts`）

```ts
interface ConversationContext {
  version: 1;
  mode: 'chat' | 'question' | 'interview';   // 纯聊天也持久化为 'chat'（ADR-065 P1-4）
  sessionId?: string;
  currentQuestionId?: string;
  pendingAction?: 'answer' | 'choose_question';
  questionHistory?: string[];
  questionCount?: number;
  messageTurnCount?: number;
  endedAt?: number;                          // 上一场已结束的标记（用于上下文纠正）
}
```

状态优先级（`routeUserMessage`，ADR-064 §5）：

1. `detectCommand` 命中（结束/继续/开始/出题/重评）→ `command` 通道，命令优先于一切。
2. `isHelpSeeking` 命中 → `copilot` 通道（求助优先于作答）。
3. 当前确有 `pendingAction=answer` 的题目且输入可解析为作答 → `answer` 通道。
4. 其余 → `copilot` 通道。

### 3.2 答案安全模式（ADR-063 §7，ADR-065 扩四模式）

```ts
type RetrievalMode = 'answer' | 'explain' | 'hint' | 'quiz';
```

| 模式 | 检索层暴露 | Copilot 语境 | 触发 |
| --- | --- | --- | --- |
| `answer` | 正确选项 + 解析 + 参考答案 | 「直接给答案」 | 用户明确要答案（`答案/正确选项/解析一下`） |
| `explain` | 正确选项 + 解析 + 参考答案 | 「详细解读这道题」 | 有当前题默认（ADR-065 P0-1）；用户要「详细解读/讲解」 |
| `hint` | 只知识骨架 + 误解 | 「提示/思路，不给答案」 | 用户要思路/提示（`提示/从哪入手/别给答案`） |
| `quiz` | 只题干，连选项都不给 | 「考我」 | 用户要被考（`考考我/来道题`） |

`explain` 与 `answer` 在**检索层完全等价**（都暴露 `sensitiveText`），区别只在 prompt 的 `modeNote`：explain 是「讲解这道题」、answer 是「给答案」。两者都受同一条硬约束：**不得修改或暗示修改题目设定的正确答案与评分标准**（prompt §8 第 3 条）。hint 在检索层被裁剪（`renderDocument` 不拼 `sensitiveText`），`buildKnowledgePromptSection` 再补一句禁止项，双保险。

### 3.3 Capability 边界（已落地 `src/application/conversation/`）

```text
src/application/conversation/
  commandDetector.ts        # routeUserMessage / detectCommand / isHelpSeeking / parseChatAnswer（纯正则，5 个命令）
  copilot.ts                # runCopilotTurn（检索→组装→LLM→引用，零副作用）+ AnswerContext + deriveLearnerContext
  copilotPrompt.ts          # buildCopilotSystemPrompt（纯函数；含答案诊断段与 modeNote）
  knowledgeCapability.ts    # planRetrievalScope / planRetrievalMode / retrieveForCopilot / combineFollowUp / buildKnowledgePromptSection
  questionCapability.ts     # rankQuestions / askQuestion
  evaluationCapability.ts   # evaluateAnswer（统一判分入口，失败返回 null 不伪造 0 分）
  interviewCapability.ts    # startChatInterview / rehydrateInterviewAgent（Agent 面试 runtime 桥接）
  conversationSession.ts    # ConversationSession 聚合 + localStorage 持久化（单一真源）
  conversation.test.ts / commandDetector.test.ts / knowledgeCapability.test.ts
src/domain/knowledge/       # types / documents / index / graph / retrieve（结构化知识 RAG，ADR-063）
```

`src/agent/tools.ts` 已改为薄适配层：`searchQuestions`/`getQuestion` 复用 `questionCapability.rankQuestions`，`evaluateAnswer` 复用 `evaluationCapability`。

## 4. Personalized Grounded Copilot（ADR-065，本架构的关键增量）

> 目标不是「更好的 RAG 架构」，而是「personalized grounded Copilot」：知道「这道题是什么 + 用户怎么答的 + 为什么错 + 长期哪里弱」，然后检索最相关知识解释。

### 4.1 AnswerContext（P0-2：用户作答与诊断进 Copilot）

```ts
// copilot.ts
export interface AnswerContext {
  answer: AnswerValue;                 // 选择题：选项下标数组；开放题：文本
  evaluation?: EvaluationResult | null; // 该题评分诊断（未评分为 null）
}
```

`CopilotSidebar.handleCopilotChat` 从 `ConversationSession.answers/evaluations` 取出当前题的作答与诊断，传入 `runCopilotTurn`；`buildCopilotSystemPrompt` 渲染「用户作答与诊断（个性化教练依据）」段（综合评分 + 维度序级 + 薄弱点 + 命中误解），让 Copilot 围绕用户实际偏差讲解，而不是泛泛而谈。

### 4.2 follow-up 检索 query 绑定（P1-1：确定性，无 LLM query rewriting）

```ts
// knowledgeCapability.ts
combineFollowUp(current, lastUserTurn?, topic?)
```

当前消息是短追问（<16 字且无 topic 锚点）时，拼上上一轮用户消息，只用于 lexical 检索；**模式/范围规划仍用原始 `query`**，避免「给我出一道题」这类命令词把追问误判成 `quiz`。`retrieveForCopilot` 用 `retrieveQuery`（拼接后）做检索、`query`（原始）做规划，二者解耦。

### 4.3 Learner Memory 参与检索排序（P1-2：轻量提权，不主导）

```ts
// types.ts → KnowledgeSearchQuery
learnerContext?: { weakTopics?: string[]; weakAngles?: string[] };
```

`metadataScore` 内 `learnerBoost` 对命中弱项 `knowledgeId`（上限 0.15）/ `topic`（0.12）/ `question.angle`（0.1）的节点小幅上浮。`copilot.ts` 的 `deriveLearnerContext(profile, topic)` 从 `profile.topicStats`（均分 < `WEAK_AVG`）与 `angleCoverage` 推导，或直接接受上游透传。上限刻意很小，不主导、不新增排序层。

### 4.4 纯 Copilot 会话持久化（P1-4：方案 A）

`handleCopilotChat` 首次进入即 `createConversationSession(mode='chat')` 落 `localStorage`，transcript 随 `ConversationSession` 刷新可恢复，与命令/答案通道一致。旧实现 `convSession=null` 时不落库，已在 ADR-065 修正。

## 5. 关键用户流程

### 5.1 Chat 解释当前题（个性化）

```text
「这道题我不会，给我详细解读」
  → routeUserMessage → isHelpSeeking → copilot
  → planRetrievalMode：activeQuestion 存在 → 'explain'（可解释正确选项）
  → retrieveForCopilot：scope=current_question，evidence 含正确选项 + 解析
  → buildCopilotSystemPrompt：渲染 AnswerContext（用户答了什么、得分、薄弱点）
  → LLM 围绕用户偏差讲解，尾部附「依据：[K]/[Q]」
```

### 5.2 Chat 出题 → 回答 → 继续

```text
「给我出一道 RAG 的题」→ command(ask_question) → QuestionCapability → 题库快照
「我的答案是 B」       → answer → EvaluationCapability → 评分/gaps/feedback
「继续」               → command(continue_interview) → 自适应或确定性选题
「结束」               → command(end_interview) → toSessionRecord → onSessionComplete 一次性落库
```

### 5.3 从 Chat 进入面试

```text
「开始模拟面试」→ command(start_interview) → interviewCapability 创建 Agent runtime session
  → mode=interview，后续按 session 状态路由；运行时 session 投影到 ConversationSession（单一真源）
```

## 6. 不做（与 ADR-065 一致）

- 不引入 Multi-Agent / Planner / query-rewrite agent。
- 不让 LLM 直接生成或修改题库状态。
- 不把完整题库/答案/解析无条件注入 Chat/Agent context（真值由检索层按 mode 裁剪）。
- 不一次性重写 `useTrainingSession` / `useAgentInterview` / IndexedDB。
- embedding 语义检索、reranker、Vector DB 仍留 Phase 2（复用已有 MiniLM），不在本次范围。
- inline citation / UI 证据折叠面板暂不做（当前为「依据列表」文本尾部拼接）。

## 7. 风险与控制

| 风险 | 控制 |
| --- | --- |
| Chat 意图误判答案/普通聊天 | 命令优先 + 求助优先于作答 + `pendingAction` 显式控制 |
| LLM 绕过题库直接编题 | 命令通道只调 QuestionCapability（仅从题库选题） |
| 多入口重复落库 | `onSessionComplete` 统一提交；`end_interview` 才一次性 `toSessionRecord` |
| Agent tools 与 capability 双写 | 先抽纯服务，tools 改适配层 |
| Copilot 泄露答案（assessment 越界） | 真值硬裁剪在检索层（hint/quiz 不暴露）；prompt 双保险；explain/answer 也不许篡改正确答案 |
| follow-up 检索召回差 | `combineFollowUp` 绑上一轮上下文；不污染模式/范围规划 |
| 纯聊天不持久化导致刷新丢 transcript | 方案 A：`handleCopilotChat` 首次进入即建 `mode='chat'` session |

## 8. 当前实现状态（以代码为准）

- `src/components/copilot/CopilotSidebar.tsx`：`routeUserMessage` 三通道收敛；`handleCopilotChat` 首次进入即建 `mode='chat'` session（方案 A），从 `ConversationSession` 取 `AnswerContext` 下传。
- `src/application/conversation/commandDetector.ts`：5 个确定性命令，无 LLM intent 分类；`routeUserMessage` 为唯一决策点。
- `src/application/conversation/copilot.ts`：`runCopilotTurn`（检索→组装→LLM→引用，零副作用）；`AnswerContext` + `deriveLearnerContext`；follow-up 用 `combineFollowUp` 绑定上一轮用户消息。
- `src/application/conversation/knowledgeCapability.ts`：`planRetrievalScope/Mode` 确定性 planner；`retrieveForCopilot` 透传 `learnerContext`/`retrieveQuery`；`buildKnowledgePromptSection` 把 `explain` 与 `answer` 同样视为可暴露真值。
- `src/domain/knowledge/`：四文档形态 + BM25 + Concept Graph 1-hop；`renderDocument` 四模式；`metadataScore` 内 `learnerBoost` 轻量提权；`questionSlotLimit` 题目证据上限（current_question/quiz 放开）。
- `src/application/conversation/conversationSession.ts`：`ConversationSession` 聚合 `context+messages+questions+answers+evaluations`，`localStorage CONVERSATION_SESSION_KEY` 统一持久化；`agentSession` 为运行时对象不持久化。

历史备注：本文件初版描述 `router.ts`/`classifyIntent`/`UserIntent` LLM 意图路由；ADR-064 已将其删除并改为 commandDetector 三通道，ADR-065 进一步落地个性化 Copilot（explain 模式 / AnswerContext / Learner 检索信号 / 聊天持久化）。后续以代码为准并即时修正文档。
