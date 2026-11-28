# SQL、Snowpark、UDF 与存储过程职责边界

## 本节要解决的问题

根据逻辑形态、数据规模、依赖和副作用选择 SQL、Snowpark、UDF 或 Stored Procedure。目标是避免把所有逻辑都塞进 Python，也避免为了“只写 SQL”而把多步骤过程控制变成难以维护的脚本。

## 核心知识

### 集合式转换优先考虑 SQL

过滤、Join、聚合、窗口函数、MERGE 和数据集转换通常适合直接用 SQL 表达。SQL 声明数据结果，优化器可以基于表统计信息和执行计划选择处理方式。对于数据库中已有的数据，不应仅为了熟悉 Python 就先把大量数据拉到应用进程再处理。

### Snowpark 让开发者用语言 API 表达数据处理计划

Snowpark DataFrame API 可以在 Python、Java 或 Scala 中构建数据处理逻辑。常见 DataFrame 操作会被转换为 Snowflake 可执行的查询计划，数据通常留在 Snowflake 侧处理；调用 collect 等动作时才将结果带回客户端或运行环境。

适合需要复用语言库、复杂表达式、代码组织或测试工具的场景。使用 Snowpark 不代表自动获得更好的性能，仍要检查生成的 SQL、执行计划、数据移动和运行成本。

### UDF 返回值，Stored Procedure 承担过程操作

UDF 用于在 SQL 表达式中计算并返回值，适合将特定计算封装成可复用函数。它不应承担多步骤作业编排或管理操作。

Stored Procedure 适合执行一组过程操作，例如运行多条 SQL、根据结果分支、执行 DDL/DML 或封装管理任务。它可以返回状态或结果，但调用者应明确其副作用和执行权限。

SQL、Snowpark、UDF 和 Stored Procedure 可以组合使用：例如 Snowpark 构建数据转换，UDF 封装单值计算，Stored Procedure 组织多步骤操作，Task 触发过程运行。

## 工程实施步骤

1. **说明输入与输出。** 写清楚输入数据规模、输出粒度、是否需要逐行计算、是否修改数据、是否有副作用。
2. **选择最贴近数据的执行方式。** 集合式 SQL 优先；需要语言 API 组织 DataFrame 逻辑时考虑 Snowpark；需要在 SQL 表达式中返回值时考虑 UDF；需要多步骤过程控制时考虑 Stored Procedure。
3. **核对数据是否离开 Snowflake。** 检查应用代码是否 collect 大量数据、是否将明细下载到外部进程，以及网络和传输成本。
4. **检查运行环境和依赖。** 对 Python/Java/Scala handler 核对支持的包、运行时版本、导入方式、部署和升级流程。
5. **设计执行权限。** 区分调用者权限与对象 Owner 权限，确定 EXECUTE AS OWNER 或 CALLER 的安全边界；不要因为使用过程封装就默认授予过宽权限。
6. **补充测试。** 对 UDF 测试空值、边界值和类型转换；对 Stored Procedure 测试成功、异常、事务回滚和重复调用；对 Snowpark 比较生成 SQL 与执行计划。
7. **监控实际结果。** 检查 Query History、耗时、扫描数据量、Warehouse credit 和外部依赖调用情况。

示例：简单逐值计算适合 UDF；多语句更新流程适合 Stored Procedure。

~~~sql
CREATE OR REPLACE FUNCTION NORMALIZE_CODE(V STRING)
RETURNS STRING
LANGUAGE SQL
AS
  'UPPER(TRIM(V))';

CREATE OR REPLACE PROCEDURE REFRESH_ORDER_SUMMARY()
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
BEGIN
  DELETE FROM MART.ORDER_SUMMARY
  WHERE SUMMARY_DATE = CURRENT_DATE();

  INSERT INTO MART.ORDER_SUMMARY
  SELECT ORDER_DATE, COUNT(*), SUM(AMOUNT)
  FROM RAW.ORDERS
  WHERE ORDER_DATE = CURRENT_DATE()
  GROUP BY ORDER_DATE;

  RETURN 'REFRESHED';
END;
$$;
~~~

## 场景分析

团队需要标准化客户代码、汇总每日订单，并在汇总完成后写入一条执行记录。

客户代码清理是单值转换，可用 SQL 表达式或 UDF；每日汇总是集合式转换，应先用 SQL 实现并分析执行计划；删除旧汇总、写入新汇总、记录运行状态属于多步骤过程控制，可以封装在 Stored Procedure 中，再由 Task 调度。若开发者希望使用 Python DataFrame API 组织转换，可评估 Snowpark，但必须验证操作是否在 Snowflake 端执行及是否产生不必要的数据收集。

技术选择应以可维护性、性能、权限和故障恢复为依据，而不是以语言偏好决定。

## 常见误区

- **认为 Python/Snowpark 必然比 SQL 快。** Snowpark 是另一种表达和开发方式，实际性能仍取决于生成的查询计划、数据移动和执行资源。
- **把 UDF 与 Stored Procedure 当成同一种对象。** UDF 返回可在 SQL 中使用的值；Stored Procedure 用于过程操作和多步骤控制。
- **在应用端处理本可留在仓库内的大量数据。** 大规模 collect 会带来网络传输、内存和客户端计算成本。
- **忽略过程执行权限。** Owner 权限模式可能让调用者间接执行其自身无权执行的操作，必须明确权限边界。
- **用一个巨型 Stored Procedure 替代所有转换。** SQL 转换、单值计算和流程编排应按职责拆分，避免产生难以测试的过程代码。

## 完成标准

- [ ] 能判断集合式数据转换是否适合直接用 SQL。
- [ ] 能解释 Snowpark DataFrame API 的执行位置和数据移动边界。
- [ ] 能区分 UDF 的返回值语义与 Stored Procedure 的过程语义。
- [ ] 能根据依赖、部署、测试和权限选择实现方式。
- [ ] 能用执行计划、Query History 和成本数据验证选择。

## 自测

1. 需要在 SELECT 中对每条记录计算标准化代码，应优先考虑哪种实现？为什么？
2. 需要先清理当天汇总，再重新计算并写入运行状态，这属于哪类职责？
3. Snowpark DataFrame 代码中调用 collect 后，应该额外检查哪些数据量和资源风险？

## 参考资料

- [Choosing whether to write a stored procedure or a UDF](https://docs.snowflake.com/en/developer-guide/stored-procedures-vs-udfs)
- [Calling functions and stored procedures in Snowpark Python](https://docs.snowflake.com/en/developer-guide/snowpark/python/calling-functions)
- [Snowpark Python API](https://docs.snowflake.com/en/developer-guide/snowpark/python/index)
