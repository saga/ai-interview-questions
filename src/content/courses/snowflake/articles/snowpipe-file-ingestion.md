# 批量加载与 Snowpipe 文件摄取

## 本节要解决的问题

按抵达方式、延迟、规模、重放和成本选择 COPY INTO、Snowpipe 与加载校验。文件上传到 Stage 只是接入准备，文件解析、目标表写入、拒绝记录处理和下游可见性必须分别验证。

## 核心知识

### COPY INTO 由用户管理 Warehouse 执行批量加载

COPY INTO table 从 Internal 或 External Stage 读取文件并写入目标表。它适合定时批处理、大批量迁移和有明确批次边界的作业。调用方需要选择 Warehouse，定义 File Format、文件 Pattern、列映射和 ON_ERROR 策略，并通过 COPY_HISTORY 或相关加载历史核对文件是否已处理。

批量加载通常可以在一次作业中处理多个文件。文件加载历史有保留期限，长期重放或业务去重不能只依赖 Snowflake 文件历史，应保存源文件 ID、批次 ID 和业务唯一键。

### Snowpipe 对到达 Stage 的文件执行自动摄取

Snowpipe 将 COPY INTO 语句封装为 Pipe，由 Snowflake 管理的 Serverless Compute 处理。自动摄取可由云存储事件通知触发，适合持续到达、希望在下一次批量窗口之前可查询的文件。Pipe 负责文件摄取，不替代复杂清洗、Join 和业务转换。

文件到达顺序不保证等于加载顺序。Snowpipe 使用文件加载元数据判断已处理文件，但其历史窗口有限，不能将其视为长期 exactly-once 业务保证。与 Bulk COPY 混用时，需要明确两种方式的加载记录边界，避免同一文件重复处理。

### 延迟需要拆成到达、摄取与业务完成时间

文件到达 Stage、Snowpipe 完成加载、下游 Streams/Tasks 或 Dynamic Tables 完成转换，是三个不同时间点。应分别记录文件通知时间、Pipe 加载时间、目标表可见时间和下游业务完成时间。否则无法确定“数据晚了”究竟是源端交付、摄取还是转换造成的。

## 工程实施步骤

1. 记录文件到达频率、平均/峰值文件大小、允许延迟、文件修订方式和下游消费时间。
2. 对定时批次或大量文件评估 COPY INTO；对持续到达的文件评估 Snowpipe；不要仅因“实时”标签直接选 Snowpipe。
3. 配置 Stage、Storage Integration、File Format 和文件命名规则，明确 ON_ERROR、Pattern 与拒绝文件处理。
4. 为文件登记稳定 file_id、batch_id、源系统、到达时间、文件 hash 和业务日期。
5. Snowpipe 自动摄取时配置云事件通知、Pipe 和服务监控；检查 Pipe 状态、通知积压和加载历史。
6. 对每批核对源文件数、解析行数、成功加载行数、拒绝行数、目标主键数和金额等业务汇总。
7. 设计迟到、重复、重发和更正文件的处理规则；需要重放时先检查加载历史和目标业务键，再执行幂等 MERGE。
8. 将加载成功与下游转换成功分开记录，使用 Streams/Tasks 或 Dynamic Tables 管理后续业务处理。
9. 按观察窗口比较端到端延迟、失败率、重试次数和费用，确认 Snowpipe 的自动化收益是否值得 Serverless 成本。

示例：定义自动摄取 Pipe。实际 Stage、File Format 和事件通知需在环境中配置。

~~~sql
CREATE PIPE RAW.ORDER_PIPE
  AUTO_INGEST = TRUE
AS
COPY INTO RAW.ORDERS
FROM @RAW.ORDERS_STAGE
FILE_FORMAT = (FORMAT_NAME = RAW.ORDER_CSV)
ON_ERROR = 'CONTINUE';
~~~

## 场景分析

供应商每五分钟上传一批 CSV，业务希望文件到达后几分钟内可查询。若继续由每小时批处理扫描 Stage，数据会等待下一个调度窗口；Snowpipe 可以响应文件事件并自动摄取。但文件中偶有坏行和重复批次，自动摄取并不解决业务重复和质量问题。

设计中应保留 file_id 和 batch_id，分别核对文件通知、Pipe Load History、拒绝行和目标表记录。下游按业务键执行幂等合并。对于超过可接受延迟仍未完成的文件，应检查事件通知、Pipe 状态和失败文件，而不是直接重放整个 Stage 目录。

## 常见误区

- 把 Snowpipe 当通用 ETL 引擎。它主要摄取文件，复杂转换通常需要下游管道。
- 文件到达 Stage 就认为目标表已经可查询。还需等待事件通知和实际加载。
- 认为 Snowpipe 保证严格文件顺序。到达顺序不等于处理顺序。
- 将 Pipe Load History 当永久去重日志。仍需保留业务批次和唯一键。
- Bulk COPY 与 Snowpipe 同时处理同一文件而不设计边界。可能出现重复加载。
- 只监控 Pipe 状态，不检查下游业务质量。加载成功不能证明数据完整正确。

## 完成标准

- [ ] 能区分 Bulk COPY 与 Snowpipe 的执行资源和触发方式。
- [ ] 能说明 Pipe、Stage、File Format 和云事件通知的关系。
- [ ] 能设计文件去重、拒绝行、迟到和重放机制。
- [ ] 能分开测量文件到达、加载和下游完成时间。
- [ ] 能用加载历史和业务对账验证结果。

## 自测

1. 一批文件每天只上传一次但容量很大，为什么 COPY INTO 可能比 Snowpipe 更合适？
2. Snowpipe 显示加载成功，但报表缺少订单，下一步应检查哪些下游环节？
3. 两个加载路径可能重复处理同一文件，应该如何设计文件登记和业务幂等？
4. 文件到达顺序与 Pipe 处理顺序不同，如何保证业务按事件时间处理？

## 参考资料

- [Data loading overview](https://docs.snowflake.com/en/user-guide/data-load-overview)
- [Snowpipe introduction](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Snowpipe auto-ingest](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-auto)
