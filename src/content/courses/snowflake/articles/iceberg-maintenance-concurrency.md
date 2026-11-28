# Iceberg Compaction、Snapshot 保留与并发写入

## 本节要解决的问题

控制 Iceberg 表的小文件、Manifest 膨胀和 Snapshot 累积，并保证并发写入与文件清理不会破坏当前表状态。维护要先确认表由谁管理：Snowflake-managed 表和外部 Catalog 表的操作权限、刷新方式和清理责任不同。

## 核心知识

### 数据文件 Compaction 与 Manifest Compaction 解决不同问题

持续小批量写入会生成大量小 Parquet 文件。查询时需要调度和读取更多文件，规划开销与对象存储请求也会增加。Data File Compaction 将多个较小文件重写为较少的大文件，以改善扫描和文件管理效率；Manifest Compaction 则合并过多或过小的 Manifest，降低 Snapshot 规划元数据的负担。

两种 Compaction 都会写入新的文件或元数据版本，不是简单地在原文件上覆盖。执行前要评估并发写入、资源消耗、维护窗口和保留策略。压缩收益应以文件数、平均文件大小、Query Profile、规划时间、扫描性能和维护成本共同衡量。

### Snapshot Expiry 与孤儿文件清理不能混为一谈

Iceberg Snapshot 保存某个时间点的表状态。Snapshot Expiry 删除不再需要的旧 Snapshot 引用，减少 metadata 历史和保留空间；孤儿文件清理则删除未被任何有效 Snapshot 引用的文件。二者操作对象不同。

清理历史 Snapshot 会缩短可回溯时间窗口。孤儿文件清理必须考虑写入提交失败、并发写入和较新的文件仍处于提交过程等情况；过短的保留阈值可能误删尚未被当前 metadata 引用但仍需要的文件。应先确定法规、Time Travel、回滚、迟到数据重放和消费者审计的保留要求，再确定过期阈值。

### 管理模式决定维护和刷新责任

Snowflake-managed Iceberg tables 的元数据由 Snowflake 管理，可使用 Snowflake 提供的表优化与维护能力。External Catalog Iceberg tables 的 Snapshot 和文件提交由外部 Catalog/引擎管理；Compaction、Snapshot Expiry 和孤儿文件清理应由外部 Iceberg 工具负责。Snowflake 通过 REFRESH 同步外部 Catalog 的元数据视图；支持的 REST Catalog 可以启用 AUTO_REFRESH，由 Snowflake 持续轮询元数据变化。

Auto Refresh 是元数据同步机制，不等于自动执行外部表的 Compaction，也不负责清理对象存储中的历史文件。外部维护后仍需验证 Snowflake 当前读取的 metadata location、Snapshot 和结果。

### 并发写入需要 Catalog 提交协调

并发写入可能从同一个旧 Snapshot 开始构建新状态。Iceberg Catalog 的提交协议负责检测当前 metadata location 是否已变化，并由写入引擎处理冲突、重读最新 Snapshot 或重试。多个引擎不能直接覆盖同一个 metadata pointer。

Compaction 也属于写入事务的一种，会和正常 INSERT/DELETE/UPDATE 竞争。执行维护时必须确认引擎能够处理并发提交和冲突；不要仅按定时器无条件清理文件或重写数据。

## 工程实施步骤

