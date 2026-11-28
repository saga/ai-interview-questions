# Query Profile 与查询根因诊断

## 本节要解决的问题

面对同一类查询突然变慢或运行时间持续增长，建立从 Query History 到 Query Profile、从算子证据到修复验证的诊断流程。目标是区分 SQL 计划退化、扫描范围扩大、数据基数变化、Warehouse 排队和事务阻塞。

## 核心知识

### 先确认慢在执行前、执行中还是执行后

总耗时包含多个阶段。COMPILATION_TIME 反映编译；QUEUED_PROVISIONING_TIME 表示等待仓库恢复或预配；QUEUED_OVERLOAD_TIME 表示仓库负载造成的排队；TRANSACTION_BLOCKED_TIME 表示并发 DML 锁等待；EXECUTION_TIME 才是执行阶段的主要耗时。

第一步不要直接修改 SQL。先用 Query History 判断异常时间来自哪一段，再决定是否要进入 Query Profile 或 Warehouse Load History。

### 使用算子和数据量定位真正的瓶颈

Query Profile 能显示扫描、过滤、Join、Aggregate、Sort、Window 和数据交换等算子，以及它们的输入输出行数和执行统计。诊断要关注“数据在哪里膨胀、哪里被过滤、哪里发生 spill”，而不仅是最深或最显眼的算子。

扫描数据量增长时，检查谓词选择性、微分区裁剪和读列数量；Join 输出行数异常时，检查关联键重复、缺失条件和数据粒度；大量本地/远程 spill 时，检查中间结果规模和算子计划，同时评估 Warehouse 资源。

### 优化必须验证结果语义和代表性工作负载

SQL 改写、仓库调大、Search Optimization 或 Query Acceleration 等动作影响路径不同。先提出一个基于 Profile 的假设，每次只改变一个关键因素；用同一数据范围、参数、并发、仓库规格和缓存条件复测，并确认业务结果一致。

## 工程实施步骤

1. 收集基线 Query ID、SQL 文本、参数、执行角色、Warehouse、Query Tag 和数据时间窗口。
2. 对比历史执行的编译、排队、执行和事务阻塞时间，判断变化最明显的阶段。
3. 打开 Query Profile，找出扫描量、Join 输出、聚合输入、数据交换和 spill 出现异常的算子。
4. 将算子异常转成单一可验证假设，例如某个日期过滤没有有效裁剪，或 Join Key 的基数发生改变。
5. 修改 SQL 或数据布局前先验证结果集与业务汇总；修改 Warehouse 前先确认主要问题不是过载等待或锁等待。
6. 使用 QUERY_HISTORY 和 WAREHOUSE_LOAD_HISTORY 检查优化前后的排队、执行和仓库负载。
7. 用相同参数、数据规模、时间窗和并发复测 p50/p95、扫描字节、Partitions Scanned、spill、credits 和结果一致性。
8. 如果性能问题仍不能解释，保留 Query Profile 证据、SQL、Query ID 和重现条件，按 Snowflake 支持流程升级。

## 场景分析

一条月度销售报表原本运行 40 秒，最近变为 5 分钟。Query History 显示排队时间基本没变，执行时间明显上升。Query Profile 中扫描行数增长，同时 Join 输出行数比历史基线高出数倍。

应先检查过滤列和数据写入分布是否改变，再检查 Join Key 是否出现重复或缺失关联条件。扩大 Warehouse 可能让计算更快，但无法修复错误的 Join 粒度，也可能增加成本。优化后比较扫描量、Join 输出行数、最终销售额和客户数，确保指标没有因为 SQL 改写而改变。

若 Query History 反而显示 QUEUED_OVERLOAD_TIME 增长，则应并行检查仓库并发，而不是把所有问题归因于 Profile 中的执行算子。

## 常见误区

- **将总时延等同于执行算子耗时。** 编译、仓库恢复、过载队列与事务锁等待需要分开分析。
- **只看最耗时的算子，不看输入输出基数。** 高成本节点的根因可能在上游数据膨胀。
- **看到 spill 就直接调大 Warehouse。** SQL 中间结果、Join 基数和聚合方式也会导致 spill。
- **把 Query Profile 当成 SQL 语义证明。** 性能变好仍需通过结果对账证明计算正确。
- **一次同时改 SQL、仓库规格和聚簇键。** 同时改变多个变量会让优化效果无法归因。

## 完成标准

- [ ] 能区分编译、排队、执行和事务阻塞时间。
- [ ] 能从 Query Profile 定位扫描、Join、聚合和 spill 的异常。
- [ ] 能把算子证据转成一次只修改一个变量的优化假设。
- [ ] 能用 Query History 和 Warehouse Load History 排除容量等待因素。
- [ ] 能通过结果对账、延迟和成本共同验收优化。

## 自测

1. Query History 显示 QUEUED_OVERLOAD_TIME 上升，但 Query Profile 的算子耗时没有变化，应该先调查什么？
2. Join 输出行数远高于输入行数，哪些数据与 SQL 特征可能造成这种放大？
3. spill 明显增加，但 Warehouse 没有排队，如何判断是资源、SQL 还是输入基数问题？
4. 优化后 p95 从五分钟降到一分钟，但结果金额也发生变化，是否可以宣布优化成功？

## 参考资料

- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [QUERY_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/query_history)
- [GET_QUERY_OPERATOR_STATS](https://docs.snowflake.com/en/sql-reference/functions/get_query_operator_stats)
