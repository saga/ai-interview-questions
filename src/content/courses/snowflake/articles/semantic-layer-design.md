# Snowflake 语义层与统一业务指标

## 本节要解决的问题

把业务实体、指标、维度和关系从重复散落的 SQL 中提取成可管理、可复用、可授权的语义定义。语义层应表达已经确认的业务口径，而不是代替事实表建模，也不是仅为字段增加自然语言描述。

## 核心知识

### Semantic View 是 Snowflake 的 Schema 级语义对象

Semantic View 将业务概念存储在数据库中。一个 Semantic View 包含逻辑表、逻辑表之间的关系，以及 Facts、Dimensions 和 Metrics 等概念。它可通过 SQL DDL、YAML 或 Snowsight Semantic Studio 创建，也可以供 Cortex Agents 和 BI 使用。

逻辑表通常对应客户、订单、产品等业务实体；关系定义这些逻辑表如何通过共享键连接。Fact 描述行级业务属性，Metric 将事实或列聚合成 KPI，Dimension 提供筛选、分组和分析上下文。

### 语义关系和指标必须符合物理数据粒度

Semantic View 可以集中定义指标，减少报表和 AI 生成 SQL 时的口径漂移，但不能修复底层事实表重复键、关系多对多或粒度不一致。建立语义模型之前，先验证逻辑表唯一键和连接基数，再把关系写进语义定义。

指标还需要说明可加性。例如营收可按订单、客户和日期进行聚合；账户余额或期末库存通常不能直接跨时间累加。非可加维度与多条关系路径需要在定义中明确，否则生成的 SQL 可能语法正确而业务含义错误。

### 语义定义需要版本、测试和权限治理

Semantic View 是数据库对象，可以按常规对象权限管理，并可在 Listing 等数据共享产品中使用。定义应纳入 Git，包含对象依赖、指标表达式、关系和同义词。语义模型发布前应通过 Golden Queries 检查指标结果、关系路径和过滤逻辑。

Snowflake 的 Semantic View 支持派生指标和逻辑表关系；如果两个逻辑表之间存在多条关系路径，需要显式指定要使用的关系路径。不要完全依赖自动推断来解释业务中有歧义的关系。

## 工程实施步骤

1. 从业务术语中整理实体、指标、维度、粒度、关系、同义词和指标 owner，先解决定义分歧。
2. 将每个逻辑表映射到物理表或视图，验证其唯一键、行粒度和可用字段。
3. 定义逻辑表间关系，明确 Join Key、基数和可能存在的多条关系路径。
4. 将 Facts、Dimensions 和 Metrics 分开建模；指标公式要说明聚合函数、过滤条件、时间口径和非可加维度。
5. 用 SQL DDL 或 YAML 将 Semantic View 定义纳入版本控制；对于复杂模型，可在 Semantic Studio 迭代，再把稳定定义纳入发布流程。
6. 为每个关键指标建立 Golden Queries，覆盖常见筛选、维度组合、时间窗口、空值和多关系路径。
7. 使用实际查询结果与经业务确认的报表/数据集市对账，特别检查 Join fanout、重复计数和非可加指标。
8. 为 BI、分析师和 Cortex Agent 配置最小权限；验证不同角色只能查询授权对象。
9. 发布后监控语义模型变更、消费 SQL、查询失败和业务指标差异，并在模型升级时保留兼容策略。

示例结构：

~~~sql
CREATE OR REPLACE SEMANTIC VIEW ANALYTICS.SALES_MODEL
  TABLES (
    orders AS MART.FACT_ORDER
      PRIMARY KEY (ORDER_ID)
  )
  FACTS (
    orders.order_amount AS ORDER_TOTAL
  )
  DIMENSIONS (
    orders.order_date AS ORDER_DATE,
    orders.customer_id AS CUSTOMER_ID
  )
  METRICS (
    orders.total_revenue AS SUM(orders.order_amount)
  );
~~~

完整 DDL 还需要按实际关系、主键、维度表达式和对象权限补齐；发布前应在目标 Snowflake 版本中运行语法和业务结果测试。

## 场景分析

财务、销售和客服各自维护一条“收入” SQL。财务按已付款订单统计，销售按已下单订单统计，客服则排除了退款订单。三份报表都叫“收入”，但过滤条件并不相同。

不能仅创建一个 total_revenue 指标就认定问题解决。先与业务 owner 确认指标是否应拆成 Booked Revenue、Paid Revenue 和 Net Revenue，再定义过滤条件、退款口径和时间维度。接着把订单逻辑表与客户、日期维度建立关系，用 Golden Queries 检查常见组合，最后将语义模型发布给 BI 和 Cortex Agent 使用。

验收时让三个角色分别查询并对账，确认访问权限、指标差异和名称描述符合预期。AI 生成的 SQL 也必须通过这些指标定义和结果校验，不能只凭自然语言答案看起来合理就上线。

## 常见误区

- 把 Semantic View 当成普通视图的别名。它包含逻辑表、关系、Facts、Dimensions 和 Metrics 等语义模型。
- 只为字段增加描述就叫语义层。没有明确关系和指标公式，无法解决口径不一致。
- 把语义模型当作物理数据建模替代品。错误粒度、重复键和 Join fanout 仍需在物理模型修正。
- 将多个口径相近的指标强行合并。应保留业务定义差异并明确名称、过滤条件和 owner。
- 依赖模型自动选择所有关系路径。多关系路径和非可加指标必须经业务验证。
- 认为 Cortex Agent 使用 Semantic View 就能保证所有答案正确。仍需通过 Golden Queries、权限和结果对账验证。

## 完成标准

- [ ] 能解释 Semantic View、逻辑表、Facts、Dimensions 和 Metrics。
- [ ] 能将物理表和业务实体映射到逻辑表与关系。
- [ ] 能识别 Join fanout 与非可加指标风险。
- [ ] 能用 Golden Queries 验证指标口径和关系路径。
- [ ] 能设计语义定义的版本控制、授权和发布流程。

## 自测

1. Semantic View 中的 Metric 与 Fact 有什么区别？为什么不能把一个 SUM 指标简单当作行级事实？
2. 两个逻辑表之间存在两条 Join 路径，应该如何避免生成 SQL 选错关系？
3. 指标定义正确但物理表存在重复业务键，语义层是否能自动修复结果？
4. 同名“收入”在三个部门口径不同，应该如何在语义层表达而不是强行统一？

## 参考资料

- [Overview of semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Creating semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/creating)
- [Using SQL commands to create and manage semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/sql)
- [YAML specification for semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)
