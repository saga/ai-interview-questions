# Streams、Tasks 与 CDC 事务语义

## 本节要解决的问题

理解 Snowflake Stream 如何表示源对象自某个事务版本以来的变更，Task 如何触发消费，以及为什么“读取到变更”不等于“已经消费变更”。本节聚焦 Snowflake 内部的变更跟踪与任务编排；外部数据库到 Snowflake 的 CDC Connector 属于另一段链路。

## 核心知识

### Stream 保存 offset，不保存一份完整变更表

Stream 记录源表或视图的事务位置，并根据源对象的 Change Tracking 信息提供该位置之后的变更记录。Stream 本身不保存完整的源表数据副本，也不是可以无限期查询的历史日志。

标准 Stream 可用于捕获插入、更新和删除产生的变更。更新通常以旧行删除记录和新行插入记录表现，并通过 \`METADATA$ACTION\`、\`METADATA$ISUPDATE\` 等元数据列区分。Append-only Stream 则只关注插入变化，不能用于需要完整更新/删除语义的场景。

### 读取与消费是两种不同操作

单独执行 SELECT 读取 Stream 不会推进 offset。Stream 在 DML 语句中被消费，并且事务成功提交后，offset 才推进到该事务读取的版本。若消费事务回滚，变更仍可在后续事务中处理。

一个 Stream 不适合被多个独立消费者轮流当作各自的消费游标：先提交的消费者会推进 offset，后续消费者看到的增量就会变化。需要多个消费者独立处理同一源对象时，为每个消费者创建独立 Stream。

Stream 还受源表的数据保留窗口影响。长期不消费会使 Stream 接近或进入 stale 状态；应监控 \`STALE_AFTER\`，并在保留窗口内稳定消费。

### Task 负责调度，不替代事务与幂等设计

Task 可以按时间计划运行，也可以在 Stream 有待处理变更时触发。Task 创建后初始为 suspended，需要显式 RESUME。Task 的成功状态只说明任务执行成功，不证明目标业务状态正确；仍要验证去重、删除、乱序、重试和数据质量。

## 工程实施步骤

1. **确定变更语义。** 明确源对象、业务主键、需要捕获的 INSERT/UPDATE/DELETE，以及下游是维护当前态、追加历史还是生成审计日志。
2. **创建并检查 Stream。** 确认源表 Change Tracking、Stream 类型、创建位置和消费角色权限；通过 DESCRIBE STREAM/SHOW STREAMS 检查 offset 和 STALE_AFTER。
3. **为消费者划分 offset。** 每个独立处理流程使用自己的 Stream，避免多个 Task 或脚本争用同一消费游标。
4. **让消费 DML 与目标写入处在同一事务边界。** 优先使用一次 INSERT/MERGE 完成 Stream 读取和目标写入；多语句处理需明确 BEGIN/COMMIT 和失败回滚行为。
5. **保留足够的变更证据。** 在需要审计或回放时，将变更标识、源主键、操作类型、更新时间及来源信息写入受控的变更日志表。
6. **配置事件触发 Task。** 通过 WHEN SYSTEM$STREAM_HAS_DATA('...') 触发；若使用用户管理的 Warehouse，要配置 WAREHOUSE。Task 运行前还要确认执行角色有权读取 Stream 和写入目标表。
7. **验证失败恢复。** 模拟 Task 失败、Warehouse 暂停、重复提交和 Stream 长时间无人消费，检查是否能重试、是否推进 offset，以及是否需要重建 Stream 和回补数据。

以下示例把变更写入持久化变更日志。它演示 Stream 被 DML 消费的边界，不是完整的业务主表 MERGE 方案：

~~~sql
CREATE STREAM RAW.ORDER_STREAM
  ON TABLE RAW.ORDERS;

CREATE TASK RAW.CAPTURE_ORDER_CHANGES
  WAREHOUSE = ETL_WH
  WHEN SYSTEM$STREAM_HAS_DATA('RAW.ORDER_STREAM')
AS
  INSERT INTO RAW.ORDER_CHANGE_LOG
    (ORDER_ID, STATUS, ACTION, IS_UPDATE, CAPTURED_AT)
  SELECT
    ORDER_ID,
    STATUS,
    METADATA$ACTION,
    METADATA$ISUPDATE,
    CURRENT_TIMESTAMP()
  FROM RAW.ORDER_STREAM;

ALTER TASK RAW.CAPTURE_ORDER_CHANGES RESUME;
~~~

## 场景分析

订单表会出现新增订单、状态更新和订单删除。下游需要维护当前订单表，同时审计团队要求保留每次状态变化。

可以让一个 Stream/Task 消费者维护当前态，另一个独立 Stream/Task 消费者写入变更日志。两个消费者不应共用同一个 Stream，否则先消费的事务会推进 offset，另一个消费者就无法按自己的节奏取得同一批变更。

当前态处理要把 UPDATE 的新行应用为更新；对于真正删除，应根据 DELETE 语义删除目标行或标记为已删除。不要把 UPDATE 对应的旧行删除记录误判成业务删除。审计日志则应保存操作类型和更新标记，保留需要的前后状态信息。

验收时至少执行：新增一行、更新一行、删除一行、消费事务回滚、Task 暂停后恢复、同一 Stream 被两个消费者误用的演练。检查目标状态和日志记录，并确认 Stream offset 在提交和回滚后的行为符合预期。

## 常见误区

- **把 Stream 当作完整历史表。** Stream 提供当前 offset 之后的变更视图；需要长期审计时应将记录写入持久化日志或历史表。
- **SELECT 后就认为 offset 已推进。** 仅查询不会消费；offset 在 DML 消费事务提交后推进。
- **多个消费者共用一个 Stream。** 每个消费者需要独立的 offset，应创建独立 Stream。
- **把 UPDATE 的旧行记录当成 DELETE。** 需要结合 ACTION 和 ISUPDATE 识别更新事件。
- **认为 Task 执行成功就代表数据正确。** 还需要核对目标行、业务键、重复和删除处理。
- **忽略 STALE_AFTER。** 长时间不消费可能导致 Stream stale，不能将 Stream 当无限期缓存。

## 完成标准

- [ ] 能解释 Stream 的 offset、变更视图与源表数据保留窗口。
- [ ] 能说明 SELECT 与 DML 消费对 offset 的不同影响。
- [ ] 能区分 INSERT、真实 DELETE 和 UPDATE 产生的变更记录。
- [ ] 能为多个消费者设计独立 Stream。
- [ ] 能说明 Task 的触发、执行身份、事务和失败恢复边界。

## 自测

1. SELECT 查询 Stream 后，另一个消费者是否仍可看到相同的变更？如果第一个消费者执行 DML 并提交，又会怎样？
2. 标准 Stream 中出现 ACTION=DELETE 且 ISUPDATE=TRUE 的记录，为什么不能直接删除业务目标行？
3. 如何设计两个消费者，使一个维护当前订单状态，另一个长期保留 CDC 审计日志？

## 参考资料

- [Introduction to Streams](https://docs.snowflake.com/en/user-guide/streams-intro)
- [Manage Streams](https://docs.snowflake.com/en/user-guide/streams-manage)
- [Introduction to Tasks](https://docs.snowflake.com/en/user-guide/tasks-intro)
- [Triggered Tasks](https://docs.snowflake.com/en/user-guide/tasks-triggered)
