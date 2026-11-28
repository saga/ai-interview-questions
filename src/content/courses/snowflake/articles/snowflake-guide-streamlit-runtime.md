# Streamlit Warehouse Runtime 与 Container Runtime：实例和身份边界

## 看板偶发串数据，问题可能在运行时共享方式

一个 Streamlit 应用为用户 A 加载了客户列表。用户 B 随后打开同一个应用，却短暂看到了 A 的筛选状态。开发者把原因归结为 SQL 缓存，但真正需要先确认的是：应用代码究竟是一人一份实例，还是所有查看者共用一份长运行服务？

Streamlit in Snowflake 有 Warehouse Runtime 和 Container Runtime 两种运行方式。选择它们时，不只比较性能，还要理解实例生命周期、计算来源、并发行为和共享状态。

## 两种 Runtime 的计算路径不同

| 项目 | Warehouse Runtime | Container Runtime |
| --- | --- | --- |
| 应用代码在哪里运行 | Virtual Warehouse | Snowpark Container Services Compute Pool |
| 用户访问实例 | 每个查看者创建个人实例 | 查看者共享一个长运行应用实例 |
| SQL 查询 | 使用应用指定的 Warehouse | 应用代码运行在 Compute Pool，SQL 仍使用独立 Warehouse |
| 生命周期 | 按需运行，空闲后与 Warehouse 生命周期相关 | 长运行服务，需考虑 Compute Pool 容量与服务状态 |
| 更适合 | 对个人实例隔离、简单计算和 Warehouse 管理有要求的应用 | 希望共享服务、使用更灵活依赖或长运行应用的场景 |

CREATE STREAMLIT 通过 RUNTIME_NAME 指定运行时，Container Runtime 还需要 COMPUTE_POOL；QUERY_WAREHOUSE 指定应用发起 SQL 时使用的 Warehouse。

~~~sql
CREATE STREAMLIT ANALYTICS_DB.APP_SCHEMA.SALES_DASHBOARD
  FROM @ANALYTICS_DB.APP_SCHEMA.APP_STAGE
  MAIN_FILE = 'streamlit_app.py'
  QUERY_WAREHOUSE = APP_QUERY_WH
  RUNTIME_NAME = 'SYSTEM$ST_CONTAINER_RUNTIME_PY3_11'
  COMPUTE_POOL = APP_COMPUTE_POOL;
~~~

若省略 RUNTIME_NAME，默认值取决于当前账户是否启用了 2026_06 行为变更包。启用后，新建的 Streamlit 应用默认使用 Container Runtime；Government/China 区域及 Native App 创建的应用存在例外。生产 DDL 应显式写出 Runtime，避免账户行为变更影响部署结果。

## Container Runtime 的“共享”不是用户数据隔离

Container Runtime 的一个长运行实例服务多个查看者。不要把用户筛选条件、客户 ID 或授权结果保存到进程级全局变量，再假设每个访问者都会得到独立的 Python 内存。

应用应把每个请求的身份和筛选条件作为请求级输入；数据访问仍由 Snowflake 的 Role、对象授权、Owner's Rights/Caller’s Rights 和 Row Access Policy 等机制控制。隐藏按钮或在 Python 中过滤列表，不构成数据库安全边界。

同样，Warehouse Runtime 的每个查看者拥有个人应用实例，也不意味着数据权限自动隔离。两种 Runtime 都必须测试实际调用者能够查询什么数据，不能用实例分配方式替代 RBAC。

## Runtime 与应用权限是两套独立配置

使用 Container Runtime 时，应用代码的 Compute Pool 和 SQL 的 Warehouse 是两种不同资源。授予 USAGE on Warehouse，不代表应用能使用 Compute Pool；反之亦然。还要检查应用的 Owner’s Rights 或 Caller’s Rights 设置以及访问外部 API 所需的 External Access Integration。

排查时分开观察应用实例/容器状态与 SQL Query History。若页面启动失败，先看 Runtime、Compute Pool、包和服务权限；若页面能打开但查询失败，再看 Query Warehouse、Role、Database/Schema 和对象授权。

## 选择建议

- 个人分析、按查看者隔离实例，且应用依赖简单时，可以先评估 Warehouse Runtime。
- 需要共享长运行应用、较灵活的依赖环境或外部服务集成时，评估 Container Runtime。
- 应用主要是 SQL 报表时，别为了“使用容器”而增加 Compute Pool；Warehouse Runtime 可能更简单。
- 应用代码长期运行并维护共享状态时，Container Runtime 更需设计用户隔离、并发和状态恢复。

## 容易混淆的地方

- Container Runtime 的应用代码运行在 Compute Pool，SQL 仍使用 Warehouse。
- Warehouse Runtime 的个人实例不代表数据库对象权限自动隔离。
- Container Runtime 的共享实例不应保存未经隔离的用户级数据。
- 运行时默认值可能随行为变更包改变，部署时应显式写出配置。
- 依赖包和运行时支持范围应按目标 Runtime 验证，不能从本地 Streamlit 直接推断。

## 自测

1. Container Runtime 的 Python 代码运行在 Compute Pool，为什么执行 SQL 仍需要 Warehouse？
2. 为什么全局变量不适合保存不同用户的客户筛选或授权结果？
3. 一个应用能打开但所有查询都报权限错误，Runtime 和 SQL 的哪些授权要分开核对？
4. 哪些情况下 Warehouse Runtime 比 Container Runtime 更简单？
5. 为什么部署 DDL 应显式指定 RUNTIME_NAME？

## 参考资料

- [Runtime environments for Streamlit apps](https://docs.snowflake.com/en/developer-guide/streamlit/app-development/runtime-environments)
- [CREATE STREAMLIT](https://docs.snowflake.com/en/sql-reference/sql/create-streamlit)
- [New Streamlits default to Container Runtime](https://docs.snowflake.com/en/release-notes/bcr-bundles/2026_06/bcr-2342)
- [Understanding owner's rights in Streamlit apps](https://docs.snowflake.com/en/developer-guide/streamlit/object-management/owners-rights)
