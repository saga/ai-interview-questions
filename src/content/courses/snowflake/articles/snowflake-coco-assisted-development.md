# Snowflake CoCo 的 AI 辅助探索、编码与优化

## 本节要解决的问题

使用 Snowflake CoCo 加速 SQL、Notebook、数据管道和 Snowflake 应用开发，同时保留代码审查、权限控制、运行验证和成本责任。CoCo 不只有一个聊天侧栏：当前提供 Snowsight、Desktop 和 CLI 三种工作入口，适用范围、文件访问和审批方式有所不同。

## 核心知识

### 三种入口共享核心能力，但工作边界不同

- **CoCo in Snowsight**：嵌入 Workspaces、SQL Worksheets 和管理页面，能读取当前页面上下文，生成或解释 SQL/Python，分析账户用量和查询表现。代码建议可通过 Diff View 审查后接受。
- **CoCo Desktop**：面向 macOS/Windows 的本地 IDE，具备 Agent 与 Editor 工作模式、读取和写入本地项目、Skills、Hooks、Subagents、MCP 和浏览器/Notebook 交互能力。
- **CoCo CLI**：面向终端工作流、脚本和自动化，适合本地仓库、开发工具及 CI 场景。Skills、Hooks 等配置在 Desktop 与 CLI 之间共享；Snowsight 的 Skill 管理与本地文件 Skill 并非完全相同。

三种入口都依赖 Snowflake 身份和角色治理，但本地代码访问、云端执行、外部工具权限和运行环境并不相同。不能因为 CoCo 理解当前 Snowflake Schema，就认定它能任意读取用户本机、GitHub 或外部数据库。

### CoCo mode 与普通侧栏面向不同任务长度

Snowsight CoCo Side Panel 适合围绕当前 SQL、Notebook 或页面做局部问题；CoCo mode 是更完整的任务视图，当前标注为 Preview，可在隔离会话中 checkout GitHub 仓库、并行运行多个会话、构建/测试应用、执行 SQL、生成报告并提交/推送/创建 PR。

CoCo mode 支持 Plan mode，可先生成计划再开始修改；工具调用审批分为 Manual、Auto Preview 和 Bypass。Manual 是默认方式；Auto mode 从 2026-11-17 起处于 Preview，可自动执行常规低风险动作，仅对被判定为风险或偏离请求的动作再次询问；Bypass 则跳过全部工具批准，不应作为一般默认值。

### CoCo 生成的代码和执行结果必须分开审查

CoCo 可以解释、生成和优化 SQL/Python，也能通过 Skills 处理 Schema、dbt、Notebook 或 Snowflake 工作流。它给出的 SQL 仍可能存在错误过滤、Join 粒度、权限扩大、昂贵扫描和副作用。生成代码、静态检查、在测试环境执行、业务结果对账、生产部署应是不同阶段。

Snowflake 对 CoCo 的身份和权限仍使用活动 Role/RBAC；CoCo 不应获得超出当前任务范围的广泛管理员身份。外部 MCP、Hooks、Subagents 和自动化会扩大执行面，应独立管理服务器、Secrets、文件路径和工具调用日志。

### 可观测性帮助解释 Agent 行为和费用

CoCo 的一次交互对应一条 Trace，内部有模型调用、工具、代码步骤等 Span。Snowflake AI Observability 可通过 Event Table 观察 Prompt 历史、Agent 执行路径和信用消耗归因；三种界面的记录进入统一事件表，并记录 INTERFACE 区分来源。查看内容受到 Role 与遥测权限约束，不应把未脱敏 Prompt 或工具输入输出开放给所有开发者。

## 工程实施步骤

1. **根据任务范围选择入口。** 当前 Worksheet 小修使用 Snowsight Side Panel；长任务和本地仓库开发使用 CoCo Desktop/CLI 或 CoCo mode；CI 中需要可重复执行时优先使用受控 CLI。
2. **确认执行身份。** 记录 Snowflake User、当前 Role、Warehouse、Database 和 Schema；本地文件、GitHub 与 MCP 访问分别配置最小权限。
3. **先让 Agent 分析上下文。** 提供目标对象、业务含义、错误信息和结果要求；对于生产数据修改或跨多个文件的任务先采用 Plan mode。
4. **明确审批模式。** 默认使用 Manual；只有在有测试、隔离工作区和可回滚动作时再评估 Auto Preview；Bypass 仅适用于受控、可重建的环境。
5. **审查 Diff 而非整段聊天。** 检查修改文件、对象名、权限变化、过滤条件、Join 基数、数据写入和依赖，确认 Diff 与原始请求一致。
6. **验证 SQL/Python。** 先检查语法、对象结构和权限；再在测试数据、只读 Role 或隔离环境执行；对结果行数、金额、业务状态和查询计划进行对账。
7. **检查外部扩展。** 对 MCP Server、Hooks、Skills 和 Subagents 建立白名单，单独管理凭证和允许的操作；不要让本地技能获得生产凭证副本。
8. **执行版本控制。** 通过 Git diff、测试、commit 和 PR 保存变更来源；对生成文件保留人类可读的变更记录和验证报告。
9. **观察 Agent 运行。** 使用 AI Observability 检查 Trace、工具调用、Token/credits 和接口来源；将实际执行错误转为回归任务。
10. **上线与恢复分离。** CoCo 提交代码不等于生产发布；数据库变更仍按 CI/CD Plan、Deploy、Verify 过程执行，保留补偿或恢复方案。

