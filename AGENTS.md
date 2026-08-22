# AGENTS.md

本文件供在本仓库工作的 AI Agent（WorkBuddy 等）阅读，明确协作与代码约定。**只放原则性约定**，具体命令见 `README.md`，架构与踩坑见 `docs/`。

## 大原则

### 1. 不要搞向后兼容，没用的代码直接删掉

- 修改接口、类型、函数签名时，**直接改成目标形态**，不要保留旧参数/旧分支/`deprecated` 兼容层。
- 重构后确认无人引用的导出、类型、文件，**立即删除**，不要标记 TODO 留着。
- 删除比加 `if (legacy) ...` 更干净。宁可让调用方一次性跟着改，也不要让代码背上历史包袱。
- 例外：对外已发布的 JSON 题库结构与 `localStorage` 配置 key 属于用户数据契约，改动需显式说明，不属于"可随手删的内部死代码"。

### 2. 添加关键测试，确保逻辑正确

- 纯逻辑（抽题、判分、题型判定、评分聚合、变体变换的 JSON 解析等）**必须有测试覆盖**，不要只靠 `npm run build` 过关。
- 测试框架用 **Vitest**（与 Vite 同生态，零额外配置成本）。新增逻辑时在同目录放 `*.test.ts`。
- 测试要断言"正确"而不仅是"不崩"：边界值、空输入、乱序答案、LLM 返回残缺 JSON 的兜底都要覆盖。
- 涉及 LLM 的用例一律 mock，**不要**在单测里真发网络请求：`pi-ai` 一次性调用可注入假 config；`pi-agent-core` 的 Agent 则注入 mock `streamFn`（按 `start → text_delta → done` 事件协议产出，见 `src/ai/interviewAgent.test.ts`）。
- 提交前跑 `npm run test`（若未配置则先 `npm i -D vitest` 并建立脚本）。

