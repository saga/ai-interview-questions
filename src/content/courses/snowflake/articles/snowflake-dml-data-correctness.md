# DML、MERGE 与数据质量保证

## 本节要解决的问题

订单变更文件每天重复投递，ETL 团队用 MERGE 把数据同步到分析表。某天作业重跑后，部分订单金额变成了两条不同记录中的一个值；另一些新订单却出现了两份。SQL 执行状态是成功，作业也没有超时。

问题不在 MERGE 语法，而在源数据没有先确定“一笔业务记录只能有一个最终版本”。MERGE 可以把匹配和更新写在一个语句里，但不会自动替你去重、保证业务键唯一或让重复输入变成幂等操作。

## 核心知识

### INSERT、UPDATE、DELETE 和 MERGE 改变数据的方式不同

- INSERT 增加行，不会因为业务键相同就自动覆盖旧行。
- UPDATE 修改满足过滤条件的现有行；WHERE 条件决定修改范围。
- DELETE 删除满足过滤条件的行；条件过宽可能一次删掉超出预期的数据。
- MERGE 根据 ON 条件比较源与目标，再分别执行 MATCHED 和 NOT MATCHED 分支。

MERGE 适合“有则更新、无则插入”的同步，但正确性取决于两侧的键和源数据粒度。语句写得完整，不代表它天然具备去重、唯一性或 exactly-once 语义。

### 一个目标行匹配多个源行时，UPDATE 可能不确定

目标表只有一条订单：

| ORDER_ID | AMOUNT | UPDATED_AT |
|---|---:|---|
| O100 | 100 | 2026-11-01 08:00 |

源文件却含有同一订单的两个版本：

| ORDER_ID | AMOUNT | SOURCE_UPDATED_AT | INGEST_ID |
|---|---:|---|---|
| O100 | 120 | 2026-11-02 09:00 | 501 |
| O100 | 125 | 2026-11-02 10:00 | 502 |

如果这两行都匹配到目标订单，MERGE 不知道应使用 120 还是 125。Snowflake 默认 ERROR_ON_NONDETERMINISTIC_MERGE 为 TRUE，这种 UPDATE/DELETE 多重匹配会报错。如果将它设为 FALSE，系统会从重复源行中选一行，但具体选择未定义，不能依赖它。

正确做法是在 MERGE 前按业务规则缩成每个订单一行。例如“取源系统更新时间最新的记录，同一时间再按摄取序号确定顺序”：

~~~sql
MERGE INTO fact_order AS target
USING (
  SELECT order_id, amount, source_updated_at
  FROM (
    SELECT
      order_id,
      amount,
      source_updated_at,
      ingest_id,
      ROW_NUMBER() OVER (
        PARTITION BY order_id
        ORDER BY source_updated_at DESC, ingest_id DESC
      ) AS rn
    FROM stg_order_changes
  )
  WHERE rn = 1
) AS source
  ON target.order_id = source.order_id
WHEN MATCHED
  AND source.source_updated_at > target.updated_at
  THEN UPDATE SET
    target.amount = source.amount,
    target.updated_at = source.source_updated_at
WHEN NOT MATCHED THEN INSERT (
  order_id, amount, updated_at
) VALUES (
  source.order_id, source.amount, source.source_updated_at
);

这里的 tie-breaker 不能随意挑一个。若 ingest_id 并不代表业务版本先后，就需要向源系统确认事件版本或变更序号。ROW_NUMBER 只是执行规则，正确的排序规则仍然来自业务。

### 未匹配的重复源行仍可能插入多条

另一个容易漏掉的情况：目标表里还没有 O200，源数据却有两条 O200。两条源记录都走 NOT MATCHED，MERGE 会插入两行。它们没有触发前面所说的“一个目标行被多个源行更新”的不确定性，但目标表仍然会产生重复业务键。

所以 MERGE 前后都要检查：

~~~sql
-- 源数据中是否每个订单只有一个候选版本
SELECT order_id, COUNT(*) AS source_rows
FROM stg_order_changes
GROUP BY order_id
HAVING COUNT(*) > 1;

-- 目标表是否已经存在重复业务键
SELECT order_id, COUNT(*) AS target_rows
FROM fact_order
GROUP BY order_id
HAVING COUNT(*) > 1;
~~~

如果业务本来允许订单有多条版本记录，就应该把版本号纳入键或建立历史表；不能简单地把“重复”定义成同一个订单号出现多次。

### 标准表上的键声明不是唯一性保证

Snowflake 标准表支持声明 PRIMARY KEY、UNIQUE 和 FOREIGN KEY，但这些约束一般不强制执行；NOT NULL 和 CHECK 会执行。Hybrid Table 的主键等约束规则不同。

因此，在标准表上声明 ORDER_ID 为 PRIMARY KEY，不能代替实际唯一性检查。ETL 应通过 staging 去重、数据质量查询和发布前对账来保证业务键符合预期。

