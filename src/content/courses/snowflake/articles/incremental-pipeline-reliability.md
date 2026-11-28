# 增量管道幂等、去重与迟到数据

## 本节要解决的问题

订单源每分钟向 RAW_ORDER_EVENTS 写入变更。下游任务用 Stream 取出新增记录，再 MERGE 到当前订单表。某次任务执行到一半失败，运维人员重跑后发现重复订单；另一次源系统重发了旧版本状态，反而把已发货订单覆盖成“待支付”。

可靠的增量管道要分别解决三件事：变更从哪里读、哪些变更应该成为当前状态、失败后如何重做。Stream 负责记录源对象的变更位置，不负责永久保存每条业务事件，也不会替你决定哪个版本是最新版本。MERGE 可以把变更应用到目标表，但前提是源记录在 Join 键上已经确定且唯一。

## 核心知识

### Stream 记录的是一个事务位置之间的变更，不是一张永久事件表

创建 Stream 时，Snowflake 为源对象记录一个 offset。之后查询 Stream，返回该 offset 到当前源对象版本之间的变更记录。Stream 自身不保存一份完整数据副本，只保存追踪变更所需的位置和元数据。

读取和消费是两回事：

- 普通 SELECT 可以反复查看同一批变更，不推进 offset。
- Stream 被 DML 消费时，offset 在事务成功提交后推进。
- 多条 DML 语句放在同一个显式事务中，可以读取同一批变更并一起提交；若事务回滚，变更不会因为失败的事务而被确认消费。
- 同一个 Stream 不应被多个独立消费者争抢。一个消费者提交 DML 后，后续消费者看到的是新 offset 之后的变更。

如果财务汇总和风控通知都需要同一张源表的所有变更，应为两个消费者各建一个 Stream，而不是让两个 Task 共用一个 Stream。

### Update 在 Stream 中表现为删除与插入两条记录

标准 Stream 的变更记录带有：
- METADATA$ACTION：INSERT 或 DELETE；
- METADATA$ISUPDATE：是否属于 UPDATE 的一部分；
- METADATA$ROW_ID：源行的稳定标识。

一条源行从状态 A 更新为状态 B，标准 Stream 会提供旧行的 DELETE 记录和新行的 INSERT 记录，并通过 ISUPDATE 标记它们属于一次更新。只看 ACTION 不看 ISUPDATE，容易把更新误判成“删除旧订单，再新增一笔订单”。

对 Append-only 事件流和标准表 CDC 要采用不同处理逻辑。Append-only Stream 只关心新增行；标准 Stream 还要处理更新和删除。不能把所有 Stream 都当作只追加的新事件表。

### 业务版本规则要在 MERGE 前确定

假设源系统对同一订单发送了三条状态：

| ORDER_ID | EVENT_VERSION | EVENT_TIME | STATUS | INGESTED_AT |
|---|---:|---|---|---|
| O-100 | 12 | 09:00 | PAID | 09:00:03 |
| O-100 | 13 | 09:20 | SHIPPED | 09:20:04 |
| O-100 | 12 | 09:00 | PAID | 09:35:10 |

第三行是旧事件的重发，虽然到达最晚，但 EVENT_VERSION 更低。若按 INGESTED_AT 取最新，目标表会回退到 PAID；应先按业务版本选择最新事件，再用到达时间作为同版本冲突时的次级排序条件。

如果上游没有单调版本号，需要建立明确的冲突策略，例如按源事件序列、源事务时间或业务系统的变更 ID 排序。不能简单地使用 Warehouse 到达时间假设“最后到达就是最新事实”。

### MERGE 的源数据必须按目标键去重

Snowflake 的 MERGE 不会自动对源数据去重：
- 同一个目标行匹配多个源行并执行 UPDATE，默认会因非确定更新而报错；关闭 ERROR_ON_NONDETERMINISTIC_MERGE 后，选中的源行也没有定义。
- 目标表没有匹配行，而源数据中有多个同键记录时，每个源行都会被 INSERT，可能插入多条重复记录。

因此，MERGE 前必须先明确每个目标业务键只保留一条待应用记录。例子中的 event_version 是源系统维护的单调版本号：

~~~sql
MERGE INTO MART.CURRENT_ORDERS AS target
USING (
  SELECT
    order_id,
    event_type,
    event_version,
    status,
    amount,
    event_time
  FROM RAW.ORDER_EVENTS_STREAM
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY order_id
    ORDER BY event_version DESC, event_time DESC
  ) = 1
) AS source
ON target.order_id = source.order_id

WHEN MATCHED AND source.event_type = 'DELETE' THEN DELETE

