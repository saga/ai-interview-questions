# 学习目标

理解 Virtual Warehouse 的计算职责，区分纵向扩容和横向扩展，能够根据查询性能、并发需求和成本约束设计 Warehouse。

## 1. Warehouse 解决什么问题

Virtual Warehouse 是 Snowflake 执行 SQL 和受支持计算工作负载的计算资源。它不负责长期保存表数据。Warehouse 的尺寸影响可用计算资源；运行、暂停、恢复和集群配置则共同影响性能、并发体验与成本。

不要把 Warehouse 当作传统数据库服务器的简单映射。它是 Snowflake 管理的计算资源抽象，配置重点是工作负载与服务目标，而不是操作系统和数据库实例维护。

## 2. Scale up 与 Scale out

| 方式 | 解决的问题 | 典型用途 | 需要注意 |
|---|---|---|---|
| 调整 Warehouse Size | 增加单个集群的计算能力 | 大查询、复杂 Join、计算密集型转换 | 成本随尺寸增加，性能提升不是线性保证 |
| Multi-cluster Warehouse | 增加集群以承接更多并发请求 | BI 用户并发、突发查询 | 主要解决并发容量，不等同于让单条查询更快 |

~~~mermaid
flowchart TD
  A[Workload] --> B{Primary bottleneck?}
  B -->|Single query is slow| C[Inspect Query Profile, then consider resize]
  B -->|Queries queue under concurrency| D[Review workload isolation or multi-cluster]
  B -->|Idle time costs too much| E[Review auto-suspend and auto-resume]
  B -->|Different teams interfere| F[Separate warehouses and cost ownership]
~~~

## 3. 自动暂停和自动恢复

Auto-suspend 可以在 Warehouse 一段时间没有活动后自动暂停，减少空闲计算消耗；Auto-resume 可以在收到新请求时自动恢复。

参数不应该照抄一个固定值。需要结合请求间隔、交互延迟要求、恢复开销和账单规则评估。暂停策略需要考虑工作负载空闲间隙和恢复时的最低计费行为。

对于长时间持续运行的 ETL，过短的 Auto-suspend 可能造成反复暂停和恢复；对于间歇性分析，关闭 Auto-suspend 又可能带来不必要的空闲费用。

## 4. 工作负载隔离

可以按照工作负载建立不同 Warehouse，例如：

- LOAD_WH：数据加载与批处理转换。
- BI_WH：仪表盘与分析查询。
- DS_WH：数据科学和探索性分析。

隔离的收益包括资源竞争减少、费用更容易归属、配置可以独立调整。但 Warehouse 过多也会增加监控、权限和配置维护成本。应以工作负载差异为依据，而不是每个用户、每张表都创建独立 Warehouse。

## 5. 工程案例：BI 高峰期查询排队

某零售企业每天 9:00 运行管理报表，许多业务人员同时打开仪表盘。观察到 Query History 中出现排队，单条查询运行时间并没有明显增长。

合理的诊断顺序：

1. 检查队列时间与执行时间，确认瓶颈是否来自并发。
2. 查看 Warehouse 当前集群配置和负载情况。
3. 评估 BI 是否应该使用独立 Warehouse，避免与 ETL 抢占资源。
4. 在适用版本和账户条件下，测试 Multi-cluster Warehouse。
5. 比较调整前后的排队时间、查询延迟和 Credits，而不是只比较吞吐量。

如果实际问题是单条查询扫描量大或 Join 效率低，单纯增加集群通常不是正确的第一步。

## 6. 公开客户案例：Order.co 的工作负载隔离

Snowflake 发布的 Order.co 客户案例提到，其原有 Redshift 环境同时承载开发工作负载、生产数据管道、临时分析和实时流量，不同负载会争抢资源，临时查询甚至可能影响生产任务。迁移到 Snowflake 后，团队使用独立 Virtual Warehouse 隔离工作负载；Snowflake 案例页称，超过 200 名业务用户的查询速度提升到原来的 2 至 7 倍，内部分析也不再干扰对外数据产品背后的管道。

这是厂商发布的客户案例，指标属于该客户特定环境，不应作为其他项目的性能承诺。可借鉴的是诊断方法：先确认资源争用，再按工作负载分离计算，最后比较查询延迟、排队时间和成本。

## 7. 监控与费用核算

至少关注：

- Query History：查询运行、排队、错误和耗时。
- Query Profile：扫描、Join、聚合和数据交换等执行细节。
- Warehouse Load：负载与并发。
- Credit Usage：计算消耗以及资源使用归属。

Resource Monitor 可以用于管理部分 Warehouse 使用预算和阈值，但不能假设它覆盖账户内所有 Serverless 服务费用。应将 Warehouse、Serverless 和其他计费项目分别核算。

## 8. 常见误解

- **扩大 Warehouse 就能解决并发。** 扩大尺寸主要增加单集群能力；并发排队需要结合多集群或隔离设计。
- **Multi-cluster 会让单条 SQL 自动变快。** 它主要解决并发容量。
- **Auto-suspend 越短越省钱。** 过于频繁的暂停和恢复也可能造成额外成本和延迟。
- **Resource Monitor 是全账户费用上限。** 它不等于对所有服务的统一硬性预算控制。

## 本节检查

1. 查询慢与查询排队，分别应该先检查什么？
2. 什么时候考虑调整 Warehouse Size，什么时候考虑 Multi-cluster？
3. 为什么不能直接把 Auto-suspend 设置为一个全公司的统一值？
