# plan0831_4 改进清单 · Chat 与 Agent 融合收敛

关联文档：`docs/improvement_plan/plan0831_4.md` · ADR-061 · `docs/CONVERSATION_ARCHITECTURE.md`

> 目标：把 Chat 从“能出题的对话”收敛为统一入口，`Question Mode` 与 `Interview Mode` 共享生命周期与能力，不再三套 orchestration 各自为政。

## 实施原则

- Conversation 是入口，不是独立业务实现
- LLM 只做结构化 intent 识别，副作用由 application capability 确定性执行
- 题目来自题库快照，不由 LLM 自由生成
- 先补齐 session 语义与路由准确性，再动 orchestration 大合并

---

## P0 — 必须修复（Chat 与 Agent 融合的断点）

- [x] **P0-1 `start_interview` 真正启动 Agent Interview**
  - 现状：`start_interview` 仅 `mode='interview'` + `askQuestion()`，未进入 `createInterviewAgent`/`createAgentSession`/`InterviewAgentSession`
  - 目标：`start_interview` 创建拥有生命周期的 `Interview/ConversationSession`，进入 Agent runtime（`submitAnswer()` 驱动），不再走共享 `askQuestion()`
  - 涉及：`src/application/conversation/interviewCapability.ts` · `src/components/copilot/CopilotSidebar.tsx` · `src/application/conversation/router.ts`
  - 验收：`开始模拟面试` 后后续消息由 Agent 决策选题/追问/收尾，而非 `rankQuestions` 重排

- [x] **P0-2 `continue_interview` 不再是“重新 askQuestion”**
  - 现状：`下一题` 直接 `askQuestion()`，未使用上一题评分/Learner state/Agent strategy/追问状态/已考察 topic/session 历史
  - 目标：`continue_interview` 使用上一题 `EvaluationResult` + `LearnerProfile` + 策略（`rankCandidatePool` 仅是候选池排序，不等于 continuation）或直接交由 Agent continuation
  - 涉及：`questionCapability.ts` · `evaluationCapability.ts` · `router.ts` · `CopilotSidebar.tsx`
  - 验收：连续提问会基于薄弱点/前置/角度弱项选下一题，而非重复题库 rank

- [x] **P0-3 建立真正的 Session（`ConversationContext.sessionId` 不再只是标签）**
  - 现状：`sessionId = crypto.randomUUID()` 但无 `InterviewAgentSession`/`LearningSession` 生命周期
  - 目标：引入 `ConversationSession`（`context + messages + questions + answers + evaluations + status` 的聚合），`sessionId` 对应真实可恢复、可结束、可回放的 session
  - 涉及：新增 `src/application/conversation/conversationSession.ts` · `src/schemas/conversation.ts`
  - 验收：`sessionId` 可定位到唯一 session，支持查询历史、duration、progress、replay

- [x] **P0-4 连续 Chat 训练不再拆成 N 个 SessionRecord**
  - 现状：每答一题 `sessionFromQuiz([{question, format}], {[id]: evaluation})` + `onSessionComplete(record)` → Q1/Q2/Q3 各存一个 1 题 session
  - 目标：一次连续问答聚合为单一 `SessionRecord`（`questions: SessionQuestion[]` + `evaluations` + `answers`），仅在 `end_interview`/显式结束或阈值时一次性落库 Learner Memory
  - 涉及：新增 `chatSession.ts` / `conversationSession.ts` · `CopilotSidebar.tsx` · `learnerCapability.ts`
  - 验收：`给我出一道题 → 回答 → 下一题 → 回答` 产生 1 个多题 session，`average`/`duration`/`history` 语义正确

- [x] **P0-5 `end_interview` 独立 intent，修复“结束”被判为 `evaluate_answer`**
  - 现状：`router.ts:54` 命中 `结束|停止` 返回 `evaluate_answer`；`CopilotSidebar` 以 `当前题已结束评分流程...` 处理，非真正结束
  - 目标：新增 `end_interview` intent，结束语义落到 session 状态机（落库/清 `pendingAction`/重置 `mode`）
  - 涉及：`src/schemas/conversation.ts` · `src/application/conversation/router.ts` · `CopilotSidebar.tsx`
  - 验收：`结束`/`结束面试` 命中 `end_interview`，触发聚合落库与状态回收

