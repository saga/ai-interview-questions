# Cortex Analyst 与 Semantic View 语义建模

## 本节要解决的问题

销售负责人问：“过去 30 天，各地区已付款订单的净销售额是多少？和前 30 天相比变化了多少？”

仓库中有订单头、订单行、折扣、退款和地区维度。直接让 LLM 根据表名生成 SQL，可能重复计算订单头金额、把退款发生日当订单日，或将取消订单计入销售额。Cortex Analyst 能根据语义模型理解业务名称并生成 SQL，但答案准确性依赖 Semantic View 对粒度、关系、指标和过滤条件的定义。

Semantic View 不是一张替代事实表的物理表，也不是自动修复错误 Join 的工具。它向自然语言查询提供经过治理的业务语义。

## 核心知识

### 先确定每张逻辑表的一行代表什么

以销售分析为例，至少需要区分：

| Logical Table | 一行代表什么 | 主键/实体 |
|---|---|---|
| ORDER_HEADER | 一笔订单 | ORDER_ID |
| ORDER_LINE | 订单中的一个商品行 | ORDER_ID + LINE_ID |
| REFUND | 一笔退款事件 | REFUND_ID |
| CUSTOMER | 一个客户当前维度记录 | CUSTOMER_ID |
| REGION | 一个地区 | REGION_ID |

如果 ORDER_HEADER 的 ORDER_AMOUNT 被连接到 ORDER_LINE，订单有 3 个商品行时，订单金额会被重复 3 次。净销售额必须先明确计算粒度，再决定是按订单头、订单行还是退款事件组合计算。

对 SCD Type 2 客户维度，不能只按 CUSTOMER_ID 做 Join。需要按订单发生日匹配有效版本，或者将当前维度和历史维度拆成不同的逻辑对象，避免一条事实连到多个客户版本。

### Semantic View 由 Logical Tables、Relationships、Dimensions、Facts 和 Metrics 组成

建模时要把物理表的结构映射成业务语义：

- **Logical Table**：代表一个可分析的数据集合，声明主键/实体和列。
- **Relationship**：说明逻辑表之间如何连接，以及关系基数。
- **Dimension**：用于分组、过滤和细分的属性，例如地区、渠道、订单日期。
- **Fact**：具有业务含义的数值或属性，例如订单金额、折扣金额、退款金额。
- **Metric**：定义业务指标，例如净销售额、订单数、退款率。

一个指标不能只叫 NET_SALES。它还应解释：
- 是否只包括已付款订单；
- 取消、退款和冲正如何处理；
- 订单日期还是收入确认日期作为时间口径；
- 金额使用哪个币种；
- 多币种是否需要汇率换算；
- 一个订单多行时如何避免重复计算。

这些定义应与财务/业务负责人确认，并在 Semantic View 描述、Metric 说明和相关测试中保持一致。名称和注释要使用分析师真实会说的词和常见同义词，不要将物理列名直接暴露给自然语言查询。

### Relationship 的 Join 键和基数决定数字是否会被放大

关系定义要说明一对一、一对多或多对多。对于订单头到订单行，一笔订单可以有多行；对于订单到退款，一笔订单可能有多笔退款。若同时连接订单行和退款事件，可能发生乘法扩行。

例如一笔订单有 3 行商品、2 笔退款，直接把三张表连接后可能得到 6 行。SUM(order_header.order_amount) 会被重复 6 次。解决方法不是简单在最终 SQL 加 DISTINCT，而是先将订单行与退款按订单粒度分别汇总，再按订单键关联；或者在语义模型中明确可用的关系路径与指标计算粒度。

对多对多关系要明确桥接表、分摊规则和过滤方向。若基数无法确认，不应把 Relationship 发布给 Analyst 使用。

### 使用 Semantic View 时，Metric 要明确事实粒度和过滤口径

