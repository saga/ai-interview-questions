# 学习目标

能够根据输入形态、数据量、到达频率和延迟要求，选择适合的数据摄取方式，并设计加载校验与失败处理。

## 1. 先区分输入形态

| 方式 | 输入形态 | 典型使用方式 | 需要关注 |
|---|---|---|---|
| COPY INTO | 已准备好的文件 | 批量加载到表 | 文件清单、格式、错误行、重复加载 |
| Snowpipe | Stage 中到达的文件 | 文件到达后自动加载 | 通知配置、延迟、Serverless 费用 |
| Snowpipe Streaming | 连续到达的行数据 | SDK 或 REST API 写入 | 通道管理、顺序、吞吐与端到端延迟 |

不能仅按“实时/非实时”二分。文件大小、文件产生频率、数据格式、上游系统能力、错误恢复方式和费用模型都会影响选型。

## 2. 批量加载：COPY INTO

文件已经在内部或外部 Stage 中，且可以按批次管理时，COPY INTO 是直接的加载方式。工程上通常需要维护：

- Stage 路径和文件范围。
- File Format 与字段映射。
- 文件命名和批次标识。
- ON_ERROR 等错误处理配置。
- 加载结果与目标数据核对。

~~~sql
COPY INTO RAW.ORDERS
FROM @INGEST_STAGE/orders/
FILE_FORMAT = (FORMAT_NAME = RAW.CSV_FORMAT)
ON_ERROR = 'ABORT_STATEMENT';
~~~

这是示意 SQL。真实执行前要根据文件格式、目标表结构、权限和错误处理要求完成配置。

## 3. 文件持续到达：Snowpipe

Snowpipe 处理 Stage 中新到达的文件。通常由云存储事件通知触发加载，计算资源由 Snowflake 管理，不需要用户预先配置一个持续运行的 Warehouse。

适合文件持续生成、希望自动加载且不需要自行维护轮询服务的场景。需要监控文件通知、Pipe 状态、加载历史和实际端到端延迟。

Snowpipe 不意味着文件到达后立即对所有消费者可见。端到端延迟仍受事件通知、服务处理和下游转换影响。

## 4. 行级持续写入：Snowpipe Streaming

Snowpipe Streaming 允许通过 SDK 或 REST API 将行数据直接写入 Snowflake 表，不要求先将数据组织成文件放入 Stage。

它适合对加载延迟更敏感的事件流或应用事件数据。设计时需要考虑客户端重试、通道与偏移管理、重复数据处理、Schema 变化以及下游消费者如何验证数据完整性。

## 5. 摄取后的质量检查

加载成功不等于数据正确。建议至少建立以下校验：

1. 文件级：文件是否被发现、处理或拒绝。
2. 行级：拒绝行数量、解析错误和关键字段空值。
3. 批次级：源文件记录数与目标表加载记录数是否对齐。
4. 业务级：金额、数量、关键维度和业务日期是否符合预期。
5. 重放级：相同文件或事件重试后是否产生重复业务记录。

~~~mermaid
flowchart TD
  A[Source Files or Events] --> B{Input Pattern}
  B -->|Batch Files| C[COPY INTO]
  B -->|Continuous Files| D[Snowpipe]
  B -->|Row Events| E[Snowpipe Streaming]
  C --> F[Raw Tables]
  D --> F
  E --> F
  F --> G[Quality Checks and Reconciliation]
  G --> H[Quarantine / Retry]
  G --> I[Curated Data]
~~~

## 6. 工程案例：订单数据从不同渠道进入平台

电商订单来自三个系统：ERP 每晚导出批量 CSV，SaaS 系统每隔几分钟写出文件，网站交易服务持续产生订单事件。

一种可行设计是：

- ERP 批次使用 COPY INTO，保留批次 ID 和文件名。
- SaaS 文件评估 Snowpipe，避免自行维护频繁轮询。
- 网站事件评估 Snowpipe Streaming，并明确重复事件处理和端到端可见性要求。
- 三条链路统一落入 Raw 层，再做模式校验、业务键去重、金额对账和异常隔离。

这是教学设计案例。实际选型仍要结合数据量、账户能力、延迟目标、SDK 支持和成本测试。

## 7. 公开客户案例：Chocolate Finance 的数据新鲜度改进

Snowflake 发布的 Chocolate Finance 客户案例介绍了从批量报表向近实时数据的转变：原先报表数据最长可能滞后 24 小时，改造后接近实时。案例描述的数据路径使用 AWS S3 Stage、Snowpipe，以及 Snowflake 作为 Amazon Data Firehose 的目标端。

这个案例说明，数据新鲜度往往不是由单一摄取服务决定，而是由源事件、云存储、通知机制、摄取链路和下游消费共同决定。评估类似架构时，应把端到端可见延迟作为指标，而不是只测量文件进入 Snowflake 的时间。此处结果来自厂商发布的客户故事，不是所有账户都能复现的性能保证。

## 8. 常见误解

- **Snowpipe 和 Snowpipe Streaming 是同一种方式。** 前者面向 Stage 文件，后者可以直接摄取行数据。
- **加载成功就代表数据完整。** 还需要检查拒绝行、源目标数量和业务指标。
- **所有数据都应该追求最低延迟。** 更低延迟可能带来更复杂的生产运维和费用，应从业务新鲜度要求出发。
- **重复执行天然等于幂等。** 需要基于文件身份、批次、业务键或事件 ID 设计重放策略。

## 本节检查

1. 已有文件批量加载、持续文件加载和行事件摄取分别适合什么情况？
2. 为什么 Snowpipe Streaming 不能简单理解成“更快的 COPY INTO”？
3. 摄取完成后，如何证明数据既完整又符合业务口径？
