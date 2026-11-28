# Snowflake 核心对象与会话执行边界

## 本节要解决的问题

理解 Database、Schema、Table、View、Stage、File Format、Warehouse 和 Role 的职责，并掌握会话上下文如何影响对象名称解析与操作权限。日常 SQL 出错时，首先要区分对象不存在、当前上下文错误、仓库未选择和角色授权不足。

## 核心知识

### Database 与 Schema 组织对象，Table/View 承载数据访问

Database 是逻辑命名空间，Schema 位于 Database 之下，表、视图、Stage、File Format、Sequence、Procedure 等对象通常属于某个 Schema。常见对象名可以写成 \`DATABASE.SCHEMA.OBJECT\`。

未写全限定名时，Snowflake 会使用当前会话的 Database 和 Schema 补全名称。切换 Database 也会影响当前 Schema，因此脚本不能假定连接时的默认上下文永远不变。

### Stage 与 File Format 是文件摄取/导出的入口配置

Stage 指向文件存放位置，可以是 Internal Stage 或 External Stage。File Format 描述 CSV、JSON、Parquet 等文件的解析选项。它们不是目标业务表，也不会自动完成数据质量校验。

加载链路应分开检查文件是否存在、格式是否解析正确、COPY INTO 是否成功、拒绝行是否处理，以及目标表是否达到预期行数。

### Warehouse 是计算资源，不属于表的命名层级

Warehouse 执行 SQL 和相关计算。它不是 Database、Schema 或 Table 的子对象，也不代表数据存储位置。没有选择合适的 Warehouse 时，查询可能因会话未设置计算资源而无法执行；但 Warehouse 可用不代表当前角色拥有表访问权限。

### Role 决定可执行的操作，会话上下文决定当前使用哪些对象和资源

Role 是权限主体，用户通过活动角色及已激活的辅助角色取得对象权限。对象所有权通常包含更广泛的管理能力；Managed Access Schema 会将对象授权决策集中到 Schema Owner 或拥有 MANAGE GRANTS 的角色。

Warehouse 的 USAGE、Database/Schema 的 USAGE 和目标表的 SELECT/INSERT 等权限是不同的授权边界。仅能看到对象名不代表有权查询对象。

## 工程实施步骤

1. **确认上下文。** 运行 \`SELECT CURRENT_ROLE(), CURRENT_SECONDARY_ROLES(), CURRENT_WAREHOUSE(), CURRENT_DATABASE(), CURRENT_SCHEMA();\` 记录当前会话设置。
2. **检查命名。** 对关键表使用全限定名，执行 SHOW TABLES/SHOW VIEWS/SHOW STAGES，并用 DESCRIBE 确认对象结构。
3. **检查文件入口。** 对 Stage 使用 LIST 检查文件，对 File Format 检查类型和解析选项；加载前明确文件匹配规则和失败处理。
4. **检查执行资源。** 确认当前 Warehouse 存在、已启动且有 USAGE 权限。不要通过变更 Database 或 Schema 来代替仓库授权。
5. **检查授权链。** 从用户拥有的 Role、当前活动 Role、角色继承和辅助角色出发，检查 Database、Schema、目标对象及 Warehouse 的所需权限。
6. **检查所有权和管理边界。** 对 CREATE/ALTER/DROP 操作确认执行角色拥有相应权限；在 Managed Access Schema 中，检查授权是否由 Schema Owner 或 MANAGE GRANTS 角色管理。
7. **固化部署上下文。** 在 ETL、应用连接和 CI 脚本中显式设置 Role、Warehouse、Database 和 Schema，减少连接配置差异造成的问题。

## 场景分析

部署脚本在开发环境能执行 \`SELECT * FROM ORDERS\`，在生产环境却提示对象不存在。团队怀疑生产表没有部署，准备重新创建。

不要先创建对象。先运行 CURRENT_DATABASE 和 CURRENT_SCHEMA，检查连接是否落在预期 Database/Schema；再用全限定名测试对象是否存在。如果全限定名可见但查询失败，检查当前 Role 的 USAGE 与 SELECT 权限。如果表能查询但 DDL 失败，继续检查 OWNERSHIP 或相应 CREATE/ALTER 权限。若错误发生在加载文件时，再检查 Stage、File Format 和 Warehouse。

该排查顺序可以避免因上下文或权限错误而创建重名对象，导致后续数据写入到错误的 Schema。

## 常见误区

- **把 Warehouse 当作 Database 的一部分。** Warehouse 是独立计算资源，不属于 Database.Schema.Object 命名路径。
- **认为切换 Database 不会影响 Schema。** 当前 Schema 属于当前 Database；切换 Database 可能同时改变当前 Schema 上下文。
- **将 Stage 当成目标表。** Stage 提供文件访问入口，File Format 负责解析规则，COPY INTO 才执行加载。
- **认为拥有对象名称就有 SELECT 权限。** 权限由活动角色及对象授权决定，不能仅从名称可见性推断。
- **忽略 Managed Access Schema。** 该模式下普通对象 Owner 的授权能力受到限制，授权由 Schema Owner 或 MANAGE GRANTS 角色集中管理。

## 完成标准

- [ ] 能说明 Database、Schema、Table、View、Stage 和 File Format 的关系。
- [ ] 能区分 Warehouse 计算资源与数据库对象命名空间。
- [ ] 能用 CURRENT_* 函数还原会话上下文。
- [ ] 能按 Role、USAGE 和对象权限定位授权错误。
- [ ] 能说明普通 Schema 与 Managed Access Schema 的授权管理差异。

## 自测

1. 当前 Database 正确，但查询未限定名称的表时提示找不到对象，应该先检查哪些会话上下文？
2. 一个角色可以使用 Warehouse，却无法查询某张表。为什么这两项权限互不替代？
3. CSV 文件已存在于 Stage，但 COPY INTO 后目标表没有预期行数。应分哪几个环节排查？

## 参考资料

- [USE 命令与当前会话上下文](https://docs.snowflake.com/en/sql-reference/sql/use)
- [Object name resolution](https://docs.snowflake.com/en/sql-reference/name-resolution)
- [Overview of access control](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
