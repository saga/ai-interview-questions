# 设计变更记录

> 记录每次影响设计/架构的变更。新条目追加在顶部，标注日期与变更点。

## 2026-08-23 · 题库扩充 + 代码展示/编辑组件（Shiki / Monaco）

- **题库 40 → 54 题**（基于 2026 面试趋势调研），全部复用现有 schema、不新增题型：
  - LLM：KV cache、MoE 总参/激活参数、解码带宽瓶颈优化（多选）、LoRA、RAG vs 微调 vs 提示工程选型（essay+rubric）、生产级 RAG 管线（多选）、手写 scaled dot-product attention（coding）。
  - Deep Learning：GQA 取代 MHA 的原因。NLP：BPE 分词与 "strawberry 数 r" 根因。
  - Agentic AI：MCP 协议、Agent 护栏（多选）、ReAct vs Plan-and-Execute（essay+rubric）、长任务上下文压缩。
- **代码组件边界确立**：只读高亮 = Shiki，可编辑/对比 = Monaco，不混用：
  - 新增 `components/common/CodeBlock`（Shiki 单例 highlighter + CSS 行号）、`RichText`（段落 + 围栏代码混合渲染）、`lib/codeFence.ts`（纯逻辑切分 + 8 例单测，容错未闭合围栏）。
  - 接入：题干/解析走 `RichText`；编程题参考答案与用户提交代码走 `CodeBlock`。
- **集成 Monaco Editor**：
  - 新增 `components/common/CodeEditor`（本地打包 monaco，不依赖 CDN；editor/json/ts worker 走 Vite `?worker`）。
  - 编程题作答由 TextArea 替换为懒加载 `CodeEditor`；结果页新增「用户代码 vs 参考答案」DiffEditor 对比（展开才挂载）。
- 测试共 **54 例全过**；typecheck/build 通过。

## 2026-08-23 · 产品转向 Training Coach（Learner Memory + 四页结构）

- 按用户评审，从"Quiz Configurator"转为"Training Coach"（ADR-015）：
  - **首屏 = 训练入口**：继续训练（按薄弱项）/ 快速训练（自动选题，10 分钟）/ 自定义训练（折叠的高级配置）。
  - **隐藏系统内部概念**：删除评分权重 UI；API Key 移入「设置」页，首页只显示 "AI ✓ / AI 未配置" 状态 chip，不再弹黄色大 Alert。
  - **Learner Memory**：新增 `domain/learner.ts`（纯逻辑）+ `storage/learner.ts`（localStorage v1 key）。结构化学习信号（topicStats 的 avgScore/mastery/trend/commonWeaknesses + 最近 50 条 SessionRecord），**不存对话原文**。
  - **Coach 抽题**：`InterviewDefinition.topicPriorities` + `domain/quiz.pickPrioritized`，薄弱主题（mastery<0.85 且均分<85）优先进入训练。
  - **结果页升级**：比上次得分 delta、亮点/待加强聚合、AI 训练建议（`recommendationText`）、按薄弱项继续训练。
  - **进度页**：总体分 + 主题掌握度条 + 最近趋势折线（内联 SVG）+ 需要关注 + 最近训练列表。
  - **面试页**：30 分钟限时模拟面试入口（追问式 loop 待 pi-agent-core 后续接入）。
- 组件：新增 `home/TrainingHome`、`progress/ProgressPage`、`interview/InterviewPage`、`settings/SettingsPanel`；删除 `SetupPanel`、`SettingsModal`（不向后兼容）。
- 测试：新增 `domain/learner.test.ts`（13 例），共 **46 例全过**；构建通过。

## 2026-08-23 · 接入 pi-agent-core（Interview Agent 层）+ Vitest 测试

