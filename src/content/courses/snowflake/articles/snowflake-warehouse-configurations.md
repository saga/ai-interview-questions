# 仓库规模、扩缩容与自动暂停

## 本节要解决的问题

将 Warehouse 配置参数与实际工作负载对应起来：规模决定单个集群可用计算资源，多集群更偏向承接并发，自动暂停与恢复影响空闲费用和冷启动体验。配置需要通过查询延迟、排队和 credits 验收，而不是只看 DDL 是否成功。

## 核心知识

### Warehouse Size 影响单集群计算能力

Warehouse 规格决定计算资源规模。扩大规格可能改善 CPU、内存或并行资源受限的查询，但不是所有 SQL 都能线性加速：如果瓶颈来自扫描过多数据、低效 Join、锁等待或外部数据访问，单纯扩大仓库未必解决问题。

### Multi-cluster 扩展主要处理并发需求

Multi-cluster Warehouse 可以在工作负载增加时启动额外集群，降低多条查询争用单个集群时的排队。它不是把一条查询自动拆到多个集群。Maximized 与 Auto-scale 策略的集群启动方式不同；应根据并发波动、启动延迟和成本选择。

### AUTO_SUSPEND 与 AUTO_RESUME 影响空闲费用和首查体验

AUTO_SUSPEND 控制仓库空闲多久后暂停；AUTO_RESUME 控制后续请求是否自动启动仓库。阈值太短可能让周期性查询反复经历恢复和本地缓存重建，阈值太长则增加空闲 credits。持续运行、长时间批处理和高频短查询通常需要不同设置。

## 工程实施步骤

1. 为仓库明确用途和Owner，区分 BI、ETL、数据科学和临时交互负载；不要只依据部门名称分配规格。
2. 先采集 QUERY_HISTORY 中的执行时间、排队时间和 Warehouse 信息，再结合 WAREHOUSE_LOAD_HISTORY 判断排队是由过载还是仓库启动/调整造成。
3. 如果主要问题是单条查询执行慢，检查 Query Profile 后对比不同规格；保持 SQL、数据量、缓存条件和并发尽量一致。
4. 如果主要问题是高并发排队，比较拆分仓库与 Multi-cluster Auto-scale；记录集群数、排队、请求成功率和成本。
5. 根据请求间隔、长批次和交互首查延迟设置 AUTO_SUSPEND / AUTO_RESUME。对周期性任务要考虑暂停后的冷缓存和恢复延迟。
6. 按需配置 Resource Monitor 对指定 Warehouse 的 credits 进行监控和告警。它不是覆盖所有 Serverless 功能、存储和数据传输费用的全账户预算工具。
7. 用同一观察窗口比较 p50/p95 延迟、排队时间、任务完成时间、集群数、空闲时间及 credits，保留调整前后的基线。

配置示例：

~~~sql
CREATE WAREHOUSE BI_WH
  WAREHOUSE_SIZE = 'MEDIUM'
  AUTO_SUSPEND = 180
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;

ALTER WAREHOUSE BI_WH
  SET WAREHOUSE_SIZE = 'LARGE'
      AUTO_SUSPEND = 300;
~~~

## 场景分析

业务高峰时 BI 查询出现大量排队，但单条查询的执行时间与平时相近。团队希望直接把 Warehouse 从 Medium 调到 X-Large。

如果主要瓶颈是并发排队，先评估 Multi-cluster 或拆分工作负载；调大单集群可能没有消除排队根因。相反，如果排队很少而单条 SQL 在扫描与聚合阶段耗时显著，才应在 Query Profile 的证据基础上测试更大规格或优化 SQL。两类问题可能同时存在，应分别验收。

发布配置前对照高峰和非高峰两组负载，记录 p95 延迟、AVG_QUEUED_LOAD、AVG_RUNNING 和每小时 credits。若延迟改善但消耗增长更快，应重新评估规格、最小/最大集群数和暂停策略。

## 常见误区

- **认为扩大规格就能解决所有并发。** 规格扩展单集群资源，多集群扩展面向并发容量。
- **认为 Multi-cluster 会把单条 SQL 分散执行。** 它增加可处理并发请求的集群，不替代单查询优化。
- **把 AUTO_SUSPEND 当成资源删除。** 暂停的是计算仓库，不删除数据库对象或表数据。
- **把 Resource Monitor 当作所有 Snowflake 费用的硬预算。** 查询归因、Serverless、存储和传输费用需要结合其它使用记录分析。
- **忽略恢复后的缓存重建。** 极短的暂停阈值可能造成频繁冷启动，影响首批查询。

## 完成标准

- [ ] 能解释 Warehouse Size 与 Multi-cluster 的作用差异。
- [ ] 能从查询历史和仓库负载中区分执行慢与排队。
- [ ] 能为不同工作负载设置自动暂停和恢复参数。
- [ ] 能说清 Resource Monitor 的监控范围。
- [ ] 能以延迟、排队和 credits 的变化验收配置。

## 自测

1. 业务高峰时 AVG_QUEUED_LOAD 上升，但 AVG_RUNNING 与单条查询时长稳定。应该先测试调大规格还是增加并发集群？
2. 一个仓库每十分钟执行一次两分钟的任务，AUTO_SUSPEND 应怎样根据成本和冷启动权衡？
3. Resource Monitor 停止一个 Warehouse 后，为什么不能据此认定账户不会再产生计算费用？

## 参考资料

- [Overview of warehouses](https://docs.snowflake.com/en/user-guide/warehouses-overview)
- [Multi-cluster warehouses](https://docs.snowflake.com/en/user-guide/warehouses-multicluster)
- [Warehouse load history](https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_load_history)
