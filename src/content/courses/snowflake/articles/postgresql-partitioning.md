# PostgreSQL 分区表：查询裁剪与数据生命周期

## 分区表先解决哪种数据问题

订单事件表每天增长数千万行。应用最常见的查询只看最近七天，合规要求保留五年，而过期数据每月要归档一次。继续把所有记录放在一张普通表里，维护窗口和历史清理都会越来越重。

分区表把一张逻辑表映射到多张物理子表。应用仍然查询父表，PostgreSQL 根据分区键路由写入，并在条件允许时跳过不相关分区。它不会自动让每条 SQL 都变快：查询若不包含分区键，仍可能访问大量分区。

## 分区键要同时符合查询和生命周期

范围分区适合有自然边界的时间或数值，例如按月划分事件。列表分区适合离散类别，例如区域；哈希分区把键值分散到固定数量的分区，适合均匀分布，却不适合直接按时间淘汰数据。

选择分区键时，先看查询是否常带这个键，再看数据是否按它自然分布，最后检查是否能按整块分区归档或删除。不能因为 CREATED_AT 是时间字段就一律按月分区。如果主要查询按 CUSTOMER_ID 访问单个客户，时间分区可能只对报表有效；若每个租户都有独立生命周期，列表分区也许更适合。分区数量过多还会增加规划和维护开销。

## 一张按月分区的事件表

下面按 CREATED_AT 做范围分区。下界包含、上界不包含，因此相邻月份不会重叠：

~~~sql
CREATE TABLE app.order_events (
  tenant_id bigint NOT NULL,
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (tenant_id, created_at, event_id)
) PARTITION BY RANGE (created_at);

CREATE TABLE app.order_events_2026_11
  PARTITION OF app.order_events
  FOR VALUES FROM ('2026-11-01 00:00:00+00')
               TO ('2026-12-01 00:00:00+00');

CREATE TABLE app.order_events_2026_12
  PARTITION OF app.order_events
  FOR VALUES FROM ('2026-12-01 00:00:00+00')
               TO ('2027-01-01 00:00:00+00');
~~~

主键包含了分区键 CREATED_AT。PostgreSQL 对分区父表的 PRIMARY KEY 和 UNIQUE 有明确限制：约束列必须包含全部分区键列，且分区键不能是表达式。各分区上的索引无法单独保证不同分区之间不存在相同键值。

如果业务要求 EVENT_ID 在整张逻辑表中全局唯一，而它又不是分区键，父表上不能只声明 PRIMARY KEY (event_id) 来获得跨分区唯一性。可以由应用生成全局唯一 ID，再通过登记表或写入服务保证业务约束；不要误以为每个分区自己的唯一索引具备全局约束能力。

## 查询谓词决定分区裁剪

查询最近一个月的事件时，明确给出分区键范围：

~~~sql
SELECT event_id, created_at, event_type
FROM app.order_events
WHERE created_at >= TIMESTAMPTZ '2026-11-01 00:00:00+00'
  AND created_at <  TIMESTAMPTZ '2026-12-01 00:00:00+00'
  AND tenant_id = 42
ORDER BY created_at DESC;
~~~

用 EXPLAIN 检查扫描了哪些分区，以及是否出现 Subplans Removed。若写成 WHERE date(created_at) = ...，分区键被函数包裹后，裁剪效果可能不如直接使用半开时间范围。分区裁剪负责排除不需要的分区；分区内部索引负责缩小命中分区中的行范围，二者并不互相替代。

## 生命周期维护比查询加速更值得计算

当一个月份的数据过期时，DROP TABLE 或 DETACH PARTITION 可以避免在大表上执行数百万行 DELETE 所产生的膨胀和清理压力。被分离的分区也可以作为普通表继续归档或导出。

生产环境应提前创建未来分区，并监控默认分区。没有 DEFAULT 分区时，超出已建范围的写入会失败；有 DEFAULT 分区时，迟到数据可能集中落入其中，之后再附加正式分区前，必须确认默认分区不包含边界冲突的数据。分区创建、迟到数据处理和过期清理应是例行作业。

## 方案的限制与常见误用

- 表规模不大，普通索引和 VACUUM 已满足维护需求时，分区可能只增加复杂度。
- 绝大多数查询不使用分区键，裁剪收益有限。
- 分区键与业务唯一性要求冲突时，需要额外设计全局唯一约束。
- 为每个客户或每个日期创建分区，容易造成数量失控。
- 没有分区创建、迟到数据和过期清理自动化，分区表会把运维问题推迟而不是消除。

## 自测

1. 按 CREATED_AT 分区后，为什么父表不能直接声明只包含 EVENT_ID 的全局主键？
2. 查询最近七天数据却扫描了大量历史分区，应先检查 SQL 的哪一部分以及 EXPLAIN 的哪些信息？
3. 月末切换时，为什么提前创建下个月分区比等第一条新数据写入后再处理更稳妥？
4. 分区裁剪和分区内 B-tree 索引分别解决什么问题？

## 参考资料

- [PostgreSQL 18 table partitioning](https://www.postgresql.org/docs/18/ddl-partitioning.html)
- [PostgreSQL data definition](https://www.postgresql.org/docs/18/ddl.html)
