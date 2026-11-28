# 窗口函数、CTE 与分阶段 SQL

## 本节要解决的问题

运营团队要做一张每日销售表：每个商品显示当天销售额、在本月内的累计销售额、当天排名，以及和前一天相比的变化。有人用 GROUP BY 把数据汇总到商品和日期，结果原始订单行全没了；有人用窗口函数写出了累计值，却发现同一天多条记录拿到相同的累计结果。

窗口函数解决的是“保留当前行，同时参考同一组中的其他行”。CTE 解决的是“把一条 SQL 拆成能读懂的逻辑阶段”。两者配合能写出清楚的分析查询，但它们不会自动替你定义业务粒度、排序规则和计算边界。

## 核心知识

### GROUP BY 会合并行，窗口函数会保留行

先看一份小数据：

| PRODUCT_ID | ORDER_DATE | ORDER_ID | AMOUNT |
|---|---|---|---:|
| P01 | 2026-11-01 | O100 | 100 |
| P01 | 2026-11-01 | O101 | 50 |
| P01 | 2026-11-02 | O102 | 80 |
| P02 | 2026-11-01 | O103 | 120 |

如果执行：

~~~sql
SELECT product_id, order_date, SUM(amount) AS day_amount
FROM fact_order
GROUP BY product_id, order_date;
~~~

结果只有三个商品/日期组合。原始订单行被压缩了。

如果需要保留每条订单，同时显示该商品截至当前日期的累计销售额，可以用窗口函数：

~~~sql
SELECT
  product_id,
  order_date,
  order_id,
  amount,
  SUM(amount) OVER (
    PARTITION BY product_id
    ORDER BY order_date, order_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_amount
FROM fact_order
ORDER BY product_id, order_date, order_id;
~~~

P01 的累计金额依次是 100、150、230。窗口函数在每一行上计算一个附加值，不会像 GROUP BY 那样把 O100 和 O101 合成一行。

### PARTITION BY、ORDER BY 和 frame 分别控制三个不同问题

- **PARTITION BY product_id**：每个商品独立计算，P01 的窗口不会包含 P02。
- **ORDER BY order_date, order_id**：规定窗口内行的计算顺序。若只按日期排序，同一天的多笔订单之间没有确定顺序。
- **ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW**：从当前分区第一行累计到当前物理行。

第三点非常重要。Snowflake 对带 ORDER BY 的非排名窗口函数，如果没有显式 frame，默认通常是：

**RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW**

RANGE 按排序值定义逻辑范围。同一排序值的 peer rows 会一起进入当前 frame。对于按日期累计的销售额，同一天的多条订单可能得到相同的累计值。ROWS 则按物理行逐条推进。

例如把上面的 ORDER BY 改为只按 order_date，再使用默认 RANGE，P01 的两条 11 月 1 日记录会一起进入 frame，二者都可能显示 150。若业务要求“同一天内也逐单累计”，应保留稳定的次级排序键并显式使用 ROWS。若业务要求“按天累计”，则应先按天聚合，再做窗口累计。

### 排名函数的差别来自并列值如何处理

假设三名销售人员的月销售额分别是 120、120、90：

| SALES_PERSON | TOTAL |
|---|---:|
| A | 120 |
| B | 120 |
| C | 90 |

- ROW_NUMBER() 为每行分配唯一序号，A 和 B 需要有额外排序键才能确定谁是第 1。
- RANK() 对并列值给相同名次，之后跳过名次：1、1、3。
- DENSE_RANK() 对并列值给相同名次，但不跳号：1、1、2。

~~~sql
SELECT
  sales_person,
  total,
  ROW_NUMBER() OVER (ORDER BY total DESC, sales_person) AS row_no,
  RANK() OVER (ORDER BY total DESC) AS rank_no,
  DENSE_RANK() OVER (ORDER BY total DESC) AS dense_rank_no
FROM monthly_sales;
~~~

如果需求是“每组只取一条最新记录”，通常使用 ROW_NUMBER()，并为时间相同的记录提供稳定的次级排序键；如果需求是“并列第一都要保留”，应该使用 RANK 或 DENSE_RANK，而不是先去重。

### LAG 与 LEAD 比较相邻行，但不替你定义时间粒度

例如需要计算每天销售额相对前一天的变化：

~~~sql
WITH daily_sales AS (
  SELECT
    product_id,
    order_date,
    SUM(amount) AS day_amount
  FROM fact_order
  GROUP BY product_id, order_date
)
SELECT
  product_id,
  order_date,
  day_amount,
  LAG(day_amount) OVER (
    PARTITION BY product_id
    ORDER BY order_date
  ) AS previous_day_amount,
  day_amount - LAG(day_amount) OVER (
    PARTITION BY product_id
    ORDER BY order_date
  ) AS amount_change
FROM daily_sales;
~~~

这里先按商品和日期聚合，因此 LAG 的上一行代表该商品上一条有数据的日期，不一定是日历上的昨天。如果某商品 11 月 2 日没有订单，11 月 3 日的上一行可能是 11 月 1 日。若业务要求和自然日比较，需要补齐日期维度，再明确缺失日期的金额按 0、NULL 还是“不适用”处理。

### CTE 是命名查询阶段，不是临时表承诺

CTE 可以把原始过滤、日汇总、排名和最终筛选拆开：

~~~sql
WITH filtered_orders AS (
  SELECT product_id, order_date, amount
  FROM fact_order
  WHERE order_date >= '2026-11-01'
),
daily_sales AS (
  SELECT product_id, order_date, SUM(amount) AS day_amount
  FROM filtered_orders
  GROUP BY product_id, order_date
),
ranked_sales AS (
  SELECT
    product_id,
    order_date,
    day_amount,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY day_amount DESC, order_date
    ) AS sales_rank
  FROM daily_sales
)
SELECT *
FROM ranked_sales
WHERE sales_rank <= 3;
~~~

