# 事实粒度、维度建模与连接基数

## 本节要解决的问题

设计分析模型时先定义事实表的 grain，再决定维度、度量和连接关系。建模的首要目标是让“一行代表什么”和“一个指标如何计算”可被业务人员与 SQL 使用者共同理解，避免多事实表连接时出现 fanout、重复累计和时间口径不一致。

## 核心知识

### Grain 是事实表设计的起点

Grain 描述事实表的一行代表的最小业务事件或状态。例如订单头事实表每行是一笔订单；订单明细事实表每行是一笔订单中的一个商品行；支付事实表每行是一笔支付尝试。三者可能共享 ORDER_ID，但粒度不同，不能未经聚合就互相连接后直接求和。

在建表之前应写出业务定义，例如“一行代表某订单在某商品上的一次明细行”，并明确业务键、事件时间、有效时间和是否允许更正。事实表的列、主键策略和指标可加性都由 grain 推导。

### Star Schema 用事实表连接维度表描述业务上下文

事实表保存度量和维度外键；维度表描述客户、产品、日期、地区等分析上下文。常见模型包括 Fact、Dimension、Conformed Dimension 和 Role-playing Dimension。订单行、支付、库存快照是不同事实；客户、产品、门店、日期是常见维度；下单日期、发货日期和签收日期可以复用同一日期维度的不同角色。

维度键通常比自然键稳定。需要追踪维度属性变化时，使用 Slowly Changing Dimension：Type 1 覆盖旧值；Type 2 新增版本并保留有效起止时间和当前标记。选择哪种方式取决于历史报表是否需要还原当时属性。

### 多事实表连接会发生 fanout

订单头与订单明细是一对多。若订单头金额被直接连接到明细表，订单头金额就会按明细行重复。两个事实表如果分别连接到相同维度，也不能简单地只按公共维度键连接后汇总，因为粒度不同可能产生多对多膨胀。

处理方法包括：先将各事实表聚合到共同分析粒度，再 Join；使用明确的桥接表表达多对多关系；对非可加度量使用正确的聚合规则；在语义层中声明正确关系和指标定义。SUM(DISTINCT amount) 不是通用修复，因为两个真实业务事件可能恰好具有相同金额。

## 工程实施步骤

1. 为每个事实表写明 grain、自然业务键、技术代理键、事件时间和允许的重复/更正行为。
2. 确认每个维度的粒度、唯一性和有效时间；为 Type 2 维度增加版本键、有效起止时间和当前记录标志。
3. 绘制事实与维度的基数关系，标明 1:1、1:N 和 N:M，特别标记桥接关系与多角色维度。
4. 按指标定义标记可加、半可加和不可加度量；余额、库存快照等不能在时间维度上简单求和。
5. 为多事实查询先确定共同粒度，分别聚合各事实，再连接到共享维度，避免原始事实明细直接相乘。
6. 建立维度唯一性、事实外键映射、Type 2 时间不重叠、迟到事实与未知成员等数据质量测试。
7. 使用真实样本计算业务关键指标，与交易系统或已认可报表做对账；改变模型后检查历史时间点结果。
8. 在 Snowflake Semantic View 中映射逻辑表、关系、facts、dimensions 和 metrics，但先保证物理表的 grain 与 key 正确。
9. 对数据增长、SCD 规则变更和多对多业务关系建立模型版本和迁移策略。

示例：先分别聚合订单头与订单明细，再按客户维度连接。

~~~sql
WITH order_totals AS (
  SELECT CUSTOMER_ID, SUM(ORDER_TOTAL) AS ORDER_AMOUNT
  FROM MART.FACT_ORDER
  GROUP BY CUSTOMER_ID
),
line_totals AS (
  SELECT CUSTOMER_ID, SUM(LINE_AMOUNT) AS LINE_AMOUNT
  FROM MART.FACT_ORDER_LINE
  GROUP BY CUSTOMER_ID
)
SELECT
  c.CUSTOMER_NAME,
  o.ORDER_AMOUNT,
  l.LINE_AMOUNT
FROM MART.DIM_CUSTOMER c
LEFT JOIN order_totals o USING (CUSTOMER_ID)
LEFT JOIN line_totals l USING (CUSTOMER_ID);
~~~

该示例假设两个事实表可以按 CUSTOMER_ID 汇总到同一粒度；若业务要求按订单或日期分析，应把这些维度一并纳入聚合键。

## 场景分析

财务报告从订单头表读取订单总额，运营报告从订单明细表读取商品金额。两表按 ORDER_ID 直接 Join 后，财务发现订单金额比交易系统大三倍。

原因是一个订单可能有多条商品明细，订单头金额在每条明细行上重复。应先明确两个事实表粒度，再分别聚合到订单或客户/日期粒度后连接。不能把 DISTINCT 当作万能补丁，也不能将订单头度量和明细度量混合后不加区分地汇总。

验收时构造一个包含多条明细、多个支付事件和一笔退款的订单，比较模型前后订单数、订单金额、商品金额和退款金额；还要验证 Type 2 客户属性在历史时点的归属。

## 常见误区

- 没有先定义 grain 就开始建事实表。后续很难判断唯一键、度量和 Join 是否正确。
- 认为共享 ORDER_ID 就意味着两张事实表可以直接 Join。同一个业务键可能在不同表中重复出现。
- 使用 SUM(DISTINCT ...) 修复 fanout。相同金额可能属于不同事件，DISTINCT 会丢掉真实业务贡献。
- 所有度量都可以沿所有维度求和。库存余额、账户余额等是半可加或非可加度量。
- Type 1 与 Type 2 只影响存储大小。它们决定历史报表是否保留当时维度属性。
- 把语义视图当成修复物理模型的工具。逻辑模型不能替代正确的 grain、唯一键和事实关系。

## 完成标准

- [ ] 能用一句话定义事实表的一行代表什么。
- [ ] 能区分事实、维度、共享维度和角色维度。
- [ ] 能识别 1:N、N:M Join 造成的 fanout。
- [ ] 能区分可加、半可加和不可加度量。
- [ ] 能说明 SCD Type 1/Type 2 对历史分析的影响。

## 自测

1. 订单头事实表和订单明细事实表都包含 ORDER_ID，为什么不能直接连接后求订单总额？
2. 账户余额每天保存一次，为什么不能跨日期直接 SUM？
3. 客户地址变更后，财务报表需要还原历史地址，应该采用哪种 SCD 策略？
4. 为什么 SUM(DISTINCT amount) 可能让 fanout 问题看起来消失，却同时丢失合法业务数据？

## 参考资料

- [Overview of semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Creating semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/creating)
- [Snowflake SQL joins](https://docs.snowflake.com/en/user-guide/querying-joins)
