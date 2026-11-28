# Query Profile 与弹性计算取舍

## 本节要解决的问题

月末财务报表从 40 秒变成 9 分钟。团队有人建议把 Warehouse 从 Large 升到 4XL；另一个人建议直接启用 Multi-cluster；还有人认为只要开 Query Acceleration Service 就能解决。

这三个方案处理的瓶颈并不一样。Warehouse 变大可能给单条查询更多计算和内存资源；Multi-cluster 主要增加并发承载能力，减少查询排队；Query Acceleration 只对符合条件的部分查询有效。先找出时间花在哪里，再决定改 SQL、调 Warehouse、增加集群还是启用加速服务。

## 核心知识

### 先把总耗时拆开，不要一看到慢就扩容

一条查询的用户感知时间可能包含编译、Warehouse 排队、Provisioning、执行和结果返回。应先在 Query History 查看：

- COMPILATION_TIME：编译和优化耗时。
- QUEUED_OVERLOAD_TIME：因并发资源不足而排队的时间。
- QUEUED_PROVISIONING_TIME：等待 Warehouse 启动或扩容资源的时间。
- EXECUTION_TIME：查询执行时间。
- BYTES_SCANNED、PARTITIONS_SCANNED、PARTITIONS_TOTAL：扫描工作量。
- BYTES_SPILLED_TO_LOCAL_STORAGE、BYTES_SPILLED_TO_REMOTE_STORAGE：溢写规模。

以下查询适合做近 7 天的初步筛查：

~~~sql
SELECT
  query_id,
  query_text,
  warehouse_name,
  total_elapsed_time,
  compilation_time,
  queued_overload_time,
  queued_provisioning_time,
  execution_time,
  bytes_scanned,
  partitions_scanned,
  partitions_total,
  bytes_spilled_to_local_storage,
  bytes_spilled_to_remote_storage
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE start_time >= DATEADD(day, -7, CURRENT_TIMESTAMP())
  AND warehouse_name = 'FINANCE_WH'
  AND execution_status = 'SUCCESS'
ORDER BY total_elapsed_time DESC
LIMIT 100;
~~~

ACCOUNT_USAGE 有数据延迟，适合趋势分析和报表；要立刻检查刚执行的查询，使用 Snowsight Query History 或 Information Schema 的 QUERY_HISTORY 表函数。不要把一个延迟更新的 Account Usage 查询当成实时事故监控。

### Query Profile 告诉你执行计划在哪里消耗资源

在 Snowsight 打开 Query History，选择具体 Query ID，再进入 Query Profile。先沿执行图从扫描、过滤、Join、聚合、排序到结果输出查看算子，再检查每个算子的行数和耗时。

重点关注：

- TableScan：扫描了多少微分区、读取多少字节、过滤条件是否有效。
- Join：输入/输出行数是否大幅增加，是否发生 Fanout。
- Aggregate / Sort：是否需要处理远超业务输出规模的数据。
- Local / Remote Spill：中间结果是否超出可用内存，尤其是 Remote Spill。
- Queue：查询是否花时间等待 Warehouse，而不是执行 SQL。

也可以通过 GET_QUERY_OPERATOR_STATS 读取指定查询的算子级统计，便于把性能诊断自动化：

~~~sql
SELECT *
FROM TABLE(GET_QUERY_OPERATOR_STATS('01b12345-0000-1234-0000-000000000000'));
~~~

Query Profile 是单条查询的执行证据，不是整个 Warehouse 的并发容量视图。要判断排队是否来自并发，应结合 Warehouse Load History。

### Query Insights 可以指出常见问题，但它不是自动修复工具

Snowflake 在支持的查询上会显示 Query Insights，例如：
- 远程溢写：查询处理的数据超出 Warehouse 可用内存，部分数据溢写到存储。
- Warehouse 排队时间过长：并发请求超过当前集群可承载能力。
- Filter 不够有选择性：过滤条件没有有效减少扫描或中间结果。
- Join 扩行：Join 输出行数明显高于输入，可能是键不唯一或关系基数与预期不符。

Insight 会给出可能原因和建议，但仍需检查数据模型、过滤条件和业务粒度。比如 Join 输出行数增加可能是合法的一对多关系，也可能是错误键导致重复累计。不能因为界面显示 Fanout 就自动添加 DISTINCT。

### Warehouse 向上扩容与 Multi-cluster 解决不同问题

**向上扩容（Resize）** 增加单个 Warehouse 的计算和内存资源，适合执行阶段受资源限制、出现显著溢写或大型查询需要更多并行处理能力的场景。它不一定能修复低选择性过滤、重复 Join 或糟糕的 SQL 计划。

**Multi-cluster Warehouse** 增加并发集群，主要用于多个查询同时排队、并发需求波动的场景。它不是把一条查询拆给多个集群一起执行，也不能保证单条查询的执行时间明显下降。

| 现象 | 优先检查/尝试 | 不应先做的事 |
|---|---|---|
| 单条查询执行时间长、Remote Spill 明显 | 检查 Join/Sort/Aggregate，减少输入，再试更大 Warehouse | 直接增加 Multi-cluster |
| 大量查询 Queued Overload | 检查并发模式、任务集中启动和 Warehouse Load；评估 Multi-cluster 或隔离工作负载 | 仅把 Warehouse 从 Large 调到 X-Large |
| 扫描微分区比例很高 | 检查过滤表达式、聚类、投影列和数据布局 | 盲目增加集群 |
| 只有部分选择性查询慢且符合条件 | 检查 QAS eligibility 和 Query Acceleration | 假设 QAS 会加速所有 SQL |
| 编译时间异常 | 检查 SQL 复杂度、对象/视图层数和生成 SQL | 扩大 Warehouse |

