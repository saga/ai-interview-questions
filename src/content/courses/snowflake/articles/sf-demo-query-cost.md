# Query Cost Monitoring 与费用归因

## 本节要解决的问题

把查询级计算消耗关联到具体工作负载、用户、角色、仓库和业务标签，并与仓库空闲成本及账户账单交叉核对。查询成本归因适合做工作负载对比和内部成本分摊，但不是 Snowflake 总账单的逐查询拆分。

## 核心知识

### Query Attribution 按查询归因 Warehouse 计算消耗

SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY 提供查询级计算 credits 归因，可按 QUERY_TAG、USER_NAME、WAREHOUSE_NAME、查询时间和参数化查询 hash 分析。并发查询的 Warehouse 费用按资源消耗权重分配，不是把一个时间段的 Warehouse 总消耗简单平均到查询数量。

查询归因不包含 Warehouse 空闲时间，也不包括存储、数据传输、Cloud Services、Serverless 功能和 AI 服务 token 等其他费用。极短查询可能不产生单条查询归因记录；Adaptive Warehouse 作业也可能需要使用其它用量视图。

### Query Tag 建立业务工作负载与账单之间的关联

应用、ETL 或服务可以通过 QUERY_TAG 会话参数标注应用、团队、作业或成本中心。标签应稳定、受控并避免放入个人隐私或秘密信息。标签缺失、版本变更和任务重试都会影响归因，因此需要对“untagged”工作量做单独监控。

示例：

~~~sql
ALTER SESSION SET QUERY_TAG = 'APP=orders_etl;ENV=prod;TEAM=data-platform';
~~~

### 费用分析需要查询、仓库和账户三个视角

查询归因回答“哪些 SQL 消耗了执行计算资源”；WAREHOUSE_METERING_HISTORY 可检查 Warehouse 的小时级用量；METERING_HISTORY / METERING_DAILY_HISTORY 用于观察账户级不同服务的用量和账单调整。三个口径不能直接相加，也不能用查询归因代替最终账单核对。

## 工程实施步骤

1. 为应用连接、ETL 作业和交互式任务制定 QUERY_TAG 规范，记录应用、环境、团队、批次或业务域。
2. 在 Query History 中检查标签覆盖率、查询状态、Warehouse 和运行时间，先识别未打标签的查询。
3. 按 QUERY_TAG、USER_NAME 和 WAREHOUSE_NAME 对 QUERY_ATTRIBUTION_HISTORY 汇总 credits，分析昂贵查询、重复查询和重试。
4. 将单查询归因结果与 WAREHOUSE_METERING_HISTORY 对照，单独列出仓库空闲时间及未被查询归因覆盖的资源消耗。
5. 使用 METERING_HISTORY 或 METERING_DAILY_HISTORY 按 SERVICE_TYPE 核对账户级用量；对最终计费口径使用账单数据，不直接把未经调整的 credits 当作金额。
6. 把 credits 与业务吞吐量、任务完成时间、数据新鲜度和结果质量结合，计算每千笔订单、每次报表刷新或每批数据的成本。
7. 建立预算告警和异常复盘流程，对标签缺失、重试激增、任务耗时增长和仓库空闲过高分别制定处理方式。

## 场景分析

订单 ETL 团队认为本月 Snowflake 成本上涨来自最近发布的 SQL 优化。财务希望按团队分摊计算费用，工程团队则想知道哪条查询变贵。

先检查 QUERY_TAG 是否覆盖发布前后工作负载，并比较相同参数化查询的调用次数和 QUERY_ATTRIBUTION_HISTORY credits。再按仓库检查 METERING_HISTORY 与 WAREHOUSE_METERING_HISTORY，确认是否因自动暂停阈值变长、空闲时间增加或多集群扩展而产生额外消耗。

如果查询归因显示执行成本没有上升，但仓库小时用量上涨，应优先检查空闲和其他服务费用；如果单查询 credits 上升，再检查数据量、SQL 计划和重试。最终分摊时明确查询归因的覆盖范围，不能将查询级 credits 当成部门完整账单。

## 常见误区

- **认为 QUERY_ATTRIBUTION_HISTORY 就是总账单。** 它不包含空闲、存储、数据传输、Cloud Services 和 Serverless 等费用。
- **直接按 SQL 次数平均分摊 credits。** 并发查询的归因基于资源消耗权重，查询成本并不相等。
- **忽略仓库空闲时间。** 查询归因不覆盖全部空闲用量，需要通过 Warehouse Metering 等视图补充。
- **只记录 Warehouse 名称，不设置 Query Tag。** 仓库内可能混合多个团队和应用，难以稳定归因。
- **把 credits 直接换算成最终金额。** 价格、服务类型和账单调整会影响实际费用，需核对计费数据。

## 完成标准

- [ ] 能用 Query Tag 标识业务工作负载并检查覆盖率。
- [ ] 能解释 QUERY_ATTRIBUTION_HISTORY 的归因对象和排除项。
- [ ] 能将查询归因与 Warehouse 和账户级 metering 交叉核对。
- [ ] 能发现未打标签、重试和空闲消耗造成的归因盲区。
- [ ] 能将 credits 与业务吞吐和数据质量结合分析单位成本。

## 自测

1. QUERY_ATTRIBUTION_HISTORY 显示某团队 credits 没有变化，但 Warehouse Metering 明显上涨，应该检查哪些费用构成？
2. 两条查询执行次数相同，为什么不应该平均分配相同 credits？
3. Query Tag 覆盖率只有 70%，这会如何影响成本分析和团队分摊？

## 参考资料

- [Attributing cost](https://docs.snowflake.com/en/user-guide/cost-attributing)
- [QUERY_ATTRIBUTION_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/query_attribution_history)
- [METERING_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/metering_history)
- [METERING_DAILY_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/metering_daily_history)
