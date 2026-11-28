# PostgreSQL JOIN、聚合与结果粒度

## 本节要解决的问题

正确组合多张关系表并计算业务指标，重点控制 JOIN 后的行数和聚合粒度。JOIN 决定哪些记录匹配，GROUP BY 决定结果每行代表什么；如果不先确认关系基数，即使 SQL 语法完全正确，金额、数量和比例也可能被重复累计。

## 核心知识

### JOIN 类型决定保留哪些记录

INNER JOIN 只保留两侧满足连接条件的组合；LEFT JOIN 保留左侧全部记录，未匹配的右侧列为 NULL；RIGHT JOIN 与之相反；FULL OUTER JOIN 保留两侧未匹配记录。CROSS JOIN 产生两侧行的笛卡尔组合，除非确实需要组合所有元素，否则应谨慎使用。

LEFT JOIN 后若把右表过滤条件放到 WHERE，右表未匹配行的条件通常会得到 NULL/UNKNOWN 并被过滤，使结果接近 INNER JOIN。若条件用于限定右表哪些记录可以参与匹配，应放在 ON 中。

### 一对多和多对多 JOIN 会放大行数

订单头表一行代表一笔订单，订单明细表一行代表一个商品行。按 order_id 连接后，一笔订单会变成多行；若直接对订单头金额 SUM，金额就会按明细行数重复。

多对多关系会产生更明显的行数膨胀。若一笔订单有三条明细、对应两条促销归属，直接连接两个明细集合可能产生六条组合。应先明确目标粒度，再按共同键聚合或通过桥接表定义正确业务关系。

### GROUP BY 改变结果粒度，聚合函数有不同 NULL 语义

GROUP BY 将拥有相同分组键的输入行合并为一组。SELECT 中非聚合列通常必须出现在 GROUP BY 中，除非 PostgreSQL 能依据主键等函数依赖确定其唯一值。

COUNT(*) 计算所有行，COUNT(column) 忽略该列为 NULL 的行，COUNT(DISTINCT column) 统计不同的非 NULL 值。SUM/AVG 等聚合也有 NULL 处理语义。比例指标需要明确分子和分母的定义，避免在已经聚合的数据上再次平均导致错误。

HAVING 在分组后过滤组；WHERE 在分组前过滤行。FILTER 子句可以为不同聚合函数应用不同条件，而不必拆成多个子查询。

## 工程实施步骤

1. 为每张输入表写明一行代表什么，确认业务键、唯一性和 NULL 行为。
2. 确定输出粒度，例如订单级、客户级、客户-月份级或商品-订单级，并据此确定 GROUP BY。
3. 在连接前检查两侧 Join Key 的重复数和匹配率，识别 1:1、1:N 和 N:M 关系。
4. 根据是否保留未匹配行选择 INNER、LEFT 或 FULL JOIN；明确右侧过滤条件应属于 ON 还是 WHERE。
5. 每增加一次 JOIN，就比较输入行数、输出行数、唯一业务键数和匹配率，定位行数异常增长。
6. 对多事实表查询，先将各事实聚合到共同分析粒度，再连接共享维度，避免明细级多表相乘。
7. 明确 COUNT(*)、COUNT(column)、COUNT(DISTINCT) 和 SUM 的业务含义及 NULL 影响。
8. 将分组前过滤放在 WHERE，聚合结果筛选放在 HAVING；需要不同聚合条件时评估 FILTER。
9. 用小型手工样本构造一对多、多对多、未匹配和 NULL 情况，验证结果。
10. 对大型查询使用 EXPLAIN (ANALYZE, BUFFERS) 检查实际行数、Join 节点、扫描和排序；执行 ANALYZE 以保持统计信息有效。

示例：先把订单头和订单明细分别汇总到客户级，再连接客户维度。

~~~sql
WITH order_totals AS (
  SELECT customer_id,
         count(*) AS order_count,
         sum(order_total) AS order_amount
  FROM sales.orders
  WHERE order_date >= date '2026-01-01'
  GROUP BY customer_id
),
line_totals AS (
  SELECT o.customer_id,
         sum(l.quantity) AS item_count,
         sum(l.line_amount) AS line_amount
  FROM sales.orders o
  JOIN sales.order_lines l USING (order_id)
  WHERE o.order_date >= date '2026-01-01'
  GROUP BY o.customer_id
)
SELECT c.customer_id,
       coalesce(ot.order_count, 0) AS order_count,
       coalesce(ot.order_amount, 0) AS order_amount,
       coalesce(lt.item_count, 0) AS item_count,
       coalesce(lt.line_amount, 0) AS line_amount
FROM sales.customers c
LEFT JOIN order_totals ot USING (customer_id)
LEFT JOIN line_totals lt USING (customer_id);
~~~

该示例将两组事实独立聚合到 customer_id 粒度。若需要按月份分析，应把月份键纳入两侧聚合并在最终 Join 中使用相同粒度。

## 场景分析

财务报表从订单表读取订单总额，销售报表从订单明细表读取商品销售额。新报表把订单、明细、促销映射表直接连接，订单金额比原报表高出数倍。

先检查每个订单有多少条明细，以及每条明细有多少条促销映射。若两个一对多关系同时连接，订单头金额会被重复，明细金额也可能因促销映射重复。应先确认促销归因是按订单、按行项目还是按比例分摊，再分别聚合到目标粒度。

验收使用包含多行明细、多个促销、无促销订单和退款的样本，核对订单数、订单金额、明细金额和促销分摊。不能仅用 SUM(DISTINCT order_total) 作为修复，因为不同订单可能具有相同金额。

## 常见误区

- **把 JOIN 当作只增加列、不改变行数。** 一对多和多对多连接会扩展行集。
- **LEFT JOIN 右表过滤条件一律写 WHERE。** 可能删除未匹配的左表记录。
- **先连接所有明细再 SUM 订单级金额。** 会因行粒度变化重复累计。
- **用 DISTINCT 修复重复。** 可能掩盖错误关系并删除真实业务记录。
- **对分组结果使用 AVG 代替加权计算。** 平均值的平均不一定等于总体平均，比例还需要明确分母。
- **只检查执行计划，不核对业务结果。** 计划解释性能，不能证明指标口径正确。

## 完成标准

- [ ] 能说明 INNER、LEFT、RIGHT、FULL 和 CROSS JOIN 的记录保留规则。
- [ ] 能识别一对多和多对多 JOIN 对行数的影响。
- [ ] 能先定义输出粒度再设计 GROUP BY。
- [ ] 能正确使用 COUNT、SUM、HAVING 和 FILTER。
- [ ] 能用样本对账和 EXPLAIN ANALYZE 验证结果与性能。

## 自测

1. LEFT JOIN 后右表条件放在 WHERE，为什么可能删除未匹配的左侧行？
2. 一笔订单有 4 条明细和 2 条促销记录，直接连接后会产生多少组合？订单金额应如何统计？
3. COUNT(*) 与 COUNT(nullable_column) 在 NULL 行存在时有什么差异？
4. 为什么两个事实表应先聚合到相同粒度再连接？
5. 总体转化率应使用总转化数/总访问数，还是各分组转化率的简单 AVG？根据什么判断？

## 参考资料

- [Table Expressions and JOINs](https://www.postgresql.org/docs/current/queries-table-expressions.html)
- [Aggregate Functions](https://www.postgresql.org/docs/current/functions-aggregate.html)
- [Window Functions](https://www.postgresql.org/docs/current/functions-window.html)
- [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
