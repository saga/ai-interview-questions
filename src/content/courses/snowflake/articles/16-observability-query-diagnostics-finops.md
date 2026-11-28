# Snowflake 可观测性、查询诊断与 FinOps

## 需要回答的运行问题

运行监控不是堆积 Dashboard。它应该回答：数据是否按时到达？任务是否持续失败？查询为何变慢？Warehouse 是否排队？费用由谁产生？故障是否影响业务 SLA？

Snowflake 有 Query History、Query Profile、Warehouse Load、ACCOUNT_USAGE 和组织级用量视图等运行证据。不同视图的延迟、保留和访问权限并不相同。

## 从查询 ID 追踪到业务影响

先从 Query History 找到失败或变慢的查询，记录 Query ID、执行时间、排队时间、扫描数据量、Warehouse 和用户/Role。再进入 Query Profile 查看扫描、Join、聚合、数据交换和溢出情况。

遇到排队问题，分析并发和 Warehouse 集群；遇到扫描问题，分析过滤和微分区裁剪；遇到 Join 膨胀，分析关联键与粒度；遇到重复计算，分析查询计划、缓存和物化策略。

## 管道级可观测性

对 Task、Dynamic Table、Snowpipe 和自建作业，建立统一的业务批次 ID、来源、开始/结束时间、处理行数、失败原因和重试次数。将 Event、Log、Trace 与数据质量检查关联，使运维人员能从业务批次定位到具体 SQL 和对象。

## 费用归因

费用分析至少拆分 Warehouse Compute、Serverless 服务、存储、数据传输和其他平台服务。Resource Monitor 可针对特定 Warehouse 或账户使用场景配置阈值和通知，但不要把它当作覆盖所有 Serverless 服务和全部账单项目的全局硬上限。

建议建立每个团队或产品的 Cost Center 标签、Warehouse 命名与归属规则、按工作负载统计 Credits 和查询 SLA、高成本查询告警，以及闲置资源定期检查。

## 建立 SLO

把新鲜度、成功率、错误率、查询延迟和恢复时间形成可量化目标。SLO 要和业务消费场景绑定，不要把“每天任务成功”误作“报表在 9 点前可用”。

## 检查题

1. Query History 和 Query Profile 的作用有什么区别？
2. 如何区分 Warehouse 排队与单条查询执行慢？
3. 为什么 Resource Monitor 不能当作全账户费用的唯一护栏？
