# EDA、可视化与数据故事

## 本节要解决的问题

零售团队发现本月线上订单金额比上月增长了 18%，但净收入只增长 4%。产品经理怀疑是大额订单增加，财务则认为折扣和退款抵消了销售额。打开一张总额折线图无法回答问题：增长来自订单量、客单价、折扣、退款，还是产品结构变化？

探索性数据分析（EDA）不是把数据画成几张图，而是通过问题、指标、分布和样本逐步缩小解释范围。每个结论都应说明数据范围、计算口径、异常和不确定性。

## 核心知识

### 先确认一行代表什么，再决定计算什么

先看订单表的粒度：一行是一笔订单，还是一条订单商品明细？若订单金额存在于订单头表，而折扣和退货存在于明细表，直接连接可能重复累计订单金额。

开始探索前先检查表结构、业务主键、时间字段和指标定义：

~~~sql
SELECT
  COUNT(*) AS row_count,
  COUNT(DISTINCT order_id) AS distinct_orders,
  COUNT_IF(order_id IS NULL) AS null_order_ids,
  MIN(order_date) AS min_order_date,
  MAX(order_date) AS max_order_date
FROM analytics.mart.fact_orders;
~~~

如果 row_count 大于 distinct_orders，先确认是否为合法的多版本记录、订单拆分还是重复加载。不要直接对所有列做 DISTINCT 来“清理”数据，否则可能把不同版本或不同事件误删。

### 缺失、重复和异常值要结合业务含义判断

例如，订单金额为 NULL 可能意味着源系统未提供金额；金额为 0 可能代表全额折扣；负金额可能是退款或冲正。它们不是同一种异常。

~~~sql
SELECT
  COUNT(*) AS rows_total,
  COUNT_IF(order_amount IS NULL) AS missing_amounts,
  COUNT_IF(order_amount = 0) AS zero_amounts,
  COUNT_IF(order_amount < 0) AS negative_amounts,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY order_amount) AS p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY order_amount) AS p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY order_amount) AS p99
FROM analytics.mart.fact_orders
WHERE order_date >= '2026-10-01'
  AND order_date < '2026-12-01';
~~~

P99 很高不一定代表脏数据：它可能来自企业客户的大额订单。应抽取高分位样本，检查客户类型、商品组合和业务状态，再决定是否单独建模或排除。

### 先分解指标，再画趋势和分布

订单金额增长可以拆成订单数、平均订单金额、折扣和退款。一个基础趋势查询：

~~~sql
SELECT
  DATE_TRUNC('month', order_date) AS month,
  COUNT(*) AS order_count,
  SUM(gross_amount) AS gross_sales,
  SUM(discount_amount) AS discounts,
  SUM(refund_amount) AS refunds,
  SUM(gross_amount - discount_amount - refund_amount) AS net_sales,
  AVG(gross_amount) AS avg_order_amount
FROM analytics.mart.fact_orders
WHERE order_date >= '2026-01-01'
  AND order_date < '2027-01-01'
GROUP BY 1
ORDER BY 1;
~~~

要解释线上和线下的差异，可以按渠道分组；要解释产品结构变化，可以按产品类别分组。比较之前必须使用相同的业务日期、币种、状态过滤和数据更新时间。若订单按创建日统计、退款按批准日统计，应先决定要看订单 cohort 还是现金流发生日，不能混在一条趋势里。

### 相关性不是因果关系

某个促销渠道的订单金额与退款率同时上升，并不能证明促销导致退款。可能的解释包括：

- 促销吸引了不同客群，客户结构发生变化。
- 旺季订单本来就更多，且物流压力同时上升。
- 大额订单比例增加，使平均金额和退款金额一起上升。
- 退款数据比订单数据晚到，两个时间序列处于不同成熟度。

可以先用相关系数描述线性关系：

~~~sql
SELECT
  channel,
  CORR(discount_rate, refund_rate) AS discount_refund_corr,
  COUNT(*) AS customer_months
FROM analytics.mart.customer_month_metrics
WHERE month >= '2026-01-01'
GROUP BY channel;
~~~

结果只表示在当前样本、当前口径下两个变量的相关程度。还需要控制客群、商品、地区和时间因素，并确认样本量和数据成熟度；若要做因果判断，需要实验、准实验或明确的识别设计，不应从一张相关性热图直接推导业务策略。

### 图表选择应服务于要回答的问题

