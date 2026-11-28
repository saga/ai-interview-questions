# Warehouse、Query Profile 与成本根因诊断

## 本节要解决的问题

把“查询变慢”“报表偶尔超时”和“Warehouse 费用上涨”转成可验证的根因分析。一次诊断至少要回答三个问题：用户等待发生在哪个执行阶段、哪个算子消耗了主要资源，以及资源变化是否足以解释性能和成本变化。

## 核心知识

### 查询总耗时需要按阶段拆解

Query History 记录编译、仓库预配等待、过载队列、事务阻塞和执行耗时。QUEUED_OVERLOAD_TIME 高通常指向并发负载，QUEUED_PROVISIONING_TIME 高则应检查仓库启动/扩容；TRANSACTION_BLOCKED_TIME 高应检查锁等待。EXECUTION_TIME 高才需要重点进入 Query Profile 观察算子。

同样的 SQL 文本可能因参数、数据规模、角色、Warehouse、Session 配置和缓存状态不同而有不同表现。诊断应使用 Query ID、Query Tag、参数化查询 hash 和实际执行上下文，而不是只按 SQL 字符串搜索。

### Query Profile 用算子输入输出和数据量找根因

扫描算子要看读取字节、微分区裁剪和过滤效果；Join 算子要看左右输入与输出行数，过度膨胀通常意味着 Join Key 重复或关联条件不完整；Aggregate/Sort/Window 要看输入基数和数据交换；Spill 则提示中间结果需要落到本地或远程存储，需要结合执行计划与仓库资源分析。

Profile 显示的是执行结果统计，不代表 SQL 语义正确。每项改写都应确认结果集、关键业务汇总和行数与原方案一致。

### 仓库负载与费用视图补充执行计划之外的信息

WAREHOUSE_LOAD_HISTORY 以 5 分钟为粒度提供运行、过载排队、预配等待和事务阻塞负载。它适合历史容量分析，但有数据延迟；即时事故可优先使用 Snowsight 和 Information Schema。WAREHOUSE_METERING_HISTORY 观察仓库小时级 credits，查询级归因用于定位昂贵 SQL。三类数据分别回答计划、容量与费用问题。

## 工程实施步骤

1. 收集问题时间范围、Query ID、SQL 版本、参数、用户、Role、Warehouse、Query Tag 和业务数据范围。
2. 在 Query History 中拆分 compilation、provisioning、overload、transaction blocked 和 execution 时间。
3. 对 execution_time 异常的查询打开 Query Profile，记录扫描、Join、聚合、排序、交换和 spill 算子数据。
4. 对 queued_overload_time 异常的查询，检查 Warehouse Load History 峰值与并发工作负载；对 provisioning 异常检查 Resume/扩缩容。
5. 对 transaction_blocked_time 异常的查询，检查 LOCK_WAIT_HISTORY、事务和并发 DML，而不是先扩大仓库。
6. 根据证据提出单一优化假设：减少扫描、修正 Join 基数、降低并发竞争、调整 Warehouse 或优化暂停策略。
7. 通过同一数据时间窗、参数、SQL 语义和缓存条件复测，并核对结果行数、关键金额和其他业务指标。
8. 对比性能和成本：p50/p95、排队、扫描字节、spill、credits、查询调用次数和单位业务产出。
9. 将 Query ID、Profile 截图/证据、SQL 版本和测试结果纳入故障记录，供下次回归比较。

## 场景分析

订单报表从 30 秒变成 4 分钟，团队准备把仓库从 Large 改成 4X-Large。Query History 显示执行时间增长，而排队时间基本不变。Query Profile 显示 Join 输出行数增长到原来的十倍，扫描的微分区数量也显著增加。

先检查最近数据是否出现重复订单、Join Key 是否仍唯一、日期过滤是否有效裁剪。若 Join 逻辑发生基数放大，扩大仓库只会更快处理错误或冗余数据；应先修正 SQL 或数据质量。优化后核对订单数、客户数和金额汇总，再比较 Query Profile 和 p95。

若排队时间同时增长，则另行评估 Warehouse 容量。一个查询可能同时存在 SQL 计划退化和并发竞争，但两者需要独立证据和验收。

## 常见误区

- **总耗时增加就认为 SQL 算子变慢。** 编译、恢复、过载队列和事务等待可能占据主要时间。
- **看到 Join 很慢就直接增加 Warehouse。** 先检查 Join 输入输出基数和关联条件。
- **把 spill 直接解释为仓库太小。** 中间数据量、排序、聚合和 Join 计划也可能导致 spill。
- **认为扫描微分区多一定是表设计问题。** 需要同时检查谓词、查询选择性和数据分布。
- **优化后只看耗时，不核对结果。** 性能提升不证明 SQL 语义保持正确。
- **把查询级 credits 当作所有费用。** 仓库空闲和 Serverless、存储等费用需要另行核对。

## 完成标准

- [ ] 能拆分查询编译、排队、执行和事务阻塞时间。
- [ ] 能用 Query Profile 识别扫描、Join、聚合和 spill 瓶颈。
- [ ] 能用 Warehouse Load History 判断容量与并发问题。
- [ ] 能将诊断结果转成单一可验证的优化假设。
- [ ] 能同时用结果正确性、延迟与成本验收。

## 自测

1. Query History 显示 QUEUED_OVERLOAD_TIME 很高，但 Query Profile 算子执行正常，应先检查什么？
2. Join 输出行数异常膨胀，可能有哪些数据或 SQL 原因？
3. 执行时间增长且扫描微分区数量上升，如何判断是数据分布变化还是过滤逻辑失效？
4. 一次优化让查询从 4 分钟下降到 40 秒，但订单金额也发生变化，是否可以判定优化完成？

## 参考资料

- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [QUERY_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/query_history)
- [WAREHOUSE_LOAD_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_load_history)
- [GET_QUERY_OPERATOR_STATS](https://docs.snowflake.com/en/sql-reference/functions/get_query_operator_stats)
