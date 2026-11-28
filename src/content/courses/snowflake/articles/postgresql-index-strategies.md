# PostgreSQL 索引设计：先匹配查询，再计算维护成本

## 为什么增加三个索引，查询却没有更快

订单表有几亿行，团队新增了 customer_id、created_at 和 status 三个索引。API 查询仍然扫描大量数据，写入吞吐却下降。

索引能减少定位候选行的成本，但每次 INSERT、UPDATE 和 VACUUM 都可能要维护它。低选择性索引也未必比顺序扫描便宜。设计应从真实谓词、排序方式和数据分布出发，而不是按字段逐个建 B-tree。

## 索引类型要匹配查询操作符

| 类型 | 典型用途 | 需要留意 |
| --- | --- | --- |
| B-tree | 相等、范围、排序和前缀匹配 | 不适合任意子串搜索 |
| GIN | JSONB、数组、全文搜索的包含或成员查询 | 体积和更新成本可能较高 |
| GiST | 范围、几何与可扩展相似/空间搜索 | 能力取决于 operator class |
| BRIN | 数据与物理存储顺序高度相关的大表 | 返回候选块范围，不逐行定位 |
| Hash | 相等比较的特定场景 | 通常先考虑功能更广的 B-tree |

日志按写入时间大致有序时，BRIN 可能用较小索引排除大量数据块；若写入顺序与时间无关，BRIN 范围会覆盖很多无关块，收益随之下降。

## 复合索引同时考虑过滤和排序

常见查询是按租户查最近订单：

~~~sql
SELECT order_id, created_at, amount
FROM sales.orders
WHERE tenant_id = 42
  AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 50;
~~~

一个候选索引是：

~~~sql
CREATE INDEX orders_tenant_status_created_idx
ON sales.orders (tenant_id, status, created_at DESC)
INCLUDE (order_id, amount);
~~~

等值过滤列放在前面，再根据排序设计后续列，可以让 B-tree 有机会同时支持过滤和 ORDER BY。不能将它简化成“选择性最高的列永远放第一位”；还要考虑其他查询是否只过滤 tenant_id，以及实际计划。

INCLUDE 将返回列放入索引叶子页，有机会支持 Index Only Scan，却不保证完全不访问 heap。可见性映射、表更新频率、返回字段及索引类型都会影响结果。

## 部分索引与表达式索引

若应用只频繁查询少量未完成订单，可以评估部分索引：

~~~sql
CREATE INDEX orders_open_tenant_created_idx
ON sales.orders (tenant_id, created_at DESC)
WHERE status IN ('NEW', 'PROCESSING');
~~~

查询谓词必须能让规划器证明它满足部分索引条件。参数化查询或不同写法不一定能匹配，因此要用应用真实 SQL 检查计划。

若查询常用 LOWER(email)，可建立表达式索引：

~~~sql
CREATE INDEX customers_email_lower_idx
ON sales.customers (lower(email));
~~~

查询需要使用匹配表达式；索引表达式还受函数不可变性约束，不能对任意随环境变化的表达式建索引。

## 在线建索引也有失败路径

普通 CREATE INDEX 可能阻塞并发写入。CREATE INDEX CONCURRENTLY 会降低写入阻塞，但执行多个阶段、等待旧事务，通常更耗时。它不能放在显式事务块中；失败后可能留下 INVALID 索引，需要检查并清理。

创建成功后用 EXPLAIN (ANALYZE, BUFFERS) 验证，再观察 pg_stat_user_indexes 的扫描计数、索引大小和写入成本。不要因为 DDL 成功就认定查询已经获得收益。

## 索引维护成本和限制

索引占用存储、增加 WAL 和写放大，也影响 VACUUM 与备份。更新频繁的表上，宽复合索引尤其昂贵。应定期检查长期无扫描的索引，但也要考虑主键/唯一约束、低频报表和故障恢复查询，不能只凭 idx_scan = 0 就删除。

- 复合索引顺序要结合 WHERE、ORDER BY 和查询组合。
- INCLUDE 不保证 Index Only Scan，也增加维护成本。
- 部分索引谓词要匹配真实查询条件。
- BRIN 依赖物理相关性，写入顺序变化会影响收益。
- CONCURRENTLY 失败后要检查是否留下 INVALID 索引。

## 自测

1. 查询按 tenant_id 与 status 等值过滤，再按 created_at 倒序。为什么复合索引值得先于三个独立索引进行测试？
2. INCLUDE 后计划仍访问 Heap，还需要检查什么？
3. 部分索引只覆盖 OPEN 状态，为什么预编译参数查询不一定能使用它？
4. CREATE INDEX CONCURRENTLY 失败后，为什么不能直接忽略留下的索引对象？

## 参考资料

- [PostgreSQL 18 indexes](https://www.postgresql.org/docs/18/indexes.html)
- [PostgreSQL 18 multicolumn indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html)
- [PostgreSQL 18 partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html)
- [PostgreSQL 18 indexes on expressions](https://www.postgresql.org/docs/18/indexes-expressional.html)
- [PostgreSQL 18 index-only scans](https://www.postgresql.org/docs/18/indexes-index-only-scans.html)