| 问题 | 适合的图 | 应同时展示 |
|---|---|---|
| 指标随时间如何变化 | 折线图 | 时间窗口、数据完整性、对照基线 |
| 金额分布是否长尾 | 直方图、箱线图 | 样本数、分位数、异常值处理 |
| 不同渠道表现差异 | 分组柱状图或箱线图 | 每组样本量、统一指标口径 |
| 两个指标是否一起变化 | 散点图 | 相关系数、样本范围、潜在混杂因素 |
| 构成比例如何变化 | 堆叠图 | 分母定义、总量变化 |

不要用双轴图让两个量纲不同的指标看起来同步，也不要只画百分比而隐藏分母。一个渠道 50 笔订单的退款率 12%，与另一个渠道 50 万笔订单的退款率 8%，解释时必须保留样本规模和置信区间。

## 工程实施步骤

1. 将业务问题转成可计算指标，写清分子、分母、事实粒度、过滤条件、币种、时区和日期字段。
2. 检查行数、唯一键、NULL、空字符串、最小/最大值和关键字段分布，先判断数据是否足以支持问题。
3. 使用 Snowflake SQL 在仓库端进行聚合、分位数和分组统计；只把必要的摘要或代表性样本传到 Notebook。
4. 对异常值保留原始记录和业务状态，区分数据错误、合法极端值和不同群体的真实差异。
5. 将总体指标按渠道、地区、产品、客户类型和时间分层，检查总体趋势是否被结构变化掩盖。
6. 选择能回答问题的图表，标注时间窗口、样本量、口径和缺失数据处理方式。
7. 对相关性结论提出可能的混杂因素，并通过分层、对照组或实验验证，而不是把相关当成原因。
8. 保存查询文本、Query ID、过滤范围、数据更新时间、分析代码和图表参数，确保他人能够重现结果。
9. 报告中把数据事实、解释假设、验证结果和建议动作分开；不确定的原因明确标成待验证。
10. 将被反复使用的指标定义沉淀到受治理的视图或 Semantic View，避免不同 Notebook 各自重算。

## 场景分析

线上订单金额比上月增长 18%，净收入只增长 4%。月度汇总显示订单数增长 15%，平均订单金额增长 3%，折扣率上升，退款额也增加。

下一步不要直接把增长归因于促销。先按渠道和产品类别分层，检查线上渠道新增订单中是否有更多低价商品；再看退款发生日期与订单创建日期是否一致，排除退款数据迟到造成的月份错位。随后抽取 P95/P99 的大额订单样本，确认是企业订单增长还是金额解析错误。

如果线上渠道的订单数增加集中在促销周，但高退款率只出现在某一类新品，可能需要继续检查产品质量和物流时效。现阶段可以说“促销周订单增长明显，退款上升集中在新品类别”；除非有对照实验或更强的因果证据，否则不要写成“促销导致退款”。

## 常见误区

- **看到总额上升就认为业务表现变好。** 先拆分订单数、客单价、折扣、退款和净收入。
- **把 NULL、0 和负数都当脏数据。** 它们可能分别代表缺失、全额折扣和退款/冲正。
- **把 P99 以外的记录全部删除。** 极端值可能是合法的大客户订单，必须先查业务上下文。
- **把相关系数当成因果证据。** 相关关系可能来自客群、季节、产品或数据延迟。
- **只画百分比，不显示分母。** 小样本的高比例不应和大样本的高比例等量解释。
- **用本地 pandas 处理全量明细。** 先在 Snowflake 端过滤和聚合，再将有限结果带入 Notebook。

## 完成标准

- [ ] 能说明分析对象的一行代表什么，并确认指标粒度。
- [ ] 能检查缺失、重复、分布和异常样本。
- [ ] 能拆分总量、比率和构成指标。
- [ ] 能区分相关性、业务假设与因果结论。
- [ ] 能为不同分析问题选对图表，并保留分母和样本量。
- [ ] 能保存 Query ID、过滤条件和数据时间范围以复现分析。

## 自测

1. 订单金额 NULL、0 和负数分别可能代表什么？为什么不能统一填成 0？
2. 总销售额增长 18%，净收入只增长 4%。你会先拆哪几个指标，而不是直接画总额趋势？
3. 某渠道退款率 12%，另一个渠道退款率 8%，但订单量相差 1000 倍。报告中还应显示哪些信息？
4. 折扣率与退款率相关系数为 0.7。为什么还不能说折扣导致退款？至少举出两个可能的混杂因素。
5. P99 金额很高。应该怎样抽样检查合法大额订单与异常数据，而不是直接删除？

## 参考资料

- [Use data profiling to understand your data](https://docs.snowflake.com/en/user-guide/data-quality-profile)
- [System data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-system-dmfs)
- [Monitor query activity with Query History](https://docs.snowflake.com/en/user-guide/ui-snowsight-activity)
- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
