# Semantic View 基础组成

## 本节要解决的问题

理解 Snowflake Semantic View 如何把物理表组织成可查询的业务模型，让 BI、Cortex Analyst 和其他消费者使用统一的实体、关系、维度和指标。Semantic View 不是普通 View 的改名，也不是自由文本提示集合；它有明确的逻辑对象结构。

## 核心知识

### Logical Tables 映射物理表，并声明主键和粒度

Semantic View 的 TABLES 部分定义逻辑表名称及其来源表/视图，可以声明 PRIMARY KEY、同义词和注释。Logical Table 的粒度由来源表决定；声明主键是帮助语义查询理解实体身份的重要依据，但不会替代物理表的唯一性测试。

多个来源表映射成逻辑表时，应先确认每张表的一行代表什么、主键是否唯一、数据是否存在重复或历史版本。

### Relationships 描述逻辑表之间的连接关系

RELATIONSHIPS 定义逻辑表如何通过外键列引用其它逻辑表。关系声明帮助语义查询生成正确 Join，但前提是底层数据满足声明的基数和业务关系。若一个订单关联多个订单明细，订单头和明细的度量不能未经处理就直接混合聚合。

当多个逻辑表之间存在多条路径时，必须检查模型能否无歧义地选择关系。不要只依赖字段名称相似或自然语言描述推断连接。

### Facts、Dimensions 与 Metrics 承担不同职责

- Fact 描述逻辑表中的行级业务值，例如订单金额、数量或成本。
- Dimension 描述分析切片和过滤字段，例如日期、地区、客户类别。
- Metric 定义聚合或派生指标，例如净收入、订单数和平均订单金额。

Metric 不只是字段别名；它可能包含 SUM、COUNT、过滤条件或跨逻辑表计算。必须明确粒度、过滤、时间口径和可加性。对于余额、期末库存等快照指标，不应简单跨时间 SUM。

## 工程实施步骤

1. 选择一个有清晰业务范围的主题域，确认要支持的消费者问题和指标列表。
2. 为每个来源表写明行粒度、主键和关键关系，先执行重复键和 NULL 检查。
3. 创建 Semantic View，按业务实体命名 TABLES，映射到真实物理表或视图。
4. 为每张 Logical Table 声明正确 PRIMARY KEY，添加便于消费者理解的 COMMENT 和 SYNONYMS。
5. 使用 RELATIONSHIPS 声明外键到被引用 Logical Table 的连接关系，并验证关系方向和基数。
6. 将行级数值定义为 Facts，将筛选/分组字段定义为 Dimensions，将聚合公式定义为 Metrics。
7. 对多关系路径、非可加指标和复杂过滤条件做显式设计，不让消费者通过猜测拼接 Join。
8. 使用 DESC SEMANTIC VIEW 检查逻辑表、关系、Fact、Dimension、Metric 和 Verified Query 定义。
9. 编写 Golden Queries，覆盖常用问题、日期边界、NULL、退款、多表连接和过滤组合。
10. 将 Semantic View DDL 纳入 Git 与 CI；发布时验证权限、查询结果、业务口径和消费者兼容性。

示例：一个简单的订单与客户语义模型。

~~~sql
CREATE SEMANTIC VIEW ANALYTICS.SALES.SALES_MODEL
  TABLES (
    orders AS MART.FACT_ORDER
      PRIMARY KEY (ORDER_ID)
      COMMENT = 'Order-level facts',
    customers AS MART.DIM_CUSTOMER
      PRIMARY KEY (CUSTOMER_ID)
      COMMENT = 'Customer dimension'
  )
  RELATIONSHIPS (
    orders_to_customers AS
      orders (CUSTOMER_ID) REFERENCES customers
  )
  FACTS (
    orders.order_amount AS ORDER_TOTAL
  )
  DIMENSIONS (
    orders.order_date AS ORDER_DATE,
    customers.customer_segment AS CUSTOMER_SEGMENT
  )
  METRICS (
    orders.total_revenue AS SUM(orders.order_amount),
    orders.order_count AS COUNT(DISTINCT orders.ORDER_ID)
  );
~~~

示例只表达一个客户到订单的关系。实际 DDL 应按目标 Snowflake 版本支持的表达式语法验证，并确认 ORDER_ID 与 CUSTOMER_ID 在物理模型中的唯一性。

## 场景分析

销售分析师希望用自然语言询问“各地区本季度收入”，但当前物理表有订单头、订单明细和客户维度。不同报表直接写 SQL，订单金额被重复计算。

建立 Semantic View 之前先确定订单头粒度和明细粒度，验证订单表主键与客户关系；再将订单、客户和区域维度映射为 Logical Tables/Dimensions。若收入按订单头统计，就不能通过未聚合的订单明细路径重复计数。用按月份、区域、退款和订单状态的 Golden Queries 对账后，再把 Semantic View 提供给 Analyst 或 BI 消费。

## 常见误区

- **把 Semantic View 当普通 SQL View。** 它还声明逻辑表、关系、Facts、Dimensions 和 Metrics。
- **只写字段注释就认为语义建模完成。** 关系和指标公式是语义结构的重要组成部分。
- **声明 PRIMARY KEY 就认为数据唯一。** 仍需要在物理数据上测试重复键。
- **把所有数值列都定义成 Metric。** 原始数值通常先是 Fact，Metric 再表达聚合或派生口径。
- **把底层 JOIN 错误交给语义模型解决。** Semantic View 不会自动修复错误 grain 或数据重复。
- **不做 Golden Query 对账就发布。** 语义结构正确不证明业务指标结果符合预期。

## 完成标准

- [ ] 能说明 Semantic View 的 TABLES、RELATIONSHIPS、FACTS、DIMENSIONS 和 METRICS。
- [ ] 能将物理表映射成具有明确粒度的 Logical Table。
- [ ] 能为逻辑表定义主键和关系，并验证其数据前提。
- [ ] 能区分 Fact、Dimension 与 Metric。
- [ ] 能使用 DESC SEMANTIC VIEW 和 Golden Queries 验证模型。

## 自测

1. Semantic View 中的 Logical Table 与物理表之间是什么关系？声明 PRIMARY KEY 能否代替唯一性测试？
2. 两个 Logical Table 之间有一对多关系，为什么会影响 Metric 的聚合？
3. Fact 与 Metric 的职责有什么差异？订单金额字段与总收入指标分别适合放在哪里？
4. Semantic View 创建成功，但 Analyst 生成了重复累计收入，应该先检查哪个物理模型边界？
5. 为什么需要用 Golden Queries 而不只是 DESC SEMANTIC VIEW 验证业务模型？

## 参考资料

- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [CREATE SEMANTIC VIEW](https://docs.snowflake.com/en/sql-reference/sql/create-semantic-view)
- [DESCRIBE SEMANTIC VIEW](https://docs.snowflake.com/en/sql-reference/sql/desc-semantic-view)
- [Creating semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/creating)
