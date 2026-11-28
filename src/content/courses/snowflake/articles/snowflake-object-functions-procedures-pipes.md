# UDF、Stored Procedure 与 Pipe 的用途

## 本节要解决的问题

数据团队有三个需求：

- 在查询中把原始商品编码转换成标准分类，供每行计算调用。
- 每晚执行一组数据清理、汇总和状态更新，并返回执行结果。
- 对象存储中一有新文件，就把文件内容加载到 Snowflake。

这三个需求都可以写成 SQL 对象，但它们不是同一种东西。UDF 是查询表达式中的函数；Stored Procedure 是由 CALL 启动的过程逻辑；Pipe 则保存 Snowpipe 的文件加载定义。把它们互相替代，通常会让权限、副作用、运行方式和故障恢复变得混乱。

## 核心知识

### UDF 返回计算值，适合嵌入 SQL 表达式

例如，原始订单中的渠道代码需要统一成业务名称。可以创建 SQL UDF：

~~~sql
CREATE OR REPLACE FUNCTION normalize_channel(channel_code VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
  CASE UPPER(TRIM(channel_code))
    WHEN 'WEB' THEN 'ONLINE'
    WHEN 'APP' THEN 'ONLINE'
    WHEN 'STORE' THEN 'RETAIL'
    ELSE 'UNKNOWN'
  END
$$;
~~~

查询中可以像内置函数一样调用：

~~~sql
SELECT
  order_id,
  normalize_channel(source_channel) AS channel
FROM raw_orders;
~~~

UDF 的调用方式是表达式求值：输入一组参数，返回标量或表结果。它可以被 SELECT、WHERE、JOIN 条件等查询位置使用。SQL UDF 可以组合 SQL 表达式；Python、Java、JavaScript 等 handler 适合需要相应语言运行时的计算。

UDF 不是用来启动一串独立 DDL/DML 作业的。若逻辑需要执行多条 SQL、管理事务或调用其他对象，应考虑 Stored Procedure。UDF 也不应该被设计成依赖每行调用时产生可观察副作用的执行器；查询优化器可能重排、合并或重复计算表达式，不能把函数调用次数当作业务流程保证。

### Stored Procedure 执行多步骤逻辑，通过 CALL 启动

例如，每日结算前需要先检查上一批次是否完成，再汇总订单金额，最后写入结算批次状态。可以把流程放进 Snowflake Scripting Procedure：

~~~sql
CREATE OR REPLACE PROCEDURE close_order_batch(batch_date DATE)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  order_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO :order_count
  FROM curated_orders
  WHERE business_date = :batch_date;

  IF (order_count = 0) THEN
    RETURN 'NO_ORDERS';
  END IF;

  INSERT INTO daily_order_summary (
    business_date, order_count, total_amount
  )
  SELECT
    business_date,
    COUNT(*),
    SUM(order_amount)
  FROM curated_orders
  WHERE business_date = :batch_date
  GROUP BY business_date;

  RETURN 'CLOSED:' || order_count;
END;
$$;
~~~

由任务或调用方触发：

~~~sql
CALL close_order_batch('2026-11-27');
~~~

Procedure 可以包含条件判断、循环、变量、SQL 语句和错误处理。适合多步骤控制逻辑，而不是把简单的字段转换也包成一个过程。

Procedure 的权限模式必须明确：

- EXECUTE AS CALLER：使用调用者的权限，适合让流程严格继承调用者已有的数据访问能力。
- EXECUTE AS OWNER：使用 Procedure 所有者的权限，适合将有限的管理操作封装成受控入口，调用者不必直接拿到所有底层权限。
- 未声明时默认 OWNER rights。

Owner rights 不是“让过程拥有所有权限”，它只使用 Procedure owner 具备的权限，并且对调用者会话上下文有额外限制。把敏感写操作做成 Owner rights Procedure 时，必须限制可传入的对象名、过滤条件和操作范围，避免把它变成任意 SQL 执行入口。

Stored Procedure 也不天然是一个原子事务。一个过程中的语句失败，不代表之前成功执行的语句一定全部回滚。需要整体原子性时，要显式设计事务边界、错误处理和重试幂等规则。

### Pipe 定义 Snowpipe 文件摄取，不负责通用 SQL 调度

如果对象存储不断收到订单文件，Snowpipe Auto-ingest 可以根据云端事件通知触发 Pipe 中的 COPY INTO。Pipe 是一个 Snowflake 对象，保存从 Stage 加载到目标表的 COPY 定义：

~~~sql
CREATE OR REPLACE PIPE raw_orders_pipe
  AUTO_INGEST = TRUE
AS
  COPY INTO raw_orders
  FROM @orders_stage
  FILE_FORMAT = (TYPE = JSON);
~~~

事件通知包含新文件的路径，Snowpipe 再按 Pipe 中的 COPY 语句读取 Stage 文件。它不是接收任意业务事件并执行任意 SQL 的消息队列，也不是用来定时运行存储过程的 Task。

Pipe 的主要工作是文件摄取。转换、质量校验、业务状态推进和下游发布仍然需要独立的数据管道阶段。Pipe 运行正常，也不能证明每个文件都已进入目标表；还要检查通知、待处理文件和加载历史。

### 选择对象时，先看需要返回值、执行过程还是接收文件

| 需求 | 适合的对象 | 调用/触发方式 | 不适合承担的工作 |
|---|---|---|---|
| 单值或表值计算 | UDF | SQL 查询表达式 | 多步骤状态变更、批次调度 |
| 多条 SQL 和条件流程 | Stored Procedure | CALL，或由 Task 等调度 | 持续监听云存储文件 |
| 自动从 Stage 加载新文件 | Pipe / Snowpipe | 云事件通知触发 | 复杂业务工作流、通用定时作业 |

## 工程实施步骤

1. 先写出调用方需要的契约：输入参数、返回值、是否修改数据、运行频率和调用身份。
2. 若逻辑只是值计算，检查能否用 SQL 表达式或 UDF 实现；只有真正需要语言运行时或可复用函数时才引入外部语言 UDF。
3. 若逻辑包含多步 DDL/DML、条件分支和状态更新，设计 Stored Procedure，并明确事务边界和失败后的部分提交处理。
4. 对 Owner rights Procedure，逐项审查调用者可以传入的参数和可影响对象，避免间接扩大权限。
5. 若来源是对象存储文件，先配置 Stage、Storage Integration、文件格式和目标表，再创建 Pipe；云端事件通知需要单独完成配置。
6. 对 Pipe 监控通知到达、待处理文件、加载历史、错误文件和目标行数；不要只检查 Pipe 是否存在。
7. UDF 用边界输入验证 NULL、空字符串、大小写、非法值和类型转换；Procedure 用重复调用、权限不足、中途失败和重跑测试。
8. 对所有会修改数据的过程记录批次键、Query ID、状态和执行结果，确保失败重试不会重复写入业务数据。

## 场景分析

订单标准化有三个处理环节：

1. 原始渠道代码要在报表和查询里被复用，使用 UDF 将 WEB、APP 映射为 ONLINE。
2. 每天 01:00 需要检查批次、汇总订单、写入控制表并生成结算结果，使用 Stored Procedure 执行过程逻辑，再由 Task 调度。
3. 订单 JSON 文件到达对象存储后需要自动加载，使用 Snowpipe Pipe 处理文件接入。

不要把三个环节都写进一个 Stored Procedure。若文件接入延迟，Procedure 不应该靠反复扫描 Stage 来模拟 Snowpipe；若业务分类只是表达式，也不需要为每一行触发一段过程逻辑。

验收时分别验证：UDF 对不同渠道代码的返回值；Procedure 在有数据、无数据和中途失败时的行为；Pipe 是否正确加载新文件、如何发现漏通知文件。它们的测试和故障责任也应分开。

## 常见误区

- **用 UDF 执行批量数据变更或工作流。** UDF 应返回计算结果，过程状态和多条 SQL 交给 Stored Procedure。
- **把 Stored Procedure 当成定时任务。** Procedure 由 CALL 执行；需要调度时使用 Task 或外部调度器。
- **认为 Owner rights Procedure 可以随意接收表名和 SQL 片段。** 这可能把所有者权限暴露给调用者，必须限制参数和操作范围。
- **认为 Procedure 出错后之前的语句都会自动回滚。** 存储过程不是天然原子事务，必须明确事务和失败恢复设计。
- **把 Pipe 当成业务事件队列或任务调度器。** Pipe 的职责是定义 Snowpipe 文件加载路径。
- **认为 Pipe 创建成功代表历史文件都会自动补载。** 事件通知和加载历史必须单独检查，漏载文件要走恢复流程。

## 完成标准

- [ ] 能根据返回值计算、多步过程和文件接入选出正确对象。
- [ ] 能在查询中调用 UDF，并解释它与 Procedure 的区别。
- [ ] 能解释 Procedure 的 CALL、Owner rights 与 Caller rights。
- [ ] 能说明 Procedure 失败时为什么不能假定所有语句自动回滚。
- [ ] 能解释 Pipe、Stage、COPY INTO 和云事件通知的关系。
- [ ] 能分别为 UDF、Procedure 和 Pipe 设计适合的测试。

## 自测

1. 需要把 WEB、APP、STORE 转成统一渠道名称，并在多个 SELECT 中调用。为什么 UDF 比 Stored Procedure 合适？
2. Procedure 默认以 Owner rights 执行。调用者只得到一项清理任务权限时，怎样防止他通过可控参数删除其他表的数据？
3. Stored Procedure 执行到第三条 DML 时报错。为什么不能默认前两条 DML 一定回滚？
4. 对象存储收到新订单文件后自动加载到 Snowflake。事件通知、Pipe 和 COPY INTO 分别负责什么？
5. 每天凌晨执行订单结算应该由 Pipe 还是 Task 调度？为什么？

## 参考资料

- [CREATE FUNCTION](https://docs.snowflake.com/en/sql-reference/sql/create-function)
- [CREATE PROCEDURE](https://docs.snowflake.com/en/sql-reference/sql/create-procedure)
- [Caller’s rights and owner’s rights stored procedures](https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-rights)
- [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [CREATE PIPE](https://docs.snowflake.com/en/sql-reference/sql/create-pipe)
