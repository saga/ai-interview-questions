# Cortex Code SQL 排障：把性能建议变成可复现实验

## Agent 说“加大 Warehouse”之前，先拿到 Query ID

一条日报查询从 15 秒变成 4 分钟。Cortex Code 读了 SQL 后建议把 Warehouse 从 Medium 调到 Large。这个建议可能正确，也可能完全无关：查询可能在排队、扫描更多微分区、Join 放大，或被另一个事务阻塞。

SQL 排障应该从 Query ID 和运行证据开始。Cortex Code 在 Standard mode 下可使用 Snowflake 数据工具；Code mode 则关闭这些数据工具。若当前会话不能访问账户查询历史，就应明确要求用户提供 Query ID 或由有权限的角色执行查询，而不是声称已经检查过运行时数据。

## 将总耗时拆开看

先查看 Query History 的排队时间、执行时间、扫描字节、扫描分区、Spill 和 Warehouse。不同阶段对应不同假设：

- 排队时间高：查 Warehouse 并发、集群负载和启动恢复。
- 执行时间高：进入 Query Profile，看 Scan、Join、Aggregate、Sort 和交换节点。
- Join 输出行数远超输入：检查关联键重复、多对多关系和 Join 谓词。
- 扫描微分区比例高：检查过滤条件、数据布局和聚簇情况。
- 远程 Spill 高：结合算子中间结果、Warehouse 规格和查询形状分析。

总耗时本身不能证明资源不足。若主要耗时来自事务等待，增加 Warehouse 也不会解除另一个事务的锁。

## 先固定基线，再验证一个假设

比较前固定 Query ID、SQL 文本和参数、数据窗口、Warehouse、Role、并发窗口以及缓存条件。保留原始 Query Profile 或可复查的查询历史。否则，一次热缓存结果与一次冷缓存结果的差异可能被误认为优化收益。

示例查询可以从 Query History 中找出扫描较多的报表：

~~~sql
SELECT
  QUERY_ID,
  START_TIME,
  WAREHOUSE_NAME,
  QUEUED_OVERLOAD_TIME,
  EXECUTION_TIME,
  BYTES_SCANNED,
  PARTITIONS_SCANNED,
  PARTITIONS_TOTAL,
  BYTES_SPILLED_TO_LOCAL_STORAGE,
  BYTES_SPILLED_TO_REMOTE_STORAGE
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE START_TIME >= DATEADD('hour', -6, CURRENT_TIMESTAMP())
  AND QUERY_TYPE = 'SELECT'
ORDER BY START_TIME DESC
LIMIT 50;
~~~

ACCOUNT_USAGE 视图会延迟，适合趋势和事后分析；刚发生的故障应使用 Snowsight Query History 或 Information Schema 的查询历史函数。Agent 不能把“视图还没有记录”解释为“查询没有执行”。

## Query Profile 中最值得看的不是颜色

Table Scan 要看读了多少分区、多少字节，以及过滤掉多少行。Join 要比较两侧输入行数和输出行数；输出突然增加时先检查关联键和数据重复。Aggregate/Sort 要看分组基数、中间结果和数据交换。Spill 需要结合输入量和仓库资源判断，不能看到 Spill 就直接升仓。

需要把算子指标自动化分析时，可用 GET_QUERY_OPERATOR_STATS 获取指定 Query ID 的算子统计。任何自动建议都必须对应具体计划节点，说明观察到的指标、假设以及如何复现。

## 用一次修复说明验证要求

假设 Query Profile 显示客户维表 Join 后，行数从 2,000 万放大到 8,000 万。Cortex Code 可以建议检查 CUSTOMER_ID 是否唯一，但不能只改成 SELECT DISTINCT 就宣告修复。应先验证主键重复，再确认业务上每个订单是否只对应一个客户；若维表有历史版本，还要明确有效期 Join 条件。

修复后比较行数、金额、客户数和业务口径，再比较耗时、扫描和 Credit。语义正确性和性能改善是两个验收条件。少算了数据的查询即使快十倍，也不是优化成功。

## 把性能建议限制在可执行的范围

让 Agent 每次只提出一个主要假设，并明确建议属于 SQL 重写、数据布局、Warehouse 资源还是任务调度。任何可能改变成本、权限或生产对象的操作先生成 Diff 或命令草案，不要直接执行。对照实验应使用隔离 Warehouse 和受控数据范围。

## 参考资料

- [Exploring query execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [Query History](https://docs.snowflake.com/en/user-guide/ui-query-history)
- [GET_QUERY_OPERATOR_STATS](https://docs.snowflake.com/en/sql-reference/functions/get_query_operator_stats)
- [Cortex Code CLI code mode](https://docs.snowflake.com/en/user-guide/cortex-code/code-mode)
