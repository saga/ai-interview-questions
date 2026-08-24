# Agent 面试页面 — 实施计划（AGENT_INTERVIEW_PLAN）

> 目标：新增一个「Agent 面试」页面，用 `@earendil-works/pi-agent-core` 跑**自主决策循环**
> （observe → evaluate → decide → ask / follow-up → persist），复用现有 domain / learner / evaluation
> 作为 Agent 工具。**现有 4 个页面与确定性 InterviewEngine 全部保留**，Agent 是并行的另一种运行时。

---

## 0. 背景与现状（已核实）

- 当前 UI 导航 4 项：`train`（训练）/ `progress`（进度）/ `interview`（面试）/ `settings`（设置）。
- 现有面试运行时：`src/application/interviewEngine.ts`（`buildSession` / `evaluateAnswer` / `nextAdaptiveStep`）+ `src/domain/adaptive.ts` 的规则式 `decideStrategy`（deep-dive / gap-probe / broaden / move-on）。
- `@earendil-works/pi-agent-core@0.84.2` **已安装并声明在 package.json**，但 `src/` 尚未引用（之前架构评审误报为死依赖）。
- LLM 接线原语已就绪：`src/ai/pi.ts` 的 `buildModels(entry)` 返回 `ModelsClient`，含 `.streamSimple(...)`；`getModel(models, id, modelId)` 取 `Model`。`Agent` 的 `streamFn` 签名正好由 `models.streamSimple` 满足。
- `LLMProvider` 边界（`types.ts`）：LLM 不感知 `LearnerProfile` / `InterviewSession`。**Agent 层是编排层，可以读 profile 作为上下文，但不得让 `LLMProvider` 直接收 profile**——本计划保持该边界。

---

## 1. 架构边界（防止 over-design，对齐 AGENTS.md）

```
UI (React / antd)
   │  新增「Agent 面试」页
   ▼
src/agent/  ← 新增层：Agent 运行时（决策中心）
   │  observe → decide → tool → observe
   │  shouldStopAfterTurn / beforeToolCall 守卫
   ├── 工具（AgentTool）→ 包装现有 domain / learner / evaluation
   ▼
domain（纯逻辑：quiz / evaluation / learner / adaptive / conceptGraph）
ai（LLM 适配：pi-ai streamFn、LLMProvider 评分）
storage（localStorage：settings / learner）
```

原则：
- **Agent 做"不确定的决策"（下一题问什么 / 是否追问 / 何时结束）；domain / ai 做"确定性执行"。**
- Agent **不直接**操作题库、评分、持久化——全部通过工具调用。
- **评分仍由现有 evaluator 完成**（`gradeChoice` 确定性 / `LLMProvider.evaluateOpenAnswer` LLM），Agent 只读取 `EvaluationResult`，不自己打分。
- **持久化复用现有管线**：结束时 `updateLearner(profile, sessionRecord)` + `sessionFromQuiz`，与现有流程写入同一个 Learner Memory → 进度页 / 推荐文案无需改动即可消费 Agent 结果。
- 工具参数 schema 用 **TypeBox**（pi-agent-core 要求），与项目既有 Zod（自分校验收）不冲突，仅工具定义用 TypeBox。

---

## 2. 目录与文件改动

### 新增 `src/agent/`（Agent 运行时层）
- `types.ts`
  - `InterviewAgentSession`：本次 Agent 面试的运行时会话（App 拥有，Agent 通过工具读写）
    - `id`, `status: 'running' | 'finished'`, `startedAt`
    - `currentQuestion: SessionQuestion | null`
    - `answers: Record<string, AnswerValue>`
    - `evaluations: Record<string, EvaluationResult | null>`
    - `log: AgentLogEntry[]`（决策/工具调用的可读记录，供 UI 展示推理过程）
  - 转发的事件类型（`onEvent` 回调参数）。
- `runtime.ts`（或并入 `src/ai/pi.ts`）
  - `buildAgentRuntime(entry: ProviderEntry): { streamFn: StreamFn; model: Model<any> }`
    封装 `buildModels(entry).streamSimple.bind(models)` + `getModel(...)`。浏览器可用，无 Node 依赖。
