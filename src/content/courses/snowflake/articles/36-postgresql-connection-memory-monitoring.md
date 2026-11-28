# PgBouncer、内存、并行查询与运行监控

## 连接管理

PostgreSQL 进程模型意味着每个客户端连接会消耗服务器资源。高并发应用如果直接建立大量连接，会增加内存、调度和上下文切换压力。PgBouncer 可以在应用与数据库之间复用连接。

Session Pooling 保留连接直到客户端断开；Transaction Pooling 在事务结束时归还连接，吞吐更高，但某些 Session 级功能和临时对象使用方式受限。选择 Pooling Mode 时要检查应用是否依赖临时表、Session 变量、Prepared Statement 和 advisory lock。

## 内存与并行查询

shared_buffers 是 PostgreSQL 自身的共享缓冲区；work_mem 通常按排序或 Hash 操作使用，可能在一个查询中被多个节点重复分配；maintenance_work_mem 用于维护操作。不能把 work_mem 直接配置成“每连接可用内存”，高并发时可能放大总内存消耗。

并行查询能在适合的计划中分摊扫描和计算，但受数据规模、计划成本、可用 worker 和 I/O 限制。增加 max_parallel_workers 不保证所有查询加速。

## 监控视图和日志

常用证据包括 pg_stat_activity、pg_locks、pg_stat_database、pg_stat_user_tables、pg_stat_statements、系统目录和 PostgreSQL 日志。监控要区分 CPU、磁盘 I/O、锁等待、连接耗尽、缓存命中和查询计划问题。

## 常见故障

- 连接数暴涨：检查应用连接池、连接泄漏和事务生命周期。
- 内存突然耗尽：检查并发 Hash / Sort、work_mem 和并行 worker。
- 查询变慢：检查 pg_stat_statements、EXPLAIN 和统计信息。
- Autovacuum 落后：检查长事务、复制槽和更新热点表。
- 磁盘增长：区分表膨胀、索引增长、WAL 和日志保留。

## 检查题

1. Transaction Pooling 为什么可能影响依赖 Session 状态的应用？
2. work_mem 为什么不能简单按连接数静态估算？
3. pg_stat_activity 和 pg_stat_statements 分别提供什么证据？
