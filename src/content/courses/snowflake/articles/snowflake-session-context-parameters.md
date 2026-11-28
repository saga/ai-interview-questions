# Session、Context 与参数优先级

## 本节要解决的问题

确认当前 SQL 运行时实际采用的 Role、Warehouse、Database、Schema 和参数值。相同 SQL 在不同 Session 中可能因上下文、参数或默认对象不同而产生不同结果；应通过显式设置和上下文函数降低环境差异。

## 核心知识

### Session Context 决定当前会话使用的对象和执行身份

Snowflake 的 USE 命令可以设置当前 Role、Warehouse、Database 和 Schema。CURRENT_ROLE、CURRENT_SECONDARY_ROLES、CURRENT_WAREHOUSE、CURRENT_DATABASE、CURRENT_SCHEMA 和 CURRENT_USER 等上下文函数用于查看当前会话状态。

没有写全限定名时，对象名称解析会依赖当前 Database 和 Schema。生产脚本、迁移脚本和多租户应用应优先使用全限定对象名，或在每个连接建立后显式设置所需上下文。

### 参数分为 Account、Session 和 Object 等范围

Snowflake 参数存在不同作用范围。Account 参数影响账户级行为；Session 参数可在 Account 和 User 层设置默认值，并可由当前 Session 覆盖；Object 参数附着在 Warehouse、Database、Schema、Table 等对象上。

查看当前作用域参数可用 SHOW PARAMETERS。设置 Session 参数使用 ALTER SESSION；账户或用户默认值需要相应管理权限。参数是否可设置在哪个作用域，取决于参数类型定义，不能假设所有参数都能从 Session 任意覆盖。

### 上下文与参数都应进入运行证据

同一 SQL 在不同 Warehouse、Role、Timezone、Date/Time 参数或其他 Session 参数下，可能表现出不同的权限、解析、结果展示或执行行为。对性能对比和问题复现，除了 SQL 文本，还应保存运行上下文与相关参数值。

## 工程实施步骤

1. 在连接池创建连接或租用连接后，显式设置当前 Role、Warehouse、Database 和 Schema，避免继承前一个请求的会话状态。
2. 执行 CURRENT_* 函数收集当前 Session 上下文；在诊断日志中记录运行用户、角色、仓库和对象命名空间。
3. 使用 SHOW PARAMETERS IN SESSION 查看当前会话参数；必要时分别使用 IN ACCOUNT、IN USER 和对象作用域查询配置。
4. 对影响结果的参数在部署配置中明确设置，并区分账户默认值、用户默认值和 Session 覆盖值。
5. 跨环境脚本优先使用全限定对象名，防止当前 Database/Schema 不同导致读写错误对象。
6. 对连接池复用场景，测试请求 A 切换 Role/Schema 后，请求 B 是否仍继承不应保留的上下文；在归还连接前清理或重新设置状态。
7. 将 SQL、Query ID、Session ID、上下文与关键参数一起保存，使性能问题和业务差异可以复现。

示例：

~~~
SELECT
  CURRENT_USER(),
  CURRENT_ROLE(),
  CURRENT_SECONDARY_ROLES(),
  CURRENT_WAREHOUSE(),
  CURRENT_DATABASE(),
  CURRENT_SCHEMA();

SHOW PARAMETERS IN SESSION;
~~~

## 场景分析

应用使用连接池，不同租户请求共用数据库连接。租户 A 的请求切换到专用 Role 和 Schema 后，连接被放回连接池；租户 B 获取同一连接时未重新设置上下文，导致查询落到错误 Schema 或使用了不期望的 Role。

修复时在每次租用连接后设置完整上下文，并在请求结束时恢复默认状态或销毁连接。测试顺序应包含不同租户、异常退出、事务回滚和连接复用。仅仅在应用启动时执行一次 USE DATABASE 并不足以保证连接池中的每个请求都使用相同状态。

## 常见误区

- **认为所有 Session 都共享同一上下文。** 每个连接有自己的 Session 状态，连接池复用时需要显式管理。
- **认为相同 SQL 一定访问同一张表。** 未限定名称会受到当前 Database 和 Schema 影响。
- **认为参数只有 Account 和 Session 两级。** 还存在 User、Object 等作用域，具体可设置范围由参数定义决定。
- **把 SHOW PARAMETERS IN SESSION 当成账户所有参数的完整清单。** 不同作用域需要指定对应的查询范围。
- **连接池只管理网络连接、不需要管理 Session 状态。** Role、Warehouse、Schema 和参数可能跨请求残留。

## 完成标准

- [ ] 能使用 CURRENT_* 函数检查当前 Session Context。
- [ ] 能解释全限定对象名与当前 Database/Schema 的区别。
- [ ] 能区分 Account、User、Session 和 Object 参数范围。
- [ ] 能通过 SHOW PARAMETERS 定位参数实际值。
- [ ] 能为连接池设计上下文初始化和清理策略。

## 自测

1. 同一条 SQL 在开发和生产访问到不同对象，如何检查 Session Context？
2. 参数在 Account 层设置默认值后，User 和 Session 层还能否覆盖？需要注意什么限制？
3. 一个连接池连接被多个租户复用，为什么只在应用启动时执行一次 USE SCHEMA 不可靠？
4. SHOW PARAMETERS IN SESSION 没看到某个对象参数，应该如何继续检查？

## 参考资料

- [USE command](https://docs.snowflake.com/en/sql-reference/sql/use)
- [Parameters](https://docs.snowflake.com/en/sql-reference/parameters)
- [SHOW PARAMETERS](https://docs.snowflake.com/en/sql-reference/sql/show-parameters)
- [Context functions](https://docs.snowflake.com/en/sql-reference/functions-context)