- `tools.ts`（最小垂直切片先 5 个，其余 Phase 2 补）
  - **Question**：`searchQuestions` / `getQuestion` / `findRelatedQuestions` / `createQuestionVariant`
  - **Candidate**：`getUserProfile` / `getWeaknesses` / `getMastery` / `getInterviewHistory`
  - **Knowledge**：`getKnowledgeNode` / `getPrerequisites` / `searchKnowledge`
  - **Evaluation**：`evaluateAnswer`（委托 `interviewEngine.evaluateAnswer`，返回 `EvaluationResult`）
  - **Control**：`finishInterview`（置 `session.status = 'finished'`，返回本轮摘要）
  - 每个 `AgentTool` 用 TypeBox `parameters`；`execute` 内部**薄包装**现有函数，不新增业务逻辑。
- `prompt.ts`
  - 系统提示词：角色 = 面试官决策中心；列出工具语义；明确"下一题问什么 / 是否追问 / 何时结束"；强调**不自己打分、通过 `evaluateAnswer` 工具获取评分**；到达题数上限或候选明显不会时调用 `finishInterview`。
- `interviewAgent.ts`
  - `createInterviewAgent(session, profile, entry, handlers)` → 返回 `{ submitAnswer(text), abort(), agent }`
  - 构建 `new Agent({ streamFn, model, systemPrompt, tools, shouldStopAfterTurn, beforeToolCall })`
    - `shouldStopAfterTurn`：当本轮 `finishInterview` 被调用，或题数达上限（如 10）→ 返回 `true` 优雅停止。
    - `beforeToolCall` 守卫：未启用 AI / 无有效 key 时拦截 `evaluateAnswer` 等需 LLM 的工具，返回 `block` + 原因（避免运行时崩）。
  - `subscribe` 把 `turn_end` / `tool_execution_*` / `message_update` 事件转发给 `handlers`（UI 渲染用）。
  - `submitAnswer(text)`：`session.answers[id] = text` → `agent.continue()` 推进下一轮。

### 新增 UI
- `src/components/agent/AgentInterviewPage.tsx`（第 5 个导航项）
  - 开场：加载 `profile` → 建 `InterviewAgentSession` → `createInterviewAgent` → `agent.prompt(开场指令)` 启动。
  - 渲染：agent 消息流（决策/推理）+ 工具调用卡（选中了哪题、评分结果）+ **当前题卡片**（`session.currentQuestion`，复用现有 QuestionCard）+ 作答输入。
  - 提交 → `submitAnswer`；`finishInterview` 触发 → `updateLearner(profile, sessionFromQuiz(...))` 持久化 → 展示本轮总结。

### 改动现有文件（最小化）
- `src/App.tsx`：新增 `{ key: 'agent', icon: <RobotOutlined />, label: 'Agent 面试' }`；现有 4 项**不动**。
- `docs/DECISIONS.md`：追加 ADR-016（Agent 层边界与职责）。
- `README.md`：注明新增「Agent 面试」页。
- 撤销 `REVIEW_2026-08-24.md` 中"pi-agent-core 为死依赖"一条（现已启用）。

### 测试（对齐 AGENTS.md「加关键测试」）
- `src/agent/interviewAgent.test.ts`：**注入 mock `streamFn`**（脚本化 assistant / toolCall）驱动
  "选 → 评 → 追问 → 结束" 一轮，断言：工具被调用、`finishInterview` 后 `shouldStopAfterTurn` 停止、`session.status==='finished'`。
- `src/agent/tools.test.ts`：mock domain 函数，断言工具**委托正确**、`evaluateAnswer` 返回 `EvaluationResult`、**选择题 gap 不写进 learner**（复用上一轮修复的契约）。
- 冒烟：`buildAgentRuntime` 返回可调用 `streamFn`（用 fake streamFn 跑通 `prompt → tool → continue → end`）。

---

## 3. Action List（分阶段，最小垂直切片优先）

