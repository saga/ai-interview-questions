# 微分区与分区裁剪基础

## 本节要解决的问题

理解 Snowflake 如何自动把表组织成微分区，以及查询优化器如何利用微分区元数据减少扫描。与传统数据库由管理员显式定义分区不同，Snowflake 标准表的微分区由平台自动维护；工程师主要负责设计有利于裁剪的数据写入顺序、观察扫描效果，并在确有收益时评估 clustering。

## 核心知识

### 微分区由 Snowflake 自动创建和维护

Snowflake 标准表的数据会自动划分为连续存储单元，每个微分区通常包含约 50–500 MB 未压缩数据。数据按列式方式组织并独立压缩。用户不需要声明分区数量，也不能像传统分区表那样逐个创建、拆分或维护微分区。

平台为微分区保存元数据，包括列值范围、不同值数量等信息。这些信息让优化器能够在执行查询时跳过与过滤条件无关的数据块。

### Pruning 减少需要扫描的微分区和列

查询包含可利用的谓词时，Snowflake 可根据微分区元数据排除不可能满足条件的微分区。剩余微分区内又可按列扫描，只读取查询需要的列。并非所有表达式都能有效剪枝；例如文档指出，带子查询的谓词即使子查询结果为常量，也不一定用于微分区裁剪。

因此要同时检查过滤谓词是否可裁剪、数据值是否在微分区间内充分聚集，以及扫描比例是否符合业务选择性。

### Clustering 是对数据组织方式的进一步管理

数据写入时形成的自然顺序会影响微分区之间的值域重叠。Snowflake 维护 clustering metadata 和 clustering depth；较低的重叠深度通常表示按指定列组织得更集中，但它不是性能的绝对指标。

只有大表且查询经常按特定列过滤、性能随数据增长明显退化时，才应评估 clustering key 和 Automatic Clustering。需要结合查询表现、维护费用和数据写入模式判断收益，不能仅仅为了让 clustering depth 数字变小而启用自动聚簇。

## 工程实施步骤

1. 选择查询量大且具有代表性的表，明确常用过滤列、查询时间范围、数据写入顺序和表规模。
2. 在 Query History 中记录查询的 PARTITIONS_SCANNED、PARTITIONS_TOTAL、BYTES_SCANNED 等字段，建立扫描基线。
3. 在不改变数据的前提下比较常用谓词，例如时间范围过滤和非选择性条件；检查 Query Profile 中的扫描算子，确认是否发生有效 pruning。
4. 若裁剪效果差，先检查写入/批量装载是否保持自然时间顺序，以及查询谓词是否能利用列值范围元数据。
5. 对确有价值的大表，运行 SYSTEM$CLUSTERING_INFORMATION 或 SYSTEM$CLUSTERING_DEPTH 查看指定列的聚簇信息，并结合实际查询历史评估。
6. 只有当查询收益足以抵消重聚簇的计算和存储成本时才配置 clustering key；变更后用相同数据和 SQL 重测。
7. 持续监控扫描比例、查询延迟和 Automatic Clustering 使用量，数据分布变化后重新评估，而不是永久保留最初的设计结论。

## 场景分析

订单明细表每天追加数亿行，运营查询通常按 ORDER_DATE 查询最近七天。早期表数据按日期顺序批量写入，后来多个上游并行回补历史订单，导致各批次时间范围交错，查询扫描的微分区比例逐渐升高。

先在 Query History 中对同一类查询比较 PARTITIONS_SCANNED / PARTITIONS_TOTAL，再查看 Query Profile 的扫描算子。若扫描比例确实增加，再评估数据写入组织方式和以 ORDER_DATE 为主的 clustering key。不能把“微分区很多”直接视为问题，也不能仅凭 clustering depth 下降就认定业务查询变快。

验收标准是代表性查询扫描比例和 p95 延迟改善，同时确认自动聚簇 credits 没有超过收益；还要用全量回补、近期查询和不同时间窗口测试是否出现副作用。

## 常见误区

- **认为需要手工创建 Snowflake 微分区。** 标准表的微分区由系统自动创建和维护。
- **把微分区当作传统分区表。** 它是平台内部的列式存储单元，不是用户通过 DDL 管理的分区边界。
- **认为过滤条件越多，剪枝就一定越好。** 谓词形态、值域重叠和数据排序都会影响裁剪效果。
- **把 clustering depth 当作唯一验收指标。** 最终应以实际查询表现、扫描量和维护成本判断。
- **默认所有表都应该配置 clustering key。** 对小表或查询没有明显收益的表，自动聚簇的成本可能不值得。

## 完成标准

- [ ] 能说明微分区由 Snowflake 自动创建，且包含列值范围等元数据。
- [ ] 能解释 pruning 如何减少微分区扫描和列扫描。
- [ ] 能用 Query History 和 Query Profile 判断剪枝效果。
- [ ] 能解释 clustering depth 的用途和局限。
- [ ] 能结合查询收益与维护成本决定是否启用 clustering。

## 自测

1. 为什么在 Snowflake 中创建表时通常不需要指定传统意义上的分区数量？
2. 一条查询扫描了表的大部分微分区，应该检查哪些数据组织和过滤条件？
3. SYSTEM$CLUSTERING_DEPTH 下降了，但查询时延没有变化，是否说明优化成功？还需要观察什么？

## 参考资料

- [Micro-partitions & Data Clustering](https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions)
- [Clustering Keys & Clustered Tables](https://docs.snowflake.com/en/user-guide/tables-clustering-keys)
- [Automatic Clustering](https://docs.snowflake.com/en/user-guide/tables-auto-reclustering)
