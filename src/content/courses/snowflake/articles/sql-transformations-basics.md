# SQL 过滤、连接与聚合基础

## 本节要解决的问题

用 SQL 将原始记录转换为业务结果时，必须先明确一行代表什么，再设计过滤、关联和分组。WHERE、JOIN 和 GROUP BY 看起来只是语法，但对行数、NULL、重复数据和指标粒度有直接影响；查询能执行不代表结果符合业务口径。

## 核心知识

### WHERE 在分组前过滤行，HAVING 在分组后过滤组

WHERE 对 FROM 产生的行集进行过滤，条件结果为 TRUE 的行才保留；FALSE 和 UNKNOWN（例如 NULL 比较）都会被过滤。HAVING 则在 GROUP BY 聚合之后，对聚合组进行筛选，例如只保留订单数量大于 10 的客户。

SQL 使用三值逻辑。amount = NULL 不会匹配空值，应使用 IS NULL；NOT IN 如果子查询结果包含 NULL，也可能让预期记录被过滤。对于金额、日期和状态字段，应明确 NULL 的业务含义。

### JOIN 会改变行数，必须检查连接键的基数

INNER JOIN 只保留满足关联条件的行；LEFT JOIN 保留左侧所有行，并将未匹配的右侧列设为 NULL。若在 LEFT JOIN 后把右侧表的过滤条件放到 WHERE，可能会过滤掉右表为 NULL 的行，使查询效果接近 INNER JOIN。若条件应限定右表匹配范围，通常应放入 ON。

一对多连接会将左侧记录展开成多行；多对多连接可能形成笛卡尔式放大。连接前应确认业务键唯一性、Join Key、NULL 语义和输入粒度。订单头连接订单明细后，订单总额会重复出现在每条明细行上，不能直接 SUM 订单头金额。

Snowflake 建议优先在 FROM 子句中使用 JOIN ... ON，而不是把关联条件和其它过滤混在 WHERE；显式 ON 更容易表达外连接语义。

### GROUP BY 把行集压缩到新的粒度

GROUP BY 后每一行代表分组键的一种组合。COUNT(*) 统计行数，COUNT(column) 忽略 NULL，COUNT(DISTINCT column) 统计不同非 NULL 值。SUM、AVG、MIN、MAX 等聚合有不同的 NULL 和可加性语义。

聚合结果要能解释其粒度。例如按 CUSTOMER_ID 汇总是客户级结果；按 CUSTOMER_ID、ORDER_DATE 汇总则变成客户-日期级。分组字段变化会直接改变指标含义。库存余额、账户余额等快照类指标通常不能跨时间简单求和。

## 工程实施步骤

1. 写明源数据的行粒度、业务键和必要字段，确认每张表的主键是否唯一、是否允许重复或 NULL。
2. 使用 WHERE 筛选目标记录；对 NULL、日期边界和状态枚举明确条件，避免用等号比较 NULL。
3. 连接表之前先检查两侧 Join Key 的唯一性和基数；若是多对多，应先聚合、去重或建立桥接关系。
4. 使用 INNER/LEFT 等明确 JOIN 类型，并将外连接右侧匹配条件放在 ON 中，避免无意中丢弃未匹配行。
5. 逐步增加 JOIN，每一步比较输入行数、输出行数和关键业务键数量，定位 fanout 或漏匹配。
6. 确定目标结果粒度后再选择 GROUP BY 字段；将不可加度量与可加金额分开处理。
7. 使用 HAVING 筛选聚合结果；需要对分组前数据过滤的条件应放在 WHERE。
8. 对结果做数据对账：主键数、总行数、金额/数量汇总、NULL 率和抽样明细。
9. 在复杂查询中将阶段拆成 CTE，命名各阶段粒度并保留中间结果检查点。
10. 对性能问题使用 Query Profile 检查扫描、Join 输入/输出、聚合和数据交换；优化后再次验证业务结果等价。

