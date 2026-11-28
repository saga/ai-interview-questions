# PostgreSQL WAL、流复制与高可用

## 本节要解决的问题

理解 WAL 如何提供崩溃恢复和复制数据源，并根据数据丢失容忍度选择异步或同步复制。复制负责把变化传到另一个实例；真正的高可用还需要健康检测、故障判断、主备提升、旧主隔离和客户端重连，不能把“有 Standby”当作已经完成自动故障切换。

## 核心知识

### WAL 保证数据页写入前先持久化变更记录

Write-Ahead Log 记录数据库变更。提交前，事务相关 WAL 需要按配置写入持久存储；数据库崩溃后可通过 WAL 重放恢复一致状态。数据页可以稍后写回磁盘，减少每次事务都同步写随机数据页的成本。

WAL 也用于归档、物理流复制和 PITR。WAL 目录本身不是永久备份；如果只保留当前 pg_wal，旧 WAL 会按检查点、归档和复制需求回收。归档失败或复制槽长期滞留可能导致 WAL 持续堆积并耗尽磁盘。

### 物理复制与逻辑复制解决不同目标

物理流复制传输 WAL，Standby 重放与 Primary 一致的整个 Cluster 变化，适合热备、只读查询和整实例故障切换。Standby 可处于 Hot Standby 状态，允许只读连接，但不能执行普通写事务。

逻辑复制通过 Publication/Subscription 传输表级逻辑变更，适合选择性表同步、跨版本迁移和部分数据分发。它不会自动复制全部 DDL、Role、权限和序列状态；Schema 变更与序列同步需要单独管理。

### 异步与同步复制在 RPO 和延迟之间取舍

PostgreSQL 物理流复制默认异步。Primary 提交后，Standby 可能尚未收到或重放 WAL；若立即故障切换，可能丢失尚未复制的已提交事务。需要监控 write、flush、replay 等 LSN 差距与时间延迟。

同步复制通过 synchronous_standby_names 和 synchronous_commit 控制提交等待 Standby 的确认。更强的确认等级会增加事务延迟，并依赖网络往返和 Standby 可用性。同步确认也不替代备份；多个副本或存储故障仍可能造成数据丢失。

### Failover 还需要避免双主和旧主回归

PostgreSQL 自带复制，但自动选主和流量切换通常由 Patroni、repmgr、云服务或其它 HA 管理组件完成。必须提供仲裁/租约或 fencing，确保旧 Primary 确实停止写入后才提升新主。否则网络分区可能出现两个节点都接受写入的 Split Brain。

故障切换后要决定旧主如何重新加入：通常需要重新同步或从新主恢复，而不是直接启动旧数据目录并让它继续写入。客户端连接池和 DNS/代理切换也需要有重连和故障恢复策略。

## 工程实施步骤

1. 明确 RPO、RTO、读写拓扑、是否允许只读 Standby、故障域和复制网络延迟。
2. 采用物理复制时建立 Base Backup、复制用户、pg_hba.conf 规则、wal_level、max_wal_senders 和 primary_conninfo。
3. 配置 Standby 的 standby.signal、primary_conninfo 与恢复/归档策略，验证能够连接 Primary 并持续接收 WAL。
4. 选择是否启用复制槽；监控 replication slot 的 restart_lsn、confirmed_flush_lsn 与保留 WAL 量，避免副本离线导致主库磁盘被占满。
5. 监控 Primary 上的 pg_stat_replication，以及 Standby 上的 pg_stat_wal_receiver、pg_last_wal_receive_lsn 和 pg_last_wal_replay_lsn。
6. 根据 RPO 选择异步或同步复制，设置 synchronous_standby_names 与 synchronous_commit，并实测提交延迟。
7. 逻辑复制场景单独管理 Publication、Subscription、表结构和序列；对 DDL 与不支持的对象设置独立迁移步骤。
8. 选用 HA Manager 或云服务承担健康检测、选主、fencing、VIP/DNS/代理切换；不要仅靠简单 TCP 探测就提升节点。
9. 演练 Primary 宕机、Standby 延迟、复制槽滞留、网络分区、旧主恢复和客户端重连。
10. Failover 后核对新主角色、最后可确认 LSN、数据差异、连接路由和备份状态；旧主重新加入前先执行恢复/重新同步。
11. 把复制链路和独立备份结合，避免误删、逻辑错误或主库损坏被同步复制到所有 Standby。

示例：在 Primary 上查看复制状态。

~~~sql
SELECT
  application_name,
  state,
  sync_state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn,
  write_lag,
  flush_lag,
  replay_lag
FROM pg_stat_replication;
~~~

## 场景分析

订单系统有一台 Primary 和一台异步 Standby。Primary 突然断电，Standby 的 replay LSN 落后于 Primary 已确认提交的一段 WAL。团队希望立即提升 Standby。

应先根据业务 RPO 判断可接受的数据丢失范围，比较最后收到、写入、刷盘和重放的 LSN。提升后旧主必须被 fencing，避免恢复后继续接受写入。应用连接池需要切换到新主并处理未确认请求的幂等重试。旧主回归时通常需要按新主状态重新同步。

如果 RPO 不允许丢失已确认提交，需评估同步复制和确认等级，但也要接受更高写入延迟以及同步 Standby 故障时的可用性影响。验收必须演练网络分区和旧主恢复，而不是只测试 Primary 正常时 Standby 能追平。

## 常见误区

- **认为复制等于备份。** 误删和逻辑错误也会复制到 Standby，必须独立备份。
- **把异步复制理解为零数据丢失。** 故障切换时可能丢失尚未复制的提交。
- **认为同步复制没有性能代价。** 提交需要等待 Standby 确认，会增加延迟并影响可用性。
- **把有 Standby 等同于自动 HA。** 还需要选主、fencing、路由切换、监控和故障演练。
- **忽略 replication slot。** 长期离线的副本可能让 Primary 保留大量 WAL，导致磁盘耗尽。
- **直接启动旧 Primary 让它恢复服务。** 需要确认新主角色并执行一致性恢复，避免双主。

## 完成标准

- [ ] 能说明 WAL 的提交持久化、崩溃恢复和复制用途。
- [ ] 能区分物理复制与逻辑复制的同步范围。
- [ ] 能解释异步/同步复制对 RPO、延迟和可用性的影响。
- [ ] 能使用 pg_stat_replication/pg_stat_wal_receiver 监控复制状态。
- [ ] 能设计选主、fencing、旧主恢复和客户端切换流程。

## 自测

1. 异步 Standby 的 replay LSN 落后于 Primary，故障切换可能发生什么？
2. 逻辑复制是否自动复制表结构、Role 和序列状态？
3. 复制槽长期保留 WAL 可能给 Primary 带来什么风险？
4. 为什么自动故障切换必须实现 fencing，而不只是检测 Primary 端口不可用？
5. 同步复制会提高数据持久性，但为什么仍不能替代独立备份？

## 参考资料

- [WAL Introduction](https://www.postgresql.org/docs/current/wal-intro.html)
- [Warm Standby and Streaming Replication](https://www.postgresql.org/docs/current/warm-standby.html)
- [Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)
- [Monitoring Database Activity](https://www.postgresql.org/docs/current/monitoring-stats.html)
- [Replication Configuration](https://www.postgresql.org/docs/current/runtime-config-replication.html)
