# Snowflake 语义层：把业务口径变成可测试的模型

## 先处理三份都叫“收入”的报表

财务、销售和客服各自维护一条收入 SQL。财务按已付款订单统计，销售按已下单订单统计，客服排除了退款订单。三份报表都叫“收入”，数字却不同。

这不一定是 SQL 写错了。它们可能代表三个合法但不同的业务概念。真正的问题是：每个消费者都在自己的查询里重新解释了业务规则。语义层应该把已经确认的实体、关系、指标和筛选口径放到可复用的位置，而不是再建一张字段描述表，或替代底层事实表建模。

## Semantic View 存的不是一组别名

Snowflake Semantic View 是 Schema 级对象。它将物理表映射为逻辑表，再用关系、Facts、Dimensions 和 Metrics 描述业务语义。

逻辑表通常对应订单、客户或产品等实体。关系说明它们怎样连接；Fact 表示行级业务属性或计算值；Dimension 提供分组、筛选和分析上下文；Metric 则用聚合表达业务度量。它们各自有职责，不能把列的 COMMENT、行级金额和 SUM 指标当成同一类元数据。

这些定义可以通过 SQL DDL 或 YAML 管理。DDL 更直接地表达对象结构和部署变更；YAML 适合声明完整语义模型及相关 AI 配置。无论选哪一种，关键都不是格式，而是定义能否进入版本控制、测试和发布流程。

## 粒度不对，语义模型会把错误解释得更清楚

假设 FACT_ORDER 每行一笔订单，FACT_ORDER_LINE 每行一笔商品明细。一个订单有五条明细。将两张表连接后，订单金额会在结果集中重复五次。此时对订单金额执行 SUM，得到的不是订单收入，而是被明细行数放大的数值。

Semantic View 可以声明逻辑表主键和关系路径，帮助生成正确的 Join；它不会替物理数据去重，也不会证明你声明的主键真的唯一。建模前应先验证业务键、行粒度、关系基数和空值情况。否则，语义定义只是把错误假设固定下来。

另一个常见问题是指标可加性。订单金额通常可以跨订单、客户和日期汇总；期末库存或账户余额是某个时点的状态，不能把每天的余额直接相加。对于快照指标，模型需要明确时间口径和允许的聚合方式，而不是只给字段起一个好懂的名字。

## 用一份小模型看清关系怎样声明

下面的例子将订单和客户映射为逻辑表。这里假设 FACT_ORDER.ORDER_ID 与 DIM_CUSTOMER.CUSTOMER_ID 已经通过数据质量检查；CUSTOMER_ID 在订单表中是引用键，在客户表中唯一。

~~~sql
CREATE OR REPLACE SEMANTIC VIEW ANALYTICS.SALES_MODEL
  TABLES (
    orders AS MART.FACT_ORDER
      PRIMARY KEY (ORDER_ID)
      COMMENT = 'One row per order',
    customers AS MART.DIM_CUSTOMER
      PRIMARY KEY (CUSTOMER_ID)
      COMMENT = 'One row per customer'
  )
  RELATIONSHIPS (
    orders_to_customers AS
      orders (CUSTOMER_ID) REFERENCES customers (CUSTOMER_ID)
  )
  FACTS (
    orders.order_amount AS AMOUNT
  )
  DIMENSIONS (
    orders.order_date AS ORDER_DATE,
    customers.customer_name AS CUSTOMER_NAME
  )
  METRICS (
    orders.total_revenue AS SUM(orders.order_amount)
  );
~~~

这个模型只定义了订单金额的聚合，并没有回答收入到底按下单、付款还是退款后统计。若三个部门的口径不同，应定义不同 Metric，或在指标定义中明确过滤条件，再由业务 owner 确认。不要创建一个名称含糊的 total_revenue，期待模型自己推断业务含义。

模型之间还可能存在多条合法关系路径。例如航班既有出发机场，也有到达机场。若都连接同一张机场维表，查询“按城市统计航班数”就必须说明使用哪条关系；否则系统无法猜出业务要的是出发还是到达。此时可以为指标显式绑定关系路径，而不是把路径选择留给自然语言问题。

## 用 Verified Queries 验证模型，而不是只验证 DDL

DDL 执行成功，只能说明语义对象创建成功。它不证明指标口径、关系路径和自然语言查询都正确。

为日常高频问题建立一组 Verified Queries：每条记录包含业务问题和已经人工核验的 SQL。注意 SQL 应使用语义模型中的逻辑表和逻辑列名称，而不是直接引用底层物理表。它们一方面为相似问题提供已确认的查询范例，另一方面可以作为评测的 Ground Truth。

评测时不要只挑最简单的“总金额”查询。应覆盖不同维度组合、日期范围、空值、退款、重复键、多个关系路径，以及容易发生 Join fanout 的场景。对于生成的 SQL，需要比较实际结果和预期结果；SQL 能运行、字段名称正确，都不足以证明业务答案正确。

Verified Query 也不是一次录入后永久不变。业务口径、物理表和关系发生变化时，应重新验证对应查询。Snowflake 的建议机制可以从真实使用中发现可能有用的指标、过滤条件或 Verified Query，但这些建议仍需人工审核，不能直接自动加入生产模型。

## 谁来维护，什么时候值得做

语义层有持续维护成本。每个关键指标至少要有业务 owner、明确的公式、过滤条件、时间口径和验收查询；每条关系都要有数据模型 owner 确认主外键和基数。模型升级还应记录兼容性影响，避免 BI 和 Agent 在同一天得到不同定义。

如果只有一张报表、指标口径尚未谈拢，或者底层事实表的粒度仍在变化，先解决数据模型与业务定义更划算。只有当多个消费者反复复制同一套实体关系和指标，而且有人负责维护定义与测试时，Semantic View 才会持续减少重复劳动。

## 常见误判

- 把 Semantic View 当作字段注释集合。它还需要逻辑表、关系和指标定义。
- 声明 Primary Key 就认为底层数据自动唯一。物理数据仍需独立检查。
- 用订单明细连接订单后直接 SUM 订单金额，忽略 Join fanout。
- 把下单收入、已付款收入和扣退款后收入强行合并成一个指标。
- 把期末库存或账户余额当作可跨时间求和的普通金额。
- 认为 Cortex Agent 使用 Semantic View 就能保证答案正确；生成结果仍需 Verified Query 评测和权限检查。

## 自测

1. 一笔订单连接五条商品明细后，为什么 SUM(订单金额) 可能放大？语义层能否替代底层去重？
2. “已下单收入”“已付款收入”和“扣退款后收入”应该强行合并成一个 Metric 吗？需要先确认哪些业务规则？
3. 期末库存为什么不能简单按月份求和？模型应说明什么聚合边界？
4. 两张逻辑表之间存在出发机场和到达机场两条关系，怎样避免查询选择错误的路径？
5. Verified Query 中的 SQL 为什么应使用逻辑表和逻辑列，而不是底层物理字段？

## 参考资料

- [Semantic Views overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Creating and managing semantic views with SQL](https://docs.snowflake.com/en/user-guide/views-semantic/sql)
- [Semantic View YAML specification](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)
- [Cortex Analyst Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
- [Best practices for modeling semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-modeling)
