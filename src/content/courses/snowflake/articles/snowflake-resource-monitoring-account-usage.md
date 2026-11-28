# Resource Monitor 与 ACCOUNT_USAGE

## 本节要解决的问题

设置 Warehouse credits 使用阈值，并利用 ACCOUNT_USAGE 视图查看查询、仓库运行和服务用量历史。Resource Monitor 负责指定范围内的 Warehouse 成本控制；ACCOUNT_USAGE 用于分析和审计；两者既不是同一机制，也不能替代完整账单核对。

## 核心知识

### Resource Monitor 管理 Warehouse 用量阈值

Resource Monitor 可以按指定周期或日期区间统计已分配 Warehouse 的 credits，达到阈值时发送通知，或暂停 Standard Warehouse、禁用 Adaptive Warehouse。Account 级 Resource Monitor 和 Warehouse 级监控可以同时存在；单个 Warehouse 的 Resource Monitor 也有其适用范围。

Resource Monitor 只覆盖 Warehouse 相关用量，不跟踪 Serverless 功能和 AI 服务的消费。Snowpipe、Automatic Clustering、Materialized View Maintenance 等服务需要结合 Budgets 和相应 Usage History 监控。即使 Warehouse 被暂停，仍可能产生 Cloud Services 等其他费用；阈值触发也不保证在精确到某个 credit 的瞬间立刻停止。

### ACCOUNT_USAGE 提供带保留期和延迟的历史数据

SNOWFLAKE.ACCOUNT_USAGE 包含 QUERY_HISTORY、WAREHOUSE_LOAD_HISTORY、WAREHOUSE_METERING_HISTORY、METERING_HISTORY、LOGIN_HISTORY 等视图。每个视图有不同数据范围、延迟和权限要求。

例如 QUERY_HISTORY 保留最近 365 天的记录，数据更新最高可能延迟约 45 分钟；WAREHOUSE_LOAD_HISTORY 按 5 分钟粒度展示仓库负载，但数据可能延迟数小时。事故刚发生时，优先使用 Snowsight 或 Information Schema 获取较新的执行记录。

### 把使用指标、成本与运行证据结合

QUERY_HISTORY 适合分析单条查询状态、耗时、扫描和错误；WAREHOUSE_LOAD_HISTORY 适合分析运行、排队、预配和事务阻塞；WAREHOUSE_METERING_HISTORY 观察 Warehouse 小时级 credits；METERING_HISTORY 和 METERING_DAILY_HISTORY 可观察账户级服务类别及账单调整。

这些视图的统计粒度不同，不能把查询级归因直接等同于账户账单，也不要忽略 Serverless、存储、传输和 Cloud Services 等费用。

## 工程实施步骤

1. 按环境和团队定义 Warehouse 归属，确认哪些仓库需要独立 Resource Monitor，哪些服务成本需要另外配置 Budget。
2. 创建 Resource Monitor，设置额度周期、阈值动作和通知对象；为需要精细控制的工作负载避免把多个无关 Warehouse 混在同一额度池。
3. 在账户、仓库或资源对象维度使用 SHOW RESOURCE MONITORS / DESCRIBE RESOURCE MONITOR 检查生效配置。
4. 用 QUERY_HISTORY 分析查询量、执行状态、时间和 Warehouse；用 WAREHOUSE_LOAD_HISTORY 判断过载、provisioning 或事务阻塞。
5. 用 WAREHOUSE_METERING_HISTORY 分析每小时 Warehouse credits，再用 METERING_HISTORY / METERING_DAILY_HISTORY 核对账户级服务类型与最终 billed credits。
6. 将 Snowpipe、Auto Clustering、Materialized View Maintenance、AI 和其他 Serverless 服务分别建立预算或用量告警。
7. 对关键视图应用明确时间过滤，记录数据延迟和查询权限；不要将延迟中的“暂无记录”解释为“没有发生使用”。
8. 定期演练 Resource Monitor 触发通知或暂停的场景，明确任务中断、恢复和人工升级路径。

示例：

~~~
SELECT
  start_time,
  warehouse_name,
  credits_used_compute,
  credits_used_cloud_services
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE start_time >= DATEADD(day, -7, CURRENT_TIMESTAMP())
ORDER BY start_time DESC;
~~~

## 场景分析

团队为月度预算配置了 Account 级 Resource Monitor，达到阈值后 BI Warehouse 被暂停。但当月账户消费仍继续增加。

需要先确认被暂停的是哪些 Warehouse，再查看 METERING_HISTORY 的 SERVICE_TYPE。Serverless 加载、自动聚簇、Materialized View 维护、存储与数据传输可能不属于 Resource Monitor 控制范围。还应检查 Cloud Services 和最终账单调整，而不是假定 Warehouse 暂停即账户全部停止计费。

验收应包括 Warehouse 触发、Serverless 独立用量、预算告警、Account Usage 延迟和任务恢复流程。

## 常见误区

- **认为 Resource Monitor 管理所有 Snowflake 消费。** 它面向 Warehouse 用量；Serverless 与 AI 服务需要用 Budget 等能力监控。
- **认为暂停 Warehouse 后不会再产生其它费用。** Cloud Services、Serverless、存储和传输费用需要单独分析。
- **认为达到阈值会精确停止在额度数值。** 阈值动作存在执行时间，不能作为逐 credit 的硬实时限额。
- **认为 ACCOUNT_USAGE 是实时监控流。** 历史视图存在刷新延迟，应按各视图的数据新鲜度选择诊断工具。
- **把 QUERY_HISTORY 当成成本账单。** 查询性能记录与费用计量口径不同，需要结合 Metering History。

## 完成标准

- [ ] 能说明 Resource Monitor 的适用资源范围和触发动作。
- [ ] 能区分 Warehouse 用量、Serverless 服务用量与账户级账单。
- [ ] 能选择 QUERY_HISTORY、WAREHOUSE_LOAD_HISTORY 和 Metering 视图。
- [ ] 能说明 ACCOUNT_USAGE 的数据延迟与历史保留窗口。
- [ ] 能设计阈值告警、暂停、恢复和用量核对流程。

## 自测

1. Resource Monitor 暂停 Warehouse 后，账户仍产生 credits，应该检查哪些服务类型？
2. Query History 已能看到查询，但 ACCOUNT_USAGE 中还没有记录，是否说明查询没有运行？
3. 要判断仓库是否排队，应看 WAREHOUSE_LOAD_HISTORY 还是 METERING_HISTORY？为什么？
4. Resource Monitor 适合用于精确的实时预算硬限制吗？需要怎样设计缓冲？

## 参考资料

- [Working with resource monitors](https://docs.snowflake.com/en/user-guide/resource-monitors)
- [Account Usage](https://docs.snowflake.com/en/sql-reference/account-usage)
- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [METERING_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/metering_history)
