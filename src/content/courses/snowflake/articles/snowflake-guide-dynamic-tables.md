# Dynamic Tables 与 Streams/Tasks 选型

## 本节要解决的问题

按转换的声明式程度、事件捕获需求和过程控制粒度，选择 Dynamic Tables 或 Streams/Tasks。它们都能形成数据管道，但状态管理方式不同：前者描述目标结果与新鲜度，后者显式消费变更并触发操作。

## 核心知识

### Dynamic Tables 描述目标数据，不要求用户管理每次增量状态

使用 CREATE DYNAMIC TABLE 定义 SELECT 和 TARGET_LAG。Snowflake 负责识别依赖、选择刷新计划并更新结果，适合 SQL Join、过滤、聚合和多层声明式转换。Target Lag 表示目标数据相对根源数据的最大陈旧程度，不是严格刷新间隔或 SLA。

Refresh Mode 可选 Incremental、Full 或 Auto。应在创建后查看 SHOW DYNAMIC TABLES 中的实际模式与原因，并通过刷新历史判断目标 lag 是否真正达到。

### Streams 显式提供变更视图，Tasks 负责触发 SQL 或过程

Stream 保存源对象的 offset，读取 offset 之后的变更记录；仅 SELECT 不推进 offset，事务中执行 DML 并成功提交后才推进。Task 可按时间计划或 Stream 是否有数据触发 SQL/Stored Procedure。

这套组合适合对 DELETE、UPDATE 等事件有显式处理逻辑、需要 MERGE、条件分支、多步骤执行或外部系统调用的情形。Stream 不是无限期事件日志，消费端需要在保留窗口内推进 offset。

### 不同执行方式的取舍

- Dynamic Tables：多层 SQL 转换与声明式结果维护，运维重点是目标 lag、刷新模式、依赖和成本。
- Streams/Tasks：变更捕获和过程控制，运维重点是 offset、事务提交、任务触发、幂等、重试及 Stale。
- Materialized Views：加速符合限制的单表查询，不承担通用的多层数据管道。
- dbt：提供外部开发、测试、模型依赖和跨仓库工程工作流；它不是 Snowflake 内部持续刷新服务，与 Dynamic Tables 可以组合而非简单互斥。

## 工程实施步骤

1. 列出每个转换的输入、输出、SQL 逻辑、删除处理、外部副作用和业务可接受延迟。
2. 对纯声明式 SQL 转换评估 Dynamic Tables，检查 Refresh Mode 支持范围和下游依赖。
3. 对需要显式捕获变更、复杂 MERGE 或过程操作的步骤评估 Streams/Tasks，明确一个消费者对应一个独立 Stream。
4. 定义幂等键、重复事件处理、失败回滚和回补策略；不要将 Task 的执行成功当作数据质量保证。
5. 设置目标 lag 和任务调度频率时从业务要求出发，避免无必要地追求极短周期。
6. 建立 Refresh History、Task History、Stream STALE_AFTER、目标表对账和端到端延迟监控。
7. 用相同输入和业务结果对比两种方案的运维复杂度、实际延迟、credits 和失败恢复。
8. 将选择理由与退出条件记录在数据管道设计中，避免技术方案仅由团队熟悉程度决定。

## 场景分析

电商订单每天持续更新，简单 SQL 计算客户日汇总；另一个流程需要捕获每笔订单的删除事件，生成审计记录并通知外部系统。

客户日汇总属于声明式结果维护，优先评估 Dynamic Tables；订单删除审计和外部通知属于过程型事件处理，使用 Stream 捕获变化，再由 Task/Stored Procedure 完成幂等写入与通知。两个流程可以共享相同源表，但消费者应有独立 Stream offset。

验收需要检查日汇总的实际 lag、事件日志的完整性、删除操作是否正确识别、通知是否重复、Task 失败后 offset 是否推进，以及 Stream 是否有过期风险。

## 常见误区

- **认为 Dynamic Tables 和 Streams/Tasks 完全等价。** 一个管理声明式结果，另一个显式管理变化消费和过程执行。
- **认为 SELECT Stream 就会消费数据。** offset 在 DML 消费事务提交后才推进。
- **多个 Task 共用同一个 Stream 作为独立消费者。** 每个消费者应使用各自 offset。
- **认为 Task 成功就证明下游正确。** 仍需验证幂等、删除、数据质量和外部副作用。
- **为了极低延迟将所有管道拆成大量 Task。** 先评估 Dynamic Tables 的依赖刷新，再对必要的过程逻辑使用 Task。

## 完成标准

- [ ] 能判断声明式 SQL 转换与过程型事件处理的差别。
- [ ] 能说明 Dynamic Tables 的 Target Lag 和刷新模式。
- [ ] 能说明 Stream offset 推进与 Task 触发边界。
- [ ] 能设计多个消费者的独立 Stream 和幂等恢复机制。
- [ ] 能用延迟、成本和业务结果比较实现方案。

## 自测

1. 一个多层 SQL 聚合不需要外部副作用，为什么可以优先评估 Dynamic Tables？
2. 一个流程需要按 DELETE 事件执行 MERGE 并通知外部系统，为什么 Streams/Tasks 更合适？
3. Stream 被 SELECT 读取后 offset 是否推进？需要什么事务条件？
4. 多个消费者需要读取相同变化，应该如何设计 Stream？

## 参考资料

- [Decision guide for dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables-limitations)
- [Introduction to Streams](https://docs.snowflake.com/en/user-guide/streams-intro)
- [Introduction to Tasks](https://docs.snowflake.com/en/user-guide/tasks-intro)
- [Triggered Tasks](https://docs.snowflake.com/en/user-guide/tasks-triggered)
