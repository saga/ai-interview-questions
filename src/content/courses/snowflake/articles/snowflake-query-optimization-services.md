# Clustering、Search Optimization、Query Acceleration 与 Materialized View

## 本节要解决的问题

一个包含 80 亿行的订单事件表，运营看板、客服查询和月度分析都在使用。客服按 order_id 查单时偶尔要等十几秒；看板按 event_date 查最近一个月的数据；分析师还会临时按客户、地区和商品组合筛选。

团队提出了四个建议：给表加聚类键、启用 Search Optimization、打开 Query Acceleration，再为常用报表建 Materialized View。四种能力都可能改善某类查询，但同时打开会增加存储和计算成本，也不代表所有 SQL 都会更快。

优化之前先看查询在做什么：是大量微分区被扫描、选择性过滤不够、聚合/排序开销大，还是 Warehouse 排队？不同瓶颈对应不同工具。

## 核心知识

### Clustering 主要改善一组常见过滤列上的微分区裁剪

Snowflake 表数据保存在微分区中。查询按某些列筛选时，服务会利用微分区元数据跳过不可能命中的分区。如果数据分布与常见过滤条件不匹配，查询可能扫描很多无关微分区。

例如订单事件表的大多数查询按 event_date 过滤，数据却长期按到达时间混杂分布。若常见查询集中在日期范围，可以评估按 event_date 聚类。若用户经常按 account_id 和 event_date 联合过滤，也要用真实查询评估这两个列的组合是否有价值。

Clustering 不是传统 B-tree 索引，也不会为每一行创建独立查找入口。Automatic Clustering 会持续重组微分区，需要额外计算成本。是否值得启用，要结合查询频率、过滤模式、表规模、聚类深度和维护费用判断。

### Search Optimization 适合选择性很高的查找

客服按 order_id 查询一两条订单，目标表有数十亿行，过滤条件通常非常选择性。Search Optimization Service 可以为适用的列维护搜索访问路径，帮助这类查询快速定位匹配记录。

它也支持部分文本、IP、VARIANT/结构化类型和地理搜索模式，但不是所有谓词都能受益。若查询本来就扫描大量记录，或目标列选择性不高，启用它可能增加维护成本，却没有明显收益。

它更像面向特定查询形态的查找优化，不应被当成所有表都要启用的通用索引。

### Query Acceleration 面向可分流的重型查询片段

Query Acceleration Service（QAS）可以将适用查询的部分处理工作卸载到共享计算资源。它适合某些大扫描、选择性过滤和聚合查询，尤其是偶发的重型分析查询。

但它不会把任意 SQL 都变快。过滤条件是否足够选择性、LIMIT/ORDER BY 是否符合要求、查询算子是否支持，都影响能否受益。QAS 需要相应版本和 Warehouse 配置，额外计算也会产生成本。

### Materialized View 为重复查询模式预计算结果

若多个仪表板反复执行同一张大表上的固定聚合，例如按业务日期和地区汇总订单金额，可以评估 Materialized View。它保存预计算结果，查询满足条件时可利用这些结果，减少重复计算。

Materialized View 不是任意 SQL 的缓存。它的定义和支持范围有限，例如不能基于多张表创建；更新源表后还需要维护物化结果，产生存储和计算开销。它更适合可重复、结构稳定、确实有收益的查询模式。

## 选择与成本比较

| 方法 | 适合的查询形态 | 需要先确认 | 主要成本/限制 |
|---|---|---|---|
| Clustering | 多个高频查询反复按相同列过滤、连接或聚合 | 微分区裁剪是否差，聚类键是否贴合真实 workload | 重聚类计算、存储维护；聚类列选择不当可能无收益 |
| Search Optimization | 高选择性的等值、文本或受支持的半结构化查找 | 查询谓词和目标列是否在支持范围内，过滤是否足够选择性 | 搜索访问路径的存储与维护计算；需要相应版本 |
| Query Acceleration | 大扫描、选择性过滤或适用聚合的重型查询 | Query Profile 是否显示扫描/过滤工作适合分流 | 额外计算费用；只覆盖受支持的查询形态 |
| Materialized View | 重复运行、结构相对固定的查询结果 | 是否能用单表定义，结果是否经常被重复消费 | 物化存储和刷新维护；定义能力有限 |

