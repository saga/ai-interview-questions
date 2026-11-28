# PostgreSQL 备份、恢复与 PITR

## 本节要解决的问题

按恢复目标选择逻辑备份、物理备份或连续归档，并通过实际恢复演练证明备份可用。备份成功不等于恢复成功；需要明确备份范围、数据一致性、WAL 保留、恢复时间、目标时间点和恢复后的业务验证。

## 核心知识

### SQL Dump 适合逻辑迁移和单库/对象级恢复

pg_dump 从单个 Database 生成逻辑备份，不要求停机；其一致性来自数据库快照，即使备份期间有并发写入也能得到一致的导出视图。可选择 plain SQL、custom、directory 和 tar 等格式。custom/directory 格式可配合 pg_restore 选择对象、并行恢复和调整恢复顺序。

pg_dump 不备份整个 PostgreSQL Cluster 的全部全局对象，例如 Role 和 Tablespace；需要同时保存这些对象时可使用 pg_dumpall 或独立的角色/配置备份。逻辑 Dump 适合跨版本迁移和对象级恢复，但不能单独提供任意时间点恢复。

### 物理备份与连续归档用于完整实例恢复和 PITR

物理备份复制数据库集群的文件布局，需要与对应 PostgreSQL 主版本和运行配置匹配。pg_basebackup 可在线取得一致的 Base Backup。恢复后还需要连续 WAL 才能将备份推进到所需时间点。

WAL Archiving 将已完成的 WAL Segment 持续存放到独立归档位置。PITR 先恢复 Base Backup，再通过 restore_command 重放所需 WAL，直到 recovery_target_time、recovery_target_lsn 或其他目标条件。若 WAL 缺段、归档延迟或保留窗口不足，就无法恢复到目标时间。

PITR 恢复通常创建一个独立的恢复实例/数据目录，不应直接覆盖仍在运行的生产主库。达到目标后，PostgreSQL 会进入可供访问的恢复结果；恢复环境经过验证后，才决定切换流量。

### RPO/RTO 决定备份频率与架构

RPO 表示可接受的数据丢失窗口，RTO 表示服务恢复时间。仅每天做一次 pg_dump，通常无法满足数分钟级 RPO；启用 WAL Archiving 可缩小可恢复时间窗口，但还需要持续成功的 Base Backup 和可靠归档存储。

逻辑备份、物理备份、WAL 归档和副本各自解决不同问题。热备/流复制能提供快速故障切换，但如果没有独立备份和归档，也可能同步传播误删或逻辑错误。备份应存放在独立故障域，并具备保留、加密、访问限制和防删除策略。

## 工程实施步骤

1. 与业务明确 RPO、RTO、需要恢复的范围（对象、Database、整个 Cluster）和允许的停机窗口。
2. 对对象级恢复/跨版本迁移使用 pg_dump；对整集群恢复和 PITR 规划物理 Base Backup 与 WAL Archiving。
3. 使用 pg_dump 的 custom/directory 格式时，保存导出命令、版本、目标数据库、过滤参数和校验信息；需要 Role 等全局对象时额外备份。
4. 使用 pg_basebackup 创建一致的物理 Base Backup；记录备份开始/结束时间、LSN、版本和数据目录。
5. 配置 archive_mode、archive_command 或归档组件，将 WAL 写入独立且受监控的存储；验证归档连续性和失败告警。
6. 设计 WAL 保留、归档容量和删除策略，确保最旧 Base Backup 需要的 WAL 不会提前清理。
7. 定期做隔离环境恢复：pg_restore 逻辑备份、恢复 Base Backup、重放 WAL 到指定时间点。
8. 恢复后验证数据库启动、Role/权限、对象数量、关键表行数、业务汇总、约束和应用连接。
9. 记录每次恢复耗时、缺失 WAL、失败原因和实际 RPO/RTO，调整备份周期和资源。
10. 演练误删、错误批处理、存储故障和整个主机丢失；恢复流程必须由未参与原始备份的运维人员也能执行。

示例：创建自定义格式逻辑备份并检查列表。

~~~bash
pg_dump -Fc -d orders -f orders.dump
pg_restore --list orders.dump
~~~

PITR 的恢复流程还需要准备 Base Backup、完整 WAL 归档、restore_command 和 recovery_target_* 配置；单独执行 pg_dump 不能实现时间点恢复。

## 场景分析

业务发现凌晨 02:15 的批处理错误地删除了过去一周的订单。最近一次每日 pg_dump 是前一晚 23:00，团队既要保留夜间正常订单，又要恢复误删数据。

可以把连续归档的 Base Backup 恢复到 02:14:59 的独立实例，使用 WAL 回放到目标时间点，再导出缺失订单并与当前生产比对。不要直接将整个生产实例切回旧时间点，因为 02:15 之后的合法交易会丢失。合并恢复记录时还要处理主键冲突、后续订单状态和支付流水。

验收应证明 PITR 能恢复到目标时间、归档链完整、业务记录可对账，并测出实际恢复耗时。只验证备份文件存在不能证明满足 RPO/RTO。

## 常见误区

- **认为 pg_dump 可以做任意时间点恢复。** PITR 需要物理 Base Backup 和连续 WAL。
- **认为 pg_dump 会备份所有 Cluster 级 Role。** 单库 Dump 与全局对象备份范围不同。
- **认为只需备份最新 Base Backup。** 所需 WAL 必须连续保留，归档链中断会影响目标时间恢复。
- **认为流复制等于备份。** 错误 SQL 和删除可能复制到 Standby，备份/归档仍需独立存在。
- **只检查备份命令成功。** 必须定期在独立环境完成恢复和数据核验。
- **恢复后直接覆盖生产。** 事故发生后仍可能有合法写入，应评估差异合并而不是盲目回退。

## 完成标准

- [ ] 能区分逻辑 Dump、物理 Base Backup 和 WAL Archiving。
- [ ] 能根据 RPO/RTO 选择备份方案。
- [ ] 能解释 PITR 的 Base Backup、WAL 重放和恢复目标。
- [ ] 能设计独立故障域、WAL 保留与容量监控。
- [ ] 能通过恢复演练验证备份完整性和业务正确性。

## 自测

1. pg_dump 成功完成后，是否可以直接恢复到备份期间任意秒？还缺少什么？
2. 物理 Base Backup 和 WAL Archive 的关系是什么？
3. PITR 恢复到 02:14:59 后，为什么不应直接覆盖已经接收后续订单的生产主库？
4. 流复制副本能否替代独立备份？为什么？
5. 如何通过恢复演练实际测量 RPO 和 RTO？

## 参考资料

- [Backup and Restore](https://www.postgresql.org/docs/current/backup.html)
- [SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html)
- [Continuous Archiving and Point-in-Time Recovery](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [pg_basebackup](https://www.postgresql.org/docs/current/app-pgbasebackup.html)
- [WAL Introduction](https://www.postgresql.org/docs/current/wal-intro.html)