1. 记录表的管理模式、Catalog、当前 Snapshot、Writer、Reader、文件格式和维护 Owner。
2. 采集数据文件数量、平均/分位文件大小、Manifest 数量、Snapshot 数量、metadata 大小和查询规划时间。
3. 若文件过小且数量持续增长，评估 Data File Compaction；若 Manifest 数量和规划时间异常，评估 Manifest Compaction。
4. 根据 Time Travel、审计、回滚和重放要求确定 Snapshot 保留窗口；先在测试表验证过期后历史查询的实际边界。
5. 为孤儿文件清理配置足够长的安全阈值，并避开正在写入、重试或尚未提交的文件窗口。
6. 对 Snowflake-managed 表使用 Snowflake 支持的维护能力，并记录操作状态、Warehouse/Serverless 消耗和结果。
7. 对 External Catalog 表由外部 Iceberg 引擎执行 Compaction、Snapshot Expiry 和 orphan cleanup；不要从 Snowflake 侧直接删除文件。
8. 外部表维护提交后执行或等待 Metadata Refresh，检查 Snowflake 看到的 Snapshot 和 Schema 是否已更新。
9. 多引擎写入时验证 Catalog 提交冲突、重试和业务幂等；对维护与业务写入设置合理并发策略。
10. 比较维护前后文件数、Manifest 数、查询规划时间、扫描字节、p95、存储与计算费用，决定是否调整周期。
11. 通过维护失败、Catalog 暂停、并发写入和旧 Snapshot 清理演练，验证不会丢失当前表引用的数据。

## 场景分析

一张订单 Iceberg 表由 Spark 每分钟追加小批次，Snowflake 每天做分析。数周后文件数增长到数百万，查询规划变慢；平台团队希望直接删除较旧的 Parquet 文件。

不能按文件修改时间直接删除。先从当前及保留 Snapshot 的 Manifest 确认文件引用，再检查是否有写入失败留下的 orphan files。若表是 Snowflake-managed，按 Snowflake 支持的优化机制处理；若表由外部 Catalog 管理，则由外部 Iceberg 引擎执行数据文件/Manifest Compaction 与 Snapshot Expiry。完成后让 Snowflake refresh 元数据，再验证读到的 Snapshot 与 Spark 一致。

验收应覆盖小文件数量、平均文件大小、Manifest 数、Snapshot 保留窗口、查询规划时间、p95、Catalog refresh 延迟和维护费用。必须用一份保留期内的历史查询证明没有误删仍被引用的数据。

## 常见误区

- 把 Data File Compaction 与 Manifest Compaction 当作同一种操作。前者重写数据文件，后者整理文件清单元数据。
- 以文件时间戳直接删除旧 Parquet。历史 Snapshot 可能仍引用这些文件。
- Snapshot Expiry 后立刻删除所有未在当前 Snapshot 中出现的文件。需要考虑其它保留 Snapshot、分支/标签和提交中的文件。
- 对外部 Catalog 表从 Snowflake 直接管理全部维护。维护责任由外部 Catalog/引擎承担。
- 开启 AUTO_REFRESH 就认为小文件和孤儿文件会自动清理。Auto Refresh 只同步外部元数据。
- Compaction 与业务写入并发时不检查提交冲突。维护也会生成新的表状态，必须使用 Catalog 协议协调。

## 完成标准

- [ ] 能区分数据文件 Compaction、Manifest Compaction、Snapshot Expiry 和孤儿文件清理。
- [ ] 能根据业务恢复与审计要求确定 Snapshot 保留窗口。
- [ ] 能解释 Snowflake-managed 与 External Catalog 的维护责任差异。
- [ ] 能说明 REFRESH/AUTO_REFRESH 的元数据同步边界。
- [ ] 能为 Compaction 与并发写入设计冲突处理和维护验收。

## 自测

1. 查询规划变慢、Parquet 平均文件大小正常，但 Manifest 数量非常多，应该优先评估哪种维护？
2. 为什么 Snapshot Expiry 和 orphan file cleanup 必须作为两个独立步骤设计？
3. 外部引擎完成 Compaction 后，Snowflake 仍看到旧文件布局，应检查什么？
4. 开启 External Catalog AUTO_REFRESH 后，是否就不需要外部引擎负责 Snapshot Expiry 和文件清理？
5. Compaction 与业务写入同时发生，应该依赖哪个协调机制保护 Snapshot 提交？

## 参考资料

- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
- [Best practices for Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-best-practices)
- [Auto-refresh Iceberg metadata](https://docs.snowflake.com/en/user-guide/tables-iceberg-auto-refresh)
- [Apache Iceberg specification](https://iceberg.apache.org/spec/)