### MERGE 幂等性取决于业务键、版本规则和重放策略

幂等意味着同一批输入重跑后，目标状态不因重复执行而继续变化。它不是 MERGE 自动提供的属性。

一个可重放的同步流程通常需要：

- 稳定的业务键，例如 order_id。
- 可比较的源版本，例如 source_updated_at 或单调递增的 event_version。
- 对相同版本重复到达的处理规则。
- 对迟到旧版本的拒绝或保留历史策略。
- 每批数据的输入、插入、更新、跳过和错误行数对账。

若只有时间戳，时钟回拨或同一时间的两个变更可能导致无法判断先后；需要向源系统确认是否有事件序号或版本号。若业务要求保留所有变更，就应使用事件/历史模型，而不是用一个当前状态表覆盖全部记录。

## 工程实施步骤

1. 明确目标表一行代表什么，确定业务键和版本键；先判断重复行是脏数据还是合法历史版本。
2. 对 staging 数据检查重复键、NULL 键、非法状态和无效时间；将不合格记录隔离，不要直接 MERGE。
3. 为多版本源记录定义确定性优先级，并给排序提供稳定 tie-breaker。
4. MERGE 前检查目标表是否已有重复键；对标准表不要依赖 PRIMARY KEY 声明自动拦截重复值。
5. 执行 MERGE 后记录 QUERY_ID、插入/更新/错误行数，并对关键金额、数量、状态和业务日期做控制总额对账。
6. 对相同批次重跑一次，比较执行前后目标快照，确认不会重复插入或覆盖更新版本。
7. 用迟到旧版本、同一时间多次变更、重复新订单、源行缺字段和目标重复键构造回归样本。
8. 发现异常时保留 staging 和批次信息；先评估事务边界和已提交状态，再决定重放、修复或回滚。

## 场景分析

订单 O100 在 10:00 被修改为 120，10:05 又被修改为 125。源系统在第二天重发了 10:00 和 10:05 两条记录，另外还重复投递了一笔新订单 O200。

如果流程先按 ORDER_ID 直接 MERGE，O100 会发生多源匹配；O200 在目标表中不存在，两份副本都会走 INSERT。正确的处理是先按业务版本选出 O100 的最新有效版本，并对 O200 使用稳定事件 ID 或业务键去重。MERGE 完成后再查询目标表，确认 O100 只有一条当前状态记录、金额为 125，O200 只插入一条。

若源系统后来补发了一个 09:55 的旧版本，目标表不应被回退到旧金额。更新条件应比较源版本和目标版本，而不能仅看文件到达时间。

## 常见误区

- **认为 MERGE 会自动选择正确的最新源记录。** 多源匹配的 UPDATE/DELETE 在默认设置下会报错；关闭错误设置后也不能依赖未定义的选择。
- **认为重复源键只影响 UPDATE。** 目标不存在时，重复源记录可能全部被插入。
- **认为 MERGE 就等于幂等。** 重放规则需要稳定业务键、版本比较和重复事件处理。
- **认为 PRIMARY KEY 声明能保证标准表唯一。** 仍需独立执行唯一性检查。
- **只看 SQL 执行成功，不对账业务结果。** 还要比较行数、控制总额、版本范围和错误记录。
- **用文件到达时间代替业务版本。** 迟到数据和重放文件会让“最后到达”不等于“最新业务状态”。

## 完成标准

- [ ] 能区分 INSERT、UPDATE、DELETE 和 MERGE 的作用。
- [ ] 能解释 MERGE 多源匹配的非确定性，以及默认错误设置的行为。
- [ ] 能解释未匹配的重复源行为什么仍可能插入多条。
- [ ] 能设计确定性去重规则和稳定 tie-breaker。
- [ ] 能说明标准表约束与实际唯一性检查的差异。
- [ ] 能用相同批次重放验证同步流程的幂等性。

## 自测

1. 目标表 O100 只有一行，源表 O100 有两个不同金额版本。默认 ERROR_ON_NONDETERMINISTIC_MERGE 打开时会发生什么？为什么不能把它关闭后依赖系统任选一行？
2. 目标表里不存在 O200，源数据有两条 O200。MERGE 可能插入几行？应在哪一步消除重复？
3. 一个旧版本文件比新版本晚一天才到达。如何避免它覆盖目标表中的新金额？
4. 标准表声明了 PRIMARY KEY，但目标表仍查到重复订单号。这个问题应该在哪些流程中拦截？

## 参考资料

- [MERGE](https://docs.snowflake.com/en/sql-reference/sql/merge)
- [Overview of constraints](https://docs.snowflake.com/en/sql-reference/constraints-overview)
- [Transactions](https://docs.snowflake.com/en/sql-reference/transactions)
