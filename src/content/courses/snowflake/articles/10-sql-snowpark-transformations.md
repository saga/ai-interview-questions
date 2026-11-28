# SQL、Snowpark、UDF 与存储过程：转换逻辑如何分层

## 选择计算方式

Snowflake 数据转换优先考虑 SQL。过滤、Join、聚合、窗口计算和集合变换使用 SQL 通常更容易被优化器分析，也更便于审查和维护。Snowpark 在需要用 Python、Java 或 Scala 表达复杂数据处理、复用库或构建应用逻辑时提供 DataFrame API，但不意味着把所有 SQL 改写成 DataFrame 会更快。

UDF 用于封装可复用的表达式或函数逻辑；Stored Procedure 用于执行一组操作、控制流程或编排 SQL 与其他调用。Task 则负责调度执行，不能用 Procedure 与 Task 的存在替代数据依赖设计。

## 一条合理的分层路径

~~~mermaid
flowchart TD
  A[Raw Tables] --> B[SQL: filter, join, standardize]
  B --> C[Snowpark: complex reusable logic if needed]
  C --> D[Conformed Tables]
  D --> E[SQL: aggregate and model]
  E --> F[Curated Data Products]
  G[Stored Procedure] --> H[Orchestrate approved operations]
  H --> A
  H --> B
~~~

把纯 SQL 能完成的工作交给 SQL；当逻辑确实需要应用语言或复用依赖时再使用 Snowpark。对于每个跨语言边界，确认运行时、包依赖、权限、网络访问、日志、异常处理和版本兼容。

## 代码样例：规范化转换

~~~sql
CREATE OR REPLACE VIEW CONFORMED_ORDERS AS
SELECT
  ORDER_ID,
  CUSTOMER_ID,
  ORDER_TS::TIMESTAMP_NTZ AS ORDER_TS,
  AMOUNT::NUMBER(18,2) AS AMOUNT
FROM RAW_ORDERS
WHERE ORDER_ID IS NOT NULL;
~~~

该示例仅展示字段规范化。真实作业还需要把被过滤的异常记录写入隔离表，避免静默丢弃数据。

## 运行成本与可观测性

UDF 或 Procedure 的语言运行时、数据移动和外部依赖会改变执行成本与故障面。不要只比较代码行数。应比较完整工作负载的运行时间、扫描量、失败重试、包供应链、授权范围和运维复杂度。

## 何时不应该引入 Snowpark

若逻辑就是一组 Join、聚合和窗口函数，使用 SQL 通常更直接。若转换必须调用外部系统，应先确认外部网络访问和认证能力；不要把 UDF 当成绕过安全边界的通用网络客户端。

## 检查题

1. 哪类数据转换应优先使用 SQL？
2. UDF、Procedure、Task 分别解决什么问题？
3. 使用 Snowpark 前需要核对哪些运行时和安全约束？
