# Semantic Views 与 Cortex Analyst

## 本节要解决的问题

业务人员问：“上季度各地区的净销售额是多少？平均每笔订单金额呢？”两个指标看起来只需要 SUM 和 AVG，但财务口径里“净销售额”要扣折扣和退款，平均订单金额又不能把订单头表的金额按明细行重复累计。

如果只给 Cortex Analyst 一组表和列名，模型必须猜测字段含义、Join 关系和指标口径。即使生成 SQL 能执行，也可能在一对多 Join 后把订单金额重复相加。Semantic View 的作用是把已经确认的业务模型发布成 Snowflake 对象，让 Cortex Analyst 使用业务实体、维度、事实和指标生成 SQL。它不能替代数据建模和质量检查。

## 核心知识

### Semantic View 是业务语义定义，不是另一份数据副本

Semantic View 是 Schema 级对象，定义逻辑表、表关系、Facts、Dimensions 和 Metrics。底层数据仍在原表或视图中；Semantic View 提供名称、业务描述、关系和可复用指标。

新项目应优先使用 Semantic Views。历史 Cortex Analyst Semantic Model YAML（通常保存在 Stage）仍为兼容性而支持，但 Snowflake 推荐新实现使用 Semantic View：对象有原生 RBAC、Sharing 和 Catalog 集成，也支持派生指标与 Public/Private access modifier。

要先定义真实数据粒度。例如订单分析可以拆成：
- ORDERS：一行一张订单；
- ORDER_LINES：一行一个订单明细；
- CUSTOMERS：一行一个客户。

这三个逻辑表并不是因为都包含 CUSTOMER_ID 就能随意 Join。ORDERS 到 ORDER_LINES 是一对多；ORDERS 到 CUSTOMERS 通常是多对一。模型中的 Primary Key 和 Relationship 必须反映真实唯一性。

### Logical Tables 和 Relationships 决定可用的 Join 路径

示例数据：

| ORDER_ID | CUSTOMER_ID | ORDER_TOTAL |
|---|---|---:|
| O-101 | C-01 | 300 |
| O-102 | C-02 | 200 |

订单明细：

| ORDER_ID | LINE_NO | NET_LINE_AMOUNT |
|---|---:|---:|
| O-101 | 1 | 100 |
| O-101 | 2 | 200 |
| O-102 | 1 | 200 |

如果先把 ORDERS 和 ORDER_LINES Join，再计算 SUM(ORDER_TOTAL)，O-101 的 300 会出现两次，结果变成 800，而实际订单头总额是 500。问题不是 SQL 语法，而是聚合粒度：订单头事实经过一对多 Join 后被复制。

Semantic View 的 TABLES 和 RELATIONSHIPS 声明逻辑表及外键关系：

~~~sql
CREATE OR REPLACE SEMANTIC VIEW SALES.SEMANTICS.ORDER_ANALYSIS
  TABLES (
    orders AS SALES.MART.ORDERS
      PRIMARY KEY (order_id),
    order_lines AS SALES.MART.ORDER_LINES
      PRIMARY KEY (order_id, line_no),
    customers AS SALES.MART.CUSTOMERS
      PRIMARY KEY (customer_id)
  )
  RELATIONSHIPS (
    orders_to_customers AS
      orders (customer_id) REFERENCES customers (customer_id),
    lines_to_orders AS
      order_lines (order_id) REFERENCES orders (order_id)
  )
  FACTS (
    order_lines.net_line_amount AS net_line_amount,
    orders.order_total AS order_total
  )
  DIMENSIONS (
    orders.order_date AS order_date,
    orders.order_status AS order_status,
    customers.customer_name AS customer_name,
    customers.region AS customer_region
  )
  METRICS (
    order_lines.net_sales AS SUM(order_lines.net_line_amount),
    orders.order_count AS COUNT(DISTINCT orders.order_id)
  )
  COMMENT = 'Order and order-line analysis';
~~~

示例假设 order_id 在 ORDERS 唯一、(order_id, line_no) 在 ORDER_LINES 唯一、customer_id 在 CUSTOMERS 唯一。Relationship 的方向由包含外键的逻辑表指向被引用的逻辑表；Snowflake 根据数据和 Primary Key 定义推断一对一或多对一关系。模型声明的唯一键必须真实成立，不能只为让创建通过而填写。

对于复合外键，Relationship 要列出每一组列。例如一个业务关系由 tenant_id + customer_id 唯一定位，不能只用 customer_id Join。若同两张逻辑表之间有多条关系路径，还要确认指标使用哪条关系，避免模型在出发机场、到达机场等相似关系中选错路径。

### Facts、Dimensions 和 Metrics 不是同义词

- **Fact** 是可用于计算的值或表达式，例如净明细金额、折扣后金额。
- **Dimension** 是分析切分条件，例如日期、地区、产品类别、客户等级。
- **Metric** 是带聚合定义的业务度量，例如净销售额、订单数、平均订单金额。

