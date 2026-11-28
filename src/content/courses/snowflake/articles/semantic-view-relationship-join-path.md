# Semantic View 关系路径、Join 基数与指标粒度

## 本节要解决的问题

销售负责人问：“上季度每个地区的客户收入是多少？”结果里，订单金额比财务结账数字高了近一倍。检查 SQL 后发现，订单同时连接了客户地址历史表和订单明细表：一个客户有多个地址版本，一张订单又有多条商品行。两个一对多关系叠在一起，订单金额被重复计算。

Semantic View 能把逻辑表、关系、Fact、Dimension 和 Metric 放在同一个业务模型中，但它不是自动修复数据模型的工具。关系键不唯一、历史版本没有时间边界、指标粒度没有定义，都会把自然语言问题变成不确定的 Join 路径。

## 核心知识

### 关系先回答“谁引用谁”，而不是先画一条线

假设分析模型包含三张逻辑表：

| 逻辑表 | 一行代表什么 | 主键或唯一键 | 外键 |
|---|---|---|---|
| customers | 一个客户 | customer_id | — |
| orders | 一笔订单 | order_id | customer_id |
| order_lines | 一笔订单中的一条商品行 | order_id + line_no | order_id |

关系可以表达成：

~~~yaml
relationships:
  - name: orders_to_customers
    left_table: orders
    right_table: customers
    relationship_columns:
      - left_column: customer_id
        right_column: customer_id
  - name: lines_to_orders
    left_table: order_lines
    right_table: orders
    relationship_columns:
      - left_column: order_id
        right_column: order_id
~~~

这里的 left_table 是包含外键的一侧，right_table 是被引用的一侧。orders.customer_id 应匹配 customers.customer_id；如果客户表的 customer_id 并不唯一，关系定义本身就失去了预期的基数。

Semantic View 会依据关系键与主键定义推断关系类型，不要求像旧 Semantic Model 一样在每个关系上手动指定 join_type 或 relationship_type。这个推断有前提：模型声明的键要和真实数据一致。标准表上的 PRIMARY KEY / UNIQUE 可能只是元数据，不会替你保证数据唯一。

### 一个指标只能有一个清楚的计算粒度

订单总额属于订单粒度，商品销售额属于订单明细粒度。两者可以在同一个 Semantic View 中出现，但不能在任意 Join 后混着 SUM。

以订单表为例：

~~~sql
CREATE OR REPLACE SEMANTIC VIEW sales_model
  TABLES (
    customers PRIMARY KEY (customer_id),
    orders PRIMARY KEY (order_id),
    order_lines PRIMARY KEY (order_id, line_no)
  )
  RELATIONSHIPS (
    orders (customer_id) REFERENCES customers,
    order_lines (order_id) REFERENCES orders
  )
  FACTS (
    orders.order_amount AS order_total,
    order_lines.line_amount AS line_amount
  )
  DIMENSIONS (
    customers.region AS region,
    orders.order_date AS order_date
  )
  METRICS (
    orders.order_revenue AS SUM(orders.order_amount),
    order_lines.product_revenue AS SUM(order_lines.line_amount),
    orders.order_count AS COUNT(orders.order_id)
  );
~~~

这个模型表达了两种不同度量：订单收入按订单表计算，商品收入按明细表计算。它们都可以按地区或日期分析，但在连接路径上需要保持度量的原始粒度。建模之前应先用真实样本确认订单金额没有被明细行复制、客户地区只有一个有效匹配。

### 多条关系路径意味着业务含义可能不同

机场航班数据是一个直观例子：同一张 flights 表有 departure_airport 和 arrival_airport 两个机场键。它们都连接 airports，但问题“从哪个城市起飞”和“到哪个城市降落”是两件事。

~~~sql
RELATIONSHIPS (
  flight_departure_airport AS flights (departure_airport)
    REFERENCES airports (airport_code),
  flight_arrival_airport AS flights (arrival_airport)
    REFERENCES airports (airport_code)
)
~~~

如果一个 Metric 可能通过多条关系路径连接到同一张逻辑表，需要明确 Metric 使用哪条路径。不能依赖模型或查询生成器猜测“机场”指起点还是终点。语义模型中的关系名称应该表达业务方向，指标描述中也应写清口径。

### 历史维度需要按事实发生时间匹配

