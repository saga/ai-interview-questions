# 统一交互入口架构设计

状态：Phase 1–3 已实施，Phase 4 统一 LearningSession 暂缓 · 2026-08-31
日期：2026-08-31（实现同步更新）
关联决策：ADR-061
关联清单：`ACTION_CHECKLIST.md` · `docs/ARCHITECTURE.md`「统一交互入口」节

## 1. 问题定义

当前系统存在多条交互链：

```text
训练页       → Interview Engine / Learner Memory
模拟面试     → Interview Engine
Agent 面试   → pi-agent-core → InterviewAgent tools
Copilot Chat → CopilotSidebar 内部 chatCopilot → 普通 one-shot / multi-turn LLM
```

底层题库、评分、Learner Memory 有复用，但没有统一的 Conversation / Intent / Capability application 层。因此用户在 Copilot Chat 中说“给我出一道题”时，Chat 可能只生成文本，不会进入“出题 → 回答 → 评分 → 继续”的有状态闭环。

目标：让 Chat 成为自然语言入口；训练、模拟面试、Agent 面试和 Chat 共享确定性的 application capabilities，而不是各自拥有一套业务逻辑。

## 2. 目标架构

```text
User
  ↓
Conversation UI（Copilot / future entry points）
  ↓
Conversation Controller
  ↓
Intent / Mode Router
  ├─ Question Capability
  ├─ Interview Capability
  ├─ Evaluation Capability
  ├─ Learner Capability
  └─ General Chat fallback
          ↓
Application Layer
  ├─ Question Bank
  ├─ Evaluation
  ├─ Learner Memory
  └─ Session
          ↑
Agent Runtime（可选消费者，不拥有业务能力）
```

核心原则：

1. **LLM 识别意图，代码执行能力。** LLM 可以输出结构化 intent；出题、评分、状态修改、Learner 更新由 application/domain 确定性执行。
2. **Agent Runtime 是消费者，不是能力所有者。** Agent tools 调用 application capabilities；Chat、训练页和 Agent 面试不重复实现出题/评分逻辑。
3. **Session 是状态边界。** 交互模式可不同，但当前题目、答案、评分和生命周期必须有统一的 session 语义。
4. **先抽能力，再合并状态。** 第一阶段不重写现有 Agent session、训练状态机或 IndexedDB schema。

## 3. 核心模型

### 3.1 Intent

```ts
type UserIntent =
  | { type: 'start_interview' }
  | { type: 'ask_question'; topic?: string; difficulty?: Difficulty; format?: FormatId }
  | { type: 'answer_current_question'; answer: AnswerValue }
  | { type: 'continue_interview' }
  | { type: 'evaluate_answer' }
  | { type: 'explain_topic'; topic?: string }
  | { type: 'general_chat' };
```

Intent 只描述用户意图，不直接执行副作用。结构化输出必须经过 schema 校验；无法确认时回退到 general chat 或向用户澄清。

### 3.2 Conversation Context

```ts
interface ConversationContext {
  mode: 'chat' | 'question' | 'interview';
  sessionId?: string;
  currentQuestionId?: string;
  pendingAction?: 'answer' | 'choose_question';
}
```

状态优先级：

1. 有 active question 且 `pendingAction=answer`：优先把用户消息视为答案，避免普通 Chat 抢路由。
2. 有 interview session 且用户说“继续/下一题/结束”：交给 Interview capability。
3. 无 active session：再进行 intent classification。

### 3.3 Capability 边界（已落地 `src/application/conversation/`）

已实现：

```text
src/application/conversation/
  router.ts                # classifyIntent + ConversationContext 工厂 + telemetry
  questionCapability.ts    # rankQuestions / askQuestion
  evaluationCapability.ts  # evaluateAnswer（统一判分入口）
  interviewCapability.ts   # startInterview / continueAdaptiveInterview / evaluateInterviewAnswer
  learnerCapability.ts     # getWeakTopics / commitSession
  types.ts                 # ConversationDeps / AskQuestionInput 等
  conversation.test.ts     # 纯逻辑回归
src/schemas/conversation.ts # ConversationContext / UserIntent Zod 契约（version:1）
```

Capability 负责：

