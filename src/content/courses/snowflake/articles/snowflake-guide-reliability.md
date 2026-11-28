# 数据契约、Schema 漂移与幂等恢复

## 上游加了一列，为什么下游汇总突然不可信

订单文件新增了 discount_reason。摄取任务仍显示成功，报表却出现列缺失，另一个下游流程还把新字段当成主键的一部分。数据加载成功与业务契约兼容不是一回事。

可靠的管道要明确字段、类型、粒度、键、时间语义和质量阈值。Schema Evolution 能接收部分文件结构变化，但不能判断新增字段是否改变指标口径，也不会自动保证重放正确。

## 先判断变化是否兼容

增加一个可选字段，且旧消费者忽略未知列，通常比较容易兼容。删除字段、修改类型、修改主键、改变字段业务含义、将 UTC 改为当地时间，或改变一行记录的业务粒度，都可能破坏下游契约。

契约至少记录字段类型和 NULL 规则、主键/业务键、行粒度、事件时间与到达时间、兼容策略、拒绝阈值、Owner 和下游消费者。JSON 能容纳未知字段，不代表消费者已经理解其含义。

## Schema Evolution 有明确前提

文件加载自动演进目标表列，需要同时满足：
1. 目标表启用 ENABLE_SCHEMA_EVOLUTION。
2. COPY 使用 MATCH_BY_COLUMN_NAME。
3. 执行加载的 Role 拥有 EVOLVE SCHEMA 或 OWNERSHIP；Snowpipe 使用 Pipe Owner Role 的权限。

~~~sql
ALTER TABLE RAW.ORDERS
  SET ENABLE_SCHEMA_EVOLUTION = TRUE;

COPY INTO RAW.ORDERS
FROM @RAW.ORDER_STAGE
FILE_FORMAT = (TYPE = PARQUET)
MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
~~~

该能力主要用于文件摄取时增加列，以及在文件缺少某列时移除该列的 NOT NULL 要求。它不会修改已有列的数据类型。默认每次 COPY 最多增加 100 列，且一次 COPY 默认只应用一个 Schema 变化。

Schema Evolution 适用于 COPY INTO 和 Snowpipe；普通 INSERT 不会自动演进结构。它也不能用于带 SELECT transform 的一般 COPY 场景。Snowpipe Streaming 高性能架构另有支持范围，Managed Iceberg 的限制更窄，不能把文件加载规则全部套过去。

## 用业务键保证重跑幂等

批次失败后重跑是正常恢复路径。若每次重跑都无条件 INSERT，同一批数据可能重复进入目标表。为事件分配稳定 event_id，并记录 batch_id、来源文件、事件时间和处理状态。

~~~sql
MERGE INTO CURATED.ORDERS AS target
USING (
  SELECT *
  FROM RAW.ORDER_EVENTS
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY EVENT_ID
    ORDER BY SOURCE_VERSION DESC, INGESTED_AT DESC
  ) = 1
) AS source
ON target.EVENT_ID = source.EVENT_ID
WHEN MATCHED
  AND source.SOURCE_VERSION > target.SOURCE_VERSION
THEN UPDATE SET
  ORDER_STATUS = source.ORDER_STATUS,
  SOURCE_VERSION = source.SOURCE_VERSION,
  UPDATED_AT = source.EVENT_TS
WHEN NOT MATCHED THEN INSERT (
  EVENT_ID, ORDER_ID, ORDER_STATUS, SOURCE_VERSION, UPDATED_AT
) VALUES (
  source.EVENT_ID, source.ORDER_ID, source.ORDER_STATUS,
  source.SOURCE_VERSION, source.EVENT_TS
);
~~~

示例假设 SOURCE_VERSION 可比较，且每个 EVENT_ID 代表同一业务事件。实际表还要定义删除事件、版本冲突和时间来源。没有稳定事件键或版本时，不能靠 ROW_NUMBER 任意保留一条重复记录。

Snowpipe 会记录文件路径和名称的加载元数据，默认保留 14 天。相同文件名在该窗口内可能被识别为已处理；修改同名文件内容，不应期待它自动重新加载。Snowpipe 与 Bulk COPY 的加载记录不同，不能假设两者互相去重；文件处理顺序也不保证等于业务事件顺序。因此，幂等设计要依靠业务事件 ID 和版本，而不是文件名。

## 任务状态和数据状态必须一起记录

Task 显示成功，只说明 SQL 成功执行。判断批次是否正确，还要保存输入清单、预期/实际行数、拒绝行数、业务聚合、目标批次状态和失败重放起点。

质量检查至少分三层：结构检查、字段/关系/时效检查，以及业务对账。Data Metric Function 提供测量值，Expectation 将测量值转为通过或违规判断。Data Quality Monitoring 的系统能力需要 Enterprise Edition，默认 DMF 调度按小时运行，不能作为实时批次门禁。若业务要求写入后立即阻断下游，应在 Task 或发布步骤中执行专用对账查询。

## 故障恢复不要从删除坏数据开始

发生 Schema 漂移时，先暂停下游交付，保留原始输入和批次记录。确认字段含义与兼容性，再决定隔离文件、调整目标表、补数据或版本化消费者。修复后使用同一 batch_id 重放，并核对 MERGE 幂等性和业务汇总。

Time Travel/Clone 可恢复对象状态或创建隔离副本，但不能替代长期业务历史、上游原始文件和审计记录。恢复时要明确时间点、之后已接收事件如何回放，以及是否需要下游重算。

## 常见失败原因

- 看到加载成功就刷新报表，未验证新增列的影响。
- 启用 Schema Evolution 后，假定类型变化也会自动兼容。
- 对同一批次无条件 INSERT，重试后产生重复记录。
- 用到达时间替代事件时间，迟到数据改变历史指标。
- 删除失败记录后重跑，丢失原始输入和故障证据。
- 把每小时 DMF 调度当作实时管道门禁。

## 自测

1. 上游新增可选字段，什么情况下可以安全放行？哪些变化必须阻断？
2. 为什么 ENABLE_SCHEMA_EVOLUTION 不会自动改变已有字段的数据类型？
3. 同一批文件重跑时，稳定 batch_id 和 event_id 分别解决什么问题？
4. Task 显示成功但业务金额对账失败，应该把管道停在哪一层？
5. Data Metric Function 返回数值后，为什么还需要 Expectation？

## 参考资料

- [Enable automatic table schema evolution](https://docs.snowflake.com/en/user-guide/data-load-schema-evolution)
- [Snowpipe load history and file metadata](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Use SQL to work with expectations](https://docs.snowflake.com/en/user-guide/data-quality-expectations)
- [Introduction to data quality checks](https://docs.snowflake.com/en/user-guide/data-quality-intro)
