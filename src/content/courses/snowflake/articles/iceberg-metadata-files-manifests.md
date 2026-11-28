# Iceberg Metadata、Manifest 与 Snapshot 读取路径

## 本节要解决的问题

从 Iceberg 元数据结构理解一次查询如何找到当前数据文件，并使用 Snapshot、Manifest 和文件统计解释查询历史、时间点读取与 metadata 增长。排障时要能区分“Catalog 指向了哪个 metadata 文件”“Snapshot 包含哪些文件”和“Query 实际扫描了哪些数据”。

## 核心知识

### Metadata JSON 记录表当前状态

Iceberg 表有 metadata JSON 文件，其中记录 Schema、Partition Specs、Snapshot 列表、当前 Snapshot ID 和 Manifest List 位置。每次提交通常产生新的 metadata 版本并通过 Catalog 更新当前 metadata location。旧 metadata 文件是否继续保留由表维护策略决定。

### Snapshot 与 Manifest 描述文件集合

Snapshot 表示某一时刻表的逻辑状态。每个 Snapshot 引用一个 Manifest List；Manifest List 再引用多个 Manifest。Manifest 中记录数据文件、删除文件、分区值和文件统计等信息。查询引擎根据当前 Snapshot 确定要读取的文件集合，不需要扫描对象存储中所有历史文件。

新增数据会形成新 Snapshot；删除或更新可以通过删除文件、位置删除或其他受支持的行级删除机制表达，具体依赖 Iceberg 版本和引擎能力。时间旅行读取某个旧 Snapshot 时，会读取该 Snapshot 所引用的数据文件集合，而不是把当前表做一次备份。

### Manifest 统计帮助减少扫描，但不代表所有文件都可剪枝

Manifest 中的分区值、列统计和文件大小可帮助引擎裁剪不相关文件。若上游 Writer 没写完整的 Parquet statistics，或者分区设计与查询条件不匹配，查询可能需要检查更多文件。Snowflake 文档建议外部管理 Iceberg 表尽可能写完整的 Parquet 统计信息，包括 Min/Max、NDV 和 Null Count。

Manifest 数量增加会提高元数据规划开销；小 Manifest 可以通过 Manifest Compaction 合并。频繁 snapshot 与大量小文件会增加元数据规模和刷新时间，需要结合写入频率与维护策略控制。

## 工程实施步骤

1. 用 Iceberg 元数据表或支持的 Iceberg 工具读取表的当前 metadata JSON、Snapshot、Manifest List 和 Manifest。
2. 记录当前 Snapshot ID、提交时间、Schema ID、Partition Spec ID 和当前 metadata location。
3. 选一个查询，检查它命中的 Snapshot 和数据文件，比较分区值、文件统计与实际扫描范围。
4. 若扫描文件过多，先核对写入端是否生成完整 Parquet statistics，再检查分区和排序方式。
5. 若 Manifest 数量过多，评估 Manifest Compaction；若数据文件很多且过小，再评估数据文件 Compaction。
6. 设计 Snapshot 保留策略，明确时间旅行、故障恢复和法规保留需要的窗口。
7. 变更维护策略前，记录活跃 Snapshot、分支/标签引用和消费者所需的历史数据。
8. 对外部 Catalog 表维护或 snapshot 变化后，安排 Snowflake metadata refresh 并验证其看到最新 Snapshot。
9. 用相同查询与数据范围对比优化前后的规划时间、扫描文件数、扫描字节和总延迟。

## 场景分析

一个 Iceberg 表每天由多个小批次追加，数据文件从几百个增长到数十万个。Snowflake 查询本身扫描数据量不大，但编译/规划阶段开始变慢，外部 Catalog refresh 也变长。

应检查 Snapshot 数量、Manifest List/Manifest 数量、数据文件数量和 Parquet statistics。对 Snowflake-managed 表可使用平台支持的 Manifest Compaction 与数据 Compaction；对 external catalog 表，维护由外部 Iceberg 引擎负责，完成 snapshot expiry 或 compaction 后再 refresh Snowflake metadata。

验收需要比较规划耗时、刷新耗时、扫描文件数、Query Profile 执行时间和保留窗口。不要仅以对象存储中的文件总量判断当前 Snapshot 的数据量，因为过期或孤儿文件可能不属于当前表。

## 常见误区

- 把 Metadata JSON 当作完整的数据文件清单。它通过 Snapshot 和 Manifest List 间接引用文件。
- 把旧 Snapshot 等同于完整数据副本。Snapshot 通常引用共享数据文件并通过增量元数据描述状态。
- 认为对象存储目录里的所有 Parquet 文件都属于当前表。只有当前 Snapshot 引用的文件才构成当前表状态。
- 认为 Manifest 越多查询一定越并行。元数据规划和文件调度也会产生开销。
- 只优化数据文件，不维护 Manifest 和 Snapshot。元数据膨胀也会拖慢规划和刷新。
- 对外部表做 Snapshot Expiry 后不 refresh。Snowflake 可能仍持有旧元数据视图。

## 完成标准

- [ ] 能画出 metadata JSON、Snapshot、Manifest List、Manifest 和数据文件的引用关系。
- [ ] 能说明 Snapshot 的时间点语义与数据文件共享。
- [ ] 能解释文件统计与分区信息如何帮助剪枝。
- [ ] 能区分数据文件 Compaction 与 Manifest Compaction。
- [ ] 能为外部表维护设计 metadata refresh。

## 自测

1. Catalog 指向一个 metadata JSON，怎样找到当前查询实际要读取的 Parquet 文件集合？
2. 为什么对象存储上存在很多历史 Parquet 文件，不代表这些文件都属于当前表？
3. Manifest 数量激增但 Parquet 文件大小合理，应该检查什么维护机制？
4. External Catalog 完成 Snapshot Expiry 后，为什么需要让 Snowflake 刷新元数据？

## 参考资料

- [Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg)
- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
- [Best practices for Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-best-practices)
- [Iceberg specification: table metadata](https://iceberg.apache.org/spec/#table-metadata)
