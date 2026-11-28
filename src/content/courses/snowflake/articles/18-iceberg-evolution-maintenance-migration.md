# Iceberg Schema 演进、维护与迁移验收

## Schema 与 Partition Evolution

Iceberg 通过字段 ID 等机制支持 Schema 演进，避免简单依赖列位置。Schema Evolution 和 Partition Evolution 能减少历史数据重写，但读写引擎必须遵守 Iceberg 规范和兼容边界。迁移时要验证字段类型、默认值、嵌套结构和分区变更在所有参与引擎中的解释一致。

## 快照与文件维护

快照提供表的时间版本；数据文件可能随持续写入变得碎片化，Manifest 也可能增长。维护包括 Snapshot Expiration、孤儿文件清理、Compaction 和 Manifest 优化。

外部 Catalog 场景中，Snowflake 不一定负责执行维护操作。Snowflake 官方文档明确区分了 Snowflake Catalog 与外部 Catalog：外部管理表需要使用自己的 Iceberg 引擎执行快照过期、元数据文件清理和数据文件压缩，并在维护后刷新 Snowflake 元数据。

## 迁移计划

1. 选定 Catalog 和写入权威，明确切换期间是否允许双写。
2. 盘点 Schema、Partition Spec、Snapshot 和文件数量。
3. 先进行一次全量基线对账，再进行增量追平。
4. 并行读取新旧表，比较关键业务指标、行数和抽样记录。
5. 验证权限、删除语义、并发写入和故障恢复。
6. 明确切换窗口、回滚点和旧系统冻结策略。

## 并发与提交冲突

多个写入者可能同时尝试提交新的 Metadata Pointer。必须使用 Catalog 所提供的提交协调机制，并处理冲突重试；不能把最后写入者覆盖前一个快照当成正常行为。写入端需要保持幂等，重试前确认操作是否已经提交。

## 验收指标

文件和记录数、关键列校验、业务指标一致性、快照增长速度、Metadata Refresh 时间、查询延迟、扫描数据量、并发提交失败率和清理策略对历史回滚窗口的影响都应进入验收记录。

## 检查题

1. 为什么外部 Catalog 下需要单独安排维护引擎？
2. Compaction 和 Snapshot Expiration 解决的是同一个问题吗？
3. Iceberg 迁移为什么必须设计双读对账和回滚窗口？
