# VARIANT 与半结构化数据：解析、访问和展开

## 为什么需要半结构化数据能力

业务事件、日志、API 响应和 SaaS 导出经常以 JSON、Avro、Parquet 或 XML 等形式到达。若每次上游加字段都要求先改表结构，接入流程会变得脆弱。Snowflake 用 VARIANT 承载半结构化值，再通过路径表达式和表函数读取字段。

VARIANT 解决的是摄取和演进灵活性，不代表可以完全放弃数据建模。核心业务字段仍应有明确类型、质量约束和消费契约。

## 解析和字段访问

~~~sql
CREATE OR REPLACE TABLE RAW_EVENTS (
  INGESTED_AT TIMESTAMP_NTZ,
  PAYLOAD VARIANT
);

INSERT INTO RAW_EVENTS
SELECT CURRENT_TIMESTAMP(), PARSE_JSON('{"event_id":"e-1001","customer":{"id":42,"tier":"gold"},"amount":125.50,"items":[{"sku":"A1","qty":2}]}');
~~~

路径访问可以使用冒号和点号。提取出的值仍可能是 VARIANT，需要通过 CAST 或类型转换函数获得可计算的 SQL 类型。生产模型不要把字符串数字、时间戳和布尔值长期留在未验证的半结构化形态。

~~~sql
SELECT
  PAYLOAD:event_id::STRING AS EVENT_ID,
  PAYLOAD:customer.id::NUMBER AS CUSTOMER_ID,
  PAYLOAD:amount::NUMBER(18,2) AS AMOUNT
FROM RAW_EVENTS;
~~~

字段缺失、JSON null、SQL NULL 和类型不匹配是不同情况。数据清洗应显式定义处理策略，不能把所有空值简单替换成默认值。

## FLATTEN：将数组转为行

当 JSON 数组需要连接、聚合或逐项校验时，可以用 FLATTEN 展开：

~~~sql
SELECT
  e.PAYLOAD:event_id::STRING AS EVENT_ID,
  item.VALUE:sku::STRING AS SKU,
  item.VALUE:qty::NUMBER AS QUANTITY
FROM RAW_EVENTS e,
LATERAL FLATTEN(INPUT => e.PAYLOAD:items) item;
~~~

FLATTEN 可能改变结果粒度：一条事件可能扩展为多条商品明细。后续聚合必须明确使用事件粒度还是明细粒度，避免金额重复累计。

## 模式演进与建模边界

半结构化列适合保留原始载荷、低频变化字段和探索阶段数据。面向 BI、财务或共享数据产品的稳定字段，应在转换层提取为强类型列，并建立主键、时间、枚举和业务规则校验。

建议分层处理：Raw 保留原始载荷、来源、到达时间和批次标识；Conformed 解析类型、统一字段名并处理缺失和重复；Curated 输出稳定的业务实体、指标和消费契约。

## 性能与运维注意

路径过滤是否有效取决于数据组织、表达式和统计元数据。不要仅因字段位于 VARIANT 就认定扫描一定慢，也不要假设任意深层路径都和普通列具有相同的性能特征。用 Query Profile 查看扫描、过滤和展开算子，再决定是否把高频字段提升为独立列。

## 检查题

1. VARIANT 路径访问后为什么常常还要做类型转换？
2. FLATTEN 如何改变 SQL 结果粒度？
3. 哪些字段适合继续留在 VARIANT，哪些应该进入强类型业务模型？
