# 外部 Iceberg 表的元数据刷新

## 本节要解决的问题

当外部引擎向 Iceberg 表写入新 Snapshot 后，让 Snowflake 识别最新的 Metadata Location 和表状态。Refresh 同步的是表元数据视图，不会重写 Parquet 文件、执行 Compaction、清理旧 Snapshot 或修复 Catalog 提交冲突。

## 核心知识

### 手动 REFRESH 将 Snowflake 元数据同步到外部 Catalog 最新状态

使用 External Catalog 的 Iceberg 表，Snowflake 需要读取 Catalog 当前指向的元数据文件。外部引擎提交新 Snapshot 后，Snowflake 可以通过以下命令同步外部表元数据：

~~~sql
ALTER ICEBERG TABLE LAKE.ORDERS REFRESH;
~~~

对于由外部 Iceberg 元数据文件路径创建的特定表，也可以在 REFRESH 中指定相对 metadata 文件路径；对于使用 External Catalog 的表，通常由 Catalog 提供最新 Metadata Location，而不是手工指定文件路径。

Refresh 不会将外部文件复制到 Snowflake-managed storage，也不会改变 Catalog 中谁有权提交 Snapshot。它只是让 Snowflake 重新读取当前表定义和 Snapshot。

### AUTO_REFRESH 对受支持 Catalog 持续轮询元数据

Snowflake 支持为特定外部 Catalog 配置自动刷新。Catalog Integration 可设置 REFRESH_INTERVAL_SECONDS，再在表上启用 AUTO_REFRESH=TRUE。Snowflake 以 Serverless 方式持续轮询 Catalog，同步最近的远端变化；该功能不依赖对象存储事件通知。

当前官方文档列出的支持范围包括符合 Apache Iceberg REST OpenAPI Specification 的 REST Catalog、Snowflake Open Catalog、AWS Glue 等特定 Catalog 类型。实际可用性取决于表的管理模式和 Integration 配置；不能假定任意自定义 Catalog 都支持自动刷新。

### Refresh 与维护操作必须分开

外部 Catalog 表的 Snapshot Expiry、旧 Metadata 文件清理和 Data File Compaction 需要由外部 Iceberg 引擎管理。维护完成后再 Refresh，让 Snowflake 看到维护后的 Snapshot。若只 Refresh 而不维护，小文件和旧 Snapshot 仍会累积；若先清理文件却没有正确考虑当前/保留 Snapshot，则可能破坏历史查询。

当外部引擎将外部表从 Iceberg v2 升级到 v3 时，Snowflake 的手动和自动 Refresh 可能失败。恢复需要外部引擎先执行能产生新 Snapshot 的 DML，使新版本信息进入新 Snapshot；之后在 Snowflake 中通过 CREATE OR REPLACE ICEBERG TABLE 重新读取更新后的元数据。单纯修改 format-version 属性而不生成新 Snapshot 不足以恢复。

## 工程实施步骤

1. **确认表管理模式。** 确认 Snowflake-managed 还是 External Catalog，记录 Catalog Integration、Catalog 类型和 Metadata Location。
2. **确认外部写入责任。** 明确哪个引擎和 Role 提交 Snapshot；Snowflake Role 能查询表不代表它能修改远端 Catalog 元数据。
3. **建立外部更新事件。** 在外部写入作业中记录 commit/snapshot ID、metadata location、完成时间和写入引擎。
4. **选择刷新策略。** 更新频率较低且可以接受延迟时使用手动 REFRESH；需要持续同步且 Catalog 支持时配置 REFRESH_INTERVAL_SECONDS 和 AUTO_REFRESH。
5. **启用前验证 Catalog 支持范围。** 检查 REST Catalog API、Open Catalog 或 Glue 配置、认证、凭证下发和允许的 Namespace。
6. **验证刷新结果。** 比较外部 Catalog 最新 Snapshot ID、Snowflake 可见表结构和查询结果；不能只看 REFRESH 命令是否成功。
7. **将维护与刷新串联。** 外部引擎执行 Compaction、Snapshot Expiry 或 Metadata Cleanup 后，安排 Snowflake Refresh，并确认查询读到新的文件布局。
8. **监控刷新延迟。** 记录外部提交时间、Snowflake 识别时间、自动刷新周期和失败次数，设置超过业务新鲜度目标时的告警。
9. **演练 Catalog 暂停、凭证过期、权限撤销、刷新失败和格式版本升级，保留恢复流程。
10. **治理表生命周期。** 维护责任、刷新责任、数据/元数据访问权限和历史 Snapshot 保留规则必须有明确 Owner。

