# PostgreSQL 事务、MVCC、隔离级别与锁

## MVCC 的基本思想

PostgreSQL 使用 MVCC 让事务基于一致性快照读取数据。UPDATE 和 DELETE 不会简单地原地覆盖所有旧版本；旧 Tuple Version 在不再被事务需要后才能清理。它减少读写互相阻塞，但也带来 VACUUM 和膨胀管理问题。

## 隔离级别

READ COMMITTED 是常见默认隔离级别，每条语句获得自己的快照；REPEATABLE READ 在事务内维持一致快照；SERIALIZABLE 通过检测可能的序列化异常保证更强的隔离语义，但应用必须准备处理 Serialization Failure 并重试事务。

隔离级别越强并不代表所有系统越安全。选择应基于业务不变量、并发模式和重试能力。

## 锁与死锁

行锁用于协调并发修改；表锁保护 DDL 或特定操作。两个事务以不同顺序锁定资源时可能形成死锁。数据库检测死锁后会终止其中一个事务，应用需要记录 SQLSTATE 并处理重试。

## 排查步骤

1. 查询 pg_stat_activity，识别等待事件和运行时间。
2. 查询 pg_locks，分析等待者和持有者。
3. 找到阻塞链顶端的长事务。
4. 检查应用是否长时间打开事务或等待用户输入。
5. 评估锁顺序、索引和事务粒度。

不要仅通过提高 lock_timeout 或终止会话来掩盖问题。先识别事务为什么持锁过久。

## 检查题

1. MVCC 为什么仍然需要 VACUUM？
2. READ COMMITTED 与 REPEATABLE READ 的快照行为有什么不同？
3. 死锁出现后应用为什么需要安全重试？