- [x] **P0-6 澄清 `evaluate_answer` vs `answer_current_question` 重复语义**
  - 现状：两者并存但路径不清晰
  - 目标：保留 `answer_current_question` 为主路径；`evaluate_answer` 收敛为“重新评价刚才答案”的显式请求（或删除），不在结束/作答主流程中使用
  - 涉及：`router.ts` · `CopilotSidebar.tsx`

---

## P1 — 体验与架构收敛

- [x] **P1-1 `messages` 与 `context` 统一持久化**
  - 现状：仅 `conversationContext` 持久化，`messages` 为 React state；刷新后 `session context 还在，聊天记录没了`，LLM 失去 history
  - 目标：`ConversationSession { context, messages }` 统一持久化（`localStorage` 或 `IndexedDB.agentSessions` 复用），恢复时 `history = messages`
  - 涉及：`CopilotSidebar.tsx` · `src/storage/db.ts` 或 `localStorage` key 合并
  - 验收：刷新后对话与题序可恢复，general chat 不丢上下文

- [x] **P1-2 抽离 `buildSystemPrompt()` / `buildConversationContext()` 到 `application/conversation/`**
  - 现状：Copilot 在组件内拼接 `weakness/currentQuestion/session` 生成 prompt，domain 信息耦合 UI
  - 目标：新增 `src/application/conversation/copilotPrompt.ts`（`buildCopilotSystemPrompt` + `buildConversationContext` 纯函数），组件仅负责 UI
  - 涉及：`CopilotSidebar.tsx` → `application/conversation/prompt.ts`
  - 验收：UI 不直接依赖 `LearnerProfile` 内部结构计算提示词

- [x] **P1-3 增强 Router 确定性能力与上下文丰富度**
  - 现状：仅覆盖少量固定短语，大量输入依赖 LLM；`context` 仅 `mode/sessionId/currentQuestionId/pendingAction`，缺少 `lastEvaluation/questionHistory/availableModes`
  - 目标：扩展确定性模式（`考考我 Agent`/`来个 RAG 的`/`难一点`/`system design`/`继续考`/`再追问`/`针对刚才错误继续` 等），并以 `lastEvaluation/questionHistory/mode` 作为 router context
  - 涉及：`router.ts` · `conversationSession.ts`
  - 验收：`难一点`/`针对刚才薄弱点继续` 可结构化命中对应 intent/topic/difficulty，无需 LLM 猜

- [x] **P1-4 动态升级：Chat 可自动升级为 Agent**
  - 目标：`Question mode` 下用户要求连续/加难/追问时，`upgrade → Interview mode` 由 Agent 接管（`Question → Practice → Adaptive Practice → Interview` 非孤立页）
  - 涉及：`router.ts` · `CopilotSidebar.tsx` · `interviewCapability.ts`
  - 验收：`再难一点，继续问我` 在 Q1 评分后自动进入 Agent 驱动的下一题

- [x] **P1-5 三套 orchestration 再收敛（Chat / Agent / Training）**
  - 现状：`Chat: 下一题 → rankQuestion` / `Agent: 下一题 → Agent+tools` / `Training: 下一题 → interviewEngine` 三个行为源
  - 目标：`Question Mode → QuestionCapability`，`Interview Mode → Agent Interview Runtime`，共享 `Question/Evaluation/Learner/Session` 能力
  - 涉及：`docs/ARCHITECTURE.md` · `docs/CONVERSATION_ARCHITECTURE.md` · ADR
  - 验收：新增行为不再产生第四套 abstraction

- [x] **P1-6 文档与 README 同步**
  - 现状：README 仍描述为“五页独立”，未体现 Chat 作为统一入口
  - 目标：同步 `docs/ARCHITECTURE.md`、`docs/CONVERSATION_ARCHITECTURE.md`、`README.md` 与 ADR（新增 ADR-062 或修订 ADR-061）
  - 验收：文档模型与代码一致，以代码为准

---

## 验证清单

- [x] `npm run typecheck` 通过
- [x] `npm run test` 通过（525 passed）
- [x] `npm run build` 通过
- [x] `npm run validate:questions` 通过
- [x] 手测：`给我出一道题` → 回答 → `下一题`（基于评分选下一题）→ `结束`（单一 session 落库）
- [x] 手测：`开始模拟面试` → Agent 首题 → 提交 → Agent 下一题（非 rank 重排）→ `结束面试` 收尾
- [x] 刷新恢复：`messages + context` 同时恢复，history 不丢
