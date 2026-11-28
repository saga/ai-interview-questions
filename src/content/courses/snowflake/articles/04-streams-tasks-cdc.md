# 学习目标

理解 Stream 保存的是什么、Stream Offset 何时推进，以及 Task 如何触发和编排数据处理。能够设计可恢复的增量处理流程。

## 1. Stream 是什么

Snowflake Stream 用于读取源对象在两个事务时间点之间发生的变更。它提供 CDC 记录，并附带描述变更操作的元数据列。

关键点：Stream 本身并不保存一份完整的源表数据副本。它维护一个 Offset，并依赖源对象的变更跟踪信息返回增量记录。可以把它理解为源表版本时间线上的书签。

## 2. Offset 什么时候推进

单纯 SELECT Stream 不会推进 Offset。Stream 被 DML 事务消费并成功提交后，Offset 才会推进到相应版本。

如果一个任务读取 Stream 后写入目标表，必须关注读写是否处在预期事务边界内。事务失败时，不应错误地假设变更已被永久消费；任务重试也必须考虑目标侧幂等性。

对于 UPDATE，Stream 可能返回 DELETE 和 INSERT 两条记录，并通过 METADATA$ISUPDATE 表示它们属于更新操作。下游不能只按行数或单一操作类型判断业务含义。

## 3. Task 是什么

Task 用于自动运行 SQL 或存储过程。它可以按固定时间计划运行，也可以在 Stream 有数据时触发。复杂流程可以组织成 Task Graph，表达依赖和执行顺序。

Task 的计算方式可以使用用户管理的 Warehouse，也可以在适用场景中使用 Serverless Task。选型要结合任务数量、运行时间、并发、资源可预测性和成本。

## 4. 一个典型 CDC 流程

~~~mermaid
flowchart TD
  A[Application or Source Table] --> B[Snowflake Table]
  B --> C[Stream Offset]
  C --> D{New Changes?}
  D -->|Yes| E[Triggered Task]
  E --> F[Transactional DML]
  F --> G[MERGE into Target]
  G --> H[Commit]
  H --> I[Stream Offset Advances]
  D -->|No| J[Wait for New Changes]
  F -->|Failure| K[Retry and Reconcile]
~~~

图中省略了权限、任务所有者、错误处理和监控配置。生产实现必须补齐这些内容。

## 5. SQL 结构示例

~~~sql
CREATE OR REPLACE STREAM ORDERS_STREAM
  ON TABLE RAW.ORDERS;

CREATE OR REPLACE TASK APPLY_ORDER_CHANGES
  WAREHOUSE = TRANSFORM_WH
  WHEN SYSTEM$STREAM_HAS_DATA('ORDERS_STREAM')
AS
  MERGE INTO CURATED.ORDERS T
  USING (
    SELECT ORDER_ID, CUSTOMER_ID, ORDER_STATUS, UPDATED_AT
    FROM ORDERS_STREAM
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY ORDER_ID
      ORDER BY UPDATED_AT DESC
    ) = 1
  ) S
  ON T.ORDER_ID = S.ORDER_ID
  WHEN MATCHED THEN UPDATE SET
    T.CUSTOMER_ID = S.CUSTOMER_ID,
    T.ORDER_STATUS = S.ORDER_STATUS,
    T.UPDATED_AT = S.UPDATED_AT
  WHEN NOT MATCHED THEN INSERT
    (ORDER_ID, CUSTOMER_ID, ORDER_STATUS, UPDATED_AT)
  VALUES
    (S.ORDER_ID, S.CUSTOMER_ID, S.ORDER_STATUS, S.UPDATED_AT);
~~~

这是帮助理解对象关系的示例，不是适用于所有 CDC 业务的完整模板。尤其是删除事件、更新前后镜像、同一业务键多次变化和事件排序，都需要根据源数据契约明确处理。示例中的简化 MERGE 不能直接用于需要保留删除语义的场景。

Task 创建后默认处于 Suspended 状态，需要显式恢复任务；应先手动测试，再启用自动调度或触发。

## 6. 生产设计必须考虑什么

- **多消费者：** 不同消费者通常应有独立 Stream，避免一个消费者推进 Offset 后让另一个消费者拿不到预期增量。
- **长时间未消费：** 评估源表数据保留期限和 Stream Staleness 风险，建立监控和恢复方案。
- **任务失败：** 监控 Task History、失败原因和重试情况；失败恢复不能只靠无界重试。
- **目标幂等：** 使用业务键、事件 ID 或批次标识控制重复应用。
- **Schema 变化：** Stream 读取历史变更时要考虑源对象 Schema 演进带来的兼容性。
- **数据对账：** 比较源端变化、消费数量、目标表变化及关键业务指标。

## 7. 工程案例：订单状态增量同步

订单系统每分钟更新订单状态，下游分析表不需要每次全表重算。可以通过 Stream 获取源表增量，再由触发式 Task 将变化应用到目标表。

设计验收应包含：插入、更新、删除、重复执行、任务中途失败、连续多次更新同一订单，以及多个消费者并行读取等测试。只验证一次正常执行并不足以证明 CDC 链路可靠。

## 8. 常见误解

- **Stream 是一张保存变更数据的普通表。** 它主要保存 Offset，变更记录依赖源对象的变更跟踪信息。
- **SELECT 后 Offset 就前进。** Stream Offset 在成功提交的 DML 消费事务中推进。
- **一个 Stream 可以随意供多个下游共享。** 消费者推进 Offset 后会改变后续消费者可读取的增量范围。
- **Task 成功运行就说明下游数据正确。** 仍要验证目标表的幂等性、删除语义和业务对账。

## 本节检查

1. Stream 的 Offset 在什么条件下推进？
2. 一个 Stream 为什么不适合多个独立消费者无协调地共享？
3. CDC 链路应该如何测试重试、删除和重复事件？