WHEN MATCHED AND source.event_type <> 'DELETE' THEN
  UPDATE SET
    target.status = source.status,
    target.amount = source.amount,
    target.event_version = source.event_version,
    target.updated_at = source.event_time

WHEN NOT MATCHED AND source.event_type <> 'DELETE' THEN
  INSERT (
    order_id, status, amount, event_version, updated_at
  )
  VALUES (
    source.order_id, source.status, source.amount,
    source.event_version, source.event_time
  );
~~~

该示例假设上游已经将更新事件规范化为一条带 event_type 的业务事件，并为每个 order_id 提供可比较的 event_version。若直接读取标准 Stream 原始 CDC 行，必须先把 UPDATE 的旧/新行组合转换成业务事件，再处理 DELETE 和 INSERT；不能把上面的 event_type 直接当作 Stream 自带列。

### MERGE 与 Stream offset 可以在同一个事务中推进

将 Stream 作为 MERGE 的 source 时，目标表写入和 Stream offset 推进属于同一个 DML 事务。MERGE 成功提交后，offset 推进；语句失败或事务回滚时，目标变更不会提交，Stream 的同一批变化可以再次处理。

这个原子边界只覆盖 Snowflake 事务中的数据库操作。若 Task 同时调用外部 API、发送邮件或修改外部系统，这些副作用不在同一个 Snowflake 事务里。不能据此宣称端到端 Exactly Once。外部动作应使用业务幂等键、outbox 表和执行状态查询来控制重复。

### 迟到数据和重复投递需要不同的处理策略

重复投递是同一业务事件被发送多次；迟到数据是较早发生的事件在较晚时间到达；修订数据则是源系统重新发布了同一业务实体的新版本。这三者不应统一做“按到达时间去重”。

处理前要确定：
- event_id 或业务主键能否稳定识别同一事件；
- event_version / source_sequence 是否能比较新旧；
- 到达时间和事件时间哪个决定业务归属；
- 迟到事件是否允许重开已关闭期间；
- 超过回补窗口后，是更新当前态还是写入调整分录。

例如，订单 11 月 27 日发生、11 月 28 日到达，日报可能需要回补 11 月 27 日；它不是 11 月 28 日的新订单。若 11 月 29 日又收到 11 月 27 日事件的更正版本，应保留原记录和修订关系，按业务规则重算受影响期间，而不是静默覆盖原始来源。

### Stream 有保留边界，不能当作长期恢复日志

如果 Stream offset 超出源表可用的数据保留范围，Stream 会变为 STALE，尚未消费的变化无法再从它读取。Snowflake 可以在一定条件下延长短保留表的数据保留期，但有最大延长期；不能把它当无限期积压队列。

应监控：
- DESCRIBE STREAM / SHOW STREAMS 中的 STALE_AFTER 和 STALE 状态；
- Stream 最后消费时间；
- 上游源表的 DATA_RETENTION_TIME_IN_DAYS 和 MAX_DATA_EXTENSION_TIME_IN_DAYS；
- Task 长时间失败、暂停或积压的情况。

若需要长期重放，应把原始事件和批次保存在持久化 Raw 表、对象存储或外部事件日志中。Stream 是 CDC 处理接口，不是历史归档。

## 工程实施步骤

1. 为源表定义稳定业务键、事件 ID、源版本/序列、事件时间和摄取时间。
2. 决定消费的是 Append-only Stream 还是 Standard Stream；若多个任务需要独立消费，按消费者分别创建 Stream。
3. 先用 SELECT 检查 Stream 中的 ACTION、ISUPDATE、ROW_ID 和业务字段，确认源系统一次更新会产生哪些记录。
4. 在 DML 消费前定义业务版本排序、重复事件处理、迟到窗口和删除语义。
5. 在 MERGE source 子查询中按目标业务键去重；验证每个目标键最多只有一条待应用记录。
6. 将 Stream 读取与目标 MERGE 放在同一条 DML 语句或显式事务中，避免先单独推进 offset 再写目标。
7. 对外部副作用采用 outbox/幂等键和执行状态检查，不把数据库事务误认为跨系统 Exactly Once。
8. 配置 Task WHEN SYSTEM$STREAM_HAS_DATA(stream_name)，并检查 Task Owner Role、Warehouse 和目标对象权限。
9. 根据失败场景配置 TASK_AUTO_RETRY_ATTEMPTS；该功能默认关闭，重试前仍需确保目标 SQL 幂等。
10. 监控 Task History、Query ID、Stream STALE_AFTER、消费间隔和目标行数/金额对账。
11. 将原始事件按批次持久化，以便 Stream stale 或处理逻辑错误时从持久化源重建目标。
12. 对迟到修订记录保存源版本、原始值、修订原因和回补批次，确保历史报表可以解释变更。

