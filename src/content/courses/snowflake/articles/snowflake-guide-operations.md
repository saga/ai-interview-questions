# 运行准备度、告警与持续改进

## 本节要解决的问题

财务每天早上 8 点要用订单和退款数据出报表。某天 8:20，Dashboard 仍显示昨天的数据；Task History 却显示所有任务都成功了。运维团队先重启 Warehouse，数据仍没更新。最后发现退款源文件晚到，负责汇总的 Dynamic Table 没有包含这批新数据。

“任务成功”只说明某次执行返回成功；“仓库可用”只说明计算资源能够运行。业务服务是否可用，还要看数据是否齐全、刷新是否按目标推进、指标是否正确，以及发生故障时有没有人负责处理。

本节用一条每日结算管道说明怎样定义运行目标、监控 Snowflake 作业、设计告警和组织故障响应。

## 核心知识

### 用业务结果定义 SLO，而不是只监控 Snowflake 对象状态

数据产品的运行目标应该描述用户实际得到什么：

| 目标 | 示例 SLO | 需要观察的证据 |
|---|---|---|
| 新鲜度 | 工作日 08:00 前发布前一业务日的完整数据 | 源批次到齐时间、Dynamic Table data timestamp、发布完成时间 |
| 完整性 | 每个来源批次的输入、成功、拒绝记录数量可对账 | 源清单、加载历史、拒绝行和目标行数 |
| 正确性 | 订单数、金额、退款金额与源系统控制总额在约定容差内 | 业务控制总额、重复键、空值与异常状态 |
| 可用性 | 业务用户能读取当天已发布的 Gold 数据集 | 访问测试、服务错误率和数据发布状态 |
| 成本 | 月度 Warehouse Credits 在预算范围内 | Warehouse 消耗、任务执行时间和空闲成本 |

上表数字和时间窗口应由业务 owner 确认。不要把所有问题都转成 CPU、Warehouse Running 或 SQL 成功率。用户关心的是报表是否按时、完整、可信地交付。

还要区分 Snowflake 功能的目标参数与业务 SLO。例如 Dynamic Table 的 TARGET_LAG 是新鲜度目标，不是业务 SLA；即使 Dynamic Table 保持 SUCCEEDED 状态，也不代表上游文件齐全或业务数据对账通过。

### 不同执行类型要看不同的运行历史

如果管道由 Tasks 执行，可以从 TASK_HISTORY 查看调度时间、状态和错误：

~~~sql
SELECT
  name,
  state,
  scheduled_time,
  query_start_time,
  completed_time,
  error_code,
  error_message
FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY(
  SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()),
  RESULT_LIMIT => 1000
))
WHERE state <> 'SUCCEEDED'
ORDER BY scheduled_time DESC;
~~~

如果使用 Dynamic Tables，则看刷新状态、刷新数据时间和失败原因：

~~~sql
SELECT
  name,
  state,
  state_message,
  refresh_trigger,
  refresh_action,
  data_timestamp,
  refresh_start_time,
  refresh_end_time,
  DATEDIFF('second', refresh_start_time, refresh_end_time) AS duration_sec
FROM TABLE(INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY(
  NAME_PREFIX => 'ANALYTICS.MART'
))
ORDER BY data_timestamp DESC
LIMIT 50;
~~~

Task History 回答任务有没有运行、何时结束、错误是什么；Dynamic Table Refresh History 回答结果表刷新到哪个数据时间、是增量还是全量、为什么失败或被跳过。它们不能互相替代。

另外，ACCOUNT_USAGE 历史视图有数据延迟。事故发生后需要立即定位时，优先使用 Snowsight 实时 Query History、Information Schema Table Functions 和对象自身的状态，不要等 Account Usage 汇总视图更新后才开始排查。

### 把告警分成单次失败、持续退化和业务数据异常

告警至少分三种：

