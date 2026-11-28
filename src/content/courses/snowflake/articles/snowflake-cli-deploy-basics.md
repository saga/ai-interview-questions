# Snowflake CLI 连接与部署基础

## 本节要解决的问题

使用 Snowflake CLI 从本地或 CI 环境建立明确的 Snowflake Session，并按目标环境运行版本化 SQL 或项目命令。连接配置决定实际账户、Role、Warehouse 和 Schema；部署操作应由专用身份执行，不能依赖开发者当前终端的隐式默认值。

## 核心知识

### Snowflake CLI 连接由配置文件、环境变量和命令行参数共同决定

Snowflake CLI 使用 config.toml 定义连接。连接可以包含 account、user、authenticator、role、warehouse、database、schema 等参数。CLI 在参数冲突时有优先顺序：命令行参数优先，其次是特定连接环境变量，再次是 config.toml/connections.toml，最后是通用环境变量。

因此，同一个 connection name 在不同 CI 环境中可能因为环境变量或 CLI 参数而连接到不同账户。生产工作流应显式使用 connection name，并在执行前确认 CURRENT_ACCOUNT、CURRENT_ROLE、CURRENT_WAREHOUSE、CURRENT_DATABASE 和 CURRENT_SCHEMA。

### 连接配置和认证凭证应分开管理

config.toml 可以保存连接账户、用户、Role、Warehouse 等非秘密配置；密码、私钥和短期 token 应通过受控环境变量、密钥管理或 Workload Identity Federation 注入。不要将包含真实密码或私钥的连接文件提交到 Git。

snow connection add 可交互或通过命令行参数创建连接；snow connection test 用来验证指定连接。使用 --temporary-connection 可以在不保存配置文件的情况下运行单次连接。具体认证参数根据密码、Key Pair、OAuth 或 Workload Identity Federation 而不同。

### CLI 执行 SQL 与项目部署是不同命令类别

snow sql 可以执行 SQL 语句、SQL 文件或指定连接上的 SQL；--filename 适合运行版本化 migration 文件。Snowflake CLI 的项目命令还可用于 Snowpark、Streamlit、Native App、DCM 等不同对象类型；不要把 snow sql -f 当作通用项目依赖管理器。

CLI 执行成功只说明语句在目标 Session 中成功完成。它不自动检查对象差异、数据质量、权限、业务结果或回滚点。需要多对象部署时，应使用版本化 migration、DCM Project 或项目专用命令，并在部署前后做校验。

## 工程实施步骤

1. **建立连接清单。** 为 DEV、TEST、PROD 定义不同 connection name，分别指定 account、user、role、warehouse、database 和 schema。
2. **检查参数优先级。** 梳理 CI 环境变量、config.toml 和命令行参数，确保没有通用环境变量覆盖到生产目标。
3. **保护凭证。** 把敏感值放进 Secret 管理或短期身份配置，限制本地 config.toml 权限，并将实际凭证文件加入 .gitignore。
4. **创建并测试连接。** 使用 snow connection add 创建配置，再用 snow connection test -c DEV 等命令验证账户、角色和网络访问。
5. **执行部署前身份检查。** 在目标连接上查询 CURRENT_ACCOUNT、CURRENT_ROLE、CURRENT_WAREHOUSE、CURRENT_DATABASE 和 CURRENT_SCHEMA，确认不是错误环境。
6. **将 SQL 迁移文件放入 Git。** 使用编号或时间戳管理执行顺序，记录每个 migration 是否可重复、是否破坏性以及失败后的补偿步骤。
7. **在低风险环境执行。** 使用 snow sql -c DEV --filename migrations/001_create_schema.sql，记录 Query ID、退出码和实际对象状态。
8. **生产部署前审查。** 对破坏性 DDL、数据回填和权限变化生成计划或人工 review；对多对象依赖使用 DCM/项目工作流，不用无序脚本猜执行顺序。
9. **部署后验证。** 检查 DESCRIBE/SHOW 结果、权限、数据行数、业务汇总和下游任务；成功返回码不等于发布验收。
10. **保存恢复材料。** 记录 CLI 版本、Git SHA、连接名、目标账户、Role、Query ID、迁移状态和回滚/向前修复脚本。

示例：

~~~bash
snow connection add --connection-name DEV
snow connection test -c DEV

snow sql -c DEV --query \
  "SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_DATABASE(), CURRENT_SCHEMA();"

snow sql -c DEV --filename migrations/001_create_schema.sql
~~~

在 CI 中连接名称和认证配置应由受控环境注入；不要依赖开发者电脑上的 default connection。

## 场景分析

开发人员本机运行迁移脚本成功，CI 运行同一脚本却连接到错误的 Snowflake Account。根因是 CI 设置了通用 SNOWFLAKE_ACCOUNT 环境变量，同时 CLI profile 又定义了另一个 account。

排查时先检查 CLI 参数、特定连接环境变量、连接配置和通用环境变量的优先级；再在真正运行迁移前打印或查询当前账户和 Role。生产流程应要求明确的 -c PROD，使用与开发者个人凭证隔离的服务身份。

验收在 DEV 和 PROD 注入不同连接信息，确保相同 SQL 文件只在显式目标环境执行。测试环境变量冲突、失效私钥、过期 token 和 Role 权限不足时，流水线应在 DDL 运行前失败。

## 常见误区

- **使用默认连接执行生产迁移。** default connection 可能来自开发机或 CI 环境，目标账户必须显式指定。
- **把 config.toml 当作可以公开提交的普通项目文件。** 它可能含密码、token 或私钥路径，应保护敏感项并使用环境注入。
- **认为 connection test 通过就能执行所有 DDL。** 认证连通不代表目标 Role 有对象创建或修改权限。
- **将 snow sql 当通用部署框架。** 它执行 SQL；复杂对象集合、依赖和差异需要 migration 或 DCM/项目流程。
- **只检查 CLI 命令退出码。** 必须确认当前连接身份、对象状态和业务结果。
- **在生产 CI 复用工程师个人账号。** 应采用专用最小权限身份，并优先评估短期凭证/Workload Identity Federation。

## 完成标准

- [ ] 能解释 Snowflake CLI 连接参数的优先级。
- [ ] 能创建、测试并显式指定不同环境的连接。
- [ ] 能区分非敏感连接配置与秘密凭证。
- [ ] 能使用 snow sql 执行版本化脚本并记录运行证据。
- [ ] 能设计部署前身份检查、权限验证和部署后业务校验。

## 自测

1. CI 命令显式使用 DEV connection，但仍连接到错误账户，应该检查哪些更高优先级参数？
2. config.toml 可以保存哪些连接信息？密码和私钥应如何处理？
3. snow connection test 成功后，为什么还不能认定迁移脚本有权执行 CREATE TABLE？
4. 多个 SQL migration 有依赖顺序和破坏性 DDL，为什么不能只依赖一个 snow sql 执行成功？
5. 如何在流水线中证明本次迁移使用了正确的账户、Role、Warehouse 和 Git SHA？

## 参考资料

- [Managing Snowflake connections](https://docs.snowflake.com/en/developer-guide/snowflake-cli/connecting/configure-connections)
- [Configuring Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/connecting/configure-cli)
- [snow connection add](https://docs.snowflake.com/en/developer-guide/snowflake-cli/command-reference/connection-commands/add-connection)
- [snow sql command](https://docs.snowflake.com/en/developer-guide/snowflake-cli/command-reference/sql-commands/sql)