同一个物理列可以作为事实来源，但指标必须明确聚合方法。SUM 适用于可加金额；余额、库存等快照型指标通常不能跨时间直接求和。若用户问“月末余额”，应该选择最新月份对应的快照，不能把每日余额相加。

对于上述示例：
- 净销售额：SUM(order_lines.net_line_amount)；
- 订单数：COUNT(DISTINCT orders.order_id)；
- 平均订单金额：应明确是否按订单头总额计算，或用订单明细净额除订单数；两个定义必须与业务财务口径一致。

如果把订单头总额和订单明细金额放在同一个 Join 结果中，需要检查指标计算是否会因 Join 扩行而重复。Semantic View 提供的 FIXED/INCLUDE/EXCLUDE 等粒度表达能力可以处理特定层级的聚合，但它们不是替代数据模型清理的补丁。优先修复错误主键、重复行和多对多桥表，再定义指标。

### ASOF 和 Range Relationship 适合按生效时间查维度

普通 Relationship 默认按相等条件 Join。若订单发生时需要取得当时生效的客户地址、证券分类或政策版本，不能把订单日与维表开始日期做普通等值 Join。

ASOF Relationship 用于按时间找到最近的有效记录；Range Relationship 用于匹配起止日期范围。示例：订单在 2026-11-15，客户地址表记录了 11 月 1 日至 11 月 30 日的最新地址，查询应取该订单日期有效的地址，而不是客户当前地址。

这类时间关系要求维度表的生效区间无重叠或有明确优先规则。若同一客户在同一日期存在两条有效地址，ASOF 或 Range Join 仍需要数据质量规则确定正确记录；Semantic View 不会自动猜测业务优先级。

### Verified Query Repository 为常见问题提供经人工验证的 SQL

Verified Query 是一对经过验证的自然语言问题和 SQL。Cortex Analyst 可以在遇到相似问题时复用这些已验证查询，减少对常见业务表达的误解。

~~~yaml
verified_queries:
  - name: quarterly_net_sales_by_region
    question: What was net sales by region last quarter?
    verified_at: 1795737600
    verified_by: finance_data_steward
    use_as_onboarding_question: true
    sql: |
      SELECT
        customers.customer_region,
        SUM(order_lines.net_line_amount) AS net_sales
      FROM order_lines
      JOIN orders
        ON order_lines.order_id = orders.order_id
      JOIN customers
        ON orders.customer_id = customers.customer_id
      WHERE orders.order_date >= '2026-07-01'
        AND orders.order_date < '2026-10-01'
      GROUP BY customers.customer_region
~~~

这里的 YAML 示例用于说明 VQR 字段；使用时要将 verified_at 设置为真实验证时间，并把 SQL 改为 Semantic View 的逻辑表和逻辑列名称，不能在 Verified Query 中写底层物理表字段名。提交前必须由业务 owner 对 SQL 的结果和业务口径签字确认。

Verified Query 也可以进入 Cortex Analyst Evaluation。要注意一个 Verified Query 在一次评测中不能同时充当运行时提示和测试答案：被选作 Ground Truth 的查询会从临时评测模型副本中移除，避免评测时直接命中它而高估 SQL 生成能力。

### Cortex Analyst 生成的是 SQL 候选结果，不是自动批准的业务指标

Analyst 根据自然语言问题、Semantic View、关系、Metric/Dimension 描述和 Verified Query 生成 SQL。生成的 SQL 仍要在实际调用 Role 下执行，并对照 Golden Query 检查：
- 选择了正确的 Metric 和 Dimension；
- 日期范围、时区和季度定义正确；
- Join 路径与基数正确；
- 过滤条件和状态口径符合业务规则；
- 聚合结果与人工核对的控制数一致。

Verified Query Repository 不是业务规则引擎，也不能覆盖所有自然语言变化。高风险指标要维护覆盖不同表达、过滤条件、日期边界和用户权限的测试集。生成 SQL 可执行只是必要条件，不是业务答案正确的充分条件。

## 工程实施步骤