以净销售额为例，假设 ORDER_LINE 已经保存每行商品净额，REFUND_SUMMARY 已经按订单和业务日期聚合。Semantic View 中可以将 NET_SALES 定义为订单行净额减去在同一口径下分配的退款金额。具体实现取决于退款应按订单日还是退款日计量。

用户问题“过去 30 天”也存在口径歧义：
- 最近 30 个完整自然日；
- 包含今天的滚动 30×24 小时；
- 最近 30 个已结算业务日。

在 Metric 和维度说明中应写清默认时间语义；不能让 LLM 自行猜测。对财务报表，应要求用户明确业务日期或使用已批准的日期维度。

### Verified Queries 为常见问题提供可信 SQL 参考

Verified Query 是经过人工确认的自然语言问题与 SQL 示例，可以帮助 Cortex Analyst 理解某类业务问题在当前 Semantic View 下应如何查询。它们适合覆盖高频和高风险问题，例如：
- 已付款净销售额；
- 按地区/渠道分组的订单数；
- 退款率；
- 月度环比；
- Top N 产品。

Verified Query 不是给所有可能问题提供答案，也不能代替 Semantic View 的基础建模。若模型关系、Metric 定义或数据粒度错误，保存一条正确 SQL 不会自动修复其他问题。

应优先为经过业务确认的 Golden Queries 建立 Verified Query，并固定使用的数据日期、过滤条件和预期结果。每次调整 Semantic View 的关系、字段或指标时，要重新运行这些查询，确保之前的语义没有被破坏。

### Cortex Analyst 返回的是 SQL 及执行结果，必须检查查询证据

Cortex Analyst 根据自然语言问题、Semantic View 和已验证示例生成查询。应用可以展示解释、SQL 和执行结果，也应保存查询 ID 与使用的语义模型版本。

对于上面的 30 天净销售额问题，检查生成 SQL 时至少确认：
1. 是否过滤了正确的订单状态；
2. 是否使用明确的业务日期窗口；
3. 是否按地区分组；
4. 订单头金额是否因 Join 到订单行而重复；
5. 退款是按订单日期还是退款日期计入；
6. 多币种是否使用正确汇率；
7. 返回的总额是否与独立 SQL/财务控制总额一致。

不能只因为 SQL 能执行就显示答案。若生成的 SQL 使用了不被允许的 Join 路径、日期或 Metric，应停止展示为正式业务结论，并记录问题用于修正语义模型。

### 评估要分别检查 SQL 正确性、回答正确性和语义覆盖

Semantic Analyst 的评测集应该包含真实用户问题、Golden SQL、预期结果和边界说明。测试不仅覆盖“简单按维度分组”，还要包含：
- 订单头/订单行粒度冲突；
- 一对多和多对多 Join；
- 多币种和汇率日期；
- 退款与冲正时间口径；
- NULL、未知类别和未分类客户；
- 时间表达式和 Top N；
- 同义词、缩写与口语问题。

SQL 执行成功不等于结果正确。应将生成 SQL 与 Golden SQL 的业务语义对照，并对关键数字使用固定样本快照做数值对账。对自然语言回答还要检查是否说明了估值/统计日期、币种和过滤条件。

## 工程实施步骤

1. 选定一个具体分析域，先画出事实与维度的一行粒度、业务键和历史有效时间。
2. 验证源表主键、重复记录、SCD2 有效期和多对多桥接关系。
3. 创建 Semantic View Logical Tables，明确每张表的 Entity/主键与可暴露字段。
4. 定义 Relationship 的 Join 键和基数，禁止不清楚或会产生不可控 Fanout 的路径。
5. 定义 Dimension、Fact 和 Metric；在描述中写明过滤、时间、币种、NULL 和聚合语义。
6. 使用业务术语、同义词和示例值改善自然语言映射，但不要堆砌与业务无关的关键词。
7. 与业务 owner 确认常见问题，为其建立 Verified Queries 和固定结果样本。
8. 使用真实 Cortex Analyst Role 验证 Semantic View USAGE、数据库角色和 Warehouse 权限。
9. 用 Golden Queries 检查生成 SQL、Query ID、Join 基数和业务控制总额。
10. Semantic View 变更后运行回归集，比较 SQL、结果值和查询计划；不通过时回退语义变更。
11. 将 Semantic View 版本、Verified Query、评测集、Query ID 和结果快照纳入发布记录。

