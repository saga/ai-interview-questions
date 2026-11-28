# PostgreSQL EXPLAIN：从估算偏差找到慢查询根因

## 先看估算行数和实际行数差了多少

订单查询从 200 毫秒变成 8 秒。开发人员看到计划使用 Nested Loop，便决定强制改成 Hash Join。问题可能不在 Join 算法，而在于规划器估算外层只有 20 行，实际却返回 200,000 行。

EXPLAIN 的价值在于展示规划器基于什么行数、成本和访问路径作出选择。调优不是把 Seq Scan 换成 Index Scan，而是找到估算与实际的偏差，并解释偏差如何影响执行计划。

## 普通 EXPLAIN 与 EXPLAIN ANALYZE 的区别

普通 EXPLAIN 只生成计划，不执行查询。EXPLAIN ANALYZE 会真正执行语句，并记录实际行数、耗时和循环次数。对于 UPDATE、DELETE 或调用外部函数的查询，测试前必须考虑数据修改和外部副作用；事务回滚无法撤销所有非事务动作。

~~~sql
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, VERBOSE)
SELECT o.order_id, c.segment
FROM sales.orders AS o
JOIN sales.customers AS c
  ON c.customer_id = o.customer_id
WHERE o.created_at >= DATE '2026-11-01'
  AND c.region = 'APAC';
~~~

读计划时重点看四组信息。rows 是估算或实际输出行数；loops 是节点执行次数；Buffers 描述共享缓冲命中、读取及临时数据块；actual time 需要结合 loops 理解。不要把父子节点耗时直接相加，它们的执行区间可能重叠。

## 估算偏差会改变 Join 和扫描选择

如果过滤条件估算只有 50 行，实际却有 50 万，规划器可能选择不适合大输入的 Nested Loop 或错误 Join 顺序。若两个过滤列高度相关，单列统计信息无法表达相关性，可以创建扩展统计：

~~~sql
CREATE STATISTICS orders_region_status_stats
  (dependencies, mcv)
  ON region, order_status
  FROM sales.orders;

ANALYZE sales.orders;
~~~

CREATE STATISTICS 只注册要收集的统计类型，实际数据仍由 ANALYZE 采集。它不会自动为所有列组合建立统计，应只用于关键谓词或分组中确有相关性的列。

如果估算行数接近而执行仍慢，再看扫描量、Join 输出膨胀、排序、Hash 批次以及 temp blocks。Seq Scan 在读取表的大部分行时可能是正确选择；Index Scan 若需要大量随机访问，反而可能更慢。

## 统计信息过时会让同一 SQL 选错计划

批量导入、删除或分布明显变化后，规划器可能依据旧统计信息决策。先检查最近 ANALYZE 和 autovacuum 时间，对目标表运行 ANALYZE。普通统计无法表达多列相关性时，再考虑 extended statistics 或提高特定列的统计目标。

不要在没有证据时全库提高 default_statistics_target。更大的样本会增加 ANALYZE 工作量；统计信息应服务于实际查询谓词，而不是试图描述所有可能的列组合。

## 前后计划必须用同一组条件比较

固定 SQL 参数、数据快照或时间窗口、并发负载和缓存条件。记录计划节点、估算/实际行数、loops、Buffers、临时文件和总耗时。只比较一次冷缓存与一次热缓存，结果很可能反映缓存差异，而不是 SQL 变更。

对有副作用的语句，可以在测试库运行。事务回滚只适用于副作用受该事务控制的操作，不能保证撤销外部 HTTP 调用或非事务性动作。

## 计划阅读中的常见误读

- 看到 Seq Scan 就加索引，忽略查询本来就要读取大量行。
- 看到 Nested Loop 就强制换算法，忽略估算行数是否准确。
- 把 shared read 当成物理盘 I/O 的精确字节数。
- 忽略 loops，低估内侧节点重复执行的总成本。
- 把 CREATE STATISTICS 当成已收集统计；还需要 ANALYZE。
- 对有副作用的语句直接运行 EXPLAIN ANALYZE。

## 自测

1. 外层估算 20 行，实际 200,000 行，Nested Loop 内层执行 200,000 次。应先验证什么？
2. shared read 很高，为什么不能直接断言存储设备读取了同样数量的数据？
3. 创建 extended statistics 后，为什么还要运行 ANALYZE？
4. Seq Scan 扫描大表的 80% 行，为什么它可能比索引扫描更合适？

## 参考资料

- [PostgreSQL 18 Using EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)
- [PostgreSQL 18 planner statistics](https://www.postgresql.org/docs/18/planner-stats.html)
- [PostgreSQL 18 CREATE STATISTICS](https://www.postgresql.org/docs/18/sql-createstatistics.html)
- [PostgreSQL 18 monitoring statistics](https://www.postgresql.org/docs/18/monitoring-stats.html)
