# Snowpipe 灾备：Failover Group、双队列与文件补载

## 一条区域故障可能同时影响数据、管道和通知

Snowpipe 自动摄取订单文件。Snowflake 主账户所在区域发生云服务故障后，目标 Failover Group 被提升，但新账户里的 Pipe 没有继续加载。表已经复制过去，事件通知却仍发到原队列，数据管道因此停在文件已上传、Snowflake 未收到通知的状态。

Snowpipe 灾备不是只复制目标表。自动摄取依赖 Stage、Pipe、Storage Integration、Notification Integration、云存储位置和消息队列；恢复时这些对象需要作为一条链路一起验证。

## 先确定复制范围和版本要求

数据库复制与账户对象复制是不同能力。Snowpipe 的 Stage、Pipe 和加载历史元数据可以随账户复制/Failover Group 管理；复制其他账户对象以及执行 Failover/Failback，需要 Business Critical Edition 或更高版本。若只复制表数据，却没有复制 Storage Integration、Notification Integration 和 Pipe，目标账户可能无法继续接收文件事件。

Replication/Failover Group 要包含与 Pipe 相关的对象类型。External Stage 使用 Storage Integration 时，必须把相应 Storage Integration 纳入复制；否则目标 Stage 可能被复制，但关联的 Integration 不存在。

如果计划使用跨区域灾备，还要决定摄取文件是单写到一个区域，还是双写到两个存储位置。单写模式需要在切换时修改 Producer 的写入目标；双写模式需要保证事件 ID、文件清单和消费规则不会造成重复。

## 多位置韧性需要第二个存储位置和第二个队列

Snowflake 的 Multi-Location Resilience for Data Pipelines 允许在目标账户预先配置第二个 Storage Location 和 Notification Queue。此能力需要 Business Critical Edition 或更高版本。对于 Amazon S3 自动摄取，Snowflake 文档要求在建立通知时选择 SNS；目标账户需要建立对应的第二条队列路径，并配置 Pipe 使用备用位置和 Queue。

备援不能等到事故发生后再临时创建。Failover 前应确认：

- 目标账户已完成 Failover Group 刷新。
- External Stage 与 Storage Integration 在目标账户可用。
- 自动摄取 Pipe 已有目标账户对应的 Notification Integration。
- 第二存储位置和第二队列已建立并完成读写、通知测试。
- S3/SNS/SQS 或 Azure Event Grid/Queue 的资源策略允许目标账户访问。
- 目标账户的 Pipe 状态、通知通道和文件路径已经演练。

## Failover 后 Pipe 要检查执行状态和通知绑定

提升目标账户后，复制的 Pipe 可能先进入 FAILING_OVER 状态；完成后应进入 RUNNING，并从最近一次刷新点继续处理可用文件。自动摄取 Pipe 还需要继续接收新文件通知；若目标账户没有预先配置 secondary auto-ingest pipe 和 queue，单纯复制数据库不会让通知自动切换。

检查 Pipe 状态时，可以使用：

~~~sql
SELECT SYSTEM$PIPE_STATUS('RAW.ORDER_PIPE');
~~~

也要检查 Stage、Storage Integration、Notification Integration 和 Pipe 描述，确认当前活动的存储位置和 Queue。AWS SQS-only Pipe、Multi-Queue Notification Integration 和普通通知 Integration 的重新绑定步骤不同，不能只凭一个 RUNNING 状态判断整个链路已恢复。

目标账户里若原来就存在同名 Stage 或 Pipe，纳入复制组后的刷新可能删除目标端预先存在的对象。启用复制前先清点目标账户的既有对象，避免恢复动作覆盖了目标专属配置。

## 14 天通知窗口与 7 天 Refresh 窗口不是同一回事

Snowpipe 暂停超过 14 天，Pipe 会进入 stale 状态，Snowflake 不再保证加载超过 14 天的通知。文件加载元数据通常也只保留有限窗口，修改已处理文件内容并不会自动重新加载。

ALTER PIPE ... REFRESH 只能扫描并排队最近 7 天的文件。更早的文件需要使用受控 COPY INTO 或其他回补流程。灾备演练必须区分：
- 事件通知队列还保留了哪些文件通知。
- Pipe Load History 记录了哪些文件已经处理。
- 目标表实际落地了哪些业务事件。
- 哪些文件需要手工重放，是否可能造成重复。

回补时使用稳定的 source_event_id 或业务键幂等写入，不能靠文件名去重所有业务事件。

## Failover 与 Failback 的验收标准

切换完成后，至少验证 Pipe 执行状态、Notification Integration 绑定、对象存储路径、目标表最新事件时间、批次行数、重复事件、迟到数据和 Query History。恢复服务不是只要 Pipe 显示 RUNNING；要证明故障期间未加载的文件已经被补齐，且没有重复写入。

Failback 也必须是一次受控的数据管道切换。确认哪个区域拥有最新文件和已提交的 Snapshot，再切换 Producer 写入目标及通知绑定。不能让两个区域在没有协调机制的情况下同时接受同一业务流写入。

## 灾备中常见的错误

- 只复制目标表，遗漏 Stage、Pipe、Storage Integration 和通知队列。
- 目标账户已有同名 Stage/Pipe，却没有在复制前清点。
- 发生区域故障后才开始创建备用队列和通知配置。
- 把 Pipe RUNNING 当成业务数据已追平。
- 将 14 天通知窗口与 ALTER PIPE REFRESH 的 7 天窗口混为一谈。
- 用文件名去重所有事件，忽略同一文件多批次或重复事件的业务键。

## 自测

1. Failover Group 已提升，但 Pipe 没有加载新文件。应分别检查哪些对象和通知资源？
2. 为什么复制 External Stage 时必须考虑 Storage Integration 是否包含在复制组里？
3. Pipe 暂停超过 14 天后，为什么不能只执行 ALTER PIPE ... REFRESH 作为完整补载？
4. 目标账户预先存在同名 Pipe，为什么可能影响复制刷新？
5. Failback 前为什么必须确认对象存储和事件通知的权威写入位置？

## 参考资料

- [Stage, pipe, and load history replication](https://docs.snowflake.com/en/user-guide/account-replication-stages-pipes-load-history)
- [Multi-Location Resilience for Data Pipelines](https://docs.snowflake.com/en/user-guide/multi-location-resilience-data-pipelines)
- [Configure the target account for multi-location resilience](https://docs.snowflake.com/en/user-guide/multi-location-resilience-data-pipelines-setup-target-account)
- [Troubleshoot data pipelines after failover or failback](https://docs.snowflake.com/en/user-guide/multi-location-resilience-data-pipelines-troubleshoot)
- [Automate Snowpipe with cloud event notifications](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-auto)
