# 成本归因、预算护栏与 FinOps 闭环

## 本节要解决的问题

将 Snowflake 消耗映射到团队、产品和单位业务产出，识别成本异常并推动工程优化。FinOps 不等于给仓库设置一个 Resource Monitor；它要求把查询、仓库空闲、Serverless、存储和数据传输等不同费用口径合并到可解释的业务成本视图。

## 核心知识

### 成本归因首先需要稳定的业务标签和资源所有者

为服务、团队、环境和作业定义稳定的 Query Tag，并为 Warehouse、数据库对象和自动化作业指定 Owner。标签应能映射到业务成本中心，但不要把个人敏感信息或凭证写入标签。

查询级归因可使用 QUERY_ATTRIBUTION_HISTORY，按 QUERY_TAG、USER_NAME、WAREHOUSE_NAME 和参数化查询 hash 识别查询消耗。该视图分配查询执行相关的 Warehouse credits，不包含仓库空闲、存储、数据传输、Cloud Services、Serverless 与 AI token 费用。

### 账户账单、Warehouse 使用量与查询归因是不同口径

QUERY_ATTRIBUTION_HISTORY 适合找出消耗较高的 SQL；WAREHOUSE_METERING_HISTORY 用来核对 Warehouse 小时级 credits；METERING_HISTORY 和 METERING_DAILY_HISTORY 按服务类型观察账户级用量和账单调整。不能把这几个视图中的 credits 直接相加，因为它们统计范围可能重叠或粒度不同。

Resource Monitor 对指定 Warehouse 的 credits 设置阈值动作，适合做用量护栏，但不能覆盖所有 Serverless、存储、传输和 AI 消耗。账户级预算、服务级监控和最终账单核对需要配套完成。

### 优化目标应按业务产出归一化

只看总 credits 无法判断成本是否合理。应结合批次行数、订单量、数据刷新频率、BI 请求量、数据新鲜度和 SLA 计算单位业务成本，例如每百万订单处理成本、每千次报表刷新成本或每 GB 数据转换成本。

成本下降也不能以业务质量下降换取。数据正确性、延迟、恢复能力和消费者体验需要作为共同约束。

## 工程实施步骤

1. 制定 QUERY_TAG 命名规范，至少包含应用/作业、环境、团队或成本中心；为缺失标签的查询建立独立监控。
2. 明确每个 Warehouse 的业务用途、Owner、环境、自动暂停策略及最大可接受 credits。
3. 使用 QUERY_ATTRIBUTION_HISTORY 找出昂贵查询、重试激增和高频重复查询，并按 QUERY_TAG 归属业务团队。
4. 对照 WAREHOUSE_METERING_HISTORY 识别空闲费用、集群变化和持续运行窗口。
5. 使用 METERING_HISTORY/METERING_DAILY_HISTORY 按 SERVICE_TYPE 识别 Warehouse、Serverless、存储、数据传输和 AI 等费用组成。
6. 为适合用 Resource Monitor 控制的 Warehouse 设置额度、阈值动作和通知；对 Serverless 等适用预算的服务另设 Budgets 或使用视图监控。
7. 与业务负责人确定单位产出指标，将 credits、账单金额、吞吐、p95 延迟和数据质量放到同一月度趋势中。
8. 对异常费用形成责任到人的行动项：SQL 改写、负载隔离、自动暂停、数据保留调整、重试治理或调用频率优化。
9. 优化后使用相同业务产出与观察窗口复测，记录实际节省金额和对 SLA 的影响。

## 场景分析

订单团队本月 Snowflake 账单增长 25%，怀疑是某次 SQL 发布造成。先检查 QUERY_ATTRIBUTION_HISTORY 中该作业的执行 credits 和调用次数；若单条查询成本变化明显，再通过 Query Profile 找扫描、Join 或 spill 变化。若查询级成本稳定，但 Warehouse Metering 增长，则检查自动暂停阈值、空闲时长和多集群运行。

如果 METERING_HISTORY 显示 Serverless 服务的用量上涨，Resource Monitor 并不能说明这部分费用已被控制，需要查看对应服务的 Usage History 和预算。最终与订单处理量、每笔订单成本和 SLA 比较，而不是只看总账单涨幅。

## 常见误区

- **认为查询归因等于部门完整账单。** 它不包含空闲、存储、数据传输、Cloud Services、Serverless 和 AI token 等费用。
- **所有资源费用都按 SQL 次数平均分摊。** 并发查询成本按资源消耗权重归因，不同 SQL 的成本并不相等。
- **只给 Warehouse 设 Resource Monitor 就完成预算管理。** 其它服务类型需要不同预算与用量监控。
- **只追求 credits 下降。** 应将成本与处理量、数据质量、延迟和恢复能力一起评估。
- **缺少 Owner 和 Query Tag。** 无法稳定把资源消耗归属到团队和应用，异常也难以形成行动闭环。

## 完成标准

- [ ] 能区分查询归因、Warehouse Metering 与账户级计量。
- [ ] 能说明 Query Tag 对业务成本归属的作用。
- [ ] 能指出 Resource Monitor 的费用覆盖边界。
- [ ] 能建立单位业务成本和 SLA 的联合观察口径。
- [ ] 能把成本异常转化为有 Owner、有验收指标的优化任务。

## 自测

1. QUERY_ATTRIBUTION_HISTORY 显示查询执行费用稳定，但仓库账单上升，应检查哪些额外费用？
2. 如何识别没有 Query Tag 的查询对团队成本分摊造成的偏差？
3. 某项优化让 credits 降低 30%，但数据延迟增加两倍，是否能判定 FinOps 改善成功？
4. Resource Monitor 达到阈值后暂停 Warehouse，为什么账户仍可能继续产生费用？

## 参考资料

- [Attributing cost](https://docs.snowflake.com/en/user-guide/cost-attributing)
- [Budgets](https://docs.snowflake.com/en/user-guide/budgets)
- [Resource monitors](https://docs.snowflake.com/en/user-guide/resource-monitors)
- [METERING_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/metering_history)
