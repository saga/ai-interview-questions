# 事务边界与并发数据修改

## 本节要解决的问题

理解 Snowflake 中 DML 的事务原子性、自动提交、显式事务和并发写入冲突。应用出现等待或重试时，需要区分事务锁、Warehouse 排队与 SQL 失败，避免因无条件重试造成重复副作用或数据不一致。

## 核心知识

### AUTOCOMMIT 决定单条语句是否独立提交

Snowflake 的 AUTOCOMMIT 默认开启。未处于显式事务中的语句会按单语句事务执行：成功时提交，失败时回滚。需要把多条相关 DML 作为一个原子单元时，使用 BEGIN TRANSACTION、COMMIT 和 ROLLBACK 明确事务边界。

显式事务应集中包含 DML 和查询语句。大多数 DDL 会隐式提交当前活动事务，不能把 CREATE TABLE、ALTER TABLE 等 DDL 当作普通 DML 放在事务中期待统一回滚。存储过程内部也需要注意事务作用域，避免跨过程边界操作由外层打开的事务。

### 并发修改的锁行为取决于语句类型

标准表上的 UPDATE、DELETE 和 MERGE 会持有资源锁，通常不能与针对同一表的其他 UPDATE、DELETE、MERGE 并行执行。INSERT 和 COPY 通常写入新的分区，往往可以并行，但涉及同一对象的 DDL 与显式事务仍需谨慎协调。

这与 Warehouse 的查询排队不同：事务锁等待来自并发数据修改或对象操作；Warehouse 排队来自计算容量或启动状态。应使用 LOCK_WAIT_HISTORY、SHOW LOCKS、SHOW TRANSACTIONS 和 Query History 识别真正的等待原因。

### 重试必须依据错误类别和业务幂等性

网络断开、超时、资源暂时不可用与事务冲突并不等价。客户端未收到结果不代表服务端操作一定没有提交。对非幂等写入，盲目重放可能生成重复记录或重复扣款。

应用应以业务唯一键、请求 ID 或批次 ID 实现幂等；发生不确定提交结果时，先查询业务状态或事务证据，再决定重试。需要终止异常遗留事务时，应按权限和运行状态使用事务管理能力，而不是直接重启整个 Warehouse。

## 工程实施步骤

1. 在应用和 SQL 脚本中标清事务起点、提交点及允许回滚的语句，确认 AUTOCOMMIT 实际值。
2. 对多条 DML 的业务操作使用显式事务；将 DDL 与 DML 部署步骤分开，避免 DDL 隐式提交破坏预期边界。
3. 设计并发写入时，识别是否会有多个会话同时 UPDATE、DELETE 或 MERGE 同一目标对象；必要时按业务键或批次分区任务。
4. 发生等待时记录 Query ID 和 Session，查看 LOCK_WAIT_HISTORY、SHOW LOCKS、SHOW TRANSACTIONS，判断是否为资源锁等待。
5. 同时检查 Query History 的 queued_overload_time、queued_provisioning_time 和 transaction_blocked_time，区分计算资源等待和事务阻塞。
6. 为写入请求设计稳定的业务唯一键和幂等记录；重试前查询请求是否已完成，避免不确定提交结果导致重复写入。
7. 演练语句失败、显式 ROLLBACK、客户端断开、并发 UPDATE 和 DDL 竞争，验证最终数据状态及锁释放行为。

示例：

~~~
BEGIN TRANSACTION;

UPDATE MART.ACCOUNT_BALANCE
SET BALANCE = BALANCE - 100
WHERE ACCOUNT_ID = 'A-100';

INSERT INTO MART.ACCOUNT_LEDGER
  (REQUEST_ID, ACCOUNT_ID, AMOUNT, CREATED_AT)
VALUES
  ('req-20261128-001', 'A-100', -100, CURRENT_TIMESTAMP());

COMMIT;
~~~

真实应用还需要保证 REQUEST_ID 唯一，并对重复请求进行判断；事务原子性不会自动解决业务层重复请求。

## 场景分析

结算服务更新账户余额后，客户端连接意外断开，没有收到成功响应。服务马上重试同一条扣款 SQL，结果可能再次扣款。

正确处理方式是让请求携带稳定的 REQUEST_ID，并在同一事务中维护余额与账本记录。客户端重连后先按 REQUEST_ID 查询账本状态：记录已存在则确认原操作已提交；记录不存在时再执行事务。若并发请求修改相同账户，检查锁等待并控制同一账户的写入并发。

验收时分别模拟提交前断开、提交后响应丢失、并发扣款和事务回滚，验证余额、账本记录和请求状态始终一致。

## 常见误区

- **认为默认 AUTOCOMMIT 关闭。** 默认开启时，事务外的每条语句独立提交。
- **认为 DDL 一定能随显式事务回滚。** 大多数 DDL 会隐式提交活动事务。
- **把所有等待都当作 Warehouse 排队。** 事务锁、仓库过载、恢复/预配等待是不同原因。
- **认为 UPDATE、DELETE、MERGE 可以在同一标准表上无限并发。** 这些写操作通常需要串行协调。
- **认为客户端超时就代表服务端回滚。** 连接结果不确定时，先检查业务操作是否已提交，再决定是否重试。

## 完成标准

- [ ] 能解释 AUTOCOMMIT 与显式事务的区别。
- [ ] 能说明 DDL 对活动事务的隐式提交影响。
- [ ] 能区分标准表上的并发 DML 锁等待和 Warehouse 排队。
- [ ] 能利用事务与锁历史定位阻塞源。
- [ ] 能为超时重试设计业务幂等检查。

## 自测

1. AUTOCOMMIT 开启时，连续执行两条 UPDATE 是否属于同一个原子事务？怎样改变这个行为？
2. 显式事务内执行 DML 后又执行 CREATE TABLE，为什么不能假定所有操作都能一起回滚？
3. 两个会话同时 MERGE 同一张标准表时出现等待，应该检查哪些锁与查询证据？
4. 客户端超时但服务端可能已提交，如何防止重试造成重复扣款？

## 参考资料

- [Transactions](https://docs.snowflake.com/en/sql-reference/transactions)
- [LOCK_WAIT_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/lock_wait_history)
- [QUERY_HISTORY view](https://docs.snowflake.com/en/sql-reference/account-usage/query_history)
