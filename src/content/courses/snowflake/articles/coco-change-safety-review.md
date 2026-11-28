# Cortex Code 生成变更的差异审查与安全门禁

## 模型生成的 DDL 可能完全合法，却破坏生产数据

Cortex Code 根据需求生成一条 CREATE OR REPLACE TABLE，语法和类型都正确，但它替换了现有表，导致下游依赖、授权和保留策略发生变化。问题不在 SQL 语法，而在变更语义和影响范围。

AI 生成的 SQL、Python、dbt 模型和 DCM 定义都应视为候选修改。模型负责提出修改和解释依据，审批与执行权限仍由工程流程控制。

## 先审查对象与数据副作用

每一份变更至少检查以下内容：

- 对象标识：Database、Schema、对象名和目标环境是否正确。
- 破坏性操作：CREATE OR REPLACE、DROP、TRUNCATE、DELETE、覆盖写入和分区变更。
- 授权变化：GRANT、REVOKE、OWNERSHIP 转移、Role 继承和未来对象授权。
- 数据语义：过滤条件、Join 粒度、去重键、NULL 处理、时区和时间边界。
- 下游影响：Task、Stream、Dynamic Table、View、Semantic View、应用和报表。
- 秘密信息：密钥、连接串、访问令牌和真实客户数据是否进入提示、日志或提交内容。

不能仅靠 git diff 判断影响范围。SQL 动态拼接、存储过程、外部配置和权限继承可能让影响跨出当前文件。

## 测试环境和受限身份是必要条件

让 Agent 使用专用开发 Role 和 Warehouse。该 Role 只获得目标 Schema 所需的创建、查询或写入权限，不继承生产管理员权限。先在隔离环境执行 DDL，检查对象结构、权限、数据和下游查询，再考虑部署。

对于数据变更，准备固定样本并检查前后行数、主键唯一性、关键聚合和业务边界。对于权限变更，验证允许访问的角色和必须拒绝的角色。对破坏性 DDL，应有独立备份或克隆、恢复步骤和明确维护窗口。

## 不能假设所有 DDL 都可以事务回滚

Snowflake 支持事务，但许多 DDL 语句具有隐式提交或独立事务语义。不能把 BEGIN/ROLLBACK 当作所有建表、替换和授权操作的通用回滚按钮。部署前应针对具体语句确认事务行为。

更可靠的恢复设计是保留原对象或可恢复副本、明确数据回灌来源、保存旧版 DDL 和授权快照，并提前演练恢复路径。回滚计划必须说明恢复到哪个版本、期间产生的新数据如何处理，以及是否会影响其他消费者。

## 用分层门禁处理 AI 修改

1. 生成：CoCo 输出候选文件与解释，不直接写生产。
2. 静态检查：解析 SQL/代码、检查对象 allowlist、危险语句、凭据和路径。
3. 测试：运行单元测试、数据质量测试和代表性 SQL。
4. 差异评审：由对象 owner 检查数据口径、权限和下游契约。
5. 发布：CI 使用专用部署身份执行变更，并保存部署 ID 和结果。
6. 验收与恢复：检查运行历史、数据对账、告警和回滚条件。

对低风险的纯文本或测试文件修改，可以自动运行检查后合并；涉及生产数据删除、权限扩大和对象替换时，需要明确授权。审批不是为了重复阅读模型说明，而是确认高影响决策由有责任的人承担。

## 一次安全审查应该留下什么

审查记录至少关联需求号、仓库 Commit、Agent/CLI 版本、输入上下文、候选 Diff、静态检查、测试结果、批准人、部署运行 ID 和回滚证据。不能保存明文秘密或不必要的个人数据。日志和提示保留期也应符合组织数据分类要求。

## 常见失误

- 只看语法和 lint，不检查 DDL 数据副作用。
- 让 Agent 使用生产高权限 Role 执行探索性 SQL。
- 认为 Git 回滚可以恢复已经执行的数据删除。
- 将 BEGIN/ROLLBACK 当作所有 DDL 的撤销机制。
- 只保留最终文件，不记录批准、执行和验证证据。
- 在提示或日志中复制秘密和生产数据。

## 参考资料

- [Snowflake access control overview](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [Cortex Code CLI code mode](https://docs.snowflake.com/en/user-guide/cortex-code/code-mode)
- [Cortex Agents access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Snowflake DCM Projects overview](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-overview)
