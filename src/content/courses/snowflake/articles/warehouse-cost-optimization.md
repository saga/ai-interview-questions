# 仓库成本诊断与运行约束

## 本节要解决的问题

从 Warehouse 的实际负载、查询执行阶段、缓存状态和空闲时间中定位可优化的计算成本。目标不是机械地缩小所有仓库，而是在满足延迟、并发和任务完成窗口的前提下减少浪费。

## 核心知识

### Warehouse Cost 同时受执行负载与空闲时间影响

Warehouse 按其运行规格和运行时长消耗 credits。Auto Suspend 可以减少空闲时的计算费用，Auto Resume 可在有请求时恢复。暂停太频繁会造成恢复等待和缓存重建；不暂停则可能在没有查询时持续消耗计算费用。

按秒计费不代表每次短暂恢复都只收取极少费用。每次启动存在最小计费时间，需按真实查询间隔设定暂停阈值。长期稳定的高负载和间歇式短请求应该采用不同的暂停策略。

### 先区分计算不足、并发排队和 SQL 低效

Query History 的 execution_time、queued_overload_time、queued_provisioning_time 和 transaction_blocked_time 分别解释不同阶段的时间。Warehouse Load History 提供 AVG_RUNNING、AVG_QUEUED_LOAD、AVG_QUEUED_PROVISIONING 和 AVG_BLOCKED。单条 SQL 执行很慢时应检查 Query Profile；并发排队高时再评估拆分 Warehouse 或 Multi-cluster。

扩大规格可能提升某些查询的计算能力，但并不自动修复低效 SQL、扫描过多数据或事务阻塞。Multi-cluster 主要承接并发，不是将一条 SQL 分拆到多个集群。

### 查询级成本不是完整 Warehouse 费用

QUERY_ATTRIBUTION_HISTORY 归因查询执行的 Warehouse 计算 credits，不包含空闲时间、存储、数据传输、Cloud Services、Serverless 和 AI token 等。Warehouse_METERING_HISTORY 可观察仓库小时级消耗；账户级费用还需要 METERING_HISTORY 等视图核对。

## 工程实施步骤

1. 按 Warehouse、团队、环境和 workload 建立资源所有者与 Query Tag，先解决费用不可归属的问题。
2. 采集一段完整高峰与非高峰窗口的 Query History 和 Warehouse Load History，区分执行、过载排队、预配等待与事务阻塞。
3. 对执行时间高的查询打开 Query Profile，查看扫描、Join、聚合、spill 和缓存读取；先排查 SQL 和数据分布。
4. 对并发排队高的仓库评估工作负载隔离和 Multi-cluster，比较 p95、排队量与集群 credits。
5. 对运行负载低而空闲时间长的仓库调整 AUTO_SUSPEND；按请求间隔和首查延迟确定阈值，避免反复短周期恢复。
6. 使用 QUERY_ATTRIBUTION_HISTORY 定位高成本 SQL，再与 WAREHOUSE_METERING_HISTORY 对账，识别查询之外的费用。
7. 对比不同规格和配置时固定数据、SQL 参数、并发和缓存条件，每次只调整一个关键变量。
8. 为每次调整定义 SLA、单位成本、空闲 credits 和任务完成时间的验收标准，并在不满足业务目标时回滚。

示例：

~~~
SELECT
  warehouse_name,
  SUM(credits_used_compute) AS compute_credits,
  SUM(credits_used_cloud_services) AS cloud_services_credits
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE start_time >= DATEADD(day, -7, CURRENT_TIMESTAMP())
GROUP BY warehouse_name
ORDER BY compute_credits DESC;
~~~

## 场景分析

BI 查询在高峰时排队，夜间仓库却有很长空闲时间。团队计划把 Medium 改成 X-Large，并取消 Auto Suspend 来避免冷启动。

先看高峰期 AVG_QUEUED_LOAD 与 Query History：若排队时间高而单条执行时间稳定，应评估 Multi-cluster 或独立 Warehouse；若没有排队但执行时间长，检查 SQL Profile 后决定是否需要扩大规格。再检查夜间 Metering 与查询到达间隔，保留合理 Auto Suspend，避免无请求时持续付费。

验收要覆盖高峰 p95、排队时间、夜间空闲 credits、缓存恢复体验和整体单位请求成本，不能只凭一个时段的查询响应决定全年配置。

## 常见误区

- **所有慢查询统一扩大 Warehouse。** 排队、SQL 执行和事务阻塞有不同根因。
- **用 Multi-cluster 修复单条 SQL 的低效计划。** 多集群主要扩展并发容量。
- **将 Auto Suspend 设置成极短值。** 频繁恢复会带来首查延迟和最小计费开销。
- **把查询归因视为仓库完整费用。** 空闲与其它服务费用必须单独对账。
- **只看总 credits，不看每单位业务产出。** 数据量和使用量增长后，总费用上涨并不一定说明效率变差。

## 完成标准

- [ ] 能从 Query History 和 Load History 定位成本来源。
- [ ] 能区分单查询执行瓶颈与并发容量瓶颈。
- [ ] 能根据请求间隔选择 Auto Suspend/Resume。
- [ ] 能区分查询级成本归因与 Warehouse/账户级费用。
- [ ] 能用延迟、排队、空闲消耗和单位业务成本验收优化。

## 自测

1. 一个仓库执行时间正常但 queued_overload_time 很高，应该优先检查什么？
2. 仓库每隔两分钟执行一次查询，设置一分钟 Auto Suspend 可能带来什么影响？
3. QUERY_ATTRIBUTION_HISTORY 的成本没有增长，但仓库 Metering 增长，应调查哪些使用量？
4. 调大 Warehouse 后 p95 改善，但每笔订单处理成本翻倍，如何判断调整是否值得？

## 参考资料

- [Warehouse considerations](https://docs.snowflake.com/en/user-guide/warehouses-considerations)
- [WAREHOUSE_LOAD_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_load_history)
- [Attributing cost](https://docs.snowflake.com/en/user-guide/cost-attributing)
- [WAREHOUSE_METERING_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_metering_history)
