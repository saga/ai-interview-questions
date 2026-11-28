# JOIN、聚合与结果粒度

## 本节要解决的问题

报表里“活跃客户数”突然少了 18%，开发先检查了数据加载任务，发现任务没有失败；再看原始客户表，客户也没有减少。问题出在一条刚改过的 SQL：为了补上客户分群，把 `LEFT JOIN` 改成了带筛选条件的写法，结果没有分群的客户被过滤掉了。

JOIN 不只是把两张表拼起来。它会改变行数，也会改变后续聚合看到的数据。读 SQL 时，至少要同时问三件事：哪些行会留下、每个键会匹配几行、聚合是在连接前还是连接后发生。

## 核心知识

### INNER、LEFT、FULL OUTER 的差别在未匹配行

假设客户表有三名客户，订单表只有两名客户有订单：

| CUSTOMER_ID | CUSTOMER_NAME |
|---|---|
| C01 | Alice |
| C02 | Ben |
| C03 | Chen |

| ORDER_ID | CUSTOMER_ID | ORDER_TOTAL |
|---|---|---:|
| O100 | C01 | 300 |
| O101 | C02 | 120 |

- `INNER JOIN` 只保留两边都匹配的客户，结果两行。
- `LEFT JOIN` 保留左表全部客户，C03 的订单列为 NULL，结果三行。
- `FULL OUTER JOIN` 保留两边所有行；如果订单表还有一个不存在于客户表的客户键，这条订单也会出现在结果中。

BI 报表通常需要保留没有订单的客户，因此会用 LEFT JOIN。这里有个容易踩的坑：右表过滤条件放在 ON 和 WHERE 的语义不同。

~~~sql
-- 保留所有客户，只把“已支付订单”连接进来
SELECT c.customer_id, o.order_id
FROM dim_customer c
LEFT JOIN fact_order o
  ON o.customer_id = c.customer_id
 AND o.status = 'PAID';

-- 这个写法会过滤掉没有已支付订单的客户
SELECT c.customer_id, o.order_id
FROM dim_customer c
LEFT JOIN fact_order o
  ON o.customer_id = c.customer_id
WHERE o.status = 'PAID';
~~~

第二条 SQL 的 WHERE 条件要求右表的 `status` 为 PAID。没有订单的客户，其 `o.status` 是 NULL，条件结果不是 TRUE，因此那一行被筛掉了。原本的 LEFT JOIN 在结果上就接近 INNER JOIN。

### 行数变多时，先查连接基数，再看 SUM

还是用订单和商品明细。订单 O100 金额 300，有两条商品明细；O101 金额 120，只有一条明细。直接连接后：

| ORDER_ID | ORDER_TOTAL | LINE_AMOUNT |
|---|---:|---:|
| O100 | 300 | 100 |
| O100 | 300 | 200 |
| O101 | 120 | 120 |

订单总额被算成 720，而不是 420。商品金额仍是 420。连接结果没有错，错的是把订单粒度的金额当成明细粒度的金额来求和。

先做两件检查：

~~~sql
-- 检查右表在连接键上是否唯一
SELECT customer_id, COUNT(*) AS rows_per_customer
FROM dim_customer
GROUP BY customer_id
HAVING COUNT(*) > 1;

-- 比较连接前后行数和业务键数量
SELECT
  COUNT(*) AS row_count,
  COUNT(DISTINCT order_id) AS order_count
FROM fact_order;
~~~

如果维度表的连接键不是唯一值，一条事实可能匹配多个维度行。若业务上本来就是多对多关系，需要桥接表、权重或明确的分摊规则；不要把扩行当成数据库异常。

### WHERE 先筛行，HAVING 再筛分组

`WHERE` 在分组之前过滤输入行；`HAVING` 在 GROUP BY 形成结果之后过滤分组。比如只统计已支付订单，并找出累计金额超过 1,000 的客户：

~~~sql
SELECT
  customer_id,
  SUM(order_total) AS paid_amount
FROM fact_order
WHERE status = 'PAID'
GROUP BY customer_id
HAVING SUM(order_total) > 1000;
~~~

把 `SUM(order_total) > 1000` 写进 WHERE 是错误的，因为此时聚合结果还没有产生。反过来，把普通行过滤全部放进 HAVING，通常会让 SQL 更难读，也可能让引擎处理更多数据。

### 预聚合不是固定优化技巧，关键是两边先对齐到同一粒度