CTE 给查询阶段命名，让每一步的输入与输出更容易检查。它不是“写一次就一定物化一次”的保证，也不能假定 CTE 被引用多次时一定只执行一次。优化器可能展开或重写查询。若性能有问题，先看 Query Profile 和扫描量；只有测量证明需要保留中间结果时，再考虑临时表或其他物化方式。

## 工程实施步骤

1. 明确输出粒度：订单行、商品/日期、客户/月，还是每个商品的一条排名记录。
2. 明确窗口分组键和排序键；排序值可能并列时添加稳定次级键。
3. 对累计、滑动和排名计算显式写出 ROWS/RANGE frame，不依赖默认值表达关键业务语义。
4. 如果要比较前后日期，先定义缺失日期的处理方式；必要时连接日期维度补齐时间轴。
5. 将不同处理阶段拆成 CTE，并为每个阶段检查行数、唯一键和汇总控制数。
6. 用包含并列排序值、缺失日期、NULL 和同一实体多条记录的数据样本做回归。
7. 检查最终输出顺序；窗口内 ORDER BY 控制计算顺序，不保证最终结果集的显示顺序。
8. 用 Query Profile 比较重写前后的扫描、聚合、排序和溢写情况。不要把 CTE 数量或 SQL 行数当成性能指标。

## 场景分析

某商品在 11 月 1 日有两笔订单，金额分别为 100 和 50；11 月 2 日有一笔 80；11 月 4 日有一笔 40。运营需要两份结果：

- 财务明细：每笔订单显示从月初开始逐单累计的销售额。
- 运营趋势：每天汇总后，显示与上一条有销售记录的日期相比的变化。

财务明细应使用订单粒度，窗口排序包含 order_date、order_id，frame 显式写成 ROWS。累计值为 100、150、230、270。

运营趋势应先按商品和日期聚合，再使用 LAG。11 月 4 日的上一条有数据日期是 11 月 2 日，变化额为 -40。如果报表需要显示“比昨天”，还应补齐 11 月 3 日并明确它的日销售额为 0，不能把 LAG 的上一条记录误称为昨天。

## 常见误区

- **把窗口函数当成 GROUP BY。** 窗口函数保留输入行；需要减少行数时，先聚合或过滤。
- **只按可能重复的字段排序，却期待 ROW_NUMBER 稳定。** 加入业务唯一键或明确的次级排序键。
- **依赖默认 RANGE 得到逐行累计。** 同一排序值可能成为 peers；关键累计逻辑应显式写 ROWS 或先按业务粒度聚合。
- **认为 LAG 的上一行就是上一自然日。** 它只返回排序后的上一条记录，缺失日期需要单独处理。
- **认为 CTE 一定物化或一定只执行一次。** CTE 是逻辑组织方式，是否物化要看执行计划和实际测量。
- **认为窗口里的 ORDER BY 保证最终结果有序。** 最终展示顺序要由最外层 ORDER BY 决定。

## 完成标准

- [ ] 能解释 GROUP BY 与窗口函数对行数的不同影响。
- [ ] 能分别说明 PARTITION BY、ORDER BY 和 window frame 的职责。
- [ ] 能区分 ROW_NUMBER、RANK 和 DENSE_RANK。
- [ ] 能用 LAG/LEAD 比较有数据的相邻记录，并识别缺失日期问题。
- [ ] 能把复杂 SQL 拆成可检查的 CTE 阶段。
- [ ] 能通过 Query Profile 判断是否需要物化中间结果。

## 自测

1. 同一个商品在同一天有两笔订单，金额为 100 和 50。为什么使用 ORDER BY order_date 加默认 RANGE 时，两行的累计金额可能相同？如何改成逐单累计？
2. 三名销售人员的业绩为 120、120、90。三种排名函数分别返回什么？如果要保留并列第一，应选哪一种？
3. 商品在 11 月 1 日和 11 月 3 日有销售，11 月 2 日没有记录。LAG 在 11 月 3 日会返回哪一天的数据？怎样才能计算“和昨天相比”？
4. 一个 CTE 被三个后续 CTE 引用。为什么不能仅凭 SQL 写法断言其结果只计算一次？应通过什么证据决定是否物化？

## 参考资料

- [Window function syntax and usage](https://docs.snowflake.com/en/sql-reference/functions-window-syntax)
- [Analyzing data with window functions](https://docs.snowflake.com/en/user-guide/functions-window-using)
- [WITH (Common Table Expressions)](https://docs.snowflake.com/en/sql-reference/constructs/with)
