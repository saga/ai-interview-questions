# PostgreSQL 索引、统计信息与 EXPLAIN 诊断

## 索引类型与访问模式

B-tree 适合等值、范围和排序访问；GIN 常用于数组、JSONB 和全文搜索等包含类查询；GiST 支持几何和范围等可扩展操作符类；BRIN 适合物理顺序与列值相关的大型表。索引类型应由查询谓词和数据分布决定，而不是照搬模板。

索引会增加写入、存储和维护成本。复合索引列顺序、部分索引条件和表达式索引都需要与实际查询匹配。

## EXPLAIN ANALYZE

~~~sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT customer_id, SUM(amount)
FROM orders
WHERE order_date >= DATE '2026-01-01'
GROUP BY customer_id;
~~~

关注估算行数与实际行数差异、扫描类型、Join 算法、排序、Buffers、执行时间和是否发生磁盘溢出。EXPLAIN ANALYZE 会真实执行查询，写操作可能产生副作用，应谨慎使用事务或只对只读语句测试。

## 统计信息

优化器依赖 ANALYZE 统计信息估计选择率和成本。大量数据变化或列值高度相关时，默认统计可能不够准确，需要提高统计目标或使用 Extended Statistics。不要把每个慢查询都归因于缺索引。

## 查询优化顺序

检查 SQL 是否产生多余行或重复 Join；检查过滤条件是否匹配现有索引和数据分布；检查统计信息和估算误差；检查 I/O、缓存、内存和并行计划；在可重复基准下比较修改前后结果。

全文搜索可使用 tsvector、tsquery 和 GIN 索引；扩展如 pg_trgm 则适用于部分模糊匹配场景，要评估维护成本和查询语义。

## 检查题

1. B-tree、GIN、GiST 和 BRIN 适用的查询形态有何不同？
2. EXPLAIN ANALYZE 为什么可能对生产有风险？
3. 估算行数偏差会怎样影响 Join 计划？
