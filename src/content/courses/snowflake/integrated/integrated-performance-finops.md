# 分析平台性能与 FinOps：从查询诊断到容量和成本治理

## 场景与目标

月末报表变慢，分析平台成本持续增加。团队怀疑仓库太小，准备扩大计算资源；但真正原因可能是扫描范围、连接基数、并发排队、数据分布、重复计算或模型设计问题。优化应从执行证据开始。

## 架构与数据流

~~~mermaid
flowchart TD
  Q[查询 / 作业] --> OBS[Query History / Profile]
  OBS --> B{瓶颈类型}
  B -->|扫描 / 连接| SQL[SQL 与模型优化]
  B -->|并发排队| WH[Warehouse 隔离与扩缩]
  B -->|缓存 / 重复计算| CACHE[缓存和调度]
  B -->|资源浪费| FIN[预算和成本归属]
  SQL --> VERIFY[同等负载复测]
  WH --> VERIFY
  CACHE --> VERIFY
  FIN --> VERIFY
~~~

## 实施步骤

1. 建立基线：记录查询指纹、用户/角色、仓库、执行时间、扫描量、排队时间、返回行数和业务 SLA，并固定数据、参数与并发条件。
2. 区分排队与执行慢。排队占比高时检查并发、仓库共享和任务重叠；执行本身慢时分析扫描、连接、排序、聚合和数据倾斜。
3. 分析 Snowflake Query Profile，观察微分区扫描、过滤、Join、聚合和 spill。先修复无效谓词、错误连接键和不必要扫描。
4. BI、批量转换、探索查询和高优先级服务可按 SLA 分配不同 Virtual Warehouse；仓库变大不会自动修复低效 SQL。
5. 区分结果缓存、仓库缓存和业务重复计算。缓存命中不应被当成稳定 SLA。
6. 用 query tag、角色、warehouse 和任务标签建立成本归属，设置资源监控、预算告警、自动暂停和异常增长检查。
7. PostgreSQL 使用 EXPLAIN (ANALYZE, BUFFERS) 检查扫描方式、估算与实际行数、连接顺序和 I/O；同时检查索引、统计信息、vacuum 和连接池。
8. 回归验证不只比较单条查询耗时，还要观察吞吐、并发、成本、失败率和结果一致性。



## 关键取舍

- 查询确实需要更多计算资源时扩仓可能有效；扫描范围或连接逻辑错误时，扩仓只会让低效查询更贵。
- 工作负载隔离降低互相干扰，但增加资源成本；按 SLA 和并发模式决定。
- 预计算和增量刷新降低查询延迟，但增加刷新、存储和新鲜度管理成本。
- PostgreSQL 索引与 Snowflake 微分区不是同一种机制；额外优化服务应通过查询证据判断是否值得启用。

## 验收清单

- 优化前后使用相同参数、数据区间和并发负载测试。
- 能说明瓶颈属于排队、扫描、计算、I/O、锁还是连接数。
- 关键查询有耗时、扫描量、排队时间和成本基线。
- 成本能追溯到团队、应用或作业，并有异常告警。
- 两种数据库的优化建议没有混用底层机制。

## 关联知识点

以下节点教程保持各自独立；本教程只提供工程流程上的关联入口。

- [virtual-warehouse](../articles/virtual-warehouse.md)
- [snowflake-micro-partitions](../articles/snowflake-micro-partitions.md)
- [snowflake-caching](../articles/snowflake-caching.md)
- [snowflake-query-optimization-services](../articles/snowflake-query-optimization-services.md)
- [warehouse-query-diagnostics](../articles/warehouse-query-diagnostics.md)
- [warehouse-cost-optimization](../articles/warehouse-cost-optimization.md)
- [snowflake-query-history](../articles/snowflake-query-history.md)
- [snowflake-resource-monitoring-account-usage](../articles/snowflake-resource-monitoring-account-usage.md)
- [postgresql-explain-plans-statistics](../articles/postgresql-explain-plans-statistics.md)
- [postgresql-index-strategies](../articles/postgresql-index-strategies.md)
- [postgresql-vacuum-bloat](../articles/postgresql-vacuum-bloat.md)
- [postgresql-memory-parallelism](../articles/postgresql-memory-parallelism.md)
- [postgresql-connection-pooling](../articles/postgresql-connection-pooling.md)

## 参考资料

- [Snowflake Query Profile](https://docs.snowflake.com/en/user-guide/ui-query-profile)
- [Warehouse Cost Controls](https://docs.snowflake.com/en/user-guide/cost-controlling-controls)
- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html)

参考链接已登记为官方文档入口，来源状态保留为“待核验”，没有把链接登记等同于已逐项复核。