示例：订单头金额与订单明细金额分别聚合后再关联到客户粒度。

~~~sql
WITH order_totals AS (
  SELECT CUSTOMER_ID, SUM(ORDER_TOTAL) AS ORDER_AMOUNT
  FROM MART.FACT_ORDER
  GROUP BY CUSTOMER_ID
),
line_totals AS (
  SELECT CUSTOMER_ID, SUM(LINE_AMOUNT) AS LINE_AMOUNT
  FROM MART.FACT_ORDER_LINE
  GROUP BY CUSTOMER_ID
)
SELECT
  c.CUSTOMER_ID,
  o.ORDER_AMOUNT,
  l.LINE_AMOUNT
FROM MART.DIM_CUSTOMER c
LEFT JOIN order_totals o
  ON c.CUSTOMER_ID = o.CUSTOMER_ID
LEFT JOIN line_totals l
  ON c.CUSTOMER_ID = l.CUSTOMER_ID;
~~~

两张事实表先汇总到客户粒度，避免订单头金额随着明细行数被重复累计。若报表需要按日期或产品分析，应把相应维度也纳入两侧聚合键。

## 场景分析

运营报告统计每个客户的订单数与订单金额，并连接客户标签表。某次重构后订单数增加一倍，金额也明显上涨。

先比较订单事实表按 ORDER_ID 的唯一性，再检查客户标签表是否一个 CUSTOMER_ID 对应多个有效标签。如果是多对多关系，直接连接会放大订单行。应先定义业务上要使用当前标签还是历史有效标签，再把标签映射到唯一粒度，或先聚合事实数据后连接。

验收用一个具有多条订单、多个标签、空标签和退款的客户样本，比较原始明细、关联后行数、订单数和金额。对 LEFT JOIN 还要确认没有匹配标签的客户仍然保留。

## 常见误区

- **WHERE 和 HAVING 可以随意互换。** WHERE 过滤分组前的行，HAVING 过滤聚合后的组。
- **把等号用于比较 NULL。** SQL 的 NULL 比较结果为 UNKNOWN，应使用 IS NULL/IS NOT NULL。
- **认为 LEFT JOIN 后再用 WHERE 过滤右表不会改变结果。** 这可能去掉右表未匹配的行。
- **认为 JOIN 不会改变行粒度。** 一对多或多对多连接都会扩展行数。
- **使用 DISTINCT 掩盖错误 JOIN。** DISTINCT 可能隐藏重复但也可能删除真实不同业务记录。
- **对所有聚合指标都使用 SUM。** 快照余额或库存等指标通常需要按时间点取值，而不是跨时间求和。

## 完成标准

- [ ] 能区分 WHERE 与 HAVING 的执行阶段。
- [ ] 能解释 SQL 三值逻辑及 NULL 条件。
- [ ] 能根据 JOIN 类型说明未匹配行和行数变化。
- [ ] 能在 GROUP BY 前明确目标结果粒度。
- [ ] 能识别多对多 Join 对指标的放大风险。
- [ ] 能用行数、主键和业务汇总验证查询结果。

## 自测

1. 一条查询需要筛选订单日期，再筛选客户订单总额大于 10 万，两个条件应分别放 WHERE 还是 HAVING？
2. LEFT JOIN 后把右表状态条件放 WHERE，为什么可能丢失未匹配行？
3. 一个订单连接多条明细后，订单头金额为什么会被重复累计？
4. COUNT(*) 与 COUNT(column) 在 column 有 NULL 时有什么差异？
5. 某个指标按客户和按客户-日期分组，结果分别代表什么粒度？

## 参考资料

- [Working with joins](https://docs.snowflake.com/en/user-guide/querying-joins)
- [Querying data](https://docs.snowflake.com/en/user-guide/querying)
- [Aggregate functions](https://docs.snowflake.com/en/sql-reference/functions-aggregation)