- **执行失败**：Task 报错、Dynamic Table 刷新失败、Warehouse 无法启动。需要错误码、Query ID 和负责人。
- **持续退化**：任务仍成功，但执行时间持续增长、Dynamic Table lag 越来越大、Warehouse 排队增加。需要趋势和阈值。
- **业务异常**：任务成功但源批次缺失、金额对账不平、重复订单增加或拒绝行暴涨。需要数据质量规则和业务责任人。

Snowflake 可以用 Task Alert 监测 Task 错误率，也可以用 ERROR_INTEGRATION 将单次 Task 失败事件推送到云消息服务。前者适合发现持续失败率越界；后者适合每次失败都触发外部响应。Task Alert 需要任务的 LOG_EVENT_LEVEL 设置为 INFO，确保成功与失败事件都记录下来。

不要让每一次轻微延迟都升级成 Pager；也不要只按失败次数告警。业务告警要包含受影响的数据集、业务日期、数据新鲜度、最后成功批次和应采取的动作。

### Query History 和 Query Profile 帮助区分慢查询、排队和资源问题

同样是报表变慢，原因可能不同：

- Warehouse 排队：并发需求超过当前集群容量，查询还没真正开始。
- 扫描和 Join 变慢：数据量、分区裁剪、Join 基数或统计信息发生变化。
- 远程溢写：排序或聚合所需的内存不足，部分数据溢写到存储。
- Warehouse 冷启动：刚从 Suspend 恢复，缓存尚未重新建立。
- 下游依赖未完成：查询本身很快，但上游任务还没发布新数据。

打开 Query History 的 Query Profile，查看执行计划中各算子耗时、扫描量、Join 输出行数、溢写和排队信息。ACCOUNT_USAGE.QUERY_HISTORY 适合长期趋势；它有数据延迟，且需要相应权限。不要把所有性能问题都归因于 Warehouse 太小，先确认瓶颈所在，再决定调整 SQL、聚类、并发或计算规模。

### 成本限制是保护措施，不是预算管理的全部

Resource Monitor 可以按 Credit Quota 触发通知、暂停 Warehouse。比如达到 80% 通知，达到 100% 暂停：

~~~sql
CREATE OR REPLACE RESOURCE MONITOR analytics_monthly_limit
  WITH CREDIT_QUOTA = 1000
  FREQUENCY = MONTHLY
  START_TIMESTAMP = IMMEDIATELY
  TRIGGERS
    ON 80 PERCENT DO NOTIFY
    ON 100 PERCENT DO SUSPEND;
~~~

再将 Monitor 绑定到指定 Warehouse：

~~~sql
ALTER WAREHOUSE transform_wh
  SET RESOURCE_MONITOR = analytics_monthly_limit;
~~~

暂停阈值要谨慎。100% SUSPEND 会阻止新查询，但当前执行中的查询可以完成；SUSPEND_IMMEDIATE 会立即终止正在运行的查询。对于财务结算或生产写入，不能只为控制费用而随意采用立即暂停。

Resource Monitor 也不能代替成本分析。团队还要按任务、Warehouse、用户和查询类型观察消耗，识别空转、重复刷新、过大 Warehouse 和低选择性查询。

## 工程实施步骤

1. 为每个数据产品定义业务 owner、用户、业务日期、发布时间和 SLO；将技术指标映射到用户可见结果。
2. 为每个来源记录批次到达、输入行数、拒绝行数、最后成功时间和数据完整性状态。
3. 对 Task 管道保存 TASK_HISTORY、Query ID 和任务错误；对 Dynamic Table 管道保存 Refresh History、data_timestamp 和 refresh duration。
4. 建立三类告警：单次执行失败、持续延迟/成本退化、业务质量和完整性异常。
5. 配置 Task Alerts 或 ERROR_INTEGRATION，并确认事件记录级别、通知集成、接收人和去重逻辑。
6. 从 Query History 和 Query Profile 中定位瓶颈，区分排队、扫描、Join、溢写和冷缓存。
7. 为关键 Warehouse 设置 Resource Monitor 通知和暂停阈值，明确生产任务被暂停后的业务影响。
8. 每次事故记录影响的数据产品、业务时间范围、最后正确数据时间、根因、恢复步骤和对账结果。
9. 恢复后重新验证输入批次、目标行数、业务控制总额和下游可见性，不能仅以 Task 状态恢复为结案。
10. 每月回顾 SLO 达成率、告警噪声、重复事故、查询成本和容量，调整任务架构与值班流程。

