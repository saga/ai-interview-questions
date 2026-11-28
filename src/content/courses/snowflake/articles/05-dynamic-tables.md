# 学习目标

理解 Dynamic Tables 的声明式模型，区分 TARGET_LAG 与固定调度周期，并能够在 Dynamic Tables、Streams/Tasks 和外部编排之间做初步选型。

## 1. Dynamic Tables 解决什么问题

Dynamic Table 将一个 SELECT 查询定义为物化结果，并由 Snowflake 跟踪上游依赖、安排刷新，使结果保持在指定的新鲜度目标范围内。

用户主要描述“结果应该是什么”和“数据需要多新”，而不是手工编写完整的增量调度步骤。多个 Dynamic Tables 可以形成依赖管道，平台根据查询定义识别依赖关系。

## 2. TARGET_LAG 不是刷新间隔

TARGET_LAG 表示对数据陈旧程度的目标，不是承诺每隔固定分钟执行一次刷新，也不是无条件 SLA。

例如 TARGET_LAG = '10 minutes' 表达的是希望数据新鲜度保持在相应目标内。实际延迟可能因刷新耗时、Warehouse 容量、数据量、查询复杂度或管道深度而超过目标。生产系统需要监控实际延迟，并在超过业务阈值时采取措施。

## 3. Refresh Mode

Dynamic Tables 支持不同刷新模式，常见包括：

- INCREMENTAL：基于变化数据计算刷新。
- FULL：重新计算完整结果。
- AUTO：创建时由 Snowflake 根据定义选择适合的模式。
- ADAPTIVE：在增量刷新基础上，根据内部启发式条件决定是否重新初始化。

不能仅凭表大小决定模式。查询表达式、Join、聚合、变更比例和实际运行成本都可能影响刷新效率。应通过真实数据量测试，并查看刷新历史与运行指标。

## 4. 一个简单示例

~~~sql
CREATE OR REPLACE DYNAMIC TABLE CURATED.DAILY_ORDER_SUMMARY
  TARGET_LAG = '10 minutes'
  WAREHOUSE = TRANSFORM_WH
  REFRESH_MODE = INCREMENTAL
AS
SELECT
  ORDER_DATE,
  REGION,
  COUNT(*) AS ORDER_COUNT,
  SUM(ORDER_AMOUNT) AS TOTAL_AMOUNT
FROM CURATED.ORDERS
GROUP BY ORDER_DATE, REGION;
~~~

这是演示声明式定义的示例。正式环境需要验证增量刷新支持情况、聚合定义、上游数据质量、Warehouse 资源和实际延迟。

## 5. 依赖管道

~~~mermaid
flowchart TD
  A[RAW ORDERS] --> B[Dynamic Table: Clean Orders]
  B --> C[Dynamic Table: Daily Summary]
  D[DIM REGION] --> C
  C --> E[BI Dashboard]
  E --> F[Freshness and Refresh Monitoring]
~~~

平台从查询定义中推导依赖关系，并按依赖顺序协调刷新。中间层可以使用 TARGET_LAG = DOWNSTREAM，使其刷新需求跟随下游消费者。

## 6. Dynamic Tables 与 Streams/Tasks 如何选

| 需求 | 优先评估 | 原因 |
|---|---|---|
| 声明式 SQL 转换，平台管理刷新 | Dynamic Tables | 重点是结果定义和数据新鲜度 |
| 需要显式读取 CDC 变化记录 | Streams | 明确控制变更数据与 Offset |
| 需要自定义 DML、过程逻辑或事件触发 | Tasks + Streams | 控制触发条件和处理步骤 |
| 复杂跨系统依赖和统一工作流治理 | 外部编排工具 | 需要 Snowflake 之外的依赖和运维控制 |

这不是绝对边界。真实项目可以组合使用。例如，上游通过 Snowpipe 摄取，Streams/Tasks 处理需要显式 CDC 的部分，Dynamic Tables 管理适合声明式表达的下游转换。

## 7. 工程案例：运营日报数据新鲜度

运营部门希望每日订单汇总在数据变更后持续更新，业务可接受十分钟级的新鲜度，不要求每条订单事件都立即完成全链路处理。

可以先评估 Dynamic Tables：定义清洗层和汇总层，按业务容忍度设置 TARGET_LAG，监控实际延迟、刷新耗时和 Warehouse 成本。如果某一步必须在接收特定事件后执行自定义动作，则再评估 Streams/Tasks。

验收不只看表是否自动更新，还要验证延迟分布、结果正确性、失败恢复和成本。

## 8. 常见误解

- **TARGET_LAG 是固定执行间隔。** 它是新鲜度目标，不是 cron。
- **设置十分钟就保证十分钟内更新。** 目标是 best-effort，实际延迟可能超过目标。
- **Dynamic Tables 可以替代所有 Streams/Tasks。** 需要显式消费 CDC 或自定义过程时，Streams/Tasks 仍然有价值。
- **INCREMENTAL 永远比 FULL 便宜。** 需要结合变更比例、查询形态和数据量测量。

## 本节检查

1. TARGET_LAG 表达什么，不表达什么？
2. 什么时候优先考虑 Dynamic Tables，什么时候需要 Streams/Tasks？
3. 如何证明一个管道满足业务新鲜度要求？