### Query Acceleration Service 只适用于符合条件的查询

QAS 可以把部分符合条件的查询处理工作分流到共享计算资源，常见目标是具有大量扫描和选择性过滤的查询。它并不是给每条 SQL 都增加一台并行 Warehouse。

是否 eligible 取决于查询形态、算子和过滤选择性。先在 Query Profile/Query Insights 中检查资格和实际加速情况，再比较启用前后的执行时间、扫描量和 Credits。即使某查询能够使用 QAS，也要确认加速收益是否大于额外计算成本。

## 工程实施步骤

1. 从用户反馈或 SLO 选出受影响的 Query ID，记录 SQL、参数、Role、Warehouse、数据快照和开始时间。
2. 将总耗时拆成编译、排队、Provisioning、执行和结果传输，确定主要耗时阶段。
3. 打开 Query Profile，检查扫描、Join、聚合、排序和 Spill；记录算子输入/输出行数。
4. 对 Join 扩行先检查连接键唯一性和业务粒度；对扫描量过大先检查过滤、列裁剪和分区裁剪。
5. 使用 Warehouse Load History 判断排队是否来自并发；如果多个工作负载互相影响，评估分离 Warehouse 或 Multi-cluster。
6. 若单条查询主要受执行资源限制，使用相同 SQL 和数据快照测试更大 Warehouse；一次只改变一个主要因素。
7. 若查询符合 QAS 条件，单独测试 QAS 开关，比较延迟、扫描量和 Credits。
8. 对每个方案记录冷/热缓存、并发数、执行次数和失败/重试，避免只用一次运行结果。
9. 为高成本查询设置回退条件，例如延迟没有改善、Credits 超过预算或其他工作负载受到影响。
10. 将诊断 SQL、Query Profile、改动、测试数据和结论纳入运行记录，后续回归时使用相同基线。

## 场景分析

FINANCE_WH 上 8 条报表同时启动，8:00 时出现大量 Queued Overload；其中一条报表即使排到执行，也因为大规模 Join 发生 Remote Spill。

这不是一个单一的 Warehouse 规格问题。先通过 Warehouse Load History 确认 8:00 并发尖峰，以及各查询的 Queued Overload 时间；再分别打开 Query Profile，查找哪条报表的 Join 输出行数异常、哪条发生远程溢写。

对并发问题，可评估 Multi-cluster Warehouse 或错峰调度；对单条重查询，先修复重复 Join、减少输入，再测试更大 Warehouse。若剩余查询属于 QAS 支持的选择性扫描模式，再独立评估 QAS。验收要同时看用户等待时间、查询执行时间、Credits 和其他工作负载的排队变化，而不只是确认某条查询变快。

## 常见误区

- **用 Warehouse 变大解决所有慢查询。** 排队、扫描、Join 扩行、溢写和编译是不同瓶颈。
- **把 Multi-cluster 当成单查询并行加速。** 它主要增加并发容量，单条查询的执行计划不会因此分摊到多个集群。
- **认为 Query Profile 只显示总耗时。** 算子行数、扫描、Join、排序和 Spill 才能帮助定位执行热点。
- **看到 Join 输出变多就加 DISTINCT。** 先确定关系基数和业务粒度，DISTINCT 可能掩盖建模错误并丢失合法数据。
- **认为 QAS 能加速所有查询。** 只有符合条件的查询才可能受益，还需评估额外 Credits。
- **只比较一次冷缓存与热缓存结果。** 性能对比要固定数据、缓存状态、Warehouse、参数和并发条件。
- **只看延迟不看 Credits。** 成本和对其他工作负载的影响也属于优化结果。

## 完成标准

- [ ] 能从 Query History 区分编译、排队、Provisioning 和执行时间。
- [ ] 能从 Query Profile 定位扫描、Join、聚合、排序和 Spill。
- [ ] 能区分向上扩容与 Multi-cluster 的适用场景。
- [ ] 能解释 Query Insights 的提示用途和限制。
- [ ] 能判断何时进一步评估 QAS，而不是默认启用。
- [ ] 能设计包含延迟、并发、Credits 和回退条件的性能实验。

## 自测

1. 一个查询执行阶段只花 10 秒，却在 Warehouse Queue 等了 90 秒。优先检查单个查询的 SQL，还是 Warehouse 并发？
2. Multi-cluster Warehouse 可以直接把一个 9 分钟 SQL 拆到多个 Cluster 同时执行吗？它主要解决什么问题？
3. Query Profile 中 Join 输出行数远大于输入行数。加 DISTINCT 之前应该检查什么？
4. 远程溢写持续发生，且过滤和 Join 粒度已经确认合理。下一步可以测试什么资源调整？
5. QAS 让查询快了 30%，但 Credits 增加一倍。是否应保留？还要比较哪些业务指标？

## 参考资料

- [Using Query Insights to improve performance](https://docs.snowflake.com/en/user-guide/query-insights)
- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [GET_QUERY_OPERATOR_STATS](https://docs.snowflake.com/en/sql-reference/functions/get_query_operator_stats)
- [Warehouse Load History](https://docs.snowflake.com/en/sql-reference/functions/warehouse_load_history)
- [Multi-cluster warehouses](https://docs.snowflake.com/en/user-guide/warehouses-multicluster)
- [Query Acceleration Service](https://docs.snowflake.com/en/user-guide/query-acceleration-service)
