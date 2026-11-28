# PostgreSQL CRUD、RETURNING 与 UPSERT

## 本节要解决的问题

设计可核验、可重试的数据写入流程，避免应用先查询再写入造成并发竞争。PostgreSQL 的 INSERT、UPDATE、DELETE 和 ON CONFLICT 可以在服务器端完成数据变更；RETURNING 能在同一条语句中返回实际修改结果。关键是让唯一约束、冲突策略和事务边界共同表达业务规则。

## 核心知识

### CRUD 语句的结果应由数据库返回

INSERT 写入新行；UPDATE 修改满足 WHERE 条件的行；DELETE 删除匹配行。不要假定 UPDATE 或 DELETE 一定影响一行，应检查受影响行数或使用 RETURNING 返回实际记录。

RETURNING 可以返回修改后的列、默认生成的 ID、计算列和触发器修改后的值。INSERT 返回新行；UPDATE 默认返回更新后的行；DELETE 返回被删除行。对于不容易在写入后再次定位的记录，RETURNING 比“写入后再 SELECT”更可靠，也避免第二次查询与另一个并发事务之间产生观察差异。

示例：

~~~sql
INSERT INTO sales.orders (
  customer_id, order_status, total_amount
)
VALUES (1001, 'created', 125.50)
RETURNING order_id, created_at, total_amount;

UPDATE sales.orders
SET order_status = 'paid'
WHERE order_id = 90001
  AND order_status = 'created'
RETURNING order_id, order_status;

DELETE FROM sales.orders
WHERE order_id = 90001
  AND order_status = 'cancelled'
RETURNING order_id;
~~~

### ON CONFLICT 依赖唯一约束或唯一索引

PostgreSQL 的 UPSERT 通过 INSERT ... ON CONFLICT 实现。冲突目标应对应主键、唯一约束或可用的唯一索引。DO NOTHING 表示冲突时跳过写入；DO UPDATE 表示冲突时更新目标行。

ON CONFLICT DO UPDATE 在并发写入下会使用数据库的唯一性检查与行锁处理竞争，比应用端先 SELECT 再 INSERT 更可靠。后者存在典型竞态：两个事务同时查到记录不存在，再同时 INSERT，其中一个可能违反唯一约束。

DO UPDATE 的 SET 表达式可以使用 EXCLUDED 引用本次准备插入的行，也可引用目标表现有值。WHERE 子句可限制何时更新；若条件不成立，冲突行不会被更新，也不会出现在该语句的 RETURNING 结果中。

### UPSERT 是原子冲突处理，不自动代表业务幂等

唯一键能防止相同业务键重复插入，但是否更新取决于业务语义。若每次重试都覆盖字段，晚到的旧消息可能覆盖新状态。对事件流或 API 请求，应有明确的请求 ID、事件版本或更新时间比较规则。

需要区分“相同请求重放”和“同一实体的新版本更新”。例如支付回调可以按 provider_event_id 去重；订单状态更新可按 event_version 保证只接受更新版本。ON CONFLICT 只提供原子写入机制，业务幂等仍由唯一键和冲突条件定义。

## 工程实施步骤

1. 为写入操作定义业务唯一键：订单号、外部事件 ID、租户内业务键或请求 ID；不要把非唯一字段误当冲突键。
2. 用 PRIMARY KEY 或 UNIQUE 约束在数据库中落实唯一性，避免仅依赖应用层预检查。
3. 对普通新增使用 INSERT ... RETURNING 获取数据库生成的 ID 和默认值。
4. 对状态变更在 UPDATE 的 WHERE 中包含预期旧状态或版本号，使用 RETURNING 确认真正更新的行。
5. 对可重复提交的新增请求使用 ON CONFLICT DO NOTHING，或按明确规则使用 DO UPDATE。
6. 在 DO UPDATE 中比较 EXCLUDED 与现有行的版本、更新时间或业务状态，防止旧消息覆盖新数据。
7. 检查 UPSERT 冲突目标及其权限要求；DO UPDATE 还需要相应 UPDATE 权限，读取的列需要 SELECT 权限。
8. 将多条业务相关写入放入同一事务，明确 COMMIT、ROLLBACK 和失败重试边界。
9. 对并发测试记录影响行数、RETURNING 结果、唯一冲突和事务错误；不要只验证单线程场景。
10. 将请求 ID、事件版本、执行结果和重试次数写入可审计日志，便于排查重复或乱序数据。

示例：按外部事件 ID 幂等写入支付状态，只接受更新版本。

~~~sql
INSERT INTO billing.payment_events (
  provider_event_id, payment_id, event_version, payment_status
)
VALUES (
  'evt-2026-00017', 501, 3, 'settled'
)
ON CONFLICT (provider_event_id)
DO UPDATE SET
  event_version = EXCLUDED.event_version,
  payment_status = EXCLUDED.payment_status
WHERE EXCLUDED.event_version > billing.payment_events.event_version
RETURNING provider_event_id, event_version, payment_status;
~~~

## 场景分析

支付平台可能对同一笔支付重复发送回调。应用若每次都 INSERT 账单流水，可能产生重复记录；若简单 UPSERT 覆盖状态，旧的 pending 事件也可能覆盖先到的 settled 状态。

使用 provider_event_id 建唯一约束，将每次外部事件作为不可重复事件；对同一支付的状态演进，再按 event_version 或业务时间比较，只接受更新版本。若 RETURNING 没有返回行，表示本次冲突处理没有插入或更新，需要区分重复事件与版本较旧的事件。

验收同时模拟两条并发相同事件、不同版本乱序到达、事务提交前失败、提交后客户端超时和唯一约束冲突。检查事件表无重复、状态不回退，且客户端重试不会重复产生业务副作用。

## 常见误区

- **先 SELECT 不存在再 INSERT。** 并发事务可以同时通过预检查，唯一约束才是最终正确性保障。
- **认为 ON CONFLICT 不需要唯一约束。** 冲突目标必须对应主键、唯一约束或可用唯一索引。
- **把 DO NOTHING 当作所有重复请求的完整处理。** 需要返回或查询已有记录时，应设计相应的业务读取路径。
- **认为 UPSERT 自动保证业务幂等。** 冲突更新仍可能覆盖新状态，需要事件版本或条件更新。
- **假设 RETURNING 一定返回一行。** WHERE 不满足或冲突策略跳过更新时，可能不返回记录。
- **把客户端超时当作数据库回滚。** 事务可能已提交；重试前应按幂等键确认实际状态。

## 完成标准

- [ ] 能使用 INSERT/UPDATE/DELETE ... RETURNING 获取实际修改结果。
- [ ] 能说明 ON CONFLICT 对主键和唯一约束的依赖。
- [ ] 能区分 DO NOTHING 与 DO UPDATE 的语义。
- [ ] 能用业务键和版本条件设计幂等 UPSERT。
- [ ] 能测试并发冲突、乱序事件和不确定提交结果。

## 自测

1. 两个事务同时执行“先 SELECT 不存在，再 INSERT”，为什么可能发生唯一冲突？
2. ON CONFLICT DO UPDATE 的 WHERE 条件不成立时，RETURNING 会返回该行吗？
3. 如何防止较旧的支付事件通过 UPSERT 覆盖较新的状态？
4. 为什么 ON CONFLICT DO UPDATE 需要的权限可能比单纯 INSERT 更多？
5. 客户端超时后不知道事务是否提交，如何安全重试？

## 参考资料

- [INSERT and ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)
- [Returning Data from Modified Rows](https://www.postgresql.org/docs/current/dml-returning.html)
- [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