如果订单、支付和明细都是独立事实表，不要把三个明细层直接连接后再求和。先确定最终报表的粒度，例如“客户 × 业务日期”，然后分别聚合：

~~~sql
WITH order_daily AS (
  SELECT customer_id, order_date, SUM(order_total) AS order_amount
  FROM fact_order
  GROUP BY customer_id, order_date
),
payment_daily AS (
  SELECT customer_id, payment_date AS order_date, SUM(paid_amount) AS paid_amount
  FROM fact_payment
  WHERE payment_status = 'SUCCESS'
  GROUP BY customer_id, payment_date
)
SELECT
  o.customer_id,
  o.order_date,
  o.order_amount,
  COALESCE(p.paid_amount, 0) AS paid_amount
FROM order_daily o
LEFT JOIN payment_daily p
  ON p.customer_id = o.customer_id
 AND p.order_date = o.order_date;
~~~

这里的聚合键必须和业务问题一致。如果报表要看订单级别，就不能提前汇总到客户级；如果支付发生在订单之后的另一天，也不能把支付日期悄悄替换成下单日期。

## 工程实施步骤

1. 先写出结果集应保留的主集合：客户全集、订单全集，还是两边匹配的记录。
2. 对连接键分别统计 NULL 数量、总行数、去重数和重复值样本。
3. 用少量已知业务键手工核对 Join 结果，特别检查 1:N、N:M 和没有匹配项的记录。
4. 将右表筛选条件逐项检查：它应该限制“匹配哪些行”，还是过滤最终结果？
5. 确定指标粒度后再写 GROUP BY。不同事实表先各自聚合，再按共同维度连接。
6. 对关键指标保留连接前后的行数、键数量和金额对账结果，作为回归测试。
7. 用 Query Profile 观察扫描、Join 和聚合算子的代价；性能优化不能改变业务结果。

## 场景分析

客户成功团队想统计每个客户的已支付订单金额，并展示客户当前分群。客户分群表里有历史版本，同一客户可能有多条记录；订单表则每笔订单一行。

直接把客户、分群历史和订单连接，可能发生两次扩行：一笔订单匹配多条分群记录，一笔客户又有多笔订单。结果既会重复订单金额，也可能把历史分群当成当前分群。

先确定报表要展示当前分群还是下单时的分群。当前分群只应匹配一条当前记录；下单时的分群要按订单日期匹配有效区间。随后将订单金额聚合到客户粒度，再连接已验证唯一的客户分群记录。验收样本至少要包含：没有订单的客户、有多笔订单的客户、发生过分群变更的客户。

## 常见误区

- **把 LEFT JOIN 的右表条件放进 WHERE。** 没有匹配值的左表行会因为 NULL 被筛掉；想保留左表时，通常应把限制匹配的条件放在 ON。
- **认为 Join 后行数增加就是重复数据。** 先查键的基数；一对多展开本身可能完全符合业务关系。
- **用 DISTINCT 或 SUM(DISTINCT amount) 修复 fanout。** 这样会掩盖关系错误，还可能删掉金额相同但真实存在的业务事件。
- **把 WHERE 和 HAVING 当成两种写法。** 一个过滤输入行，一个过滤聚合后的分组。
- **看到预聚合就认为一定更快。** 预聚合首先要保证口径正确；聚合粒度选错，会让结果错误得更隐蔽。

## 完成标准

- [ ] 能说出 INNER、LEFT、FULL OUTER 对未匹配行的处理差异。
- [ ] 能解释右表过滤条件放在 ON 和 WHERE 的结果差异。
- [ ] 能用键唯一性和连接前后行数定位 fanout。
- [ ] 能区分 WHERE 与 HAVING 的执行位置。
- [ ] 能按报表粒度决定是否预聚合，以及应该使用哪些分组键。

## 自测

1. 客户 C03 没有订单。要在报表中保留 C03，并只连接已支付订单，筛选条件应该放在哪里？
2. 一个客户有 4 笔订单，分群历史表有 3 个版本。直接 Join 后金额为什么可能被重复 3 倍？应该怎样确定匹配版本？
3. 订单金额按订单粒度保存，商品金额按明细粒度保存。报表要按客户和月份展示两者，两个事实表应该分别按什么键聚合？
4. 想找出订单金额超过 1,000 的客户，为什么应使用 HAVING，而不是 WHERE？

## 参考资料

- [Snowflake SQL joins](https://docs.snowflake.com/en/user-guide/querying-joins)
- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Creating Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/creating)
