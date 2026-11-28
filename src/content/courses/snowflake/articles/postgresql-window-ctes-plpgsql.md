# PostgreSQL 窗口函数、CTE 与 PL/pgSQL

## 本节要解决的问题

将复杂 SQL 拆成可理解的计算阶段：用窗口函数保留明细行并计算排名或累计值，用 CTE 表达查询步骤，用 PL/pgSQL 封装需要过程控制的数据库逻辑。三者解决不同问题，不能为了“代码整洁”将所有查询都改成 CTE，也不能把行级计算交给过程语言。

## 核心知识

### 窗口函数在保留行的同时观察相关行集合

窗口函数通过 OVER 定义分区、排序和窗口框架。PARTITION BY 将逻辑行集划分为多个窗口；ORDER BY 决定窗口内的排序；ROWS/RANGE/GROUPS 定义当前行计算时包含哪些相邻行。

与 GROUP BY 不同，窗口函数不会把多行压缩成一行。常用函数包括 row_number、rank、dense_rank、lag、lead、first_value，以及带 OVER 的 sum/avg 等聚合函数。

窗口函数在 WHERE、GROUP BY 和 HAVING 之后计算，不能直接写在 WHERE 中过滤窗口结果。需要按排名过滤时，应先在子查询或 CTE 中计算，再在外层 WHERE 筛选。

默认窗口框架在使用 ORDER BY 时通常从分区起点延伸到当前行及其同序 peer。对 last_value 这类函数，这个默认框架可能不是整组数据；若需要全分区最后值，应显式定义 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING。

### CTE 组织查询阶段，物化行为由优化器和关键字决定

WITH 子句可以为复杂查询命名中间结果，提高逻辑可读性。递归 CTE 可以遍历树、图或层级结构，但必须保证递归终止，并处理可能的环路。

在现代 PostgreSQL 中，单次引用、无副作用的非递归 CTE 通常可以折叠进父查询，由优化器联合优化；多次引用的 CTE 默认可能物化。MATERIALIZED 可以强制单独计算，NOT MATERIALIZED 可以鼓励内联，但可能重复计算。不能再假设所有 CTE 都是优化屏障。

数据修改 CTE 可以在一条 SQL 中包含 INSERT、UPDATE、DELETE 等操作；其输出通常通过 RETURNING 形成可供其他 CTE 使用的临时结果。数据修改子语句会执行一次并完成，不应依赖它们之间按书写顺序观察彼此修改。

### PL/pgSQL 适合过程控制，不替代集合式 SQL

PL/pgSQL 是 PostgreSQL 的过程语言，可以编写函数和过程，支持变量、条件、循环、异常处理和动态 SQL。若工作只需一次集合式 UPDATE 或 INSERT，优先直接写 SQL；当逻辑确实需要多步骤分支、错误处理或数据库端封装时，再考虑 PL/pgSQL。

Function 与 Procedure 有不同调用和事务边界。函数用于表达可在 SQL 中调用的计算或操作；过程通过 CALL 调用，在符合条件的场景中可执行事务控制。SECURITY DEFINER 函数以拥有者权限执行，需要固定并审查 search_path，避免不可信用户创建同名对象影响函数内未限定名称解析。

## 工程实施步骤

1. 写明查询输入、输出粒度和需要保留的明细行，判断使用 GROUP BY 还是窗口函数。
2. 需要分组排名、前后行比较、累计值或移动计算时使用窗口函数，并显式定义 PARTITION BY、ORDER BY 和窗口框架。
3. 需要过滤窗口结果时，将窗口计算放进子查询/CTE，再在外层过滤。
4. 用 CTE 为复杂查询的阶段命名，检查是否重复引用、是否有昂贵计算以及是否需要 MATERIALIZED 或 NOT MATERIALIZED。
5. 对递归 CTE 定义终止条件，使用路径/visited 集合或 CYCLE 机制检测环路。
6. 对数据修改 CTE 明确 RETURNING 输出和执行副作用；不要依赖多个修改子句按书写顺序互相可见。
7. 只有需要分支、循环、异常处理或可复用服务端逻辑时才编写 PL/pgSQL；集合运算尽量留在 SQL 中。
8. 将需要安全边界的函数设置 SECURITY INVOKER 或 SECURITY DEFINER，并对后者设置受控 search_path、对象全限定名和最小拥有者权限。
9. 使用 EXPLAIN (ANALYZE, BUFFERS) 比较窗口排序、CTE 物化、重复扫描和临时文件，验证性能假设。
10. 对边界样本测试同值排序、NULL、空分区、重复事件、递归环路和异常回滚行为。

