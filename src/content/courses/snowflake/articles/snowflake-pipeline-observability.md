# 管道可观测性：事件、日志、Trace 与告警

## 本节要解决的问题

当 Task 显示成功但下游没有数据，或数据已更新却出现业务对账差异时，需要把调度事件、查询执行、代码日志、Trace、质量指标和通知放在同一条诊断链路中。Snowflake 提供多种观察入口，它们记录的对象和时间窗口不同，不能用一个“任务状态”替代整条数据管道的健康状态。

## 核心知识

### 日志、Trace、指标和事件各有职责

- **Log** 记录代码在某个时间点输出的信息，例如异常、分支、外部请求结果和业务键。
- **Trace** 记录一次执行中的 Span 及其父子关系，用于定位跨函数、过程或调用步骤的耗时与错误。
- **Metric** 记录可聚合的测量值，用来观察执行次数、延迟、错误率或资源使用趋势。
- **Event** 描述系统或 Task 等对象发生的状态变化，例如任务开始、完成或失败。

在 Snowflake Handler 中，Logging、Tracing 和 Metrics 的采集需要配置 telemetry/event table，并设置相应 LOG_LEVEL、TRACE_LEVEL 和 METRIC_LEVEL。仅在代码中调用 logger 或 tracer 并不保证数据已被采集；若采集级别未启用，事件表中可能没有预期记录。

Event Table 适合保存代码遥测记录；Task 的执行事件可以写入关联的 Active Event Table，并通过 Alert 在出现失败事件时触发通知。事件表采集有费用，逐行 Handler 如果对每条数据都写日志，可能形成大量遥测数据。

### Task History 与 Event Table 观察不同层次

TASK_HISTORY 记录任务执行历史，适合按任务、执行时间、状态、QUERY_ID、错误和耗时查看运行情况。ACCOUNT_USAGE.TASK_HISTORY 覆盖较长历史但有数据延迟；Information Schema 的 Task History 表函数适合较近时间的排查。

Task event 记录会写入 Event Table，能够通过 resource_attributes、record 和 value 等字段关联任务名称、执行类型、严重级别和状态。Task event 的采集必须显式设置 LOG_EVENT_LEVEL；ERROR 记录失败运行，INFO 可记录成功和失败运行。Alert on new data 可监控 Event Table 新插入的失败事件。

此外，Query History 解释 SQL 查询状态与时间，Dynamic Table Refresh History 解释动态表刷新，Pipe Load History 解释文件摄取。任何单一历史视图都无法回答所有层次的问题。

### 数据质量和新鲜度是交付结果的证据

管道调度成功只说明执行器完成了触发和执行，并不证明目标表包含正确数据。需要检查源端到达、摄取完成、转换完成、目标表可见和消费者读取等时间点，并验证行数、业务键、金额汇总、拒绝记录与数据质量 Expectation。

DMF/Expectation 可以持续测量非空、重复、引用关系和其他质量指标；业务批次对账则需核对源文件数量、加载数量、拒绝数量和业务汇总。新鲜度应以实际数据时间戳衡量，而不是将 Task 的计划时间当作数据已更新的证明。

## 工程实施步骤

1. **画清管道阶段。** 记录 Source、Ingest、Transform、Target 和 Consumer 的组件、责任人、输入输出键和预期时效。
2. **统一关联标识。** 为批次、Task、Query、外部请求和目标数据保存 batch_id、QUERY_TAG、Query ID 与业务主键，确保日志和数据可相互追踪。
3. **启用遥测采集。** 为相关数据库配置 Event Table，在账户/对象级别设置适当 LOG_LEVEL、TRACE_LEVEL、METRIC_LEVEL；只采集诊断需要的等级和工作负载。
4. **采集 Task 状态事件。** 为目标 Task 设置 LOG_EVENT_LEVEL=ERROR 或 INFO；先查询 Event Table 确认实际字段和值，再建立 Alert on new data。
5. **关联执行历史。** 用 TASK_HISTORY 找到失败或异常运行的 Query ID，再通过 Query History 和 Query Profile 定位 SQL 执行阶段；对动态表或 Snowpipe 读取各自刷新/加载历史。
6. **定义数据交付指标。** 为每个批次记录 source_count、loaded_count、rejected_count、target_count、last_event_time 和业务汇总，定义缺失、重复、延迟和错误率阈值。
7. **分层设置质量门禁。** Raw 验证到达和加载完整性，Conformed 验证实体关系及标准化，Curated 验证指标口径和消费者契约。
8. **配置告警和升级。** 按失败类型路由给任务 owner、平台 owner 或数据 owner；告警内容包含任务、批次、Query ID、错误和受影响消费者。
9. **演练失败恢复。** 注入 Task 失败、源文件延迟、转换错误和目标表对账差异，验证告警可达、重试幂等、补数成功且状态可追踪。
10. **控制遥测成本。** 对高频 Handler 避免每行记录无意义日志；设置保留和清理策略，定期检查 Event Table 体量和采集级别。

