# 端到端数据工程管道

## 本节要解决的问题

电商系统每天把订单 JSON 文件写入对象存储。财务要求早上 8 点前看到前一天完整订单；运营则希望新订单进入仓库后几分钟内可查。两类需求使用同一个目标表，但接入方式、错误处理和验收标准不同。

一条数据管道至少要把文件或事件接入、解析、标准化、业务校验和下游发布分开。COPY 或 Snowpipe 显示加载成功，只能证明某个加载步骤完成，不代表订单没有重复、金额没有丢失或下游模型已经更新。

## 核心知识

### 批量文件、持续文件和行级事件不是同一种输入

| 输入形态 | 常见方式 | 适用情况 | 主要考虑 |
|---|---|---|---|
| 固定批次文件 | COPY INTO | 文件按批次完整交付，允许按计划运行 | 批次清单、文件级重试、对账 |
| 持续到达的文件 | Snowpipe Auto-ingest | 文件持续写入云存储，希望自动触发加载 | 事件通知、Pipe 状态、漏文件恢复 |
| 高频行级事件 | Snowpipe Streaming | 需要低延迟写入行数据，不以文件为交付单位 | 客户端提交、通道状态、行级错误与重放 |

Snowpipe Auto-ingest 仍然是文件摄取。云存储发出的事件通知包含新文件路径，Snowflake 根据 Pipe 中的 COPY INTO 语句读取 Stage 文件；它不会把事件通知本身当成数据行。Snowpipe Streaming 则通过 Streaming API 接收行数据，使用方式与文件 Pipe 不同。

### 一条可恢复的文件管道要分开管理 Raw、标准化和消费数据

以订单 JSON 为例，建议保留原始输入及批次信息，再产生标准化订单和消费模型：

~~~mermaid
flowchart LR
  A["对象存储订单文件"] --> B["Stage / COPY 或 Snowpipe"]
  B --> C["RAW_ORDERS"]
  C --> D["解析与标准化"]
  D --> E["STG_ORDERS"]
  E --> F["业务键、金额和状态校验"]
  F --> G["CURATED_ORDERS"]
  F --> H["拒绝行与错误队列"]
  G --> I["报表 / Semantic View"]
~~~

Raw 层尽量保留来源文件、加载时间和原始字段，便于重放和追溯。标准化层负责类型转换、字段映射和状态归一。Curated 层只发布通过业务校验的数据。拒绝记录应保留失败原因，不能把异常行静默丢掉。

### Snowpipe Pipe 保存的是一条 COPY 规则，不是数据表

创建 Pipe 时要明确 Stage、目标表、文件格式和加载转换：

~~~sql
CREATE PIPE raw_orders_pipe
  AUTO_INGEST = TRUE
AS
  COPY INTO raw_orders
  FROM @orders_stage
  FILE_FORMAT = (TYPE = 'JSON')
  MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
~~~

AUTO_INGEST = TRUE 启用云事件通知触发的文件加载。实际部署还要配置 S3/SQS、GCS/Pub/Sub 或 Azure Event Grid 等通知链路，以及 Snowflake 访问 Stage 所需的 Storage Integration。Pipe 定义本身不会创建云端通知配置。

文件路径范围必须规划好。多个 Pipe 如果监听同一 Bucket 的重叠目录，可能把同一个文件加载到多个目标表，甚至重复写入同一业务域。

### Pipe 不会自动补齐通知缺失的历史文件

Snowpipe 依赖事件通知队列。通知没有发出、Pipe 创建之前已经存在的文件、队列中漏掉的文件，不会自动因为文件还在 Stage 就被加载。

可以通过 Pipe 状态检查是否仍在运行：

~~~sql
SELECT SYSTEM$PIPE_STATUS('RAW_DB.INGEST.RAW_ORDERS_PIPE');
~~~

需要补载近期遗漏文件时，可以使用：

~~~sql
ALTER PIPE RAW_DB.INGEST.RAW_ORDERS_PIPE REFRESH;
~~~

REFRESH 适合偶发恢复，不是替代事件通知的轮询机制。重建 Pipe 后要特别小心：新 Pipe 没有旧 Pipe 的加载元数据，直接无条件 REFRESH 可能把旧文件再次排队。应根据旧 Pipe 暂停时间或最后已摄取时间设置 MODIFIED_AFTER，并结合 COPY_HISTORY 核对文件。

COPY_HISTORY 的 Account Usage 视图有延迟；查询不到刚刚完成的加载，不等于文件没有加载。要结合 Pipe Details、Pending Files、事件记录和时间窗口判断，不能仅凭一个空结果重放文件。

