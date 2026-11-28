# Cortex Code 工作流治理：从提示到可审计交付

## 只保存最终 SQL，无法解释 Agent 为什么这样改

一次生产问题发生后，团队看到 Git 中有一条 SQL 变更，却无法回答：Agent 当时看到了哪一版表定义？用的是 Code mode 还是 Standard mode？谁批准了 Diff？SQL 实际在哪个 Warehouse 执行？失败后是否重试过？

这说明记录只停留在最终文件，没有贯通输入、候选修改、审核、执行和结果。Cortex Code 的对话记录有助于回看交互，但不能替代版本控制、部署审计和运行日志。

## 将一次 Agent 工作拆成可关联的记录

建议以一个稳定的 work_id 或需求 ID 串联以下信息：

| 阶段 | 应记录的内容 | 主要用途 |
| --- | --- | --- |
| 请求 | 目标、约束、允许修改范围和数据敏感级别 | 解释本次工作的边界 |
| 上下文 | Git Commit、文件清单、对象定义、项目规则版本 | 还原 Agent 当时看到的输入 |
| 生成 | Cortex Code 版本、模式、模型/配置、命令与候选 Diff | 复现修改来源 |
| 审查 | 静态检查、测试结果、评审人和批准决定 | 证明修改通过了哪些门禁 |
| 执行 | 部署身份、Role、Warehouse、Query ID、部署运行 ID | 追踪生产副作用 |
| 结果 | 数据对账、运行状态、告警和回滚记录 | 判断交付是否真正完成 |

不必把所有提示内容和终端输出永久保存。按数据分类脱敏，只保留复现、审计和责任追踪需要的最小证据。敏感参数、密钥和个人数据不应直接写入共享日志。

## 区分 Code mode 与 Standard mode 的执行边界

Cortex Code Code mode 主要提供文件、Shell 和代码搜索工具，关闭 Snowflake 数据工具、MCP、Skills 和协作能力。Standard mode 才面向需要 Snowflake SQL、MCP、Skills 或其他数据工作能力的场景。审计记录必须保存模式与工具范围，否则后续无法解释某条 SQL 是从仓库静态分析得到，还是通过数据库工具实际查询得到。

还要记录执行身份。当前连接角色、辅助角色和 Warehouse 会影响能看到的对象、能运行的操作和实际成本。单独保存“Agent 使用了 Standard mode”不够，必须能关联到实际 Role、对象权限和工具资源。

## 提示词版本和业务规则不应只存在于聊天里

稳定的项目规范、SQL 规则、对象清单和测试要求应放入版本控制。每次运行记录它们的 Commit 或版本标识。临时输入可关联到 work_id，但不应把一段聊天文本当作长期、唯一的业务规则来源。

对同一任务重复运行时，可能因为模型版本、文件状态、工具返回和随机性得到不同 Diff。复现要求不是保证输出完全相同，而是能说明输入和执行环境，并重新验证结果。

## 用 Git 与 CI 承担正式交付

Agent 可以创建候选分支、修改文件和运行测试，但合并与部署应按仓库流程执行。CI 应保留 Commit、构建结果、测试报告和部署环境。生产执行完成后，再关联 Query History、Task History 或 DCM 部署记录。

对于高影响动作，明确区分“Agent 建议”“人批准”“系统执行”和“验证通过”四个状态。不能用一个 completed=true 把所有环节合并。若执行失败，应保留失败记录、重试次数和人工介入情况，而不是用后一次成功覆盖前一次失败。

## 对审计记录本身做质量检查

定期检查是否存在没有 work_id 的生产操作、缺少批准记录的高风险修改、没有 Query ID 的 SQL 变更、无测试报告的合并，以及无法关联到 Commit 的部署。还应检查日志脱敏和保留期限，避免审计系统变成第二个秘密泄露渠道。

## 常见误区

- 只保存最终 SQL，不保存其输入和修改 Diff。
- 将聊天历史当作唯一业务审计记录。
- 不区分代码模式和数据工具模式。
- 把 Agent 的完成报告等同于生产部署成功。
- 将批准人、执行身份和验证人压缩成同一个状态字段。
- 为了完整留痕而无限制保存提示和数据输出。

## 参考资料

- [Cortex Code CLI code mode](https://docs.snowflake.com/en/user-guide/cortex-code/code-mode)
- [Cortex Code changelog](https://docs.snowflake.com/en/user-guide/cortex-code/changelog)
- [Cortex Agents access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [DCM Projects collaboration and CI/CD](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-collaboration)
