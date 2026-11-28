# Dynamic Tables 生产选型与诊断

## 本节要解决的问题

在生产数据管道中，判断何时使用 Dynamic Tables、Streams/Tasks 或 Materialized Views，并建立刷新模式、实际数据延迟、质量和费用的运维闭环。目标是让声明式转换尽可能简单，同时保留对过程逻辑和失败恢复的明确控制。

## 核心知识

### Dynamic Tables 适合声明式 SQL 多阶段转换

Dynamic Tables 用 SELECT 定义目标结果，用 TARGET_LAG 表达数据新鲜度目标。Snowflake 根据依赖关系和数据变化安排刷新，适合多层 SQL 转换，如 Raw、清洗、主题汇总和下游数据集。它不要求开发者自行维护每个中间 Stream offset。

TARGET_LAG 是 staleness target，不是固定刷新间隔，也不是保证达成的 SLA。资源、SQL 复杂度、上游变化量或依赖深度都可能让实际 lag 超过目标。需要用 DYNAMIC_TABLES 函数、Refresh History 和实际消费者查询观察结果。

### Incremental、Full 与 Auto 的结果和成本不同

Incremental refresh 尝试处理变化部分，适合可增量维护且变化比例相对较小的查询；Full refresh 会重新执行完整定义；Auto 在创建时依据启发式选择可用模式。生产部署应明确评估查询支持能力，并检查 SHOW DYNAMIC TABLES 中实际解析的 refresh_mode 与 refresh_mode_reason。

数据量、更新比例、Join 和聚合结构可能影响增量刷新开销。不要假定 Incremental 必然更快或更便宜；要用真实数据分布和刷新历史验证。

### Streams/Tasks 与 Materialized Views 处理不同需求

当需要精确捕获 INSERT/UPDATE/DELETE、执行 MERGE、编排多步骤过程、条件分支或调用外部服务时，Streams/Tasks 更适合。Materialized View 面向单表查询加速，不替代多层转换管道。

Dynamic Tables 适合声明式结果维护，Streams/Tasks 适合过程控制和显式消费进度。生产系统也可以组合使用：先通过 Stream 捕获变化并执行过程型写入，再由 Dynamic Tables 组织面向分析的派生数据。

## 工程实施步骤

1. 明确每层数据的消费者、允许陈旧时间、查询定义、是否需要删除捕获、是否有外部副作用和回放要求。
2. 对多层 SQL 结果表优先评估 Dynamic Tables；有过程逻辑或明确事件消费需求时评估 Streams/Tasks；单表重复查询加速再评估 Materialized View。
3. 在代表性数据量下验证 SELECT 是否支持 Incremental，并在创建后检查实际 Refresh Mode。
4. 为叶子层设置业务可接受的目标 lag；中间层可使用 TARGET_LAG=DOWNSTREAM，让下游消费需求驱动刷新。
5. 通过 INFORMATION_SCHEMA.DYNAMIC_TABLES() 观察实际 lag、time_within_target_lag_ratio 和最后刷新状态，结合 Refresh History 找失败根因。
6. 将刷新成功和数据质量分开验收：对账主键数、金额汇总、空值、迟到数据和下游可见时间。
7. 检查刷新使用的 Warehouse credits、执行次数和实际 lag；调整 Target Lag 前先确认是否真的有更严格的业务需求。
8. 演练上游错误、刷新失败、调度暂停、定义变更和历史回补，确保有明确恢复步骤。
9. 对依赖关系、Refresh Mode 和 Target Lag 的变更进行代码审查和生产灰度，保留回退定义。

## 场景分析

订单数据经过去重、商品维度 Join 和日汇总后供 BI 消费。业务允许最终日汇总最多滞后 15 分钟，中间去重层并不需要独立刷新节奏。

可以为面向 BI 的叶子 Dynamic Table 设置 15 分钟目标 lag，让中间层设置 DOWNSTREAM，避免每层独立按更短频率刷新。若去重逻辑必须捕获具体删除事件并按请求 ID执行 MERGE，则将这部分过程型处理交给 Streams/Tasks，再由 Dynamic Tables 构建分析层。

验收包括实际 lag 分布、Refresh Mode、刷新失败率、金额和订单数对账、Warehouse credits 以及迟到数据回补。

## 常见误区

- **把 TARGET_LAG 当作准时触发的刷新定时器。** 它表达数据陈旧度目标，不是刷新周期，也不是硬 SLA。
- **每个中间动态表都设置独立短 lag。** 中间层可使用 DOWNSTREAM，由下游消费者需求驱动。
- **认为 Incremental 总比 Full 更省资源。** 刷新支持范围、变化比例和维护成本会影响实际结果。
- **用 Dynamic Tables 承担外部 API 调用或复杂条件流程。** 这类副作用和过程控制应由 Tasks/Stored Procedures 等机制承担。
- **只看最后一次刷新成功。** 应监控观察窗口内实际 lag、失败比例和业务结果质量。

## 完成标准

- [ ] 能根据转换和控制需求选择 Dynamic Tables、Streams/Tasks 或 Materialized Views。
- [ ] 能解释 Target Lag、DOWNSTREAM 和实际数据陈旧度。
- [ ] 能验证实际 Refresh Mode 和刷新历史。
- [ ] 能把数据质量、恢复流程与刷新成功状态分开管理。
- [ ] 能在延迟、成本和业务正确性之间做取舍。

## 自测

1. 三层 Dynamic Table 管道中，为什么中间层可能适合使用 DOWNSTREAM？
2. 设置 TARGET_LAG 为十分钟，但实际 lag 经常超过目标，应检查哪些资源与管道特征？
3. 一个转换需要按 CDC 的删除事件执行 MERGE，为什么 Streams/Tasks 可能比 Dynamic Tables 更适合？
4. AUTO 创建后发现实际为 FULL refresh，应检查什么，并如何评估成本？

## 参考资料

- [Decision guide for dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables-limitations)
- [Set the target lag](https://docs.snowflake.com/en/user-guide/dynamic-tables/target-lag)
- [Quick-start best practices](https://docs.snowflake.com/en/user-guide/dynamic-tables/best-practices)
- [Monitor dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/monitoring)
