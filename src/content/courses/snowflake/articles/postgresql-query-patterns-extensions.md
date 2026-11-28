# PostgreSQL 查询模式、全文搜索与扩展

## 深分页为什么会越翻越慢

订单列表 API 使用 LIMIT 50 OFFSET 249950。前几页响应很快，用户翻到第 5000 页后查询变慢，因为数据库仍需找到并跳过前面的结果。

向后翻页可以考虑 Keyset Pagination：使用上一页最后一条记录的排序键作为下一页游标。排序必须稳定且唯一，否则并列时间戳会造成重复或漏行。

~~~sql
SELECT order_id, created_at, amount
FROM sales.orders
WHERE tenant_id = 42
  AND (created_at, order_id) < (
    TIMESTAMPTZ '2026-11-28 10:00:00+00',
    9800123
  )
ORDER BY created_at DESC, order_id DESC
LIMIT 50;
~~~

对应索引可以是：

~~~sql
CREATE INDEX orders_tenant_created_id_idx
ON sales.orders (tenant_id, created_at DESC, order_id DESC);
~~~

游标值来自上一页最后一行。Keyset Pagination 避免为深页跳过大量记录，但它不是跨 HTTP 请求的数据库快照；翻页期间有新订单或状态更新，结果集合仍可能变化。若需要稳定快照，还要定义时间边界或一致性策略。

## N+1 查询不是索引问题

页面先查 50 个订单，再对每个订单单独查询客户名称，就会产生 51 次往返。即使每条 SQL 都有索引，网络延迟、连接池调度和数据库解析成本仍会累积。

对一对一或多对一关联，Join 或批量查询通常更合适。但一对多 Join 会改变结果粒度，直接 LIMIT 50 可能只覆盖少于 50 个订单；可以先分页主表，再批量获取关联记录。优化目标是减少往返，同时保留原有业务粒度。

## 让过滤条件匹配索引

按天查询 created_at 时，直接使用半开范围通常比对索引列套日期函数更清楚：

~~~sql
WHERE created_at >= TIMESTAMPTZ '2026-11-28 00:00:00+00'
  AND created_at <  TIMESTAMPTZ '2026-11-29 00:00:00+00'
~~~

若业务确实按 LOWER(email) 查询，可以创建匹配表达式的索引。SELECT * 会增加网络传输、解码和应用对象构造成本，也可能令 Index Only Scan 失去覆盖条件。只返回应用实际需要的字段。

## 全文搜索、模糊匹配、空间和向量检索并非同一问题

PostgreSQL 全文搜索将文本解析为 tsvector，用 tsquery 表达检索条件。中文分词需选择合适词典或扩展，默认 english 配置并不适合中文。

pg_trgm 使用三元组支持相似度和部分 LIKE/ILIKE 查询；全文搜索处理词元和语言规则，两者召回语义不同。PostGIS 通常使用 GiST 索引支持空间谓词，如 ST_Intersects 和 ST_DWithin。pgvector 则通过距离算子做向量相似搜索，精确最近邻与 HNSW、IVFFlat 近似索引有不同的速度和召回取舍。

近似向量索引还有一个容易忽略的过滤边界：WHERE 条件通常是在索引扫描返回候选之后应用。若租户过滤只留下少量候选，HNSW 扫描可能返回少于 LIMIT 的行。pgvector 0.8.0 起可使用 iterative index scans 扩大搜索范围，但仍受 max_scan_tuples、内存等限制。多租户隔离和过滤选择性高时，还应评估普通过滤索引、部分索引或分区策略。

## 用代表性查询决定是否引入扩展

不要为了“把搜索都放进数据库”而安装扩展。先确认数据规模、更新频率、查询算子、召回要求和隔离边界。扩展还会引入版本、索引维护、部署权限和升级要求。

上线前固定代表性查询，比较正确性、p95 延迟、索引大小、写入成本和资源使用。近似向量搜索必须测召回率，不能只看响应时间；严格过滤时返回数量不足，也必须进入测试样例。

## 容易造成慢查询或错误结果的写法

- 深 OFFSET 分页没有稳定排序和合适索引。
- 循环内逐行查询关联对象，形成 N+1。
- 对索引列套函数，却没有匹配的表达式索引。
- 一对多 Join 后直接 LIMIT，改变了分页粒度。
- 把全文搜索、模糊匹配、空间搜索和向量搜索混为一谈。
- 只测近似索引速度，不测召回率和过滤后的结果数量。

## 自测

1. Keyset Pagination 为什么适合深分页？它为什么不能自动提供跨请求的一致性快照？
2. 一对多 Join 后直接 LIMIT 50，为什么可能只覆盖少于 50 个订单？
3. pg_trgm、PostGIS 和 pgvector 分别解决什么问题？
4. HNSW 先扫描近似邻居再应用严格 WHERE 条件，为什么可能返回不足 LIMIT 的行？

## 参考资料

- [PostgreSQL 18 SELECT](https://www.postgresql.org/docs/18/sql-select.html)
- [PostgreSQL 18 full text search introduction](https://www.postgresql.org/docs/18/textsearch-intro.html)
- [PostgreSQL 18 full text search tables and indexes](https://www.postgresql.org/docs/18/textsearch-tables.html)
- [pg_trgm](https://www.postgresql.org/docs/18/pgtrgm.html)
- [PostGIS spatial indexes](https://postgis.net/documentation/faq/spatial-indexes/)
- [pgvector filtering and iterative index scans](https://github.com/pgvector/pgvector)
