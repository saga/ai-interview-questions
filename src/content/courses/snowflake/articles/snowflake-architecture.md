# Snowflake 平台分层与计算存储分离

## 先从一次查询的故障说起

订单表同时供 ETL 作业和 BI 看板使用。早上批量任务启动后，看板开始变慢。有人建议把 Warehouse 调大，有人建议复制一张订单表，还有人怀疑是 Snowflake 服务层出了问题。

这三个建议针对的不是同一件事。判断该改哪一层，先把查询的责任边界分开：

- 用户能否登录、当前角色能否访问订单表，属于身份与授权问题。
- SQL 是否排队、执行时消耗多少计算资源，主要看 Warehouse。
- 表数据如何保存、查询要读哪些数据，由平台的存储与执行机制共同决定。
- SQL 解析、元数据和查询协调属于 Cloud Services，用户并不直接管理这一层的计算实例。

理解架构的价值，不是背出三个层次的名称，而是知道故障出现时应该先拿什么证据。

## 数据、计算和协调各自负责什么

### 表数据由平台管理，Warehouse 不保存一份表副本

Snowflake 将表数据组织为微分区，并负责底层持久化、压缩、加密和元数据管理。用户通过 Table、View 等逻辑对象访问数据，不需要自行管理数据文件的位置和布局。

Virtual Warehouse 是一组独立的计算资源，负责执行 SQL，也可以承载 Snowpark 工作负载。一个 Warehouse 执行查询时，不会占用另一个 Warehouse 的计算容量；但两个 Warehouse 可以读取同一份持久化表数据。

因此，为 BI 创建独立 Warehouse，通常是在隔离计算负载，不是在复制订单表。复制表会引入数据同步、存储和一致性问题，不能作为并发排队的默认解法。

### Cloud Services 负责协调请求，不是第三种用户仓库

Cloud Services 处理认证、访问控制、元数据、SQL 解析与优化、查询协调等平台级工作。它与用户创建、调整和暂停的 Warehouse 不同。

当前 Role 缺少表的 SELECT 权限，换一个更大的 Warehouse 不会让查询成功；对象名称解析到错误的 Database 或 Schema，也不能靠增加计算资源修复。相反，SQL 已通过权限检查，但在 Warehouse 上长时间排队，就应该调查计算负载。

## 一条查询经过哪些边界

一次查询可以按下面的逻辑理解。实际执行会受到缓存、查询类型和优化器决策影响，因此这不是每条 SQL 都固定执行的物理步骤表。

| 阶段 | 平台在处理什么 | 排查时先看什么 |
| --- | --- | --- |
| 建立会话 | 验证身份，确定活动 Role 与会话上下文 | 登录错误、CURRENT_ROLE、当前 Database/Schema |
| 解析和授权 | 解析对象、检查权限、生成执行计划 | 对象是否存在、角色继承、对象授权 |
| 执行查询 | Warehouse 执行计划并读取需要的数据 | 排队时间、Query Profile、扫描量和执行阶段 |
| 返回与记录 | 返回结果并记录查询信息 | Query ID、执行状态、耗时和错误信息 |

这张表不是为了机械分类故障，而是避免在没有证据时先改资源配置。

## 用同一张表区分三种故障

先确认连接使用的上下文：

~~~sql
SELECT
  CURRENT_ROLE(),
  CURRENT_WAREHOUSE(),
  CURRENT_DATABASE(),
  CURRENT_SCHEMA();
~~~

接着在 Snowsight 的 Query History 中找到慢查询，记录 Query ID、排队时间、执行时间和使用的 Warehouse，再打开 Query Profile。

| 观察到的现象 | 更可能的方向 | 不应先做的事 |
| --- | --- | --- |
| SQL 在开始执行前就报权限错误 | Role、对象授权或会话上下文 | 调大 Warehouse |
| 查询长时间排队，实际执行时间并不长 | Warehouse 并发、负载隔离或集群容量 | 先复制整张表 |
| 查询开始后扫描量很大，Join 或聚合耗时明显 | SQL 计划、过滤条件、数据布局和工作负载 | 只增加并发集群 |

如果 ETL 与 BI 共用一个 Warehouse，分离两类负载可能减少资源竞争；如果 BI 查询自身扫描大量微分区，隔离仓库不会自动减少扫描量。两个问题可以同时存在，仍然需要分别验证。

## 增加一个 Warehouse，究竟换来了什么

给 BI 建立独立 Warehouse 后，两个团队可以分别设置资源规格、自动暂停策略和成本归属。它们读取同一张订单表，但不再争用同一组计算资源。

上线前不要只比较看板是否变快。至少在相同时间窗口比较 BI 的 p95 延迟和排队时间、ETL 的完成时间、两个 Warehouse 的 Credit 消耗，以及新增的空闲成本。如果排队下降而总成本显著上升，还需要重新评估规格和自动暂停策略。

## 容易混淆的三个判断

- Warehouse 是计算资源，不是数据副本；共享表数据不代表共享计算容量。
- Cloud Services 的平台级服务不由用户通过调整 Warehouse 规格来管理。
- 慢查询不一定是计算资源不足。排队、扫描、Join、权限和对象解析需要不同证据。

## 自测

1. 两个 Warehouse 同时查询一张订单表，为什么不会互相占用对方的计算容量？它们又共享了什么？
2. Query History 显示查询排队很久，但执行阶段很短。你会先检查什么？为什么不应直接复制数据？
3. SQL 在开始执行前因 Role 缺少权限而失败，应该检查哪一层？调大 Warehouse 能解决吗？

## 参考资料

- [Snowflake key concepts and architecture](https://docs.snowflake.com/en/user-guide/intro-key-concepts)
- [Overview of warehouses](https://docs.snowflake.com/en/user-guide/warehouses-overview)
- [USE 命令与当前会话上下文](https://docs.snowflake.com/en/sql-reference/sql/use)
