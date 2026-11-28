# PostgreSQL 锁、死锁与并发故障处理

## 本节要解决的问题

定位事务为什么等待、哪些操作互相阻塞以及如何安全解除阻塞。PostgreSQL 通过 MVCC 降低普通读写之间的冲突，但 UPDATE、DELETE、SELECT FOR UPDATE、DDL 和显式 LOCK 仍会取得锁。排障时必须找到持锁事务、等待事务和业务操作，不应直接重启数据库或杀掉所有慢查询。

## 核心知识

### 表锁和行锁保护不同对象与操作

PostgreSQL 每条 SQL 会自动取得所需表级锁。SELECT 通常取得 ACCESS SHARE；INSERT/UPDATE/DELETE 通常取得 ROW EXCLUSIVE；许多 DDL 会请求更强的锁。ALTER TABLE、DROP TABLE 等操作可能需要 ACCESS EXCLUSIVE，因而等待长时间运行的查询或事务结束。

UPDATE、DELETE 和 SELECT FOR UPDATE 等还会锁定具体行。普通 SELECT 通过 MVCC 读取可见版本，通常不会被行锁阻塞；但另一个事务尝试修改相同行时需要等待。SELECT FOR UPDATE、FOR NO KEY UPDATE、FOR SHARE 和 FOR KEY SHARE 的冲突范围不同，应按需要选择而不是无条件锁更多行。

### 死锁来自事务获取锁的顺序形成环路

两个事务如果以不同顺序锁定相同资源，可能形成循环等待。例如事务 A 先锁账户 1 再锁账户 2，事务 B 先锁账户 2 再锁账户 1。PostgreSQL 会检测死锁并终止其中一个事务，报错 SQLSTATE 40P01；应用必须回滚并按幂等策略重试整个事务。

统一加锁顺序、缩短事务、避免在持锁期间调用外部 API，可以显著减少死锁。不要为了消除死锁而把所有表或所有行都加成高强度锁，这会降低并发能力。

### 从活动会话、阻塞关系和锁视图定位根因

pg_stat_activity 展示会话状态、运行 SQL、事务开始时间和等待事件；pg_locks 展示当前锁请求与持有情况；pg_blocking_pids(pid) 可以列出阻塞某会话的进程 ID。可将这些信息关联起来，找到阻塞链的最前端。

lock_timeout 限制单次锁等待时间；statement_timeout 限制语句运行总时间；deadlock_timeout 控制死锁检测等待时机。log_lock_waits 可记录较长锁等待。参数应按 workload 和运维目标设置，不要一味调大超时时间掩盖阻塞问题。

## 工程实施步骤

1. 出现等待时先查看 pg_stat_activity，记录 pid、usename、application_name、state、wait_event_type、wait_event、xact_start 和 query_start。
2. 使用 pg_blocking_pids(pid) 找到阻塞当前进程的会话，并递归检查阻塞链中最早的未提交事务。
3. 联查 pg_locks，按 pid、locktype、relation、mode 和 granted 判断锁对象及是否已获得。
4. 查看持锁会话的事务开始时间和 SQL；特别留意 idle in transaction、长时间批处理和应用外部调用。
5. 对 DDL 等待，检查是否有长时间 SELECT 或写事务持有冲突表锁；对 UPDATE 等待，检查是否多个事务争用相同业务行。
6. 将同一业务对象的批量更新按固定顺序排序，例如先按 account_id 排序，再逐个更新，降低死锁概率。
7. 缩小事务范围，避免在 BEGIN 与 COMMIT 之间调用网络服务、等待用户输入或执行长时间文件处理。
8. 按需要设置 lock_timeout、statement_timeout 和 log_lock_waits；使用 SET LOCAL 可将参数限制在当前事务。
9. 解除阻塞前确认会话 Owner、业务影响和事务内容；可先 cancel 当前语句，只有确定需结束整个 Session 时才 terminate。
10. 重现并发场景，验证锁等待时间、死锁次数、回滚结果和幂等重试；记录阻塞 SQL 与业务请求 ID。

示例：查看当前被阻塞的会话和阻塞者。

~~~sql
SELECT
  a.pid,
  a.usename,
  a.application_name,
  a.state,
  a.wait_event_type,
  a.wait_event,
  a.xact_start,
  pg_blocking_pids(a.pid) AS blocking_pids,
  a.query
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0
ORDER BY a.xact_start NULLS LAST;
~~~

## 场景分析

订单结算作业持续等待，API 请求也出现超时。团队准备重启 PostgreSQL 实例。

先查询 pg_stat_activity 和 pg_blocking_pids，发现一个 ETL Session 已进入 idle in transaction，持有订单表相关行锁；API 更新同一订单时等待该事务结束。重启实例会中断全部连接，不能解决应用为何在事务中闲置的问题。

处理时先确认 ETL 是否已经完成前序写入，再由作业负责人提交或回滚；如果事务长期失联，可在业务评估后取消语句或终止 Session。随后修复应用，确保异常路径始终 COMMIT/ROLLBACK，并且不在事务内等待外部服务。验收要验证 API 超时下降、阻塞事务消失、订单状态与账务记录一致。

## 常见误区

- **认为 MVCC 代表没有锁。** 普通读写冲突较少，但写写、DDL 和显式锁仍会等待。
- **看到 wait_event 就直接杀会话。** 应先识别阻塞链、Owner 和事务业务影响。
- **认为死锁是数据库故障。** 常见根因是应用获取锁顺序不一致，数据库终止一个事务以解除环路。
- **在事务里调用远程 API。** 外部延迟会延长持锁时间。
- **把 lock_timeout 调大当作修复。** 这只是让请求等待更久，阻塞根因仍然存在。
- **取消语句和终止 Session 不作区分。** cancel 结束当前语句；terminate 会断开整个连接并回滚未提交事务。

## 完成标准

- [ ] 能区分表锁、行锁和 MVCC 读可见性。
- [ ] 能解释死锁形成条件与 SQLSTATE 40P01。
- [ ] 能通过 pg_stat_activity、pg_locks 和 pg_blocking_pids 定位阻塞链。
- [ ] 能选择 lock_timeout、statement_timeout 和 log_lock_waits。
- [ ] 能以一致加锁顺序和短事务减少并发问题。

## 自测

1. 普通 SELECT 为什么通常不会被 UPDATE 的行锁阻塞，但 SELECT FOR UPDATE 会？
2. 两个事务按相反顺序更新两张表，为什么可能形成死锁？
3. pg_stat_activity 显示 idle in transaction 且有 blocking_pids，应该先检查什么？
4. cancel_backend 与 terminate_backend 对 Session 的影响有什么差异？
5. 为什么在事务中调用外部 API 会增加锁等待风险？

## 参考资料

- [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Monitoring Database Activity](https://www.postgresql.org/docs/current/monitoring-stats.html)
- [System Information Functions: pg_blocking_pids](https://www.postgresql.org/docs/current/functions-info.html)
- [Runtime Configuration: Client Connection Defaults](https://www.postgresql.org/docs/current/runtime-config-client.html)
