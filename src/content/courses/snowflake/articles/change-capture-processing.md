# Streams、Tasks 与 CDC 事务语义

## 先看 Stream 交付给消费者的是什么

订单表当前只有一条记录：

| ORDER_ID | STATUS |
| --- | --- |
| 82013 | CREATED |

后来状态被改成 PAID，再改成 SHIPPED。下游需要维护一张当前状态表，审计系统则要保留每次变更。

如果把 Stream 想成一张永久保存所有事件的日志表，就会设计错消费者。Stream 保存的是源对象的一个 offset，并根据 Change Tracking 提供该位置之后的变更视图；它本身不保存一份完整数据副本，也不是长期审计日志。

## Offset 决定消费者从哪里开始看

创建 Stream 时，Snowflake 为源对象初始化一个时间位置。之后源表发生并提交 DML，Stream 就能提供 offset 之后的变更记录。

标准 Stream 会记录插入、更新和删除。更新通常表现为旧行的 DELETE 记录和新行的 INSERT 记录，两条记录都可以通过 METADATA$ISUPDATE = TRUE 识别。只看 METADATA$ACTION = 'DELETE' 就删除目标业务行，会把一次状态更新误当成真正的业务删除。

如果消费者只关心新增行，可以考虑 Append-only Stream；如果需要更新和删除语义，就不能用它替代标准 Stream。

## SELECT 不消费变更，提交 DML 才会推进 offset

这是 Stream 最容易被误用的地方。

单独执行 SELECT * FROM RAW.ORDER_STREAM 可以查看当前变更，但不会推进 offset。即使放在显式事务中，单独 SELECT 也不等于消费。只有 DML 在事务中读取 Stream，并且事务成功提交，offset 才会推进。

可以把它理解为一个提交边界：

| 操作 | Stream offset |
| --- | --- |
| 执行 SELECT 查看 Stream | 不变 |
| DML 读取 Stream，但事务回滚 | 不推进 |
| DML 读取 Stream，事务成功提交 | 推进到本次事务所消费的位置 |

这个区别决定了失败恢复方式。若目标写入和 Stream 消费处于同一事务，失败回滚后，变更仍可以在下一次消费中处理。若把消费和目标写入拆成两个互不关联的步骤，就必须自行处理两者之间的失败窗口。

## 两个消费者要各自拥有 offset

回到订单例子：一个消费者维护当前状态，另一个消费者写审计日志。它们需要独立的消费进度，因此应为同一个源表创建两个 Stream：

~~~sql
CREATE STREAM RAW.ORDER_CURRENT_STREAM
  ON TABLE RAW.ORDERS;

CREATE STREAM RAW.ORDER_AUDIT_STREAM
  ON TABLE RAW.ORDERS;
~~~

Stream 保存的是 offset，而不是整份源表数据；为不同消费者建立独立 Stream，是把消费游标分开，并不等于复制两份完整数据。

消费者 A 可以按业务主键将 INSERT、UPDATE 和 DELETE 应用到当前表。消费者 B 则把操作类型、更新时间和需要保留的前后状态写入审计表。两者各自推进自己的 offset，不会因为其中一个先提交而让另一个丢掉同一批变更。

## Task 只负责何时运行，不替你保证数据正确

Task 可以按计划运行，也可以由 Stream 中出现待处理数据来触发。事件触发的任务通常用 SYSTEM$STREAM_HAS_DATA 作为 WHEN 条件：

~~~sql
CREATE TASK RAW.CAPTURE_ORDER_CHANGES
  WAREHOUSE = ETL_WH
  WHEN SYSTEM$STREAM_HAS_DATA('RAW.ORDER_AUDIT_STREAM')
AS
  INSERT INTO RAW.ORDER_CHANGE_LOG
    (ORDER_ID, STATUS, ACTION, IS_UPDATE, CAPTURED_AT)
  SELECT
    ORDER_ID,
    STATUS,
    METADATA$ACTION,
    METADATA$ISUPDATE,
    CURRENT_TIMESTAMP()
  FROM RAW.ORDER_AUDIT_STREAM;

ALTER TASK RAW.CAPTURE_ORDER_CHANGES RESUME;
~~~

Task 创建后初始为 suspended，需要显式启动。执行身份、Warehouse、Stream 权限和目标表权限都要检查。Task 显示执行成功，只说明 SQL 运行完成；是否正确处理了重复事件、真实删除、迟到数据和业务主键，仍要靠数据校验。

## 生产消费前，至少演练这几种变化

在测试环境中分别插入一行、更新一行和删除一行，观察 Stream 的 ACTION 与 ISUPDATE。然后故意让消费事务失败，再重试，检查 offset 是否符合预期。

还要模拟两个消费者误用同一个 Stream 的情况：第一个消费者提交 DML 后，offset 已推进，第二个消费者不再拥有自己独立的那批变更。生产中应从设计上避免这种竞争，而不是等到日志少了一段再补救。

长期审计需要把消费后的记录写入持久化日志或历史表，并定义保存期限、业务键和回放规则。Stream 的源对象保留窗口和 STALE_AFTER 也要持续监控，不能把它当成无限期缓存。

## 容易混淆的边界

- Stream 是带 offset 的变更视图，不是长期事件日志。
- SELECT 只读取，不推进 offset；提交 DML 才消费变更。
- UPDATE 会产生带有更新标记的旧行和新行，不能把旧行记录直接当成业务 DELETE。
- 多个独立消费者需要独立 Stream。
- Task 负责触发和执行，不负责替业务定义幂等、删除和审计策略。

## 自测

1. 一个事务 SELECT 了 Stream，随后回滚。另一个事务还能看到这批变更吗？为什么？
2. Stream 返回 ACTION = 'DELETE' 且 ISUPDATE = TRUE 的记录，为什么不能直接删除当前状态表中的订单？
3. 如何设计两个独立消费者，让一个维护订单当前状态，另一个保存审计历史？

## 参考资料

- [Introduction to Streams](https://docs.snowflake.com/en/user-guide/streams-intro)
- [Manage Streams](https://docs.snowflake.com/en/user-guide/streams-manage)
- [Introduction to Tasks](https://docs.snowflake.com/en/user-guide/tasks-intro)
- [Triggered Tasks](https://docs.snowflake.com/en/user-guide/tasks-triggered)
