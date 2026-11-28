# 批量与持续数据摄取

## 本节要解决的问题

根据输入形态、到达频率和目标延迟选择 Snowflake 摄取方式。批量文件、持续到达的文件和秒级行/事件流具有不同的触发方式、计算模型、成本口径与重复处理边界，不应统一包装成一个“实时导入”流程。

## 核心知识

### COPY INTO 用于受控批量文件加载

COPY INTO table 从内部或外部 Stage 读取文件并写入目标表，通常由用户管理 Virtual Warehouse 执行。适合一次性迁移、定时批处理和可控的大批量装载。可使用 VALIDATION_MODE 预校验文件；加载后通过 COPY_HISTORY 和目标表数据核对结果。

Bulk COPY 的文件加载历史与 Snowpipe 的 pipe 元数据不同。不要让同一批文件同时由两种方式处理，否则两套加载记录未必互相识别。

### Snowpipe 按 Stage 文件到达事件持续加载

Snowpipe 将 COPY INTO 语句封装在 Pipe 对象中，文件到达 Stage 后由 Snowflake 管理的 Serverless Compute 处理。适用于数据以文件形式到达，且希望在分钟级而非下一个批次窗口内加载的场景。自动摄取可由云存储事件通知触发。

Snowpipe 按文件记录加载元数据，保留时间有限，通常为 14 天。文件处理顺序不保证与 Stage 到达顺序一致；如果业务依赖事件顺序，应在下游基于业务时间戳或序列字段重排。

### Snowpipe Streaming 直接接收行或事件

Snowpipe Streaming 面向客户端直接发送行数据，避免先生成文件再等待文件到达 Stage。官方描述的高性能架构可达到低至数秒的摄取延迟，适用于事件持续产生且对新鲜度要求高的工作负载。

它使用 SDK 或 REST API 等客户端接入方式，需设计 Channel、offset、客户端重试与数据去重。若源系统已经以文件交付，Snowpipe 往往更简单；若是大批量文件，COPY INTO 通常更合适。

## 工程实施步骤

1. 记录输入是文件还是行事件，单批大小、峰值到达率、文件大小、目标延迟和是否需要保持源端顺序。
2. 对定时或大批量文件使用 COPY INTO；对连续到达的文件评估 Snowpipe；对秒级行事件评估 Snowpipe Streaming。
3. 文件方案先建立 Stage、File Format、云存储权限和 COPY/PIPE 定义；行流方案先设计客户端身份、Channel、offset 和重试机制。
4. 设计业务唯一键、批次 ID、事件 ID 和源端时间戳，明确重复、迟到和乱序数据的处理方式。
5. 选择对应的加载历史机制：Bulk COPY 检查目标表加载历史，Snowpipe 检查 Pipe Load History，Streaming 检查客户端 offset 和摄取状态。
6. 将原始数据先可靠落地，再使用 Streams/Tasks 或 Dynamic Tables 执行需要的转换；不要把复杂 Join、聚合或过滤假定为摄取组件的职责。
7. 测量从源端产生到目标表可查询的端到端延迟、拒绝量、重复率、吞吐量和服务成本。
8. 演练源端重发、客户端重启、文件更正、pipe 重建和历史回补，确认不会造成静默漏数或重复业务写入。

## 场景分析

订单应用每秒产生数百条事件，当前先写成 CSV 文件，每五分钟上传一次。产品团队希望数据在十秒内可查询。

继续用五分钟批量 COPY 无法满足目标；若必须保留文件输出，可评估 Snowpipe，但通常需要分钟级窗口。若确实需要秒级行数据，应评估 Snowpipe Streaming，并让应用在发送时提供稳定事件 ID 和可恢复 offset。

上线前同时比较吞吐、端到端延迟、重复率、失败恢复和费用。不要只用 Snowflake 表中“出现了新行”作为成功标准；还要验证同一事件是否重复、是否有乱序以及客户端崩溃后能否继续处理。

## 常见误区

- **把 COPY INTO、Snowpipe 和 Snowpipe Streaming 当成同一服务的三种开关。** 它们分别面向批量文件、持续文件和直接行事件。
- **认为 Snowpipe 会保证文件到达顺序。** Pipe 内部有队列和多个处理进程，不保证严格按 Stage 顺序提交。
- **认为 Snowpipe 与 Bulk COPY 共用完整去重记录。** 两种方式使用不同的加载元数据，混用可能产生重复。
- **认为摄取完成就等于业务转换完成。** 复杂清洗、Join、聚合通常需要下游转换管道。
- **只以单条 INSERT 成功率衡量行流。** 应监测客户端 offset、重复、迟到和端到端可见性。

## 完成标准

- [ ] 能按输入形态和延迟要求选择 COPY、Snowpipe 或 Snowpipe Streaming。
- [ ] 能解释三种方式的触发方式和计算资源差异。
- [ ] 能说明文件加载历史、顺序和重复处理边界。
- [ ] 能设计事件 ID、offset、重试和下游幂等。
- [ ] 能以端到端延迟、吞吐、质量和费用验收摄取方案。

## 自测

1. 数据每晚提供一批数百 GB 文件，应该优先考虑哪种摄取方式？为什么？
2. 文件每隔几十秒到达，希望几分钟内可查询，Snowpipe 解决了哪部分工作？
3. 应用每秒直接生成数千条事件且要求秒级可见，为什么 Snowpipe Streaming 比定时 COPY 更合适？
4. Snowpipe 与 Bulk COPY 同时处理同一 Stage 文件，可能导致什么问题？

## 参考资料

- [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Snowpipe Streaming overview](https://docs.snowflake.com/en/user-guide/snowpipe-streaming/snowpipe-streaming-overview)
- [Bulk loading from a local file system](https://docs.snowflake.com/en/user-guide/data-load-local-file-system)
