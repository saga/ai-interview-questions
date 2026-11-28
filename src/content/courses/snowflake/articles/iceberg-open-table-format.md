# Apache Iceberg 与开放 Lakehouse 架构

## 本节要解决的问题

理解 Apache Iceberg 是表格式而不是数据库或计算引擎，并厘清数据文件、表元数据、Catalog 和查询引擎的关系。采用开放表格式的价值在于让多个引擎按统一元数据协议访问同一份数据；代价是需要设计元数据写入权、提交协调、文件生命周期和权限边界。

## 核心知识

### Iceberg 以快照和元数据描述表状态

Iceberg 数据通常以 Parquet 等列式文件保存。表的当前状态由 metadata JSON、Manifest List、Manifest 和数据文件共同描述。Metadata 指向当前 Snapshot；Snapshot 引用 Manifest List；Manifest 记录数据文件及其统计和分区信息。查询引擎先读取元数据确定本次扫描的数据文件，再读取相应列式文件。

这与直接扫描一个对象存储目录的 Hive 风格发现方式不同。Iceberg 不依靠目录名来唯一决定表的当前状态，而是通过元数据快照描述哪些文件属于当前表。新增、删除或更新通常通过提交新的元数据版本表达，旧快照可在保留策略允许时继续读取。

### Catalog 是表名到当前元数据位置的协调入口

Catalog 负责命名空间、表标识和当前 metadata location。S3/GCS/Azure 等对象存储保存数据和元数据文件；Spark、Trino、Snowflake 等引擎通过 Catalog 找到表，并读取对应文件。Catalog 不是数据文件本身，也不是查询计算引擎。

多个引擎要安全读写同一张表，必须遵循 Catalog 的提交协议。并发写入时，不能让不同引擎各自直接覆盖元数据指针；提交者需要检测冲突并基于最新 snapshot 重试或合并。

### 开放格式并不自动等于多引擎任意写入

Iceberg 提供开放的表元数据和快照协议，但实际可用能力取决于引擎版本、Catalog 类型、表版本和云存储授权。某些引擎只支持读取；某些写入路径仅支持部分 DML；某些 Catalog 需要 credential vending 或 REST API。

Snowflake 当前支持 Snowflake-managed Iceberg tables，也支持连接外部 Catalog 的 Iceberg 表；2026 年的外部管理表写入能力已扩展到符合 Iceberg REST API 的 Catalog。具体写入能力仍有边界，例如外部管理写入仅支持自动提交事务，不支持多语句事务。设计时必须按实际管理模式和支持矩阵选择，而不是笼统声称所有引擎都能完整读写。

## 工程实施步骤

1. 明确数据文件存储位置、文件格式、Catalog 类型、写入引擎、读取引擎和数据产品消费者。
2. 将数据文件、Iceberg 元数据和 Catalog 作为三个独立责任面记录，分别确定 Owner 和访问权限。
3. 选择 Snowflake-managed 或 external catalog 模式，并核实表版本、DML、Schema 演进、维护和事务支持情况。
4. 对每个引擎确认读写功能、Catalog 协议、认证和凭证下发能力；不要仅凭“支持 Iceberg”判断可写入。
5. 确认对象存储路径权限、Catalog Namespace 权限、表级 Grants 和密钥/临时凭证生命周期。
6. 为多写入方定义唯一的提交协调方式，明确冲突检测、重试、幂等业务键和失败后的 snapshot 核验。
7. 使用同一张代表性表验证跨引擎读取、类型映射、分区裁剪和写入可见性。
8. 建立文件 compaction、snapshot 保留、metadata refresh 和孤儿文件治理的责任分工。
9. 记录不同引擎实际使用的表版本、Catalog API、功能限制和验收日期，升级时重新执行兼容测试。

## 场景分析

数据平台将订单明细保存在对象存储中，Spark 用于批量转换，Snowflake 用于 SQL 分析，另一个引擎用于特征工程。团队希望避免三份数据副本。

采用 Iceberg 可以让多个引擎围绕同一张表共享快照元数据，但必须先确定 Catalog 是谁管理。若 Spark 和 Snowflake 都写同一个 external catalog 表，要确认 Catalog REST 提交协议、凭证和冲突重试行为；若只允许 Spark 写、Snowflake 读，架构可以更简单，但 Snowflake 的 metadata refresh 需要跟上外部写入。不能仅共享对象存储目录就认为多个引擎看到同一张表的同一版本。

验收包括跨引擎 snapshot 一致性、并发写入冲突、字段类型、删除语义、文件维护和访问撤销。

## 常见误区

- 把 Iceberg 当成数据库或计算引擎。它定义表格式和元数据协议，查询和计算由其他引擎完成。
- 把 Catalog 当作对象存储。Catalog 维护表标识和当前元数据位置，实际 Parquet 与 Manifest 文件保存在存储中。
- 认为同一份 Parquet 文件就代表同一张 Iceberg 表。引擎还必须理解同一 Catalog 中的 metadata 和 snapshot。
- 认为开放格式意味着所有引擎都支持完整读写。需逐项核对版本、Catalog、DML 和事务能力。
- 允许多引擎直接覆盖 metadata 文件。必须通过 Catalog 提交协议协调快照更新。
- 只测试跨引擎读取，不测试维护和快照变化。Compaction、过期与 refresh 同样会影响可见性。

## 完成标准

- [ ] 能解释数据文件、Manifest、Snapshot、metadata JSON 和 Catalog 的关系。
- [ ] 能区分表格式、Catalog、对象存储和计算引擎。
- [ ] 能识别开放格式的互操作能力与实际引擎支持边界。
- [ ] 能为多写入方设计 Catalog 提交与冲突处理。
- [ ] 能明确数据、元数据、凭证和维护的责任边界。

## 自测

1. Catalog 不可用时，为什么引擎可能无法仅凭已知的 Parquet 路径安全读取最新表状态？
2. 两个引擎同时写 Iceberg 表，为什么不能各自把 metadata 文件指针直接更新到自己的结果？
3. Snowflake 能查询外部 Iceberg 表，是否就代表它支持该表的所有 DML 和多语句事务？
4. 采用 Iceberg 后，哪些数据副本可以减少，哪些元数据和计算资源仍然需要管理？

## 参考资料

- [Apache Iceberg tables in Snowflake](https://docs.snowflake.com/en/user-guide/tables-iceberg)
- [Create Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-create)
- [Write support for externally managed Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-externally-managed-writes)
- [Apache Iceberg specification](https://iceberg.apache.org/spec/)
