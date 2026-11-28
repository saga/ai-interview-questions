# Lakehouse 生产实践：围绕 Apache Iceberg 设计开放数据架构

## 场景与目标

平台希望多个计算引擎共享开放表格式，降低被单一引擎锁定的风险，同时继续使用 Snowflake 做分析。采用 Iceberg 后，团队仍须决定对象存储、Catalog、写入引擎、快照保留、文件维护和并发冲突由谁负责。

## 架构与数据流

~~~mermaid
flowchart TB
  Producers[数据生产者 / ETL] --> Writers[受控写入引擎]
  Writers --> Object[(对象存储 / Parquet)]
  Writers --> Meta[Iceberg Metadata / Snapshots]
  Catalog[Catalog] <--> Meta
  Readers[Snowflake / Spark / 其他引擎] --> Catalog
  Readers --> Object
  Ops[Compaction / Snapshot Expiry / Cleanup] --> Object
  Ops --> Meta
  Governance[权限、审计、质量] -.-> Catalog
~~~

## 实施步骤

1. 先明确多引擎读取、数据开放或存储责任等使用动机。若数据只在单一分析平台消费，原生表可能更简单。
2. 定义对象存储桶、加密、网络、生命周期和文件成本责任；区分平台管理表与外部管理表，维护职责不可混用。
3. 确认权威 Catalog、认证方式、命名空间、表注册和元数据刷新行为。多引擎写入前确认 Catalog 与提交协议支持目标并发模型。
4. 根据过滤条件、文件大小、写入频率和扫描模式设计分区。过细产生小文件和元数据开销，过粗增加无关扫描。
5. 制定 Schema/Partition Evolution、快照保留、过期清理和孤儿文件处理策略，先验证恢复窗口和审计需求。
6. 确定单写者、分区隔离或经过验证的并发提交模式；冲突后按业务语义重试，不能直接覆盖元数据文件。
7. 迁移时比较行数、主键集合、金额汇总、时间范围、空值分布和抽样结果；先影子读取，再切换消费者。
8. 监控快照数量、metadata 文件增长、小文件比例、孤儿文件、Catalog 失败、写入冲突和查询性能。



## 关键取舍

- Iceberg 让表格式和元数据规范更开放，但 Catalog、身份、网络和文件维护仍需明确责任。
- 托管模式降低部分维护工作，外部模式更灵活但需要团队承担更多维护；边界以目标平台支持能力为准。
- Schema/Partition Evolution 不代表所有引擎和版本都能无缝读写，上线前应验证兼容矩阵。
- 快照长保留有利于回滚和审计，但保留旧文件会增加成本；多引擎并发写入通常比开放读取更难。

## 验收清单

- 每张 Iceberg 表有明确 Catalog、存储和写入责任人。
- 目标引擎的读写兼容性经过版本化测试。
- Schema 与分区演进有变更计划和回滚方式。
- 并发冲突、快照过期、小文件和孤儿文件有演练。
- 迁移结果经过数据对账，对象存储和 Catalog 权限可审计。

## 关联知识点

以下节点教程保持各自独立；本教程只提供工程流程上的关联入口。

- [iceberg-open-table-format](../articles/iceberg-open-table-format.md)
- [iceberg-schema-partition-evolution](../articles/iceberg-schema-partition-evolution.md)
- [iceberg-maintenance-concurrency](../articles/iceberg-maintenance-concurrency.md)
- [iceberg-managed-external-basics](../articles/iceberg-managed-external-basics.md)
- [iceberg-metadata-refresh-basics](../articles/iceberg-metadata-refresh-basics.md)
- [iceberg-external-catalog-integration](../articles/iceberg-external-catalog-integration.md)
- [iceberg-metadata-files-manifests](../articles/iceberg-metadata-files-manifests.md)
- [iceberg-write-mode-conflict](../articles/iceberg-write-mode-conflict.md)
- [iceberg-migration-validation](../articles/iceberg-migration-validation.md)
- [snowflake-table-types](../articles/snowflake-table-types.md)

## 参考资料

- [Snowflake Apache Iceberg Tables](https://docs.snowflake.com/en/user-guide/tables-iceberg)
- [Manage Apache Iceberg Tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
- [Apache Iceberg Documentation](https://iceberg.apache.org/docs/latest/)

参考链接已登记为官方文档入口，来源状态保留为“待核验”，没有把链接登记等同于已逐项复核。