- `QuestionCapability`：按 topic/difficulty/format 和 Learner signal 选题、建立 `SessionQuestion`（`rankQuestions` 复用 `domain/adaptive.rankCandidatePool`）。
- `EvaluationCapability`：复用 `sessionEvaluator.evaluateSessionQuestion`，统一选择题判分和开放题评分，失败返回 `null` 不伪造 0 分。
- `InterviewCapability`：创建/推进/结束 session（对 `application/interviewEngine.buildSession/nextAdaptiveStep` 的薄封装）。
- `LearnerCapability`：读取弱项、更新画像、幂等提交 session record（`updateLearner → saveLearner`）。
- `ConversationRouter`：解释 intent、当前 mode 和 capability 结果，管理 pending action；不直接计算分数；`chatCopilot` 仅作为 `general_chat` 与 `classifyIntent` 的 LLM adapter。

`src/agent/tools.ts` 已改为薄适配层：

```text
domain / storage
      ↑
application capabilities（question / evaluation / learner）
      ↑
agent tools / Copilot conversation controller / training hooks
```

`searchQuestions` / `getQuestion` 复用 `rankQuestions`，`evaluateAnswer` 复用 `evaluationCapability`，不再重复实现 ranking/evaluation 业务规则。

## 4. 关键用户流程

### 4.1 Chat 出题

```text
“给我出一道 RAG 的题”
  → ask_question(topic=rag)
  → QuestionCapability
  → UI 展示真实 SessionQuestion
  → context.pendingAction = answer
```

Chat 不自行生成题目正文，不绕过题库和题目契约。

### 4.2 Chat 回答与继续

```text
“我的答案是……”
  → answer_current_question
  → EvaluationCapability
  → 展示评分 / gaps / feedback
  → context.pendingAction = choose_question

“继续”
  → continue_interview
  → QuestionCapability / InterviewCapability
```

### 4.3 从 Chat 进入面试

```text
“开始模拟面试”
  → start_interview
  → InterviewCapability 创建 session
  → mode = interview
  → 后续消息按 session 状态路由
```

“针对刚才的弱点再问我”可触发 Agent follow-up，但题目选择与评分仍必须走共享 capability。

## 5. 分阶段实施（Phase 1–3 已完成，Phase 4 已评估暂缓）

### Phase 1：抽 application capabilities — 已完成

- 从 Agent tools、训练 Hook 和 Interview Engine 中识别重复业务逻辑。
- 新增 `src/application/conversation/` 能力接口和 `conversation.test.ts` 纯逻辑测试。
- `src/agent/tools.ts` 已改为 capability adapter，不重复实现 ranking/evaluation 业务规则。

验收：Agent 面试现有行为不回归；出题、评分、Learner 更新已有共享 application 入口。`npm run test` 41 files / 525 tests 通过。

### Phase 2：建立 Conversation Context — 已完成

- 为 Copilot 增加 `ConversationContext` schema（`src/schemas/conversation.ts:7-13`，`version:1`）与 localStorage 最小 context 恢复（`CopilotSidebar.tsx:134-199`，best-effort，transcript 不恢复）。
- 支持 `question` / `interview` mode 和 `pendingAction: answer | choose_question`。
- `ask_question` 只调用 `QuestionCapability` 并渲染题库快照；`answer_current_question` 交由 `EvaluationCapability`；`continue_interview` / `start_interview` 复用共享 capability。

验收：Chat 已支持“给我出一道题”→ question mode → 回答 → 共享评分 → “下一题”闭环；失效题目提示重新出题；重复提交由 `loadingRef` + context 状态阻断。

### Phase 3：接入轻量 Intent Router — 已完成

- 定义 `UserIntent` schema（`src/schemas/conversation.ts:15-33`，`version:1`，`intent/confidence/source/fallbackReason` telemetry）。
- 高置信确定性规则：`给我出题`/`继续/下一题`/`开始面试`/`结束`（`router.ts:45-65`）。
- 接入结构化 LLM intent classification（`INTENT_SYSTEM` + `extractJSON` + `userIntentSchema.safeParse`），分类器不执行副作用；topic/difficulty/format 经 schema 校验并支持常用 alias（`TOPIC_ALIASES`）。
- 低置信（`confidence<0.75`）或冲突要求澄清；未知回退 `general_chat`；dev 环境输出 debug telemetry。

验收：核心 intent 有可追踪路由结果；未知输入回退 general chat；注入字符串作为数据处理，不改变 router 权限（有回归测试）。

### Phase 4：逐步统一 Session — 已评估，暂缓统一 schema

