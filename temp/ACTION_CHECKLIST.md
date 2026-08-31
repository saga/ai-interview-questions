# Unified Conversation Architecture · Action Checklist

关联设计：`docs/CONVERSATION_ARCHITECTURE.md`  
关联 ADR：`docs/DECISIONS.md` → ADR-061

状态：Phase 1–4 已执行；统一 LearningSession 迁移暂不实施

## 0. 实施规则

- [x] 先确认设计文档，再修改业务代码。
- [ ] 每个阶段单独提交，避免一次性大重构。（本次未执行 commit。）
- [x] 每个阶段同步更新 `docs/ARCHITECTURE.md`、`docs/CHANGELOG.md`、必要时新增 ADR。
- [x] 不在 Chat 层直接生成题目、评分或写 Learner Memory。
- [x] LLM 只输出经过 schema 校验的 intent；副作用由 application capability 执行。
- [x] 不把完整题库、答案、解析和原始 Chat 历史无条件注入模型上下文。

## Phase 1 · 抽取 Application Capabilities（P0）

目标：不改变用户行为，先消除业务逻辑只存在于 Agent tools / Hook 内的问题。

### 代码

- [x] 盘点 `src/agent/tools.ts`、`src/hooks/useTrainingSession.ts`、`src/application/interviewEngine.ts` 的重复职责。
- [x] 新增 `src/application/conversation/` 目录。
- [x] 定义 `questionCapability`：按 topic/difficulty/format/Learner signal 选题并生成 `SessionQuestion`。
- [x] 定义 `evaluationCapability`：统一选择题判分、开放题评分入口和 null/error 语义。
- [x] 定义 `interviewCapability`：创建、推进、结束 session；暂时适配现有 Agent session。
- [x] 定义 `learnerCapability`：读取弱项、更新画像、幂等提交 session record。
- [x] 将 `src/agent/tools.ts` 改为 capability adapter，不重复实现 ranking/evaluation 业务规则。
- [x] 保持 Copilot 原有通用问答行为不变，并接入共享 capability 的题目模式。

### 测试

- [x] 每个已实现 capability 添加纯逻辑单测（`src/application/conversation/conversation.test.ts`）。
- [x] 覆盖空题库/排除题、无 provider、评分 provider 失败、重复题路由和注入字符串边界；重复提交由 session adapter 的幂等回调约束。
- [x] 运行 `npm run typecheck`。
- [x] 运行目标回归测试；全量测试在完成前检查执行。
- [x] 运行题库校验；全量校验在完成前检查执行。

验收：Agent 面试现有行为不回归；出题/评分/Learner 更新已有共享 application 入口。

## Phase 2 · Conversation Context 与 Question Mode（P0）

目标：Chat 可以“出题 → 接收答案 → 评分”，但暂不统一所有 session schema。

### 代码

- [x] 定义并校验 `ConversationContext`：`mode`、`sessionId`、`currentQuestionId`、`pendingAction`。
- [x] 增加 Copilot context adapter，不直接操作 Agent runtime 内部 session；context 以 schema 校验后 best-effort 写入 localStorage。
- [x] 实现 `ask_question`：只调用 `QuestionCapability`，UI 展示题库快照。
- [x] 实现 `answer_current_question`：按 `pendingAction` 将消息交给 `EvaluationCapability`。
- [x] 实现 `continue_interview`：调用共享 `QuestionCapability`；`start_interview` 使用 interview mode 的最小 adapter。
- [x] 处理刷新、关闭、结束、重复提交和 session 失效：context 可恢复，失效题目会提示重新出题。
- [x] Chat session 增加 localStorage 最小 context 恢复；完整 transcript 不恢复，已在设计文档明确。

### 测试

- [x] 当前题存在时，答案消息优先路由为 `answer_current_question`，不进入 general chat。
- [x] 无当前题时，普通/回答类消息不会直接写入 Learner Memory。
- [x] 重复提交由 `loadingRef` 和 session context 状态阻断重复评分/落库。
- [x] 题目展示内容来自题库快照，不来自 LLM 自由生成。
- [x] 答案中的注入字符串作为数据处理，不改变 router 的权限；有回归测试。

验收：Chat 已支持“给我出一道题” → question mode → 回答 → 共享评分 → “下一题”闭环。

## Phase 3 · Lightweight Intent Router（P1）

目标：支持自然语言进入 Question / Interview / Knowledge / General Chat。

- [x] 定义 `UserIntent` schema 和版本字段（`src/schemas/conversation.ts`）。
- [x] 实现高置信确定性规则：`给我出题`、`继续`、`下一题`、`开始面试`、`结束`。
- [x] 接入结构化 LLM intent classification；分类器不执行副作用。
- [x] 处理 topic、difficulty、format 的 schema 校验与常用 topic alias。
- [x] 低置信或冲突意图要求澄清，不猜测执行动作。
- [x] 添加 router telemetry：intent、confidence、source、fallback reason；开发环境输出 debug telemetry。
- [x] 运行 typecheck；全量测试和构建在完成前检查。

验收：核心 intent 有可追踪路由结果；未知输入回退 general chat；intent 错误不会越权修改 session 或 Learner。

## Phase 4 · Session 收敛评估（P1）

目标：在 adapter 稳定后，再决定是否统一为 `LearningSession`。

- [x] 对比训练、模拟面试、Agent 面试、Chat session 字段和生命周期，结论写入 `docs/CONVERSATION_ARCHITECTURE.md`。
- [x] 明确题目快照、答案、评分、Learner 写入和恢复语义。
- [x] 设计 adapter-first、版本、幂等、回放和失败恢复约束。
- [x] 评估保留现有 session 作为底层实现；当前不直接统一 schema。
- [x] 统一 LearningSession 迁移暂不适用：现有生命周期差异较大，后续若启动迁移再单独写 ADR 和数据迁移测试。

验收：当前 adapter 不改变历史 session 语义；Chat context 可恢复最小状态；统一 session 迁移明确延后。

## 完成前检查

- [x] `npm run typecheck`
- [x] `npm test`（41 files / 525 tests）
- [x] `npm run build`
- [x] `npm run validate:questions`（1297 题 / 106 知识节点）
- [x] 关键 capability / router / Agent adapter 测试通过
- [x] 更新 `docs/ARCHITECTURE.md`
- [x] 更新 `docs/CHANGELOG.md`
- [x] 新增 ADR-061
- [x] 检查 `git diff`：未发现密钥；本次改动集中在 Conversation capabilities、Copilot、文档与测试。工作区另有此前未处理的 `docs/prompt*.md`、`docs/improvement_plan/plan0831_3.md` 和题库文件，未覆盖。