示例：计算每位客户最近三笔订单，并保留订单明细。

~~~sql
WITH ranked_orders AS (
  SELECT
    order_id,
    customer_id,
    order_date,
    order_total,
    row_number() OVER (
      PARTITION BY customer_id
      ORDER BY order_date DESC, order_id DESC
    ) AS rn
  FROM sales.orders
)
SELECT order_id, customer_id, order_date, order_total
FROM ranked_orders
WHERE rn <= 3
ORDER BY customer_id, order_date DESC;
~~~

窗口结果保留每张订单；如果使用 GROUP BY，订单明细会被压缩，无法直接返回最近三笔的原始行。

## 场景分析

销售团队要展示每位客户最近三笔订单，同时显示该客户订单累计金额。直接 GROUP BY customer_id 只能得到客户级汇总，无法保留每笔订单。

使用 row_number 按 customer_id 分区并按 order_date、order_id 排序，再在外层过滤 rn <= 3；累计金额可用 SUM(order_total) OVER (PARTITION BY customer_id ORDER BY order_date, order_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) 计算。若对同一客户的订单排序存在并列，必须加入稳定的次排序键。

验收构造同一客户多笔同日订单、空客户集合、重复金额和不同日期时区，核对排名顺序与累计值。再用 EXPLAIN ANALYZE 观察排序与窗口节点的成本。

## 常见误区

- **把窗口函数当 GROUP BY。** 窗口函数保留行，GROUP BY 压缩到分组粒度。
- **在 WHERE 中直接引用窗口函数。** 应先在子查询/CTE 计算，再在外层过滤。
- **认为 ORDER BY 的默认 frame 总是整个分区。** last_value 等函数可能只看到当前行及 peer，需要显式定义 frame。
- **认为所有 CTE 都一定物化。** PostgreSQL 可以内联或物化，必要时用关键字控制。
- **把 PL/pgSQL 用来替代简单集合 SQL。** 逐行循环通常比集合式 SQL 更难优化。
- **忽略 SECURITY DEFINER 的 search_path。** 不可信 Schema 中的同名函数或表可能造成权限提升风险。

## 完成标准

- [ ] 能解释窗口函数与 GROUP BY 对行粒度的差异。
- [ ] 能设计 PARTITION BY、ORDER BY 和窗口 frame。
- [ ] 能使用 CTE 组织查询并说明物化/内联影响。
- [ ] 能处理递归 CTE 的终止条件和环路。
- [ ] 能判断何时使用 PL/pgSQL，并审查 SECURITY DEFINER。

## 自测

1. 需要每个客户最近三笔订单的明细行，为什么窗口函数比 GROUP BY 更合适？
2. 窗口函数为什么不能直接出现在 WHERE 中？该如何过滤排名结果？
3. last_value 默认窗口框架为什么可能只返回当前排序 peer 的值？
4. NOT MATERIALIZED 有什么性能收益和重复计算风险？
5. SECURITY DEFINER 函数为什么必须控制 search_path 并避免未限定对象名？

## 参考资料

- [Window Functions](https://www.postgresql.org/docs/current/functions-window.html)
- [Window Function Tutorial](https://www.postgresql.org/docs/current/tutorial-window.html)
- [WITH Queries (CTEs)](https://www.postgresql.org/docs/current/queries-with.html)
- [PL/pgSQL](https://www.postgresql.org/docs/current/plpgsql.html)
- [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)