- 采纳评审结论：pi-agent-core **只做 LLM Agent 层**，Quiz Domain 完全自写（ADR-012）：
  - 新增 `ai/interviewAgent.ts`：唯一依赖 `@earendil-works/pi-agent-core` 的地方，用 `Agent` + `subscribe(message_update→text_delta)` 做开放/编程题流式评分，`parseEvaluation` 结构化输出；`(model, streamFn)` 依赖注入便于测试。
  - 变体留在 `ai/variantGenerator.ts`（pi-ai one-shot，不走 Agent）；`ai/client.ts` 更名 `ai/models.ts`，`ai/piProvider.ts` 拆为 `variantGenerator.ts` + `provider.ts` 里的 `PiAIProvider` 委托实现。
  - 浏览器 local-first：pi-ai `streamSimple` 作 Agent `streamFn`，无后端代理。
  - 验证：pi-agent-core 不静态 import `pi-ai/compat`；`node:fs/crypto/...` externalize 成警告（只用 Agent 不触 harness 则不崩）；主 chunk 1.26 MB / 369 kB gzip。
- 评分升级（ADR-013）：四维更名为 正确性/完整性/架构/表达；`Question.rubric` 支持 `required` 要点 + 该题 `dimensions` 权重覆盖；题库 5 道开放/编程题补 rubric 样例。
- 测试基建（ADR-014）：引入 **Vitest**（`npm run test`），33 个用例覆盖 domain 抽题/判分/评分聚合/变体校验 + ai 提示词/解析纯函数 + **真实 Agent + mock streamFn** 集成；`*.test.ts` 从生产 tsc 排除。
- 删除：`src/ai/client.ts`、`src/ai/piProvider.ts`（被 models/variantGenerator 取代，不向后兼容）。

## 2026-08-23 · 架构边界重构（domain / ai / storage）

- 采纳评审建议，重构 LLM 变体 / 评分 / 题库模型的边界：
  - 目录拆分：`domain/`（纯逻辑）、`ai/`（LLMProvider 适配层，唯一依赖 pi-ai）、`storage/`、`lib/interviewEngine.ts` 编排；组件按 `quiz/result/settings` 分组。
  - 题库模型升级：每题加 `topic`/`tags`/`reference.concept`，`category` 改 slug；新增 `agentic-ai` 类目 10 题（现共 38 题）。
  - 变体安全：`validateVariant` 校验 + 失败回退原题，开放题 `referenceAnswer` 永不被 LLM 改写（ADR-006）。
  - LLM 藏在 `LLMProvider` 接口后，PiAIProvider 为唯一实现（ADR-007）。
  - 评分升级为四维 Rubric（正确性/完整性/深度/表达）（ADR-008）。
  - 删除旧 `lib/quiz.ts`、`lib/piClient.ts`、`lib/storage.ts` 及旧组件文件（不向后兼容）。

## 2026-08-23 · 文档分层重构

- 将 AGENTS.md 中的"常用命令""技术栈注意点"移除。
- 常用命令并入 `README.md` 的"常用命令"段。
- 技术栈注意点并入 `docs/ARCHITECTURE.md`。
- 新建 `docs/`：`ARCHITECTURE.md`（架构设计）、`DECISIONS.md`（ADR）、本文件（变更记录）。
- 动因：AGENTS.md 应保持"只放原则"，与 README / docs 去重（ADR-005）。

## 2026-08-23 · 引入 AGENTS.md（两大原则）

- 新增 `AGENTS.md`，固化两条大原则：不向后兼容（删死代码优先）、关键逻辑必须加测试（Vitest）。

## 2026-08-23 · Interview Engine 化改造

- 新增 `src/lib/interviewEngine.ts`：声明式 `InterviewDefinition` → `buildSession` → `evaluateAnswer` / `evaluateSession`。
- 类型系统升级：`EvaluationResult`（三维评分）、`coding` 编程题、`tags`、`evaluationCriteria` 等。
- `piClient.gradeEssay` 升级为 `evaluateOpenAnswer`，返回三维评分。
- 新增倒计时（`timeLimitSec`，到点自动交卷）。
- 题库 `questions.json` 增加 2 道 coding 题（softmax / 线性回归 BGD）。

## 2026-08-23 · 初始脚手架

- Vite + React 18 + TS + Ant Design 应用。
- 集成 `@earendil-works/pi-ai`（0.84.2）做题目变体与问答题评分。
- 题库 28 题 / 8 类别 / 单选择·多选·问答三类。
- 修正：antd 6 的 `Divider` 移除 `orientation`；pi-ai 浏览器密钥改用 `createModels({ credentials })`。