## 场景分析

销售负责人问：“过去 30 天，日本地区的已付款净销售额是多少？”

Semantic View 定义：
- ORDER_LINE 的粒度为订单行；
- ORDER_HEADER 的粒度为订单；
- REFUND_SUMMARY 已按订单和退款业务日期聚合；
- REGION 是客户在订单发生日的有效地区；
- NET_SALES 采用收入确认日期，并按 USD 汇率换算。

Cortex Analyst 生成 SQL 后，审核发现它将 ORDER_HEADER 直接 Join 到 ORDER_LINE，再按地区 SUM(ORDER_AMOUNT)。一笔有 4 行商品的订单会重复 4 次订单头金额。正确处理是使用订单行净额指标，或先将订单行汇总到订单粒度后再与订单头和退款汇总关联。

如果用户没有说明“过去 30 天”是否包含今天，且该指标用于正式财务报告，应用应要求选择业务日期范围或使用已批准的报告周期，不应默默选择一个口径。最终回答应显示业务日期、币种、订单状态和语义模型版本。

## 常见误区

- **把 Semantic View 当成表结构的别名。** 它要定义业务粒度、关系和可解释指标。
- **只定义 Metric 名称，不说明计算口径。** Analyst 可能把相同名字映射到错误的事实列或聚合。
- **将多对多关系直接暴露给 Analyst。** 连接可能放大金额或计数，需建桥接或预先聚合。
- **认为 Verified Query 能修复所有语义错误。** 它只为部分问题提供参考，基础模型仍然决定 SQL 正确性。
- **SQL 能执行就当答案正确。** 还需对照 Golden SQL、固定日期样本和业务控制总额。
- **把过去 30 天当成无歧义时间条件。** 应明确自然日、滚动时段和业务日口径。
- **让自然语言问题决定高影响筛选或权限。** 访问权限应由 Snowflake Role/Policy 保证，而不是依赖用户提示。
- **只更新 Semantic View，不跑回归问题集。** 关系、字段和 Metric 变化可能改变已有问题的生成 SQL。

## 完成标准

- [ ] 能说明 Logical Table、Relationship、Dimension、Fact 和 Metric 的职责。
- [ ] 能为每张逻辑表定义粒度、主键和有效时间。
- [ ] 能识别 Join Fanout 并设计适当的预聚合/桥接。
- [ ] 能定义含时间、状态、币种和 NULL 规则的 Metric。
- [ ] 能解释 Verified Query 的价值和覆盖边界。
- [ ] 能用 Golden Query、SQL、Query ID 和数值对账验证 Cortex Analyst 输出。
- [ ] 能区分语义正确性、查询执行成功和用户最终回答正确。

## 自测

1. 一张订单头表和订单行表 Join 后，订单头金额重复 4 次。Semantic View 中应先检查什么？为什么不能用最终 DISTINCT 掩盖问题？
2. 一个退款订单有两笔退款记录，订单行有三行商品。直接连接后可能产生多少行？需要怎样设计退款汇总粒度？
3. Verified Query 已经包含一个正确 SQL，但 Analyst 仍为其他问题生成重复金额的 SQL。应该先修正哪一层？
4. “过去 30 天”有哪几种可能口径？正式财务报告应怎样确定？
5. Semantic View 更改 Relationship 后，为什么需要重新运行此前的 Golden Queries？

## 参考资料

- [Cortex Analyst overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst)
- [Create and use Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic)
- [Verified queries](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/verified-queries)
- [Cortex Analyst REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api)
