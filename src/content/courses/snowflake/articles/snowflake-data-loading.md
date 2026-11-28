# 批量与持续数据摄取

## 从一个五分钟批次说起

订单服务每秒产生几百条事件。当前方案先把事件写进 CSV，每五分钟上传一次，Snowflake 再执行 COPY INTO。运营团队希望看板在数据产生后十秒内可见。

这不是把 COPY INTO 的参数调小就能解决的问题：当前链路要等文件生成、上传、加载，再经过下游转换。真正需要先确认的是输入形态——源系统交付的是文件，还是可以直接发送行事件？

Snowflake 的三类摄取方式看起来都能把数据写进表，但它们的触发方式、计算责任和恢复语义并不相同。

## 先看数据是怎样到达 Snowflake 的

| 方式 | 输入与触发 | 计算责任 | 更适合的情况 |
| --- | --- | --- | --- |
| COPY INTO | 已经存在于 Stage 的文件，由用户发起批量加载 | 用户管理的 Warehouse | 定时批次、迁移和大批量文件 |
| Snowpipe | Stage 中有新文件，事件通知触发 Pipe | Snowflake 管理的 Serverless Compute | 文件持续到达，希望自动摄取 |
| Snowpipe Streaming | 客户端直接发送行数据 | Streaming 服务与客户端共同承担接入处理 | 源系统本身产生连续行或事件，且需要较低摄取延迟 |

如果源系统已经稳定地交付文件，Snowpipe 通常比改造成行级 Streaming 更简单。反过来，如果事件已经在应用或消息系统中，不必为了等文件再额外生成 CSV。

## 文件批次：COPY INTO 仍然是最直接的控制方式

COPY INTO 从内部或外部 Stage 读取文件并写入目标表。调用方决定什么时候执行、使用哪个 Warehouse、采用什么 File Format 和错误处理策略。

~~~sql
COPY INTO RAW.ORDERS
FROM @RAW.ORDER_STAGE
FILE_FORMAT = (FORMAT_NAME = RAW.ORDER_CSV)
ON_ERROR = 'SKIP_FILE';
~~~

真正的批量作业还需要在执行前后记录批次 ID、源文件清单、成功与拒绝的行数，并核对目标表业务键。COPY INTO 的返回状态只能说明这次加载语句怎样处理文件，不能自动证明下游数据已经符合业务要求。

## 持续文件：Snowpipe 负责自动加载，不负责整条管道

Snowpipe 把一条 COPY INTO 语句放在 Pipe 对象中。外部存储通知或其他支持的触发方式让 Snowpipe 得知文件到达，再由 Snowflake 管理的计算资源执行摄取。

它适合持续到达的文件，但有几个工程边界必须提前设计：

- Pipe 记录最近 14 天处理过的文件路径和名称。同名文件即使内容被修正，也可能被视为已经处理。
- Snowpipe 通常先处理较早到达的文件，但不保证严格按 Stage 到达顺序加载。
- Snowpipe 不承诺固定加载延迟。文件大小、格式、通知和转换复杂度都会影响实际时间。
- Snowpipe 与普通 Bulk COPY 使用不同的加载元数据，混用时不能假定彼此会自动去重。

因此，文件名不能代替业务事件 ID。对于更正文件和历史回补，要先核对原文件是否已经写入目标表，再决定使用新文件名、受控 COPY 还是其他重放方式。

## 行事件：Streaming 把文件等待从链路中移走

Snowpipe Streaming 由客户端通过 SDK 或 REST API 直接发送行数据，不需要先生成文件、上传 Stage，再等待文件通知。客户端通过 Channel 组织写入流，并用 Offset Token 等进度信息支持故障后的恢复。

同一 Channel 内可以维护有序写入，但多个 Channel 之间没有全局顺序。若业务依赖跨分区顺序，需要在数据中保留源端时间戳、分区和序列信息，在下游按业务规则处理。

Offset 也不是业务唯一键。客户端超时可能发生在服务端已接收、客户端尚未确认的时刻，因此仍要用稳定的 event_id 或业务键设计下游幂等处理。还要分开记录“写入已确认”“表中已可查询”和“下游转换已完成”三个状态。

## 回到订单场景：十秒目标是否值得改变接入方式

如果订单服务能直接发送行事件，且十秒可见是明确的业务要求，可以评估 Snowpipe Streaming。改造后仍需测量从源端产生到目标表可查询的时间，并演练客户端断线、重启、重复批次和 Offset 恢复。

如果源系统只能每五分钟提供一个文件，Snowpipe 可以省去人工调度加载的工作，但它不会把五分钟的文件生成等待变成十秒。更重要的是，Snowpipe 没有固定延迟保证，不应把“自动摄取”写成“实时 SLA”。

数据摄取组件也不应承担所有业务转换。复杂 Join、聚合、去重和迟到处理通常留给后续的 Streams/Tasks、Dynamic Tables 或其他转换步骤。把原始输入可靠落地，再单独验证转换结果，会更容易定位丢数和重复。

## 最容易造成重复数据的地方

1. 同一批文件同时交给 Snowpipe 和 Bulk COPY。两者的加载记录相互独立，可能重复写入。
2. 修改已经处理过的文件，却继续使用原路径和文件名。Snowpipe 可能忽略它。
3. 把文件加载成功当成业务数据完成。下游转换、去重和质量核对仍未完成。
4. 只观察 Snowflake 表中出现了新行，没有记录源端 ID、到达时间和重放位置。

## 自测

1. 每天夜间交付数百 GB 文件，数据允许次日使用。为什么 COPY INTO 往往比 Streaming 更合适？
2. 同一个文件被 Snowpipe 加载后又执行 Bulk COPY，为什么不能依赖两种方式自动避免重复？
3. Streaming 客户端收到超时，但服务端可能已经接收数据。重启后应依靠什么恢复，为什么还需要业务 event_id？

## 参考资料

- [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Snowpipe Streaming overview](https://docs.snowflake.com/en/user-guide/snowpipe-streaming/snowpipe-streaming-overview)
- [Bulk loading from a local file system](https://docs.snowflake.com/en/user-guide/data-load-local-file-system)
