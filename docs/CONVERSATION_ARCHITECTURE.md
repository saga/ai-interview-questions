# 统一交互入口架构设计

状态：设计已记录，尚未实施
日期：2026-08-31
关联决策：ADR-061

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

### 3.3 Capability 边界

建议新增：

```text
src/application/conversation/
  intent.ts
  conversationRouter.ts
  questionCapability.ts
  evaluationCapability.ts
  interviewCapability.ts
  learnerCapability.ts
```

Capability 负责：

- `QuestionCapability`：按 topic/difficulty/format 和 Learner signal 选题、建立 `SessionQuestion`。
- `EvaluationCapability`：复用 `sessionEvaluator`，统一选择题判分和开放题评分。
- `InterviewCapability`：创建/推进/结束 session，调用确定性策略或 Agent runtime。
- `LearnerCapability`：读取弱项、更新画像、提交 session record。
- `ConversationRouter`：解释 intent、当前 mode 和 capability 结果，管理 pending action；不直接计算分数。

现有 `src/agent/tools.ts` 应逐步变为薄适配层：

```text
domain / storage
      ↑
application capabilities
      ↑
agent tools / training hooks / conversation controller
```

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

## 5. 分阶段实施

### Phase 1：抽 application capabilities

- 从 Agent tools、训练 Hook 和 Interview Engine 中识别重复业务逻辑。
- 新增 capability 接口和纯逻辑测试。
- 先让 Agent tools 调用 capability；不新增 Chat 行为。

验收：Agent 面试现有行为不变；出题、评分、Learner 更新只有一个 application 入口。

### Phase 2：建立 Conversation Context

- 为 Copilot 增加 context/session adapter。
- 支持 `question` mode 和 `pendingAction`。
- 复用现有 `InterviewAgentSession` 或建立最小 adapter；暂不迁移全部 IndexedDB 数据。

验收：Chat 产生的题目可被回答和评分；刷新/结束行为有明确策略；不重复执行已完成工具调用。

### Phase 3：接入轻量 Intent Router

- 先用结构化 LLM intent 或确定性规则处理高置信命令。
- intent 经过 Zod/schema 校验。
- 未知意图回退 general chat。
- 所有副作用仍由 capability 执行。

验收：`ask_question`、`answer_current_question`、`continue_interview`、`start_interview` 四条核心路径有测试和 telemetry。

### Phase 4：逐步统一 Session

- 对比训练、模拟面试、Agent 面试和 Chat session 的字段。
- 设计统一 `LearningSession` 前先完成数据迁移方案与回放兼容策略。
- 只有在 adapter 稳定后，才合并 session schema 与持久化。

当前评估结论：

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

## 8. 当前实现与设计的差距

- `src/components/copilot/CopilotSidebar.tsx` 内部仍持有 `chatCopilot`，尚未调用 Question/Evaluation/Interview capability。
- `src/agent/tools.ts` 主要服务 Agent 面试，尚未作为跨入口的 application API。
- Agent prompt 已具备连续面试决策语义，但该语义尚未被 Conversation Router 复用。
- 训练、模拟面试、Agent 面试仍由不同 Hook/runtime 管理 session。

本文件只记录目标设计和实施顺序；完成用户确认前不应直接开始 Phase 1 的大范围重构。
