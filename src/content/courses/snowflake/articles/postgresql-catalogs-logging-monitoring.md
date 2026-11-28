# PostgreSQL 系统目录、日志与运行监控

## 先判断数据库是在忙、在等，还是已经失去响应

线上 API 的 p95 从 80 毫秒升到 2 秒。CPU 使用率并不高，连接数却接近上限。仅看 CPU 很难解释问题：连接可能在等待锁、等待 I/O，也可能由应用开启事务后长期不提交。

PostgreSQL 有三类互补证据。系统目录和 Information Schema 描述对象定义；pg_stat_* 视图记录连接、事务、表和 I/O 的活动；服务端日志保留某次错误、慢语句或连接事件。统计视图适合观察趋势，日志用于复原事件，目录用于解释对象结构，不能互相替代。

## 从 pg_stat_activity 找到等待者

先查看非空闲连接：

~~~sql
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  wait_event_type,
  wait_event,
  now() - query_start AS query_age,
  now() - xact_start AS transaction_age,
  left(query, 300) AS query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND state IS DISTINCT FROM 'idle'
ORDER BY xact_start NULLS LAST, query_start;
~~~

state = active 只说明后端正在执行语句；wait_event_type 和 wait_event 可以说明它是否正在等待资源。active 会话也可能正等待锁。idle in transaction 会话没有运行 SQL，却可能长期保留事务和快照，影响 VACUUM 清理。排查时同时看 query_age 与 transaction_age，不要只盯着最长 SQL。

若等待类型是 Lock，再查看阻塞关系：

~~~sql
SELECT
  blocked.pid AS blocked_pid,
  blocker.pid AS blocker_pid,
  blocked.application_name AS blocked_app,
  blocker.application_name AS blocker_app,
  now() - blocked.query_start AS blocked_for,
  left(blocked.query, 200) AS blocked_query,
  left(blocker.query, 200) AS blocker_query
FROM pg_stat_activity AS blocked
JOIN pg_stat_activity AS blocker
  ON blocker.pid = ANY(pg_blocking_pids(blocked.pid));
~~~

确认阻塞者后，先联系事务所有者，判断是否能安全终止事务。直接执行 pg_terminate_backend 可能回滚业务操作；它是应急手段，不是锁诊断的第一步。

## 统计视图回答趋势，不还原每次请求

pg_stat_database 可观察事务提交、回滚和死锁；pg_stat_user_tables 与 pg_stat_user_indexes 能帮助判断扫描、索引访问和死元组；PostgreSQL 16 及之后版本还提供 pg_stat_io，用于按后端类型和 I/O 上下文观察活动。

例如，下面的查询可找出顺序扫描读取行数较多的表：

~~~sql
SELECT
  schemaname,
  relname,
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY seq_tup_read DESC
LIMIT 20;
~~~

顺序扫描多不自动代表缺索引。如果查询读取表中大部分行，顺序扫描可能更便宜。n_dead_tup 是估算值，不等于磁盘上所有可回收字节。统计计数器也可能在重启或手动重置后归零，因此监控系统要保存采集时间和基线。

## pg_stat_statements 与慢 SQL 日志各有任务

pg_stat_statements 按规范化查询累计调用次数、总执行时间、平均耗时和块访问，适合找长期成本最高的 SQL。它需要加入 shared_preload_libraries 并在服务器启动时加载；只执行 CREATE EXTENSION 不足以完成预加载配置。

~~~sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT
  calls,
  round(total_exec_time::numeric, 1) AS total_ms,
  round(mean_exec_time::numeric, 1) AS mean_ms,
  rows,
  shared_blks_hit,
  shared_blks_read,
  left(query, 240) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
~~~

若要追踪单次慢语句，可以配置 log_min_duration_statement，再结合业务 SLO 设定阈值。log_line_prefix 最好包含时间、PID、用户、数据库、应用名和事务 ID。完整 SQL 可能含个人信息或业务数据，日志访问范围和保留期限也要纳入安全管理。

## 系统目录和 Information Schema 的区别

information_schema.columns 适合查询当前角色可见对象的列定义；pg_catalog 更贴近 PostgreSQL 内部对象模型，提供表、索引、类型和统计等系统信息。系统目录能力更丰富，但与 PostgreSQL 实现耦合更强。

生产监控不应无筛选地高频轮询 pg_stat_activity、pg_locks 和 pg_stat_statements。高基数 SQL 文本、过密采样和过长保留时间都会增加监控开销。应围绕具体故障假设选择视图和字段。

## 诊断时容易读错的信号

- CPU 不高不代表数据库没有瓶颈，锁等待和连接池耗尽也会拖慢请求。
- active 不等于正在消耗 CPU，也可能等待资源。
- 顺序扫描多不等于缺索引，先看扫描比例和查询目的。
- pg_stat_statements 是聚合统计，不是逐请求审计日志。
- 统计计数器可能重置，不能跨重置点直接做趋势差分。
- 慢 SQL 日志可能包含敏感值，应限制访问并评估脱敏。

## 自测

1. 一个会话长期处于 idle in transaction，另一个请求等待锁。应该用哪些视图和字段把两者关联起来？
2. pg_stat_user_tables 显示某张表 seq_scan 很高，什么情况下这是正常行为？
3. pg_stat_statements 没有启用，为什么只执行 CREATE EXTENSION 可能还不够？
4. 为什么慢 SQL 日志和 pg_stat_statements 应该一起使用？

## 参考资料

- [PostgreSQL 18 monitoring statistics](https://www.postgresql.org/docs/18/monitoring-stats.html)
- [PostgreSQL 18 logging configuration](https://www.postgresql.org/docs/18/runtime-config-logging.html)
- [pg_stat_statements](https://www.postgresql.org/docs/18/pgstatstatements.html)
- [The PostgreSQL system catalogs](https://www.postgresql.org/docs/18/catalogs.html)