这些方法可以组合，但组合不代表收益必然相加。Search Optimization 与 QAS 在合适的查询上可以协同；Clustering 和物化结果也可能同时适用。不过每增加一种优化，都应单独证明它带来的延迟收益超过存储和维护成本。

## 工程实施步骤

1. 从 Query History 选出真正影响业务的慢查询，按频率、延迟、扫描量和使用场景分组。
2. 打开 Query Profile，确认时间消耗主要来自扫描、Join、聚合、排序、排队还是远程数据读取。
3. 记录当前基线：执行时间、bytes scanned、partitions scanned/total、缓存读取、Warehouse size 和 credits。
4. 对日期范围型工作负载，评估当前微分区裁剪情况，再决定是否需要调整聚类键。
5. 对主键或高选择性文本查找，先确认谓词和列类型在 Search Optimization 支持范围内，再做小范围试验。
6. 对大扫描、选择性过滤或聚合查询，检查 QAS eligible 证据和配置要求，不要只凭 SQL 很长就启用。
7. 对固定重复报表，评估 Materialized View 的单表定义、维护延迟和存储成本；先用代表性查询验证能否实际命中。
8. 每次只改变一个主要优化因素，用同一数据快照、相同参数和相同 Warehouse 条件做 A/B 比较。
9. 除延迟外，还要比较扫描量、credits、维护时间、刷新滞后和其他查询是否受到影响。
10. 若提升只发生在单次冷启动或缓存命中场景，扩大样本后再决定是否保留优化。

## 场景分析

客服查询 order_id，通常返回一条记录；运营看板每天按 event_date 查最近 30 天订单；月度分析则扫描较大数据量，计算多个地区的订单金额。

这三个查询不能用同一个优化答案：

- 客服精确查单：若 order_id 选择性高且谓词支持，可试 Search Optimization。
- 运营看板：如果大量查询都按 event_date 做范围过滤，且当前分区裁剪差，评估 Clustering。
- 月度分析：如果扫描和聚合开销大、过滤条件选择性高，评估 QAS；若报表 SQL 长期固定且重复使用，再评估 Materialized View。

假设客服查询从 12 秒降到 1 秒，但每月搜索维护费用显著上升；而看板查询本来已能裁剪 95% 的微分区，聚类后只从 1.8 秒降到 1.7 秒。第一个优化可能值得保留，第二个则未必。最终选择应由 workload 与费用数据决定，不是由功能清单决定。

## 常见误区

- **把 Clustering 当成传统索引。** 它影响微分区组织和裁剪，不提供逐行 B-tree 查找。
- **认为 Search Optimization 对所有查询都有效。** 它针对受支持的高选择性查找，扫描型聚合不一定受益。
- **看到大 SQL 就启用 QAS。** 需要检查 eligible 查询形态、过滤条件、版本和额外计算成本。
- **认为 Materialized View 是通用缓存。** 定义支持范围有限，维护本身也消耗资源。
- **一次启用四种优化，再比较优化前后。** 无法判断收益来自哪里，也看不清每种功能的成本。
- **只对比执行时间。** 还要看扫描量、credits、刷新时延和整体 workload。

## 完成标准

- [ ] 能根据执行证据区分扫描裁剪、选择性查找、重型查询分流和重复结果预计算。
- [ ] 能说明四种能力各自适用的查询形态。
- [ ] 能识别版本、SQL 谓词和定义范围等限制。
- [ ] 能设计一次只改变一个主要因素的性能对照实验。
- [ ] 能同时评估延迟、扫描量、credits 和维护成本。

## 自测

1. 客服每次按唯一 order_id 查一条记录，通常应先评估哪种能力？为什么不应先为整张表做通用聚类？
2. 一个日期过滤的看板已经能跳过 97% 的微分区。是否应该立即启用 Automatic Clustering？还要检查什么？
3. 某条分析 SQL 扫描很大，但没有选择性过滤。QAS 一定适合吗？需要哪些执行证据？
4. 一个报表反复计算单张事实表上的固定聚合。Materialized View 可能带来什么收益和维护代价？
5. 同时开启 Search Optimization 与 QAS 后变快了，怎样判断两者分别贡献了多少收益？

## 参考资料

- [Optimizing query performance](https://docs.snowflake.com/en/user-guide/performance-query-options)
- [Optimizing storage for performance](https://docs.snowflake.com/en/user-guide/performance-query-storage)
- [Using the Query Acceleration Service](https://docs.snowflake.com/en/user-guide/query-acceleration-service)