示例：为某数据库的 Task 失败事件启用采集，并在事件表中查询。

~~~sql
ALTER DATABASE ANALYTICS
  SET LOG_EVENT_LEVEL = ERROR;

SELECT
  TIMESTAMP,
  RESOURCE_ATTRIBUTES:"snow.executable.name"::STRING AS TASK_NAME,
  VALUE:"state"::STRING AS TASK_STATE,
  VALUE:"query_id"::STRING AS QUERY_ID
FROM SNOWFLAKE.TELEMETRY.EVENTS
WHERE RESOURCE_ATTRIBUTES:"snow.executable.type"::STRING = 'TASK'
  AND VALUE:"state"::STRING = 'FAILED'
ORDER BY TIMESTAMP DESC;
~~~

示例中列路径需按当前事件类型与 Event Table schema 核对；生产环境还应确保查询角色有权访问 Event Table。

## 场景分析

订单数据管道中的 Task 显示 SUCCEEDED，但当日订单汇总少了 8%。单看 Task History 无法解释数据缺口，因为 SQL 执行本身没有报错。

先通过 Task History 找到执行批次和 Query ID，再检查原始文件到达记录、Pipe Load History、目标表加载行数和 batch_id。若摄取完整但转换结果不足，进入 Query Profile 检查过滤条件、Join 基数和异常行隔离。随后读取 Event Table 中关联的 Handler 日志和 Trace，定位是否发生了外部服务失败、分支跳过或异常重试。

若 Task 的成功事件已经写入 Event Table，仍需让批次数据质量对账独立阻断下游发布。修复后按原 batch_id 进行幂等回放，确认订单总数和金额恢复一致，再关闭事故。

## 常见误区

- **认为有日志就实现了端到端可观测。** 日志、Trace、Metric、Task Event 和数据质量应使用共同标识关联。
- **只看 Task 成功状态。** 任务可以成功执行错误的 SQL，或只处理了部分合法输入；必须检查数据交付结果。
- **启用日志代码后不配置采集级别。** Telemetry collection 和 Event Table 设置决定哪些记录会被保存。
- **把 TASK_HISTORY 当实时告警流。** ACCOUNT_USAGE 有延迟；近期失败可结合 Snowsight、Information Schema 和 Event Table。
- **无条件采集每一行的日志。** 大量 Handler 逐行日志会制造高基数、噪声和额外费用。
- **告警触发即视为事故处理完成。** 还需确认数据修复、重放、质量对账和消费者恢复。

## 完成标准

- [ ] 能区分日志、Trace、Metric 和 Event 的使用目的。
- [ ] 能说明 Event Table、LOG_EVENT_LEVEL 与 Handler telemetry level 的关系。
- [ ] 能使用 TASK_HISTORY、Query History 和 Event Table 定位不同层次的运行问题。
- [ ] 能将调度状态与数据质量、新鲜度和批次对账分开验证。
- [ ] 能设计告警、责任升级、幂等重试和遥测成本控制。

## 自测

1. Task 显示成功但目标表行数异常，应该从哪些历史记录和数据证据开始定位？
2. 为 Task 设置 LOG_EVENT_LEVEL=ERROR 后，Event Table 会记录哪些任务状态？若需记录成功事件应如何配置？
3. Handler 中已调用 logger，但 Event Table 没有日志，应该检查哪些遥测设置？
4. 为什么不应让大规模逐行 UDF 为每一行都写一条 INFO 日志？
5. 任务失败事件已触发 Alert，但数据恢复仍未完成，事故流程还需要确认哪些事项？

## 参考资料

- [Logging messages from functions and procedures](https://docs.snowflake.com/en/developer-guide/logging-tracing/logging)
- [Event table overview](https://docs.snowflake.com/en/developer-guide/logging-tracing/event-table-setting-up)
- [Monitoring events for task executions](https://docs.snowflake.com/en/user-guide/tasks-events)
- [TASK_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/task_history)
- [ACCOUNT_USAGE views and data latency](https://docs.snowflake.com/en/sql-reference/account-usage)
- [Collecting metrics data](https://docs.snowflake.com/en/developer-guide/logging-tracing/metrics)