## 场景分析

某日 08:20，Dashboard 还显示前一日的数据。Task History 里所有任务均为 SUCCEEDED，但 Dynamic Table 的 DATA_TIMESTAMP 仍停留在 07:45；日志显示退款文件在 08:10 才到达。

这不是 Warehouse 故障。首先确认退款文件是否成功加载，其次确认 Dynamic Table 是否完成新的刷新，再检查 Gold 汇总是否包含该业务日期的退款。若 Dynamic Table 还在等待刷新，应在数据产品状态中标记“延迟”，而不是发布旧结果并显示正常。

恢复后对比订单金额、退款金额和净收入控制总额，确认结果与源系统一致。最后更新上游文件到达 SLO，或重新设计财务报表的等待窗口。若运营确实需要更早看到数据，可以发布“截至 07:45 的暂定数据”并明确标记，而不是把暂定结果伪装成完整结算。

## 常见误区

- **Task 成功就表示数据已经完整。** 任务只证明该次执行成功，仍要检查上游批次、下游刷新和业务对账。
- **Dynamic Table 状态 SUCCEEDED 就代表数据足够新。** 应检查 DATA_TIMESTAMP 与业务截止时间，而不只看最后一次刷新状态。
- **所有延迟都靠调大 Warehouse 解决。** 先区分排队、扫描、Join、溢写、冷缓存和上游迟到。
- **只按 SQL 失败次数告警。** 任务可能成功但业务金额错误或数据不完整。
- **Resource Monitor 达到阈值后立即暂停所有生产 Warehouse。** 暂停策略要考虑结算窗口、正在运行的任务和恢复路径。
- **事故恢复后只检查服务是否重新运行。** 还要核对业务日期、行数、金额和下游可见性。
- **把 ACCOUNT_USAGE 视图当成实时诊断工具。** 这些视图有延迟，实时排障要用更及时的历史函数和 Snowsight。

## 完成标准

- [ ] 能把数据产品 SLO 转成新鲜度、完整性、正确性、可用性和成本指标。
- [ ] 能使用 TASK_HISTORY 定位 Task 执行失败。
- [ ] 能使用 DYNAMIC_TABLE_REFRESH_HISTORY 检查数据时间戳和刷新错误。
- [ ] 能区分执行失败、持续退化和业务数据异常。
- [ ] 能用 Query Profile 区分排队、扫描、Join 和溢写问题。
- [ ] 能用 Resource Monitor 保护预算，并说明不同暂停动作的业务影响。

## 自测

1. Task History 全部显示 SUCCEEDED，但 Dashboard 仍是旧数据。你会先检查哪些刷新和上游证据？
2. Dynamic Table 的 STATE 是 SUCCEEDED，但 DATA_TIMESTAMP 落后业务截止时间 40 分钟。可以向用户宣布数据已完成吗？
3. Task Alert 和 ERROR_INTEGRATION 分别适合解决什么通知场景？Task Alert 为什么需要 INFO 事件级别？
4. Query Profile 显示查询大部分时间在排队，而不是扫描数据。调大 Warehouse 之外，还应检查什么？
5. Resource Monitor 在 100% DO SUSPEND 和 100% DO SUSPEND_IMMEDIATE 之间有什么区别？结算任务应如何选择？

## 参考资料

- [Monitor dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/monitoring)
- [DYNAMIC_TABLE_REFRESH_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/dynamic_table_refresh_history)
- [TASK_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/task_history)
- [Configure error alerts and notifications for tasks](https://docs.snowflake.com/en/user-guide/tasks-errors-integrate)
- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [Working with resource monitors](https://docs.snowflake.com/en/user-guide/resource-monitors)
