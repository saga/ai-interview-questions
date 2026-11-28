# Warehouse、Query Profile 与成本根因诊断

## 先别把四分钟的查询直接换成四倍大的仓库

订单报表昨天运行 30 秒，今天变成 4 分钟。团队准备把 Warehouse 从 Large 改成 4X-Large，但没有人确认这四分钟到底花在排队、事务等待还是 SQL 执行上。

Snowflake 的 Query History 已经记录了这些阶段。先把总耗时拆开，才能决定要看 Warehouse Load，还是进入 Query Profile 查算子。

## 同样是慢，背后的等待完全不同

Query History 中几个时间字段尤其有用：

| 字段 | 表示什么 | 常见排查方向 |
| --- | --- | --- |
| COMPILATION_TIME | SQL 编译和计划阶段的时间 | 查询复杂度、反复生成动态 SQL |
| QUEUED_PROVISIONING_TIME | 等待 Warehouse 创建、恢复或扩容资源 | 仓库启动和扩容过程 |
| QUEUED_OVERLOAD_TIME | 因当前仓库负载过高而排队 | 并发峰值、资源争用 |
| TRANSACTION_BLOCKED_TIME | 被并发 DML 事务阻塞的时间 | 锁等待和事务生命周期 |
| EXECUTION_TIME | 实际执行计划的时间 | 扫描、Join、聚合、交换和 Spill |

如果报表主要在 QUEUED_OVERLOAD_TIME 上消耗时间，打开 Query Profile 看到的算子可能并没有问题；要是 EXECUTION_TIME 增加，则要进一步检查执行计划。事务阻塞高时，扩大 Warehouse 并不能释放另一事务持有的锁。

## 先用 Query ID 固定诊断对象

排查事故时，不要只按 SQL 文本搜索。相同 SQL 可能使用不同参数、Role、Warehouse、Session 设置和数据窗口。把 Query ID、Query Tag、执行用户、Role、Warehouse、参数以及业务数据范围保存下来，才能复现原始问题。

查询历史可以直接查看：

~~~sql
SELECT
  QUERY_ID,
  START_TIME,
  QUERY_TYPE,
  USER_NAME,
  ROLE_NAME,
  WAREHOUSE_NAME,
  COMPILATION_TIME,
  QUEUED_PROVISIONING_TIME,
  QUEUED_OVERLOAD_TIME,
  TRANSACTION_BLOCKED_TIME,
  EXECUTION_TIME,
  PARTITIONS_SCANNED,
  PARTITIONS_TOTAL,
  BYTES_SCANNED,
  BYTES_SPILLED_TO_LOCAL_STORAGE,
  BYTES_SPILLED_TO_REMOTE_STORAGE
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE START_TIME >= DATEADD('hour', -6, CURRENT_TIMESTAMP())
  AND QUERY_TYPE = 'SELECT'
ORDER BY START_TIME DESC
LIMIT 100;
~~~

ACCOUNT_USAGE 视图不是实时事故面板。QUERY_HISTORY 视图最多可能延迟约 45 分钟，Warehouse Load History 的数据延迟可能更长。刚刚发生的查询，优先用 Snowsight Query History 或 Information Schema 的 QUERY_HISTORY 表函数查看。

## Query Profile 要看算子的输入和输出

当 EXECUTION_TIME 明显增加，打开对应 Query ID 的 Query Profile。不要只看哪个算子颜色最深，先比较算子输入、输出和数据交换：

- Table Scan：查看扫描字节、扫描微分区比例和过滤效果。过滤条件没有裁剪到数据，往往会让下游算子处理更多行。
- Join：比较左右输入行数和 Join 输出行数。输出突然膨胀，通常应检查关联键是否唯一、Join 条件是否完整，或数据是否出现重复。
- Aggregate、Sort 和 Window：关注输入基数、分组数量及数据交换。高基数聚合或排序可能产生大量中间数据。
- Spill：查看本地或远程 Spill 字节，结合算子输入、Warehouse 资源和查询形态分析；Spill 是症状，不自动等于 Warehouse 太小。

需要将 Profile 指标纳入程序化分析时，可以使用 GET_QUERY_OPERATOR_STATS。它返回算子统计数据，但仍要把 JSON 指标与具体 Query ID、SQL 版本和业务结果关联起来。

## 回到订单报表：先排除 Join 放大

Query History 显示，这条报表的执行时间增加，而排队时间基本不变。Query Profile 又显示 Join 输出行数是原来的十倍，扫描的微分区数量也显著增加。

这时应先检查客户维表是否出现重复键、订单表是否重复摄取，以及日期过滤条件是否仍然有效。若 Join 基数放大，扩大 Warehouse 只会更快地处理更多冗余行。

修正后不能只看耗时下降。还要核对订单数、客户数和金额汇总，确认业务结果与预期一致。若排队时间也在增长，则另开一条容量调查；单条查询可以同时有计划退化和并发竞争，但两种根因要分别拿证据。

## 仓库负载和费用数据补充另一半答案

Query Profile 解释一条 SQL 怎样执行，Warehouse Load History 观察一段时间的仓库负载，Warehouse Metering History 记录仓库 Credit 使用。三者回答的是不同问题，不能互相替代。

ACCOUNT_USAGE 的历史数据有延迟，适合做事后容量分析和趋势比较。实时事故则先从 Snowsight 或 Information Schema 取证。查询级费用归因也不等于账户全部费用：空闲 Warehouse、Serverless 服务、存储和数据传输应分别观察。

## 怎样验证一次优化真的有效

每次只验证一个主要假设。例如先修复 Join Key，再保持数据窗口和参数不变进行对照；不要同时更改 SQL、Warehouse Size 和缓存条件，否则无法判断哪项变更起作用。

比较至少包含 p50/p95 耗时、排队时间、扫描字节、Spill、Credit 和结果正确性。对关键报表还要保留 Query ID、SQL 版本和验收结果，以便后续回归时复用。

## 常见误判

- 总耗时增加，不代表算子执行变慢。
- Join 输出行数膨胀，应先查基数和关联条件，而不是直接扩仓。
- Spill 既可能与仓库规格有关，也可能来自查询中间结果过大。
- 扫描微分区多，要结合过滤条件、选择性和数据分布判断。
- 查询级 Credit 不能代表所有账户费用。

## 自测

1. QUEUED_OVERLOAD_TIME 很高，但 Query Profile 的执行算子正常。应该先看哪些仓库负载证据？
2. Join 输出行数突然放大十倍，哪两类数据问题最值得先排查？
3. ACCOUNT_USAGE.QUERY_HISTORY 没有刚执行的 Query ID，是否说明查询没有运行？应改用什么观察入口？
4. 优化后查询从 4 分钟降到 40 秒，但订单金额也下降了。为什么不能判定优化完成？

## 参考资料

- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [QUERY_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/query_history)
- [WAREHOUSE_LOAD_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_load_history)
- [GET_QUERY_OPERATOR_STATS](https://docs.snowflake.com/en/sql-reference/functions/get_query_operator_stats)