## 场景分析

开发人员要求 CoCo 优化一个慢查询，并顺手修改对应 dbt 模型。CoCo 可以先读仓库和当前 Snowflake Schema，解释 Query Profile，再提出 SQL 与模型修改。

合理工作流是先让 CoCo 分析查询耗时和 Join 基数，形成计划；然后生成 SQL Diff 和 dbt Diff；开发人员检查过滤条件、模型依赖和输出粒度，在开发 Warehouse 和测试数据运行，并与原结果对账。通过后再提交 PR，由 CI 运行项目测试与变更计划。不能让 Agent 直接在生产表上试跑多个版本，也不能因为查询更快就跳过结果等价验证。

如果需要 CoCo 使用外部 MCP 访问 Jira 或 GitHub，应为该 Server 配置专门 token 和允许的操作范围，并在 Trace 中检查实际调用。AI 自动化可以减少机械确认，但高风险写操作和生产发布仍要遵循项目的明确授权流程。

## 常见误区

- **把 CoCo 只当成聊天机器人。** 它有 Snowsight、Desktop、CLI 和不同任务模式，工具范围不同。
- **把 CoCo mode Preview 当成所有 Snowsight Side Panel 都可用的 GA 功能。** 应按文档区分两种入口与各自状态。
- **打开 Auto 或 Bypass 就代表安全自动化。** Auto 仍依赖风险分类；Bypass 会跳过审批，应严格限制。
- **把生成 SQL 直接运行在生产环境。** 需要先审查 Diff、权限、结果语义和性能证据。
- **认为 CoCo 理解当前 Role 就能代替 RBAC。** 它仍受角色和对象权限约束，外部文件和 MCP 还有独立授权。
- **只看最终代码，不检查 Agent 执行轨迹。** Observability 可以帮助定位错误工具调用、成本和失败步骤。
- **把 CoCo 的 Git commit 当成数据库发布成功。** 代码进入仓库与数据库部署、回填、验证是不同阶段。

## 完成标准

- [ ] 能区分 CoCo Snowsight、Desktop、CLI 和 CoCo mode 的用途。
- [ ] 能说明 Plan、Manual、Auto Preview 和 Bypass 的审批差异。
- [ ] 能将 AI 代码建议、Diff 审查、测试、PR 与数据库发布分成独立步骤。
- [ ] 能识别本地文件、Snowflake Role 和 MCP 的不同授权边界。
- [ ] 能通过 AI Observability 追踪 CoCo 运行步骤和成本。

## 自测

1. 当前只需修复打开的 SQL Worksheet，优先使用哪个 CoCo 入口？如果要修改本地 dbt 仓库，又该选择哪个？
2. CoCo mode 运行在 Snowflake 隔离会话中，是否意味着它能自动访问本地磁盘上的任意文件？
3. Auto mode 与 Bypass 的风险差异是什么？为什么 Bypass 不适合作为一般默认配置？
4. CoCo 生成的 SQL p95 提升了 50%，为什么仍需验证结果语义和数据质量？
5. MCP Server 能访问 GitHub，但 CoCo 当前 Role 无权查询 Snowflake 某张表，是否应该通过 MCP 绕过该授权？
6. 如何通过 Trace 和 Event Table 区分模型调用耗时与外部工具耗时？

## 参考资料

- [Overview of Snowflake CoCo](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code)
- [CoCo mode in Snowsight](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-snowsight/coco-mode)
- [CoCo CLI extensibility](https://docs.snowflake.com/en/user-guide/cortex-code/extensibility)
- [CoCo CLI bundled skills](https://docs.snowflake.com/en/user-guide/cortex-code/bundled-skills)
- [CoCo Desktop MCP support](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-desktop/mcp-support)
- [CoCo Observability](https://docs.snowflake.com/en/user-guide/cortex-code/observability)
- [Auto mode Preview release notes, November 17 2026](https://docs.snowflake.com/en/release-notes/2026/other/2026-11-17-coco-auto-mode-preview)
