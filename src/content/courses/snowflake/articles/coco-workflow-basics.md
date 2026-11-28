# CoCo 辅助开发的基本工作流

## 本节要解决的问题

将 CoCo 从临时问答工具用成可审查的开发工作流：理解任务、读取仓库/页面上下文、提出计划、生成修改、执行测试、审查 Diff、提交版本和验证部署。不同 CoCo 入口的执行环境和文件权限不同，不能把本地 CLI、Desktop 和 Snowsight Cloud Sandbox 的安全属性混为一谈。

## 核心知识

### Side Panel 处理当前页面，CoCo mode 适合长任务

Snowsight Side Panel 可以读取当前 Worksheet、文件或页面的上下文，适合解释 SQL、修复报错和小范围编辑。CoCo mode 是独立视图，面向较长任务，可在隔离的 Cloud Sandbox 中 checkout GitHub 仓库、并行运行 Session、构建应用、执行 SQL 和保存报告。

CoCo Desktop/CLI 适合本地项目工作流，能够访问配置授权范围内的本地文件和工具；本地 Python、脚本和工具并不因此获得 Cloud Sandbox 的隔离。需要受限执行环境时，应明确选择 Snowsight Sandbox，而不是假定所有入口都安全隔离。

### Plan 与 Approval Mode 控制工作过程，不等于业务审批

Plan mode 先研究任务并提出计划，等待用户确认后再执行。Approval Mode 有 Manual、Auto (Preview) 和 Bypass：
- Manual 是默认设置，对工具操作逐项请求批准。
- Auto (Preview) 自动执行被判断为常规低风险的动作，其他动作仍询问；安全分类是概率性的，不是安全边界。
- Bypass 跳过全部工具批准，账户管理员可以禁止这种模式。

Auto 不会替代 Snowflake RBAC、管理员策略或数据保护规则。对于读取敏感数据、生产 DDL、写入业务数据和外部系统副作用，应使用适当的角色、工具权限和明确的审批流程。

### Git Diff、测试和部署必须分开

CoCo 可以生成代码、修改本地项目、执行 SQL、测试和创建 Git commit/PR。每个动作都应保留其输入、改动文件、执行结果和版本。代码进入 Git 不代表数据库部署成功；数据库对象部署、回填、权限和数据结果还需通过 CI/CD 验证。

生产发布应由明确环境、服务身份和 CI 门禁执行。CoCo 提交 PR 后，CI 负责静态检查、测试、变更计划和部署；部署后还要核对数据与业务结果。不要让 Agent 直接绕过发布流水线修改生产环境。

## 工程实施步骤

1. **按任务规模选入口。** 当前 Worksheet 小修改使用 Side Panel；长仓库任务使用 CoCo mode；本地 IDE 项目使用 Desktop/CLI。
2. **说明目标和约束。** 提供仓库、文件、目标对象、业务语义、禁止修改范围、测试命令和预期验收。
3. **先计划，再执行。** 多文件或跨层架构任务启用 Plan mode，审查涉及组件、文件、权限和回滚策略。
4. **选择审批模式。** 默认 Manual；只有在隔离环境、测试齐全且可重建时才评估 Auto Preview；避免使用 Bypass 处理敏感或生产任务。
5. **提供最小权限。** Snowflake 使用专用 Role；GitHub、MCP、外部 API 和本地文件权限分别管理，不给 Agent 过宽凭证。
6. **先生成 Diff。** 检查修改文件、SQL 对象、依赖、权限、数据副作用和配置变化，确认与任务目标一致。
7. **执行验证。** 运行 lint、单元测试、集成测试、SQL 对账和 Query Profile；结果证据与修改版本绑定保存。
8. **提交 Git 变更。** 保存 commit、PR、测试日志和部署说明；未完成验证的修改不能标记为交付完成。
9. **由 CI/CD 部署。** 在目标环境执行变更计划、部署和发布后验证；生产 DDL 与业务数据回填按各自恢复策略处理。
10. **复盘 Agent 行为。** 保存 Trace、工具调用、审批记录、错误与用户反馈，将问题转成下一轮回归样本。

## 场景分析

团队要求 CoCo 为一个 Snowflake 数据管道增加字段、调整 Dynamic Table 定义并更新 dbt 测试。任务涉及多个文件和生产依赖。

合适的工作流是先在 CoCo mode Plan mode 中读取仓库并整理依赖计划，再在隔离 Session 中修改 DDL、dbt 模型和测试。开发者检查 Diff，确认没有删除未评估列、改变指标粒度或扩大权限；随后运行本地测试和开发环境数据对账，提交 PR。CI 重新生成变更计划并部署到测试环境；只有业务验证完成后再走生产发布。

若同一任务由 CoCo CLI 在开发者本机执行，应明确其本地脚本不在 Snowsight Cloud Sandbox 中隔离。不能因为 Auto mode 可自动处理常规动作，就允许本机脚本直接使用生产密钥执行破坏性命令。

## 常见误区

- **所有任务都使用同一种 CoCo 入口。** 当前页面小修改和长仓库任务的环境能力不同。
- **把 Plan mode 当自动执行。** Plan mode 先提出方案，确认后再开展实际修改。
- **把 Auto Preview 当强制审批系统。** 其风险分类是概率性的，不能代替权限和安全策略。
- **把 CoCo Desktop/CLI 当 Cloud Sandbox。** 本地脚本和工具并非被隔离执行。
- **提交 PR 就算发布完成。** 数据库部署和数据验证还需要 CI/CD。
- **Bypass 适用于所有自动化。** Bypass 会跳过工具批准，应受管理员策略限制。
- **只保存最终代码，不保存 Trace 和测试证据。** 无法复盘工具执行、权限和失败原因。

## 完成标准

- [ ] 能区分 Side Panel、CoCo mode、Desktop 和 CLI 的使用边界。
- [ ] 能解释 Plan mode 与 Manual/Auto Preview/Bypass 的差异。
- [ ] 能为多文件任务建立计划、Diff 审查和测试过程。
- [ ] 能说明本地执行与 Cloud Sandbox 的安全边界。
- [ ] 能把 Git 提交、CI 部署和业务验收分开。
- [ ] 能保存工具执行、审批与发布证据。

## 自测

1. 只需解释当前 Worksheet SQL 报错，应优先使用哪个 CoCo 入口？跨多个文件重构仓库又应使用哪个？
2. CoCo mode 的 Cloud Sandbox 与 CoCo Desktop/CLI 的本地文件执行有何安全区别？
3. Auto Preview 认为某条操作安全就自动执行，是否可以替代 Snowflake Role 和管理员策略？
4. CoCo 已经提交 PR，是否表示生产数据库对象和数据已发布？
5. 哪些场景应保持 Manual Approval，而不是使用 Bypass？

## 参考资料

- [CoCo mode in Snowsight](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-snowsight/coco-mode)
- [Overview of Snowflake CoCo](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code)
- [CoCo CLI reference](https://docs.snowflake.com/en/user-guide/cortex-code/cli-reference)
- [CoCo Auto mode Preview](https://docs.snowflake.com/en/release-notes/2026/other/2026-11-17-coco-auto-mode-preview)