- 对比训练、模拟面试、Agent 面试和 Chat session 的字段。
- 设计统一 `LearningSession` 前先完成数据迁移方案与回放兼容策略。
- 只有在 adapter 稳定后，才合并 session schema 与持久化。

当前评估结论（与 `ACTION_CHECKLIST.md` Phase 4 一致）：

| 入口 | 当前状态 | 关键字段 | 持久化/收尾 |
| --- | --- | --- | --- |
| Training | `InterviewSession` + Hook refs | questions / answers / grades / definition | `sessionFromQuiz` → `updateLearner` → IndexedDB |
| Mock Interview | `InterviewSession` | questions / answers / evaluations / timer | 复用 Interview Engine 收尾 |
| Agent Interview | `InterviewAgentSession` | currentQuestion / answers / evaluations / log / fallback telemetry | `sessionRecordFromAgent` → `updateLearner`，另有 agent draft |
| Chat Question | `ConversationContext` + canonical `Question` snapshot | currentQuestionId / pendingAction / mode | 评分后通过 `onSessionComplete` 进入既有 Learner 管线；context 仅 best-effort localStorage |

结论：暂不直接合并为 `LearningSession`。现有三种 session 的生命周期和恢复语义不同，先保留 adapter；统一 schema 需要后续单独 ADR、迁移版本、回放兼容和幂等写入方案。当前 Chat 已采用最小 `ConversationContext`，刷新后可恢复当前题 id，但不恢复完整 Chat transcript。

## 6. 明确不做

- 第一阶段不引入 Multi-Agent / Planner。
- 不让 LLM 直接生成或修改题库状态。
- 不把完整题库、答案或解析无条件注入 Chat/Agent context。
- 不一次性重写 `useTrainingSession`、`useAgentInterview` 和 IndexedDB。
- 不在没有 schema、权限和失败恢复设计前开放任意 capability tool。

## 7. 风险与控制

| 风险 | 控制 |
| --- | --- |
| Chat 意图误判答案/普通聊天 | active session 优先级 + 明确 pendingAction + 可撤销确认 |
| LLM 绕过题库直接编题 | QuestionCapability 只从 Question Bank 选题 |
| 多入口重复落库 | LearnerCapability 统一提交，session idempotency |
| Agent tools 与 capability 双写逻辑 | 先抽纯服务，再删除重复实现 |
| Chat 历史污染 Agent 状态 | ConversationContext 与 Agent runtime session 分离，显式 attach |
| 大范围状态迁移回归 | adapter-first，分阶段迁移 |

## 8. 当前实现状态（已与代码同步，以代码为准）

- `src/components/copilot/CopilotSidebar.tsx` 已接入 Conversation 能力：`classifyIntent` → `askQuestion` / `evaluateConversationAnswer` / `continue_interview` / `start_interview`，题目展示来自题库快照不由 LLM 生成，`chatCopilot` 仅保留为 `general_chat` 与 `classifyIntent` 的 LLM adapter；`ConversationContext` 经 `conversationContextSchema` 校验后 best-effort 写入 `localStorage`（`CONVERSATION_CONTEXT_KEY`），刷新可恢复当前题 id，完整 transcript 不恢复（设计如此）。
- `src/agent/tools.ts` 已改为 application capability 的薄适配层：`searchQuestions`/`getQuestion` 复用 `questionCapability.rankQuestions`，`evaluateAnswer` 复用 `evaluationCapability.evaluateAnswer`，评分不归 Agent；重复 ranking/evaluation 逻辑已消除。
- `src/application/conversation/router.ts` 已实现轻量 Intent Router：确定性高置信规则 + 结构化 LLM intent（`INTENT_SYSTEM`，`extractJSON` 后 `userIntentSchema.safeParse`）+ topic alias + 低置信澄清 + `IntentTelemetry`（`intent/confidence/source/fallbackReason`，dev 调试输出）。
- 训练、模拟面试、Agent 面试仍由不同 Hook/runtime 管理 session，未统一为 `LearningSession` — 这是 Phase 4 **刻意暂缓**的决策（见 `§5 Phase 4` 与 ADR-061），非遗漏；adapter-first，暂不重写 `useTrainingSession` / `useAgentInterview` / IndexedDB。

历史备注：本文件初版为“设计已记录、尚未实施”；2026-08-31 起 Phase 1–3 已落地，本文档同步更新为实现状态，后续以代码为准并即时修正文档。
