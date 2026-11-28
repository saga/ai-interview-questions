# Snowpipe Streaming 行级摄取与交付语义

## 本节要解决的问题

理解 Snowpipe Streaming 如何让客户端直接写入行数据，并围绕 Channel、Offset Token、重试、顺序和端到端可见性设计可靠摄取。低延迟服务并不自动等于业务 exactly-once，客户端仍需设计稳定事件标识和可恢复的提交进度。

## 核心知识

### Streaming 直接发送行，不需要先生成 Stage 文件

Snowpipe Streaming 面向持续产生的行或事件，客户端通过 SDK 或 REST API 将数据写入目标表，避免先生成文件、上传 Stage、等待文件通知和 COPY。适合高频事件和低延迟场景；若源端已经提供大批文件，COPY 或 Snowpipe 往往更简单。

客户端使用 Channel 将写入流分区，服务端为 Channel 维护写入位置。新架构的高性能吞吐和延迟能力受客户端、Region、表结构和服务限制影响，不能把公开基准当作所有 workload 的 SLA。

### Offset Token 用于恢复 Channel 进度

客户端可以在写入批次中附带 Offset Token，并在本地持久化已确认的偏移。重启后可从最后确认的位置恢复，避免从头重放整个流。Token 的含义需要由客户端定义为可比较、单调推进的源端进度标记，例如 Kafka partition offset。

Offset Token 不是全局唯一业务主键，也不意味着来自多个 Channel 的事件具有全局顺序。跨分区事件的因果顺序需要由源系统字段和下游逻辑维护。

### 重试、重复与可见性需要端到端语义

网络超时可能发生在服务端已接收但客户端未收到确认之后。客户端需要以 Channel/Offset 恢复进度，并使用 event_id 或业务键在下游进行去重。摄取已确认、表中可查询、下游任务完成是不同状态。

若业务需要 exactly-once 效果，应将源端位点、提交确认、目标表唯一键和重放逻辑组合起来验证，而不能仅依赖一个 offset 字段。

## 工程实施步骤

1. 确认源系统是连续行事件还是文件批次，记录吞吐、峰值、延迟目标、顺序要求和重放窗口。
2. 为流任务建立独立服务身份，配置目标表权限和所需 Snowpipe Streaming 访问能力。
3. 设计 Channel 分区策略，通常与源端 partition 对齐，避免无意中改变事件顺序和并行度。
4. 为每条事件生成稳定 event_id，并为每个源分区维护可比较的 offset token。
5. 将批次写入、服务确认和本地位点持久化分开处理；只有确认满足恢复语义后才推进客户端检查点。
6. 演练写入超时、客户端重启、重复批次、Channel 重建、源端位点回退和多 Channel 并行。
7. 在下游使用 event_id 或业务键执行幂等 MERGE，并按 event_time 处理迟到和乱序。
8. 分别监控写入确认延迟、Snowflake 表可见时间、下游转换延迟、重复事件数和拒绝数。
9. 使用代表性吞吐量测量并发、Channel 数量、客户端 CPU/网络、服务成本和目标表写入行为。
10. 将源端进度、Channel、Offset Token、最后确认时间和错误样本持久化，支持故障后回放与核查。

伪代码展示客户端检查点关系：

~~~text
read source batch
write rows with channel + offset token
wait for server acknowledgement
persist acknowledged source offset
on restart: resume from persisted offset
downstream: deduplicate by event_id
~~~

具体 Java/Python/REST API 的 Channel 与 Offset Token 字段以当前客户端版本文档为准。

## 场景分析

订单服务通过 Kafka 产生每秒数千条状态事件。消费者把事件写入 Snowpipe Streaming 后，某次网络故障导致客户端在没有收到 ACK 时重启。如果直接从最新 Kafka offset 继续，可能漏掉部分事件；如果从旧位置全部重发，又会产生重复事件。

应在每个 Kafka partition 维护单独 Channel 和 offset，只有写入确认后才推进本地位点。重启从最后确认的位置恢复，目标表用 event_id 做幂等去重。对于不同 partition 的事件，不假定存在全局顺序；如状态更新要求顺序，需要按订单键在下游协调。

验收注入 ACK 丢失、客户端崩溃、重复消息、乱序和多分区并发，检查事件完整性、去重率、表可见延迟和下游状态最终一致性。

## 常见误区

- 认为低延迟就天然提供业务 exactly-once。业务幂等和源位点恢复仍需客户端与下游共同实现。
- 假设多个 Channel 之间存在全局顺序。顺序通常需要按分区或业务键管理。
- 把 Offset Token 当事件 ID。前者定位消费进度，后者标识业务事件。
- 把客户端已发送等同于服务端已确认。网络中断时必须处理结果不确定的批次。
- 认为 Streaming 必须先上传文件到 Stage。它的目的之一就是直接行摄取。
- 只监控 Snowflake 写入吞吐，不监控源端位点和下游完成时间。端到端链路才是业务时效。

## 完成标准

- [ ] 能说明 Snowpipe Streaming 与文件摄取的差异。
- [ ] 能解释 Channel、Offset Token 与源端检查点。
- [ ] 能为超时、重启和重复消息设计恢复策略。
- [ ] 能区分摄取 ACK、表可见时间和下游业务完成时间。
- [ ] 能用稳定事件键实现端到端幂等。

## 自测

1. 为什么客户端没有收到 ACK 时，不能直接认为批次没有写入？
2. Offset Token 和 event_id 分别解决什么问题？
3. 两个 Channel 并发写入时，业务能否假设全局事件顺序？
4. Kafka 客户端重启后，如何保证既不丢事件也不重复产生业务结果？

## 参考资料

- [Snowpipe Streaming overview](https://docs.snowflake.com/en/user-guide/snowpipe-streaming/snowpipe-streaming-overview)
- [Snowpipe Streaming high-performance architecture](https://docs.snowflake.com/en/user-guide/snowpipe-streaming)
- [Snowpipe Streaming SDK](https://docs.snowflake.com/en/user-guide/snowpipe-streaming/snowpipe-streaming-sdk)
