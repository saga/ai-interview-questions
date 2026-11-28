# Apache Iceberg 与 Snowflake Lakehouse 架构

## Iceberg 解决什么问题

Apache Iceberg 是开放表格式，使用数据文件、Manifest、Manifest List 和 Metadata JSON 描述表的快照与结构。它让多个兼容引擎在遵循同一表格式协议的前提下访问数据，而不把数据完全绑定到单一引擎的私有表存储。

Snowflake 使用 Iceberg Table 将平台计算与开放存储格式结合。架构设计时必须明确 Catalog、对象存储、计算引擎、元数据写入权和维护责任。

## Catalog 决定了谁是元数据权威

Snowflake-managed Catalog 与外部 Catalog 的责任不同。前者由 Snowflake 管理 Iceberg 元数据生命周期；外部 Catalog 的表则可能由外部引擎负责提交和维护。不能只根据 SQL 查询是否成功，就推断 Snowflake 拥有所有元数据维护权。

## 关键组件

- Data Files：实际表数据文件，通常为 Parquet。
- Manifest：记录数据文件及分区值、统计信息。
- Manifest List：聚合某个快照引用的 Manifest。
- Metadata JSON：记录 Schema、Snapshot、Partition Spec 和表属性。
- Catalog：维护当前元数据指针和提交协调。

查询时，读取路径从 Catalog 获得当前元数据，再沿快照和 Manifest 找到需要扫描的数据文件。

## 架构选择前先回答

1. 数据放在哪个对象存储和 Region？
2. 谁拥有 Catalog，谁可以提交新快照？
3. 哪些引擎需要读写？
4. 权限如何跨引擎和云账户传递？
5. 谁负责 Compaction、Snapshot Expiration 和 Metadata Refresh？
6. 如何处理并发写入和提交冲突？

## 不要把开放格式等同于零治理成本

开放格式提高互操作性，但引入 Catalog、凭据、文件生命周期、Schema Evolution 和并发写入的协作问题。生产上线前要做多引擎读写测试、故障恢复演练和数据对账。

## 检查题

1. Iceberg 的 Catalog 和 Metadata JSON 分别承担什么职责？
2. 为什么外部 Catalog 会改变维护责任？
3. 如何确认多个引擎看到的是同一个一致快照？
