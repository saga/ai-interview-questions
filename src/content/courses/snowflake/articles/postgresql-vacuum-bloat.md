# PostgreSQL VACUUM、Autovacuum 与膨胀

## 本节要解决的问题

维护 PostgreSQL 的死元组、统计信息、可见性映射和事务 ID 年龄，避免表/索引膨胀与 XID Wraparound 风险。VACUUM 不是简单地压缩表文件；它必须尊重 MVCC 中仍可能被旧 Snapshot 读取的行版本。

## 核心知识

### UPDATE/DELETE 产生旧行版本，VACUUM 负责回收可复用空间

PostgreSQL 的 UPDATE 和 DELETE 通常不会立即物理移除旧行版本。旧版本要等到不再被任何活动事务 Snapshot 引用后，才能被 VACUUM 识别为死元组并清理。清理后的页面空间通常可供后续 INSERT/UPDATE 重用，但标准 VACUUM 不一定会把文件尾部空间归还操作系统。

因此，表膨胀不等于只要执行 VACUUM FULL。高更新率表需要保持常规 VACUUM 运行，控制死元组累积；若需要将文件显著缩小并归还磁盘空间，才评估 VACUUM FULL、CLUSTER 或 pg_repack 等重写操作，并评估锁和额外磁盘空间。

### VACUUM 还承担统计、可见性和 XID Freeze

VACUUM 会维护 Visibility Map，帮助 Index Only Scan 判断页面是否 all-visible；ANALYZE 更新规划器统计信息，使优化器估算行数和选择计划更准确。VACUUM ANALYZE 可以同时执行清理和统计更新。

PostgreSQL 使用有限位宽的事务 ID。旧事务 ID 必须通过冻结机制处理，避免 XID Wraparound 导致数据库无法正确判断旧行可见性。Autovacuum 会自动执行日常清理，并在接近 Wraparound 风险时触发更紧急的维护；不要为了降低 I/O 随意关闭 autovacuum。

### 长事务和复制槽可能阻止旧版本清理

长时间运行的事务、idle in transaction、prepared transaction 和复制槽保留的 xmin/catalog_xmin 可能让旧行版本仍需保留。即使 Autovacuum 正常启动，也可能无法回收被旧 Snapshot 仍然需要的数据。

排查膨胀时，应同时观察 pg_stat_user_tables 的 n_dead_tup、last_autovacuum、last_vacuum、pg_stat_activity 的 xact_start/backend_xmin、pg_replication_slots 的 xmin/catalog_xmin 和 pg_class 的 relfrozenxid。不能只依据表文件大小或一次 VACUUM 的运行时间得出结论。

## 工程实施步骤

1. 对高更新/删除表监控 n_dead_tup、n_live_tup、last_autovacuum、last_autoanalyze 和表/索引大小变化。
2. 检查 pg_stat_activity 中长事务、idle in transaction 和 backend_xmin；定位是否有会话长期持有旧 Snapshot。
3. 查看复制槽的 active、restart_lsn、xmin 和 catalog_xmin，确认离线副本或逻辑订阅是否阻止 WAL/行版本回收。
4. 使用 pg_stat_progress_vacuum 观察正在运行的 VACUUM 阶段、扫描进度和清理情况。
5. 对统计信息过期的表执行 ANALYZE；对死元组多但空间可重用的表使用普通 VACUUM。
6. 根据表更新率设置 autovacuum_vacuum_threshold、autovacuum_vacuum_scale_factor、autovacuum_analyze_scale_factor 等参数；优先对热点表做 per-table 调整。
7. 检查 autovacuum_max_workers 和成本延迟设置，避免高峰期维护吞吐不足或过度影响业务 I/O。
8. 关注 relfrozenxid 与 age(relfrozenxid)，在逼近冻结阈值前处理长事务、复制槽和阻塞维护的原因。
9. 若确实需要归还文件系统空间，评估 VACUUM FULL、CLUSTER 或 pg_repack；检查 ACCESS EXCLUSIVE 锁、维护窗口和临时双份磁盘空间。
10. 将 Autovacuum 运行状态、数据库磁盘增长、冻结年龄和复制槽保留纳入告警，并定期演练异常膨胀处理。

示例：查看死元组和 Autovacuum 最近运行情况。

~~~sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
~~~

## 场景分析

订单历史表持续执行状态更新和过期记录清理，磁盘占用不断上升。团队准备每天运行 VACUUM FULL。

先检查 n_dead_tup、Autovacuum 时间、长事务、复制槽和实际表/索引大小。如果旧 Snapshot 被长事务或复制槽保留，普通 VACUUM 无法清理这些行版本，频繁执行 VACUUM FULL 也不能从根本上解决阻塞来源。应先处理长事务和无用复制槽，再让标准 VACUUM 回收空间。

如果表确实存在大量可回收但未返回 OS 的内部空洞，才评估 pg_repack 或 VACUUM FULL，并设置维护窗口、磁盘余量和锁影响。验收监控死元组、表/索引大小、autovacuum 运行、查询计划和 XID 年龄，而不是只看文件大小瞬时下降。

## 常见误区

- **把 VACUUM 当作必然缩小文件的压缩命令。** 普通 VACUUM 主要让空间可重用，不一定归还操作系统。
- **只关注死元组，不关注 Visibility Map 和统计信息。** VACUUM 还影响 Index Only Scan 与计划估算。
- **关闭 Autovacuum 降低后台 I/O。** 可能引发膨胀、统计失真和 XID Wraparound 风险。
- **频繁运行 VACUUM FULL。** 它会重写表并需要 ACCESS EXCLUSIVE 锁和额外磁盘空间。
- **忽略长事务和复制槽。** 它们可能阻止旧版本回收，导致 VACUUM 无法清理。
- **只按全局 scale_factor 调整所有表。** 大表和高更新表通常需要按表单独设置策略。

## 完成标准

- [ ] 能解释 MVCC 死元组和普通 VACUUM 的空间回收方式。
- [ ] 能区分 VACUUM、ANALYZE 和 VACUUM FULL 的作用。
- [ ] 能说明 Visibility Map 和 XID Freeze 的作用。
- [ ] 能从 pg_stat_activity、pg_stat_user_tables 和复制槽定位清理阻塞。
- [ ] 能按工作负载调整 Autovacuum，并评估重写操作的锁和磁盘风险。

## 自测

1. 普通 VACUUM 执行后表文件大小没有明显下降，是否表示它没有回收空间？
2. 长事务为什么可能阻止 VACUUM 清理旧行版本？
3. 为什么关闭 Autovacuum 可能引发比磁盘膨胀更严重的事务 ID 风险？
4. VACUUM FULL 与普通 VACUUM 的锁和磁盘空间影响有何差别？
5. 如何判断复制槽是否正在阻止旧行版本或 WAL 回收？

## 参考资料

- [Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [Automatic Vacuuming Configuration](https://www.postgresql.org/docs/current/runtime-config-autovacuum.html)
- [Vacuuming Configuration](https://www.postgresql.org/docs/current/runtime-config-vacuum.html)
- [Monitoring Database Activity](https://www.postgresql.org/docs/current/monitoring-stats.html)
- [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)