客户地址会随时间变化。财务希望按订单发生时的地址统计收入，而运营希望按客户当前地址看客户分布。两者不是同一个问题。

对地址历史表，可以按客户键和有效开始日期建立时间关系。Semantic View 支持 ASOF 关系，用“截至订单日期最近生效的地址版本”匹配订单，而不只是按 customer_id 连接。

建模前先验证同一客户的有效期是否重叠、是否存在空洞、订单日期能否匹配到唯一版本。若时间区间有重叠，ASOF 只会按规则选出一条记录，并不能替业务决定哪条地址才正确。

## 工程实施步骤

1. 从业务问题列出实体、事实表、粒度和指标口径；先确认订单、支付、明细和历史维度各自的一行代表什么。
2. 检查每个关系键的唯一性、NULL 数量和未匹配行；对标准表不能把 PRIMARY KEY 元数据当作唯一性证明。
3. 定义逻辑表、主键和关系列；关系方向从外键所在表指向被引用表。
4. 对同一目标表存在多个关系路径的情况，为指标选择业务含义明确的路径，并用不同方向的测试问题验证。
5. 将 Facts、Dimensions 和 Metrics 分开定义。Fact 保存行级业务值；Metric 定义跨行计算，不用一个模糊的 revenue 代替 booked revenue、paid revenue 和 refunded amount。
6. 为历史属性建立时间匹配测试，验证有效区间、迟到修订和未匹配订单。
7. 建立 Golden Questions：覆盖地区、日期、无订单客户、多笔明细、多个历史地址和退款等情况。
8. 将查询结果与交易系统或已批准报表对账，再把关系和 Metric 纳入语义模型版本管理。

## 场景分析

财务按订单发生时的地区计算收入；销售按客户当前地区查看销售分布。客户 C01 去年在东京，今年搬到大阪，订单表有三笔订单，其中一笔发生在搬家前。

如果只建立 customers 与 orders 的普通等值关系，再把地址字段作为 Dimension，历史订单可能全部落到当前地址。若再连接 order_lines，订单收入还有可能按商品行重复。

先把两个业务问题拆开：

- 财务指标：订单日期匹配地址有效期，订单收入仍按订单粒度汇总。
- 销售视图：客户当前地址用于客户分布，不回写历史订单的发生地。

用三笔订单的日期和两段地址有效期造一份小样本，手工算出预期地区金额，再比较 Semantic View 返回结果。只有两个口径都能对账，关系路径和 Metric 才算可用。

## 常见误区

- **把关系定义当成数据质量约束。** Semantic View 的关系表达逻辑连接；真实数据是否唯一、完整仍需要独立测试。
- **只声明一个 revenue Metric。** 订单收入、商品收入、实收金额和退款金额的粒度与过滤条件可能不同，应分别命名。
- **多条关系路径不做区分。** 例如 departure airport 和 arrival airport 都连机场表，指标必须说明使用哪一条。
- **历史维度只按自然键 Join。** 还要用事实日期匹配有效版本，并处理区间重叠和未匹配记录。
- **用 Semantic View 修复物理表 fanout。** 物理数据的 grain、唯一键和关系先要正确，语义层才能稳定复用。

## 完成标准

- [ ] 能指出每个关系的外键侧、被引用侧和连接列。
- [ ] 能解释 Semantic View 如何根据主键定义推断关系。
- [ ] 能区分订单粒度和明细粒度的指标。
- [ ] 能为多条关系路径定义不同的业务含义。
- [ ] 能说明历史维度为什么需要时间匹配。
- [ ] 能用 Golden Questions 对关系和 Metric 做结果对账。

## 自测

1. orders 每行一笔订单，order_lines 每行一个商品行。要同时报告订单收入和商品收入，为什么不能先连接两张表再对两个金额列都做 SUM？
2. 航班表有 departure_airport 和 arrival_airport 两列。若只定义一个 flights-to-airports 关系，查询“起飞城市”时会缺少什么信息？
3. 客户地址历史有两个重叠的有效区间。ASOF 关系是否能代替数据质量处理？还要检查什么？
4. 一个 Standard Table 声明了 customer_id 为 PRIMARY KEY，但真实数据中存在重复值。Semantic View 的关系推断会面临什么风险？

## 参考资料

- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [YAML specification for semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)
- [Best practices for modeling semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-modeling)
- [Using SQL commands to create and manage semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/sql)