## 工程实施步骤

1. 为每个来源记录文件命名规则、目录范围、交付时间、业务日期和批次标识。
2. 根据延迟要求决定 COPY、Snowpipe Auto-ingest 或 Snowpipe Streaming，不因“持续数据”几个字就默认选 Snowpipe。
3. 建立 Raw 目标表，保留源文件名、加载时间、原始业务键和必要的批次信息。
4. 为文件格式、列名匹配、类型转换和 ON_ERROR 策略建立明确配置；先用样本文件做解析测试。
5. 将标准化和业务校验与文件加载分开，统计输入行、成功行、拒绝行、重复行和目标行数。
6. 记录文件加载历史和 Pipe 状态；对漏通知、文件早于 Pipe 创建时间和失败文件准备恢复步骤。
7. 为批次发布设置控制总额，例如订单数、订单金额、退款金额和关键状态数量，与源系统对账。
8. 用同一批次重复执行恢复流程，确认重复文件不会制造重复业务行；必要时使用稳定业务键和版本规则做下游幂等。
9. 只有当 Curated 层质量检查通过，才让下游任务、报表或 Semantic View 看见该批次为正式数据。
10. 对端到端新鲜度、失败文件、拒绝行比例、Pipe 停滞和下游更新时间设置监控与责任人。

## 场景分析

订单文件每天 07:00 交付，财务要求 08:00 前完成结算；营销活动期间，运营希望新订单在几分钟内进入实时看板。

财务批次可以用 COPY INTO 按文件清单加载，并在全部文件到齐后执行对账和发布。运营实时看板可以用 Snowpipe Auto-ingest 处理新增文件，但不能把它当作严格的分钟级 SLA：要监控实际到达与加载延迟，且要能发现没有事件通知的文件。

某次云端通知通道中断 20 分钟。Pipe 恢复后不能只看“Running”状态就宣布数据完整。先列出中断期间 Stage 中的文件，再与 COPY_HISTORY、Pipe 的已摄取时间和目标表文件清单对照。确认漏掉哪些文件后再执行 REFRESH 或定向 COPY，并核对不会重放已经成功加载的文件。

## 常见误区

- **把 Snowpipe 当成事件消息队列。** Auto-ingest 通知的是文件路径，数据仍由 Pipe 中的 COPY INTO 从 Stage 读取。
- **认为 Pipe 创建后会自动加载此前所有文件。** 历史文件和漏通知文件要按恢复流程补载。
- **用 REFRESH 当成定时轮询。** REFRESH 是恢复手段，不能替代事件通知，也不能随意在重建 Pipe 后无条件执行。
- **把 Pipe Running 当成数据新鲜度正常。** 还要看最后加载时间、Pending Files、错误文件和下游更新时间。
- **只看加载成功数量，不对账业务结果。** 需要比较批次行数、金额、重复键和拒绝记录。
- **让 Raw 表直接成为业务报表数据源。** 原始接入和业务消费应有独立的质量门禁。

## 完成标准

- [ ] 能根据输入延迟和数据形态选择 COPY、Snowpipe 或 Snowpipe Streaming。
- [ ] 能说明 Snowpipe Auto-ingest 的事件通知与 COPY INTO 分工。
- [ ] 能设计 Raw、标准化、Curated 和拒绝数据的职责。
- [ ] 能检查 Pipe 状态、加载历史并恢复漏载文件。
- [ ] 能解释重建 Pipe 后 REFRESH 可能重复排队旧文件的风险。
- [ ] 能用批次行数、控制总额和重放测试验收整条管道。

## 自测

1. Snowpipe Auto-ingest 收到云端事件通知时，通知中包含文件数据还是文件路径？真正读取文件的是哪一步？
2. Pipe 运行正常，但某个 Stage 文件始终没有进入目标表。应检查哪些通知、Pipe 和加载历史证据？
3. 新 Pipe 创建后直接执行无条件 REFRESH，为什么可能重新加载旧文件？如何限定需要补载的时间范围？
4. 财务批次要求完整交付，运营要求几分钟内可见。两者是否应该使用同一种摄取模式？
5. COPY INTO 显示文件加载成功，但 Curated 表订单金额与源系统不一致。还需要检查哪些阶段？

## 参考资料

- [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Automate Snowpipe with cloud event notifications](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-auto)
- [Manage Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-manage)
- [CREATE PIPE](https://docs.snowflake.com/en/sql-reference/sql/create-pipe)
