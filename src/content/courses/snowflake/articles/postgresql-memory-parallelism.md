# PostgreSQL 内存、I/O 与并行查询调优

## 为什么把 work_mem 调到 1GB 后连接反而不稳定

一个报表任务频繁出现 Sort Method: external merge，运维人员据此把 work_mem 从 16MB 调到 1GB。单条 SQL 的临时文件减少了，但高峰期数据库进程被操作系统终止，应用连接大量断开。

work_mem 不是每个连接只分配一次的固定内存。一次查询可能包含多个排序或 Hash 节点，Parallel Worker 也可能各自使用相关内存；数百个会话并发时，潜在占用会相乘。调参应按并发峰值估算，而不是只看一条执行计划。

## 先分清四个内存参数

shared_buffers 是 PostgreSQL 自己的缓冲池。操作系统文件缓存也可能保留同一数据，因此不能把 shared_buffers 之外的内存简单视为浪费。初始值需要结合物理内存、容器限制、云数据库规格和工作集测试，不能机械照搬某个百分比。

effective_cache_size 只是规划器估算有多少数据可能命中 PostgreSQL 缓冲池或操作系统缓存，不会预留内存，也不会分配物理页面。把它调高不会增加系统可用内存，只会改变规划器对缓存命中的估计。

work_mem 是每个执行操作可使用的工作内存上限。Sort、Hash Join 和 Hash Aggregate 可能使用它；Hash 操作还受 hash_mem_multiplier 影响。看到磁盘排序时，先确认节点数量、并发会话和临时文件，再考虑在单个报表事务里 SET LOCAL，而不是直接全局放大。

maintenance_work_mem 主要用于 CREATE INDEX、VACUUM 等维护操作。预算时还要考虑并发维护任务和并行 worker，不能把它与普通 SELECT 的 work_mem 混为一谈。

## 并行查询不是免费的 CPU

并行查询把支持的计划节点分配给 worker，再由 leader 汇总。是否采用并行计划取决于查询形状、表规模、成本参数和可用 worker。小查询的 worker 启动成本可能超过收益；某些计划节点也无法并行执行。

max_parallel_workers_per_gather 限制一个 Gather/Gather Merge 节点的 worker 数；max_parallel_workers 限制整个实例的并行 worker 池。把前者调大，却不检查 max_worker_processes 和实际 CPU 配额，只会让更多查询竞争有限的 CPU。

## 先读配置来源和重启状态

~~~sql
SELECT name, setting, unit, source, pending_restart
FROM pg_settings
WHERE name IN (
  'shared_buffers', 'effective_cache_size', 'work_mem',
  'hash_mem_multiplier', 'maintenance_work_mem',
  'max_parallel_workers', 'max_parallel_workers_per_gather',
  'max_worker_processes', 'max_wal_size',
  'checkpoint_timeout', 'checkpoint_completion_target'
)
ORDER BY name;
~~~

再结合 pg_stat_activity、pg_stat_io、临时文件统计和操作系统指标观察实际负载。若查询有大量磁盘排序，定位具体 Sort/Hash 节点；若写入高峰伴随 checkpoint I/O，则检查 WAL 生成速率与检查点压力，不要把所有磁盘读写都归因于 shared_buffers。

## 检查点和查询 Spill 是两种不同问题

max_wal_size 与 checkpoint_timeout 影响检查点触发，checkpoint_completion_target 控制检查点工作在时间窗口内的分布。检查点过于频繁会造成写入抖动；盲目把 max_wal_size 提得很大，又会增加崩溃恢复时需要处理的 WAL。

调优前记录检查点统计、WAL 生成和存储延迟。云数据库还要区分底层 IOPS/吞吐限制和 PostgreSQL 自身缓冲行为。一次只改一组参数，比较吞吐、p95 延迟、内存峰值、临时文件和恢复时间。

## 用局部配置验证，不要一次改全局

对已定位的报表，可以先在专用连接或事务中做受控测试：

~~~sql
BEGIN;
SET LOCAL work_mem = '128MB';

EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT customer_id, sum(amount)
FROM sales.orders
WHERE created_at >= TIMESTAMPTZ '2026-11-01 00:00:00+00'
GROUP BY customer_id;

ROLLBACK;
~~~

数值只是实验起点，不能直接复制到全局配置。比较计划、临时块和内存峰值后，再决定是否需要角色级参数、专用连接或并发调度调整。

## 调参时容易忽略的限制

- work_mem 会被多个执行节点和并行 worker 放大。
- effective_cache_size 不分配物理内存。
- shared_buffers 要结合操作系统缓存和部署内存上限。
- 并行 worker 增多不保证单条 SQL 更快，也可能挤占其他查询 CPU。
- 检查点压力、查询 Spill 和存储瓶颈需要不同证据。
- 单条查询压测得到的参数，不等于高并发生产参数。

## 自测

1. 一条查询有三个 Hash/Sort 节点，Gather 下又启动四个 worker。为什么把 work_mem 提高到 512MB 可能带来很高的潜在内存压力？
2. effective_cache_size 从 8GB 调到 32GB 后，系统可用内存没有减少。原因是什么？
3. 并行查询没有启动 worker，应该检查哪些全局和每查询限制？
4. WAL 写入和 checkpoint I/O 变高，为什么不应直接归因于 shared_buffers 太小？

## 参考资料

- [PostgreSQL 18 resource consumption](https://www.postgresql.org/docs/18/runtime-config-resource.html)
- [PostgreSQL 18 query planning](https://www.postgresql.org/docs/18/runtime-config-query.html)
- [PostgreSQL 18 parallel query](https://www.postgresql.org/docs/18/parallel-query.html)
- [PostgreSQL 18 monitoring statistics](https://www.postgresql.org/docs/18/monitoring-stats.html)
