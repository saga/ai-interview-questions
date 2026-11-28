# Snowflake-managed 与 External Iceberg 表

## 本节要解决的问题

选择由 Snowflake 管理 Catalog 和元数据，还是连接外部 Catalog 管理 Iceberg 表。关键差别不是“数据在 Snowflake 还是外部”，而是谁持有元数据提交权、谁负责维护快照、外部引擎如何看到写入，以及 Snowflake 访问云存储时采用何种凭证。

## 核心知识

### Snowflake-managed 表由 Snowflake 管理表元数据

Snowflake-managed Iceberg table 使用 Snowflake 作为 Catalog。表的数据文件位于配置的 External Volume，元数据由 Snowflake 生成和维护。External Volume 可以指向客户自己的云存储，也可以使用 Snowflake-managed storage（适用的区域和配置需核对）。

这种模式适合将 Snowflake 作为主要写入和 Catalog 管理入口，同时希望其他 Iceberg 引擎读取开放格式的场景。外部引擎仍需能够访问存储位置并理解生成的 Iceberg 元数据；Snowflake 管理元数据不意味着自动替外部引擎配置 IAM 权限。

### External Iceberg 表由远端 Catalog 决定当前 Snapshot

External Iceberg table 关联 AWS Glue、Databricks Unity Catalog、Snowflake Open Catalog 或其他受支持 Catalog。Snowflake 查询时需要发现或刷新外部 Catalog 中的元数据。可使用 Catalog Integration、External Volume 或 Catalog-vended credentials 连接远端 Catalog 和对象存储。

历史上的 external table 有只读场景，但当前 Snowflake 已支持对符合 Iceberg REST API 的外部 Catalog 表进行写入。配置可使用 catalog-vended credentials；不支持凭证下发的 Catalog 需要配置 External Volume 和 REST Catalog Integration。写入能力存在限制，包括仅支持 autocommit 事务，不支持多语句事务。应以当前文档中的 Catalog 和云区域支持表为准。

### 选择方式应围绕元数据控制权和运维责任

Snowflake-managed 模式下，Snowflake 负责 metadata/snapshot 更新、部分自动维护；External 模式下，外部 Catalog/引擎负责快照提交和表维护，Snowflake 需要刷新元数据以识别外部更新。两种模式都需要管理文件路径、访问授权、快照保留、查询性能和数据质量。

对于 Snowflake-managed Iceberg，表优化能力包括数据 Compaction、Manifest Compaction 和 Snapshot Expiry；External Catalog 表的快照过期、旧 Metadata 文件清理和数据文件 Compaction 必须由外部 Iceberg 引擎执行。不能把一套维护作业同时套用到两种管理模式。

## 工程实施步骤

1. 说明谁是主要写入引擎、谁是 Catalog 管理方，以及哪些系统需要读取最新 Snapshot。
2. 对 Snowflake-managed 模式配置 External Volume，检查存储区域、IAM、读写权限和元数据位置。
3. 对 External Catalog 模式配置 Catalog Integration，优先评估 catalog-vended credentials；必要时配置 External Volume。
4. 对外部写入场景核对 Catalog 是否符合 Iceberg REST API，并验证目标表/Namespace 的创建与写入权限。
5. 从 Snowflake 建立 Iceberg 表后，使用 SYSTEM$GET_ICEBERG_TABLE_INFORMATION 检查当前 metadata location 和状态。
6. 对 Snowflake-managed 表验证 Snowflake DML、snapshot 生成及外部引擎读取；对 External 表分别验证外部写入和 Snowflake 刷新后的读取。
7. 确认维护责任：Snowflake-managed 表由 Snowflake 支持的优化能力处理；External Catalog 表由外部引擎执行 compaction、snapshot expiry 和 metadata cleanup。
8. 对 External 表的每次外部维护后执行或安排 metadata refresh，确保 Snowflake 与 Catalog 的当前视图同步。
9. 演练 Catalog 不可用、凭证过期、写入冲突、刷新失败和存储权限撤销。

配置思路示例：

~~~sql
CREATE CATALOG INTEGRATION EXT_ICEBERG_CATALOG
  CATALOG_SOURCE = ICEBERG_REST
  TABLE_FORMAT = ICEBERG
  REST_CONFIG = (
    CATALOG_URI = 'https://catalog.example.com/api'
  )
  ENABLED = TRUE;
~~~

真实配置还需要认证、凭证下发或 External Volume 等参数，不能直接把示例 URI 当生产配置。

## 场景分析

数据湖由 Databricks Unity Catalog 管理，Snowflake 团队希望读取并写回部分 Iceberg 表。若仅采用只读的外部表配置，Snowflake 可以读取外部快照，但无法满足数据转换写回需求。应评估 REST Catalog Integration、credential vending 或 External Volume，并核对外部写入功能的可用性和事务限制。

如果 Snowflake 是唯一写入者，Snowflake-managed 模式通常更容易将维护与刷新责任集中在 Snowflake；如果多个引擎都要写同一表，则应由共同的 Catalog 协议协调。选择结果要记录谁管理 Snapshot、谁进行 Compaction、谁刷新 Snowflake 元数据，以及谁有权清理文件。

## 常见误区

- 认为 External Iceberg 表永远只读。当前 Snowflake 已有受限的 external catalog 写入能力。
- 认为 Snowflake-managed 表不需要云存储权限。外部引擎仍需按存储路径和身份获得访问权。
- 将 External Volume 与 Catalog Integration 混为一个对象。前者连接存储，后者连接 Catalog。
- 对 external catalog 表依赖 Snowflake 自动完成全部维护。外部表维护需要由外部 Iceberg 引擎负责。
- 对 Snowflake-managed 和 external table 使用同一套快照清理策略。元数据责任不同，操作权限和风险也不同。
- 忽略 autocommit 限制。External table 写入不支持多语句事务。

## 完成标准

- [ ] 能解释 Snowflake-managed 和 external catalog 的元数据控制权差异。
- [ ] 能区分 External Volume、Catalog Integration 和 Catalog-vended credentials。
- [ ] 能识别外部表写入和事务限制。
- [ ] 能分别制定两种模式的 Compaction、Snapshot Expiry 和 Refresh 策略。
- [ ] 能验证元数据位置、凭证、读写和外部引擎互操作。

## 自测

1. Snowflake-managed Iceberg table 和 external catalog table 的当前 snapshot 分别由谁提交？
2. Catalog 支持 credential vending 时，为什么可能不需要用 External Volume 配置相同的存储凭证路径？
3. 对 external catalog 表执行写入后，为什么还要关注 Catalog 提交和刷新行为？
4. 为什么不能用 Snowflake-managed 表的自动维护规则推断 external table 也会自动 compact？

## 参考资料

- [Create Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-create)
- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
- [Write support for externally managed Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-externally-managed-writes)
- [Use catalog-vended credentials](https://docs.snowflake.com/en/user-guide/tables-iceberg-catalog-vended-credentials)