示例：为受支持的 REST Catalog 配置自动刷新。

~~~sql
ALTER CATALOG INTEGRATION EXT_ICEBERG_CATALOG
  SET REFRESH_INTERVAL_SECONDS = 120;

ALTER ICEBERG TABLE LAKE.ORDERS
  SET AUTO_REFRESH = TRUE;
~~~

## 场景分析

Spark 每 10 分钟向外部 Catalog 管理的 Iceberg 订单表追加数据，Snowflake 用于运营分析。运营要求外部提交后五分钟内在 Snowflake 中可见。

先确认 Catalog 是否支持 AUTO_REFRESH，再设置刷新间隔并观察实际时间差。若 Catalog 不支持自动刷新，则在 Spark 作业成功提交 Snapshot 后调用 ALTER ICEBERG TABLE ... REFRESH。Snowflake 查询仍读到旧版本时，应检查远端 Catalog 当前 metadata location、Integration 访问权限和 Refresh 历史，而不是重复写数据。

若 Spark 每周执行 Compaction 和 Snapshot Expiry，应把维护结束事件与 Refresh 串联。Refresh 不能替代 Spark 的文件维护，也不应在 Snapshot 清理前后用不一致的版本判断查询结果。

## 常见误区

- **认为 REFRESH 会将外部数据复制到 Snowflake。** 它同步的是 Metadata/Snapshot 视图，不复制数据文件。
- **认为 AUTO_REFRESH 触发云存储事件通知。** 它按 Catalog Integration 配置持续轮询外部 Catalog。
- **认为刷新就会执行 Compaction 和 Snapshot Expiry。** 这些属于外部 Iceberg 引擎的维护责任。
- **忽略 Catalog 支持范围。** 不是任意 REST endpoint 或所有 Catalog 都支持自动刷新。
- **只检查 Refresh SQL 返回成功。** 还要确认 Snowflake 看到的 Snapshot、Schema 和查询结果与外部 Catalog 一致。
- **仅修改 Iceberg v3 属性后重试 Refresh。** 某些版本升级恢复需要先产生新 Snapshot，再在 Snowflake 重建表元数据。

## 完成标准

- [ ] 能说明手动 REFRESH 和 AUTO_REFRESH 的作用与区别。
- [ ] 能解释 Catalog Integration 的 REFRESH_INTERVAL_SECONDS。
- [ ] 能区分元数据刷新与文件 Compaction/Snapshot Expiry。
- [ ] 能根据 Catalog 类型选择手动或自动刷新。
- [ ] 能设计外部提交、刷新延迟和维护后的同步验证。
- [ ] 能识别 Iceberg 格式版本升级对刷新流程的影响。

## 自测

1. Spark 已提交新 Snapshot，但 Snowflake 仍查询到旧数据，应该检查哪些元数据边界？
2. AUTO_REFRESH 是否依赖 S3/GCS/Azure 文件通知？Snowflake 通过什么方式发现 Catalog 更新？
3. 外部 Iceberg 表完成 Compaction 后，为什么仍要 Refresh？
4. Catalog Integration 支持自动刷新，是否代表所有外部 Iceberg 表都能启用 AUTO_REFRESH？
5. 外部引擎把表升级到 Iceberg v3 后 Refresh 失败，为什么只修改 format-version 属性可能不够？

## 参考资料

- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
- [Automatically refresh Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-auto-refresh)
- [ALTER ICEBERG TABLE ... REFRESH](https://docs.snowflake.com/en/sql-reference/sql/alter-iceberg-table-refresh)
- [CREATE ICEBERG TABLE with REST catalog](https://docs.snowflake.com/en/sql-reference/sql/create-iceberg-table-rest)
