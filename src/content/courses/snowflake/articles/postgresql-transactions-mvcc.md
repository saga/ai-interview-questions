# PostgreSQL 事务、MVCC 与隔离级别

## 本节要解决的问题

理解 PostgreSQL 如何通过 MVCC 快照提供并发读写，并选择适合业务一致性要求的事务隔离级别。要区分逻辑上的事务原子性、快照可见性、行锁和序列化失败；应用需要有明确的提交确认、重试和幂等策略。

## 核心知识

### MVCC 用行版本和 Snapshot 控制可见性

PostgreSQL 使用多版本并发控制（MVCC）。UPDATE 或 DELETE 不会简单地覆盖当前所有读者看到的版本，而是产生新的行版本并记录可见性信息。每个查询或事务根据 Snapshot 判断哪些行版本可见。

这使普通 SELECT 通常不会阻塞 UPDATE/DELETE，写入也不必等待所有读者结束；但它不意味着没有锁。写事务仍需要行级锁、表级锁和提交协调；长事务还可能阻止 VACUUM 清理不再可见的旧版本。

### Read Committed 与 Repeatable Read 的快照范围不同

PostgreSQL 默认隔离级别是 Read Committed。每条命令获得新的 Snapshot，因此同一事务中两次 SELECT 之间，可能看到其他事务已经提交的变化。

Repeatable Read 在事务中使用稳定 Snapshot；普通读不会因并发提交而看到变化。PostgreSQL 的 Repeatable Read 还能防止幻读，但仍可能出现 Serialization Anomaly。Serializable 使用 Serializable Snapshot Isolation（SSI）检测读写依赖；如果无法证明并发事务等价于某个串行顺序，事务会以 serialization failure 终止。

Read Uncommitted 在 PostgreSQL 中按 Read Committed 行为执行，不会出现脏读。

### 失败事务要重试整个业务单元，而不是只重跑最后一条 SQL

Serializable 失败通常返回 SQLSTATE 40001，死锁返回 40P01。应用应回滚失败事务，并从事务开头重新执行整个业务逻辑。只重试最后一条 UPDATE 可能破坏前面读取和计算所依赖的快照。

Sequence 的 nextval 变化不会随事务回滚；因此序列号存在跳号是正常现象，不代表数据行已经提交。客户端超时也不代表事务必然回滚，若提交结果不确定，应通过业务请求 ID 或账本记录检查是否已提交。

## 工程实施步骤

1. 将业务操作划分为事务单元，明确哪几条语句必须原子提交，哪些外部调用不能放在长事务内。
2. 默认使用 Read Committed；只有确实需要稳定快照或可串行化语义时，才提升为 Repeatable Read 或 Serializable。
3. 在需要防止并发修改同一业务对象时，评估 SELECT FOR UPDATE、唯一约束或条件 UPDATE，而不是无差别锁整张表。
4. 对 Serializable 事务设计 SQLSTATE 40001 的全事务重试；对 deadlock 40P01 记录冲突并按策略重试。
5. 为重试使用请求 ID、业务唯一键或操作版本，防止客户端不确定提交结果后重复产生副作用。
6. 处理 sequence 时不假定回滚会恢复 nextval；不将连续无缺口序号当作数据库事务保证。
7. 监控长事务和 idle in transaction，会话长期持有快照可能阻止旧行版本回收。
8. 将外部 API、邮件和消息发送放在事务提交之后，通过 Outbox 或可靠事件机制处理，避免事务回滚但外部副作用已经发生。
9. 使用并发测试验证丢失更新、重复写入、读写偏差和序列化失败；不要只在单连接下测试。
10. 记录事务隔离级别、SQLSTATE、重试次数和最终提交状态，确保重试耗尽后有明确告警与补偿路径。

示例：在 Serializable 下执行需要全事务重试的转账逻辑。

~~~sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

UPDATE banking.accounts
SET balance = balance - 100
WHERE account_id = 10
  AND balance >= 100;

UPDATE banking.accounts
SET balance = balance + 100
WHERE account_id = 20;

COMMIT;
~~~

应用必须检查第一条 UPDATE 是否影响一行，并在 SQLSTATE 40001 时回滚后重跑整个事务；转账还需校验账户存在、币种一致和业务幂等。

## 场景分析

两个事务并发从同一账户扣款。应用先 SELECT 余额，再判断足够后 UPDATE。若使用 Read Committed 且不锁定行，两个事务可能基于相似旧读数做判断，导致业务规则无法保持。

解决方式要根据业务选择：可以在读取时 SELECT FOR UPDATE 锁住账户行，或用带余额条件的 UPDATE 并检查 RETURNING 行数；复杂跨账户约束可考虑 Serializable，并处理序列化失败后整个事务重试。

验收同时模拟两个并发扣款、客户端在 COMMIT 前后断开、唯一请求重复提交和序列化失败。检查最终余额、账本总额、请求状态以及重试是否产生重复扣款。

## 常见误区

- **认为 MVCC 意味着没有锁。** 普通读写互不阻塞不代表写写、DDL 或显式锁之间没有冲突。
- **认为 Read Committed 的整个事务共享同一 Snapshot。** 每条命令可看到新的已提交数据。
- **认为 Repeatable Read 与 Serializable 完全等价。** PostgreSQL 的 Repeatable Read 仍可能出现 Serialization Anomaly。
- **只重试触发错误的那一条 SQL。** 序列化失败需要重跑整个事务逻辑。
- **认为 sequence 变更会跟随事务回滚。** nextval 不回滚，序列值出现间隙正常。
- **将客户端超时当作事务未提交。** 需要查询业务请求状态，避免不确定提交后的重复操作。

## 完成标准

- [ ] 能解释 MVCC 行版本和 Snapshot 可见性。
- [ ] 能区分 Read Committed、Repeatable Read 和 Serializable。
- [ ] 能说明 PostgreSQL 中 Read Uncommitted 的实际行为。
- [ ] 能为 40001 和 40P01 设计正确重试。
- [ ] 能处理 sequence 不回滚和客户端提交结果不确定的情况。

## 自测

1. Read Committed 下同一事务连续两次 SELECT，为什么可能看到不同的已提交结果？
2. PostgreSQL 的 Repeatable Read 能否防止所有序列化异常？
3. 收到 SQLSTATE 40001 后，为什么应重跑整个事务，而非只重复失败语句？
4. 为什么事务回滚后 sequence 仍可能跳号？
5. 客户端在 COMMIT 时网络断开，如何判断业务是否已经提交？

## 参考资料

- [Concurrency Control and MVCC](https://www.postgresql.org/docs/current/mvcc.html)
- [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Sequence Manipulation Functions](https://www.postgresql.org/docs/current/functions-sequence.html)
