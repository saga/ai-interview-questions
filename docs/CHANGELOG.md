# 设计变更记录

> 记录每次影响设计/架构的变更。新条目追加在顶部，标注日期与变更点。

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