## 场景分析

订单 O-100 的源系统先发送 event_version=12、STATUS=PAID，之后发送 event_version=13、STATUS=SHIPPED；由于网络重试，version 12 在 15 分钟后又到达一次。

如果下游按 INGESTED_AT 取最新，最终状态会从 SHIPPED 回退为 PAID。按 event_version 排序后，三条记录只选出 version 13，目标状态保持 SHIPPED。若源表同时包含多次版本更新，应在一个 Stream 消费事务中完成版本整理和 MERGE。

第一次 Task 执行到 MERGE 失败并回滚，Stream offset 没有推进，重试时同一批记录仍可读；第二次 MERGE 成功提交后，目标表更新且 Stream offset 前移。若 Task 在 MERGE 成功后还要向外部系统发送通知，通知应通过 outbox 以稳定 event_id 发送，并由接收方幂等处理，避免 Task 重试时重复发信。

如果 Task 连续暂停多天，运维人员还要检查 STALE_AFTER 是否已过；若 Stream 已 stale，应从原始事件归档重建，而不能假设重新启动 Task 会补回所有变更。

## 常见误区

- **把 Stream 当作永久 CDC 事件日志。** Stream 只维护相对源对象的 offset；超出保留窗口会 stale。
- **认为 SELECT Stream 会推进 offset。** 只有在成功提交的 DML 中消费才会推进。
- **多个 Task 共用同一个 Stream。** 一个消费者提交后会移动 offset，其他消费者将看不到相同的 delta。
- **把标准 Stream 的 UPDATE 只看作 INSERT。** 更新通常表现为旧行 DELETE 与新行 INSERT，并带 ISUPDATE 标记。
- **认为 MERGE 会自动去重。** 多个未匹配源行可以全部插入；多个源行匹配同一目标行也可能导致非确定更新。
- **按到达时间选择最新事件。** 迟到的旧版本可能最后到达，却不是业务上的最新事实。
- **把 Snowflake 事务当成跨系统 Exactly Once。** 邮件、API、消息队列和外部数据库不在同一事务边界内。
- **认为 Task 自动无限重试。** TASK_AUTO_RETRY_ATTEMPTS 默认关闭，且重试不能替代幂等设计。
- **只保留 Stream，不保留原始事件。** Stream stale 后无法替代长期归档完成恢复。

## 完成标准

- [ ] 能解释 Stream offset、DML 消费和事务提交之间的关系。
- [ ] 能区分 Append-only Stream 与 Standard Stream 的变更语义。
- [ ] 能解释 METADATA$ACTION、METADATA$ISUPDATE 和 METADATA$ROW_ID。
- [ ] 能在 MERGE 前按业务版本去重，并说明源端重复记录会造成什么结果。
- [ ] 能说明数据库事务的原子边界以及外部副作用的幂等要求。
- [ ] 能区分重复投递、迟到事件和修订版本。
- [ ] 能监控 Stream staleness，并设计从原始事件归档重建的方案。

## 自测

1. 只执行 SELECT 查询 Stream，下一次查询是否还会看到相同的变更？什么时候 offset 才会推进？
2. 两个 Task 共用一个 Stream。第一个 Task 成功提交 MERGE 后，第二个 Task 是否还能消费同一批变更？应该怎样设计？
3. Stream 中同一 order_id 出现两个未匹配目标表的源记录。MERGE 会自动保留一条吗？怎样保证只插入一条？
4. 标准 Stream 中一条 UPDATE 为什么会同时出现 DELETE 和 INSERT？如何避免把它误处理成删除订单和新增订单？
5. Task 的 MERGE 成功，但外部通知 API 超时。为什么不能简单重跑整个业务步骤？需要什么幂等措施？
6. Task 停止消费超过 STALE_AFTER 后，为什么不能只重新启动 Task 来恢复积压数据？

## 参考资料

- [Introduction to Streams](https://docs.snowflake.com/en/user-guide/streams-intro)
- [Manage Streams and prevent staleness](https://docs.snowflake.com/en/user-guide/streams-manage)
- [MERGE](https://docs.snowflake.com/en/sql-reference/sql/merge)
- [Introduction to Tasks](https://docs.snowflake.com/en/user-guide/tasks-intro)
- [Introduction to Streams and Tasks](https://docs.snowflake.com/en/user-guide/data-pipelines-intro)