### Phase 0 — 接线验证（约 0.5h）
- [ ] 0.1 `src/ai/pi.ts`（或 `src/agent/runtime.ts`）新增 `buildAgentRuntime(entry)` → `{ streamFn, model }`。
- [ ] 0.2 冒烟测试：fake `streamFn` 驱动 `Agent.prompt → tool → continue → end`，确认事件流 `agent_start/turn_end/agent_end` 可达。

### Phase 1 — 工具层（核心，可独立测试）
- [ ] 1.1 `src/agent/types.ts`：`InterviewAgentSession` + 事件类型。
- [ ] 1.2 `src/agent/tools.ts`：先实现最小 5 工具 `searchQuestions` / `getQuestion` / `evaluateAnswer` / `getUserWeaknesses` / `finishInterview`（其余 Knowledge / Candidate 工具 Phase 2 补）。
- [ ] 1.3 `tools.test.ts`：断言委托正确、`evaluateAnswer` 返回 `EvaluationResult`、选择题 gap 不污染。

### Phase 2 — Agent 运行时与提示词
- [ ] 2.1 `src/agent/prompt.ts`：系统提示词（角色 / 工具语义 / 停止条件）。
- [ ] 2.2 `src/agent/interviewAgent.ts`：构建 Agent、`shouldStopAfterTurn`（finishInterview 或题数上限）、`beforeToolCall` 守卫、`subscribe → handlers`、`submitAnswer` / `abort`。
- [ ] 2.3 `interviewAgent.test.ts`：mock streamFn 驱动完整脚本 loop，断言 session 状态与停止。
- [ ] 2.4 （可选）补齐 Knowledge / Candidate 其余工具，丰富 agent 决策输入。

### Phase 3 — UI 页面
- [ ] 3.1 `AgentInterviewPage.tsx`：loop UI + 当前题卡片（复用 QuestionCard）+ 作答输入 + 结束 `updateLearner` 持久化。
- [ ] 3.2 `src/App.tsx` 增加 `agent` 导航项；现有 4 项不动。
- [ ] 3.3 dev server 手动冒烟：完整跑一轮 loop（需真实 API Key；无 key 时 `beforeToolCall` 应优雅拦截而非崩）。

### Phase 4 — 收尾与文档
- [ ] 4.1 `npm run test` + `npm run build` 全绿。
- [ ] 4.2 `docs/DECISIONS.md` ADR-016；`README.md` 注明新页；撤销 review 中 pi-agent-core 死依赖一条。
- [ ] 4.3 （可选）UI 展示 agent 推理/决策过程（来自 `session.log`）。

---

## 4. 风险与注意

- **Tool 参数用 TypeBox**（pi-ai 要求），项目既有 Zod 不改；仅 `AgentTool.parameters` 用 TypeBox。
- **streamFn 必须来自 pi-ai `streamSimple`**；provider 降级链（`FallbackProvider`）当前在 `LLMProvider` 层——Agent 层先**单 provider** 起步，不接 `FallbackProvider`（避免过度设计）。
- **Agent 可读 `LearnerProfile` 作上下文**（编排层权限），但 `LLMProvider` 仍不直接收 profile（边界不变）。
- **不要一次性 Agent 化所有流程**：现有 `interview` 页（规则式 `decideStrategy`）保留；Agent 是并行的新运行时。规则式 `adaptive` 与 Agent 决策可长期共存，互为对照。
- **题型一致**：选择题走确定性 `gradeChoice`（无 LLM），仅 open 走 `LLMProvider.evaluateOpenAnswer`——与现有 engine 完全一致；Agent 的 `evaluateAnswer` 工具即委托此逻辑。

---

## 5. 验收标准

- [ ] 新「Agent 面试」页可完整跑一轮：开场 → 选题/追问 → 用户作答 → 评估 → 决策下一题或结束 → 结果进入 Learner Memory（进度页/建议仍可用）。
- [ ] 现有 4 页与确定性 engine 行为**不变**。
- [ ] 测试覆盖：mock streamFn 驱动 loop 停止、工具委托、选择题 gap 不污染 Learner Memory。
- [ ] `npm run test` / `npm run build` 全绿。
