# Warehouse 利用率、并发与容量

## 本节要解决的问题

使用 Warehouse Load History、Query History 和 Metering 识别仓库过载、资源不足、启动排队和空闲浪费，并判断应该扩大规格、使用 multi-cluster、拆分负载还是调整自动暂停策略。不要把 Warehouse 利用率当作单一百分比指标。

## 核心知识

### WAREHOUSE_LOAD_HISTORY 显示运行、排队和阻塞负载

ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY 按 5 分钟区间提供 AVG_RUNNING、AVG_QUEUED_LOAD、AVG_QUEUED_PROVISIONING 和 AVG_BLOCKED 等指标。它们分别反映执行负载、因仓库过载而排队、因仓库 provision/resume 而等待，以及被事务阻塞的查询负载。

该视图存在数据延迟，适合历史容量分析，不适合当作秒级告警源。即时排查需要结合 Snowsight 当前查询和 Query History。

### 利用率和并发容量不是同一个概念

单仓库规格影响可用计算资源；Multi-cluster Warehouse 可以在并发增加时扩展集群。持续高 AVG_QUEUED_LOAD 表示过载排队，可能需要增加并发容量或分离工作负载。单条 SQL 执行时间高但没有排队，更应该检查查询计划、扫描量和数据处理资源。

### 负载数据必须与费用和业务目标一起看

WAREHOUSE_METERING_HISTORY 反映小时级 Warehouse credits；Query History 有查询级时间和排队字段。将二者与业务吞吐量、SLA、自动暂停时间和集群数放在一起，才能区分容量不足和资源闲置。

## 工程实施步骤

1. 选定 Warehouse 和业务高峰时间，查询 WAREHOUSE_LOAD_HISTORY，观察 AVG_RUNNING、AVG_QUEUED_LOAD、AVG_QUEUED_PROVISIONING 与 AVG_BLOCKED。
2. 结合 Query History 检查排队的是哪些 SQL、用户和团队，区分短查询高并发与少量长查询占满资源。
3. 对执行慢的查询打开 Query Profile；对等待多的查询确认是过载、恢复/配置还是事务阻塞。
4. 比较独立 Warehouse 与 Multi-cluster 的收益，检查集群启动和扩缩容策略，以及最小/最大集群数。
5. 将 Warehouse Metering 与 Load History 对照，识别低运行负载却持续付费的时间段，并复核 AUTO_SUSPEND 设置。
6. 对高峰 ETL 和 BI 使用不同 Warehouse 时，评估负载隔离、权限、Query Tag 和团队成本归属。
7. 调整后在相同高峰窗口比较排队时间、p95 响应、任务完成时间、集群数、credits 和空闲时段。

示例：

~~~sql
SELECT
  start_time,
  warehouse_name,
  avg_running,
  avg_queued_load,
  avg_queued_provisioning,
  avg_blocked
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY
WHERE start_time >= DATEADD(day, -7, CURRENT_TIMESTAMP())
  AND warehouse_name = 'BI_WH'
ORDER BY start_time DESC;
~~~

## 场景分析

财务报表高峰期出现排队，运营团队同时抱怨查询响应变慢。平台团队看到仓库平均运行负载不高，怀疑 Warehouse 规格太小。

检查 5 分钟粒度的负载曲线，不能只看全天平均值。若峰值期间 AVG_QUEUED_LOAD 明显升高，说明过载排队；若 AVG_QUEUED_PROVISIONING 升高，应检查仓库启动或扩容等待；若 AVG_BLOCKED 升高，则应排查并发 DML/事务锁。若这些指标不高但单条 SQL 很慢，应进入 Query Profile 分析扫描和 Join。

容量方案可以是独立 BI Warehouse、Multi-cluster Auto-scale 或调整仓库规格，具体取决于证据。验收以高峰 p95、排队量、报表完成窗口和 credits 为准，不能用低日均利用率证明高峰容量充足。

## 常见误区

- **只看全天平均利用率。** 高峰队列会被长时间低负载稀释，需按时间段分析。
- **把 AVG_QUEUED_LOAD 当成 SQL 执行时间。** 它描述过载导致的队列负载，需与 Query History 的时间字段区别使用。
- **看到 AVG_RUNNING 高就一定要扩大规格。** 还要检查是否有排队、SQL 计划和实际 SLA。
- **忽略 provisioning 与 blocked。** 仓库启动、扩缩容和事务锁会造成等待，但原因并不是计算资源过载。
- **只看 Load History 不看 credits。** 高利用率可能高效，也可能是昂贵的长查询；低利用率也可能伴随空闲费用。

## 完成标准

- [ ] 能解释四类 Warehouse Load 指标。
- [ ] 能区分过载排队、provisioning 等待与事务阻塞。
- [ ] 能根据查询行为选择扩大规格、Multi-cluster 或拆分负载。
- [ ] 能将 Load History 与 Metering 和业务 SLA 结合分析。
- [ ] 能定义容量调整前后的可比验收窗口。

## 自测

1. AVG_QUEUED_PROVISIONING 上升，但 AVG_QUEUED_LOAD 不高，应该优先检查什么？
2. 全天 AVG_RUNNING 不高，但每天 10 点到 11 点排队严重，为什么仍然可能需要扩容？
3. 仓库没有排队，但某类 SQL 的执行时间持续上升，下一步应该查看什么？

## 参考资料

- [WAREHOUSE_LOAD_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_load_history)
- [Multi-cluster warehouses](https://docs.snowflake.com/en/user-guide/warehouses-multicluster)
- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [WAREHOUSE_METERING_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_metering_history)
