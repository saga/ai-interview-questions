# 查询历史与运行状态

## 本节要解决的问题

通过 Query History 查明一条 SQL 是否提交、何时开始执行、使用哪个 Warehouse、由谁执行、是否失败，以及时间花在哪里。需要区分即时排查和长期历史分析：Snowsight、Information Schema 表函数与 ACCOUNT_USAGE 视图的数据范围和延迟并不相同。

## 核心知识

### Query History 记录语句执行元数据

Query History 可以按时间、用户、Session、Warehouse、状态等维度查询 SQL 执行记录。重要字段包括 QUERY_ID、QUERY_TEXT、USER_NAME、ROLE_NAME、WAREHOUSE_NAME、START_TIME、END_TIME、EXECUTION_STATUS、ERROR_CODE 和 ERROR_MESSAGE。

也可以检查编译、排队、执行时间以及扫描微分区等性能字段。Query History 适合回答“发生了什么”，但不直接展示每个算子的详细执行路径。

### Information Schema 与 ACCOUNT_USAGE 的适用窗口不同

Information Schema 的 QUERY_HISTORY 表函数面向最近活动，查询范围限制在最近 7 天，适合较及时的排查。SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY 可查询最近 365 天的记录，但视图存在数据延迟，官方文档说明最高约 45 分钟。事故刚发生时不要假设 Account Usage 已经完整更新。

使用 ACCOUNT_USAGE 时应明确时间过滤并只选择需要的列，避免全表扫描历史记录。访问视图还需要相应 SNOWFLAKE 数据库权限。

### Query History 与 Query Profile 配合定位原因

Query History 提供状态、耗时和汇总性能指标；Query Profile 展示算子及其数据流，适合继续定位扫描、Join、聚合、排序、网络传输和溢写等阶段。排队时间明显时，还需要结合 Warehouse Load History，避免把仓库过载误判为 SQL 执行本身很慢。

## 工程实施步骤

1. **锁定查询。** 优先用 Query ID；没有 Query ID 时用时间范围、用户、Warehouse、Session 和 SQL 文本特征缩小范围。
2. **先检查即时视图。** 在 Snowsight Query History 查状态与错误；必要时使用 Information Schema QUERY_HISTORY 表函数查看最近七天。
3. **检查长期记录。** 使用 ACCOUNT_USAGE.QUERY_HISTORY 对比跨天、跨周或发布前后的查询表现，注意其延迟与历史保留范围。
4. **拆分时间。** 分别检查 COMPILATION_TIME、EXECUTION_TIME、QUEUED_PROVISIONING_TIME、QUEUED_OVERLOAD_TIME 和 TRANSACTION_BLOCKED_TIME，判断时间花在编译、仓库恢复、资源排队还是事务阻塞。
5. **继续看 Profile。** 对执行时间异常的查询打开 Query Profile，检查扫描量、Join 输入行数、过滤效率、溢写和最耗时的算子。
6. **检查运行上下文。** 核对用户、Role、Warehouse、Database、Schema、Query Tag 和会话参数，确保比较的是同一类工作负载。
7. **把异常转成行动。** 错误码对应权限、对象、类型或 SQL 问题；排队对应仓库负载；执行算子过慢则进一步分析查询计划或数据布局。
8. **保留可重放证据。** 记录 Query ID、SQL 版本、参数、运行上下文和观察时间窗，避免只保存截图或口头描述。

示例：按 Warehouse 汇总最近 24 小时的失败查询和排队时间。

~~~sql
SELECT
  warehouse_name,
  execution_status,
  COUNT(*) AS query_count,
  AVG(queued_overload_time) AS avg_overload_ms,
  SUM(execution_time) AS total_execution_ms
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE start_time >= DATEADD(hour, -24, CURRENT_TIMESTAMP())
GROUP BY warehouse_name, execution_status
ORDER BY query_count DESC;
~~~

## 场景分析

上午 10 点后，某个批处理任务看起来“卡住”。开发人员只看到客户端一直等待，准备重启应用。

先用运行时刻、用户和 Warehouse 找到 Query ID。若状态显示正在排队，检查 QUEUED_OVERLOAD_TIME 与 Warehouse Load History；若查询执行时间很长，再打开 Query Profile；若状态为失败，先读取 ERROR_CODE/ERROR_MESSAGE 并检查相关对象、角色和参数。应用重启可能会中断客户端连接，但不能自动释放被阻塞的事务或修复仓库容量。

事故记录应包括查询 ID、状态、关键时间字段、Profile 证据、采取的动作和恢复结果。这样下一次可以比较同一 SQL 的执行行为，而不是仅凭用户感知判断是否变慢。

## 常见误区

- **把 Query History 当作完整执行计划。** 它主要记录查询级元数据，算子级分析应继续看 Query Profile。
- **要求 Account Usage 实时反映刚执行的查询。** 其历史视图有延迟；即时排查优先使用 Snowsight 或 Information Schema。
- **将总耗时全部算作 SQL 执行时间。** 编译、仓库恢复、过载排队、事务阻塞和结果传输可能占用明显时间。
- **只按 SQL 文本检索。** 相同文本可能由不同用户、角色、Session 或 Warehouse 执行，应结合上下文过滤。
- **排队或失败时先重启客户端。** 应先确认服务端查询状态、Query ID 和事务情况。

## 完成标准

- [ ] 能使用 Query ID 或上下文条件定位查询。
- [ ] 能说明 Information Schema 与 ACCOUNT_USAGE 的时间窗口和延迟差异。
- [ ] 能从查询级时间字段判断编译、排队、执行和事务阻塞。
- [ ] 能判断何时需要打开 Query Profile 或 Warehouse Load History。
- [ ] 能整理可供复盘的 Query ID 和运行证据。

## 自测

1. 刚执行的查询没有出现在 ACCOUNT_USAGE.QUERY_HISTORY 中，是否一定表示它没有执行？应该改用什么方式查看？
2. QUEUED_OVERLOAD_TIME 很高而 EXECUTION_TIME 较低，问题更可能位于 SQL 算子还是仓库负载？
3. Query History 显示执行时间长，但无法从汇总字段判断具体慢算子，下一步应查看什么？

## 参考资料

- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [QUERY_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/query_history)
- [WAREHOUSE_LOAD_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_load_history)
