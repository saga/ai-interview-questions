# Query Profile 与 SQL 性能诊断

## 本节要解决的问题

使用 Query Profile 将慢查询拆成可定位的执行算子和数据流阶段，从而提出可以验证的优化假设。不要只看总耗时或直接放大 Warehouse；先确认时间花在扫描、过滤、Join、聚合、排序、数据交换、spill 还是仓库排队。

## 核心知识

### Query Profile 描述算子执行路径

在 Snowsight 的 Query History 中选择 Query ID，可查看 Query Profile。图中的算子表示扫描、过滤、Join、聚合、排序、结果生成等操作；边表示算子之间的数据流。每个算子可查看处理行数、扫描量、耗时等统计信息，帮助定位最昂贵的阶段。

Query Profile 展示的是执行后统计，不是 SQL 的逻辑文本顺序。优化应从高成本节点及其输入输出规模入手，而不是仅按 SQL 中子句的书写顺序猜测。

### 扫描、Join、聚合和 Spill 是常见的分析入口

扫描阶段先看读取了多少微分区和字节，以及过滤条件是否有效裁剪。Join 要看左右输入行数、输出行数和基数是否符合预期；输出规模异常膨胀通常需要检查 Join 条件和数据重复。聚合、排序和窗口操作需要观察输入规模与资源消耗。发生本地或远程 spill 时，说明中间数据未完全驻留在内存，需要结合算子和数据量分析。

### 执行计划需要与排队和缓存状态分开解释

Query Profile 主要解释执行阶段。总时延还可能包含编译、仓库恢复、过载排队、事务阻塞和结果传输。Query History 中的时间字段以及百分比扫描自缓存等指标可用于判断执行前等待和缓存影响。比较两次查询前必须控制数据、Warehouse、缓存和并发条件。

## 工程实施步骤

1. 选择一个有明确业务目标的慢查询，保存 Query ID、SQL、参数、Warehouse、执行角色和执行时间。
2. 打开 Query Profile，按算子耗时和数据流定位最昂贵节点；先找出扫描或输出行数明显异常的部分。
3. 对扫描过高的节点，检查过滤谓词、分区裁剪、选择列和数据分布；用 PARTITIONS_SCANNED / PARTITIONS_TOTAL 对照验证。
4. 对 Join 输入或输出行数异常的节点，检查 Join Key 唯一性、过滤位置和重复行；对比改写前后的结果集，确保语义等价。
5. 对 Aggregate、Sort 或 Window 节点，检查输入基数、分组粒度和是否存在不必要排序/重复计算。
6. 对 spill 节点，检查中间结果规模和算子计划，使用相同数据和并发测试更合适的 Warehouse 规格或 SQL 改写。
7. 从 Query History 单独检查编译、排队和执行耗时，避免将仓库过载误判为算子低效。
8. 在相同数据、SQL 参数、Warehouse 规格和缓存条件下重跑，比较总时延、算子耗时、扫描量、spill 和结果等价性。

## 场景分析

客户订单和订单明细表 Join 后再按客户统计金额。最近一周查询从 20 秒增长到 3 分钟，团队准备把 Warehouse 从 Large 调为 4X-Large。

先对照 Query Profile。若扫描行数显著增加，检查日期过滤是否在扫描阶段生效；若 Join 输出行数远大于两侧输入，检查 Join Key 是否不唯一或漏掉关联条件；若远程 spill 增长，再评估中间数据规模和仓库资源。Query History 如果显示明显 queued_overload_time，则需要独立评估仓库并发。

优化后必须验证客户数、订单数和金额汇总不变，并在相同数据窗口下比较扫描量、Join 输出行数、spill 和 p95 时延。若只有增加 Warehouse 规格后变快，但单位查询成本显著上升，就不一定是可接受的优化。

## 常见误区

- **只看 Query Profile 总时长。** 需要定位具体算子和数据流，另外把排队与执行时间区分开。
- **认为扫描微分区多就一定需要更大仓库。** 扫描过多通常要先检查过滤条件和数据组织。
- **Join 慢就先换 Join 算法。** 先检查输入基数、重复键和关联条件，很多问题来自数据语义。
- **spill 一定意味着 Warehouse 规格太小。** 还要检查中间结果规模、SQL 写法和 Join/聚合输入。
- **只比较一次优化前后的耗时。** 缓存、并发和数据分布会干扰结果，应使用可比基线并验证结果等价。

## 完成标准

- [ ] 能在 Snowsight 中通过 Query ID 打开 Query Profile。
- [ ] 能识别扫描、Join、聚合、排序和 spill 对性能的影响。
- [ ] 能结合 Query History 区分排队与执行瓶颈。
- [ ] 能把 Profile 证据转成可验证的 SQL 或资源优化假设。
- [ ] 能通过结果等价和性能指标验收优化。

## 自测

1. Query Profile 中 Join 的输出行数远高于两侧输入，应该先检查哪些 SQL 和数据特征？
2. 远程 spill 上升但执行前没有排队，应如何判断是否真的需要扩大 Warehouse？
3. 一次优化后时延降低，但扫描微分区数和业务结果也变化了，怎样确认这是合理优化而不是结果语义改变？

## 参考资料

- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [GET_QUERY_OPERATOR_STATS](https://docs.snowflake.com/en/sql-reference/functions/get_query_operator_stats)
- [QUERY_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/query_history)