1. 先确认订单、明细、客户等实体的事实粒度、主键、唯一键和外键质量。
2. 识别一对多、多对一、复合键、多对多桥表以及生效日期关系。
3. 为每个逻辑表定义 Primary Key/Unique Key 和业务注释；不要用逻辑假设代替实际唯一性检查。
4. 将业务列映射为 Facts 与 Dimensions；为金额、计数、比率、余额等指标写清分子、分母、聚合和非可加维度。
5. 用 CREATE SEMANTIC VIEW 或 YAML 规范建立 Schema 级对象；在部署时检查 CREATE SEMANTIC VIEW、USAGE 和底层表 SELECT 权限。
6. 使用 SEMANTIC_VIEW() 函数或 Cortex Analyst 测试样例验证生成 SQL 的 Join 路径、结果粒度和指标值。
7. 将高频、复杂或容易歧义的问题加入 Verified Query Repository；每条 VQ 都要有具体提问、逻辑 SQL 和业务 owner。
8. 为每项核心 Metric 建立 Golden Query 和控制数，对比直接 SQL 与 Analyst 生成 SQL 的结果。
9. 在不同 Role 下测试 Semantic View 的对象权限、底层数据策略和访问边界。
10. 修改表粒度、Relationship、Primary Key 或 Metric 表达式时，重新运行受影响的 Verified Query 和 Evaluation。
11. 通过 DESCRIBE SEMANTIC VIEW、SHOW SEMANTIC DIMENSIONS、SHOW SEMANTIC FACTS 和 SHOW SEMANTIC METRICS 检查已部署定义。
12. 将语义定义、Verified Query、评测结果和业务口径版本一并纳入变更审查。

## 场景分析

业务部门问：“2026 年第三季度，各地区的净销售额和平均订单金额是多少？”语义层把订单头和订单明细关联后，如果直接 SUM(order_total)，O-101 因为有两条明细被重复计算。模型还可能把“订单金额”理解成订单头总额，而财务的“净销售额”其实需要扣除明细折扣和退款。

修正时先确定两个指标不是一回事：净销售额按明细净额汇总，订单数按唯一订单 ID 计数；平均订单金额则明确采用净销售额除以订单数，或财务已批准的订单头口径。随后定义唯一键、Relationship、Metric，并创建一条 Verified Query 由财务 owner 校验结果。

新员工以自然语言问相同问题时，Analyst 可以基于该语义定义和 Verified Query 生成查询，但输出仍要经过 Golden Query 回归。若更改订单明细的粒度或退款处理方式，所有相关指标和 Verified Query 都要重新验证。

## 常见误区

- **把 Semantic View 当作另一张业务数据表。** 它定义业务语义和查询关系，不复制底层数据。
- **只写列名和注释，不定义主键与关系。** Analyst 无法凭名字准确还原一对多、复合键和时间关系。
- **将订单头金额和订单明细金额在一对多 Join 后直接 SUM。** 头表金额会按明细行重复，必须调整指标粒度。
- **把 Fact、Dimension 和 Metric 混成同一种字段。** Metric 必须有聚合与业务口径，不是任意数值列。
- **用当前维度值回答历史问题。** 需要按事件日期关联 ASOF/Range 维度或有效期版本。
- **Verified Query 直接引用物理表字段。** SQL 应使用 Semantic View 的逻辑表和逻辑列名称。
- **把 Verified Query 当成全面测试集。** 高频问题只是代表性样例，仍需覆盖日期、边界、Join 和权限变化。
- **只验证 Analyst 生成 SQL 能执行。** 还要核对结果和业务控制数。
- **把多对多关系当作普通一对多。** 桥表、非唯一键和多路径 Join 可能改变聚合结果，需要单独建模和验证。

## 完成标准

- [ ] 能解释 Semantic View、逻辑表、Relationship、Fact、Dimension 和 Metric 的职责。
- [ ] 能根据真实主键和外键设计逻辑关系，并判断 Join 基数。
- [ ] 能解释一对多 Join 为什么可能重复累计订单头事实。
- [ ] 能为金额、计数、余额和比率定义正确聚合与可加性。
- [ ] 能判断历史维度应使用普通 Join、ASOF 或 Range Relationship。
- [ ] 能使用 Verified Query Repository，并说明 SQL 必须使用逻辑表/列。
- [ ] 能通过 Golden Query、权限测试与 Evaluation 验证 Cortex Analyst 输出。

## 自测

1. 一张订单有三条明细。订单头的 300 元金额在 Join 后会出现几次？为什么 SUM(order_total) 会被放大？
2. order_id 在订单头唯一，(order_id, line_no) 在明细唯一。Semantic View 的 Primary Key 和 Relationship 应怎样定义？
3. 余额每天有一条记录。为什么不能把每日余额跨月求和？应该如何定义月末余额指标？
4. 订单发生在 11 月 15 日，客户地址在 11 月 1 日生效、12 月 1 日失效。普通等值 Join 能否找到它？应考虑哪种 Relationship？
5. 一个 Verified Query 已经用于生产指导 Analyst。将它选作 Evaluation Ground Truth 时，Snowflake 如何避免评测直接命中这条查询？
6. Analyst 生成 SQL 可执行，但销售额比财务控制数高 40%。应先检查哪些 Join 粒度、指标定义和过滤条件？

## 参考资料

- [Semantic Views overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Using SQL commands to create and manage semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/sql)
- [YAML specification for semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)
- [Cortex Analyst Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
- [Suggestions for semantic models and views](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-suggestions)
- [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
