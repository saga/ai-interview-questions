# 业务语义与统一指标治理

## 本节要解决的问题

把业务指标从个人 SQL 和报表公式中提升为由业务 owner 管理的定义，确保不同团队、BI 和 AI 应用对同一指标使用一致的粒度、过滤、时间和计算口径。语义治理不只是给指标取统一名称；它需要明确指标契约、关系约束、访问范围、版本变更和验证证据。

## 核心知识

### 指标必须先定义业务口径，再选择语义对象

每个关键指标至少需要记录：业务名称、技术名称、owner、定义、分子/分母、过滤条件、事实粒度、时间口径、币种/单位、可加性、空值处理、刷新要求和敏感等级。

例如“净收入”不能只写成 SUM(amount)。还需要确定收入是下单、支付还是确认口径；退款、取消、税费、折扣和跨币种转换如何处理；按订单日期还是结算日期分组；是否允许按时间累加。名称相同但定义不同的指标应保留为不同指标，而不是强行合并。

### Semantic View 将指标定义、关系和访问边界放入模型

Snowflake Semantic View 包含 Logical Tables、Relationships、Facts、Dimensions 和 Metrics。它适合将经业务确认的实体关系和指标表达为可被 Analyst、BI 或 SQL 使用的语义对象。

Facts 描述逻辑表中的行级业务事实；Metrics 描述聚合或派生计算；Dimensions 描述筛选和分组字段。PRIVATE Fact/Metric 可用于语义视图内部计算但不作为消费者直接查询项；Dimension 不能标记为 PRIVATE。通过 REFERENCES 或 OWNERSHIP 等对象权限，语义对象还可以控制哪些角色能发现私有指标定义。

语义视图并不能弥补错误物理模型。如果底层表的 grain、主键或 Join 基数不正确，语义定义仍可能生成重复计数。必须先验证逻辑表唯一键与关系，再把指标放进 Semantic View。

### 语义治理需要 owner、访问分类与变更流程

指标 owner 负责业务含义和口径批准；数据平台 owner 负责物理映射、数据质量与刷新；消费者负责确认使用场景和兼容要求。不是每次字段改名都要业务审批，但如果过滤条件、时间口径、分母、币种或 Join 路径变化，通常会改变指标含义。

Snowflake 可通过 SEMANTIC_METRICS Information Schema View 检查语义视图内的 Metric 名称、表达式、同义词、注释和数据类型。视图只向不同角色暴露其可见范围；private metrics 只在拥有 REFERENCES 或 OWNERSHIP 的角色上下文中显示。它可以辅助盘点和审计，但不能替代业务 owner 的口径确认。

## 工程实施步骤

1. 建立指标目录，记录名称、定义、业务 owner、公式、时间口径、粒度、单位、可加性、敏感等级和使用方。
2. 将同名异义指标拆开命名；对定义相同但技术表达不同的指标建立统一标准，并明确历史兼容关系。
3. 检查事实表 grain、主键、维度唯一性和 1:N/N:M 关系，先修正物理模型和数据质量问题。
4. 在 Semantic View 中定义逻辑表、Relationships、Facts、Dimensions 和 Metrics；用 PRIVATE 控制不应直接暴露的中间事实或指标。
5. 为语义对象设置 Owner、USAGE/SELECT 等相应权限及 REFERENCES/OWNERSHIP 管理权限；按消费者角色验证能发现和查询的内容。
6. 建立 Golden Queries，覆盖常见维度、时间范围、边界条件、退款/取消、币种换算、空值和多关系路径。
7. 在 CI 或定期作业中执行语义结果对账；使用 SEMANTIC_METRICS 盘点指标表达式、同义词、注释及权限可见性。
8. 对定义变更做影响分析：识别依赖的 BI 报表、Cortex Analyst、应用和数据产品；对破坏性口径变化采用新指标版本或兼容期。
9. 让业务 owner 审批公式或含义变更，技术 owner 审批物理映射和权限变更；保存定义版本、评估结果和发布时间。
10. 发布后监控指标消费量、查询错误、与权威报表的偏差和权限拒绝，定期清理无 owner 或无消费者的指标。

示例：盘点当前数据库的 Semantic View 指标定义。

~~~sql
SELECT
  SEMANTIC_VIEW_CATALOG,
  SEMANTIC_VIEW_SCHEMA,
  SEMANTIC_VIEW_NAME,
  TABLE_NAME,
  NAME AS METRIC_NAME,
  EXPRESSION,
  SYNONYMS,
  COMMENT
FROM ANALYTICS.INFORMATION_SCHEMA.SEMANTIC_METRICS
ORDER BY SEMANTIC_VIEW_SCHEMA, SEMANTIC_VIEW_NAME, TABLE_NAME, METRIC_NAME;
~~~

需要注意当前 Role 对私有 Metric 的可见性；查询结果不完整时，不能直接断定语义对象没有定义该指标。

## 场景分析

财务、销售和客服都在报表中使用“收入”。财务按已付款金额统计，销售按已下单金额统计，客服排除退款订单。三个报表结果不同，团队准备统一成一个 Metric 以减少重复公式。

应先由业务 owner 判断这三项是否本来就是不同指标，例如 Paid Revenue、Booked Revenue 和 Net Revenue。随后为每个指标写出退款、取消、税费、币种和时间口径，再检查订单、支付和退款事实表的 grain 与关系。将指标映射到 Semantic View，并建立覆盖退款、部分付款和多币种的 Golden Queries。

发布后，Cortex Analyst 和 BI 使用同一套定义，但消费者仍需按 Role 获得相应对象权限。若净收入定义发生变化，应记录版本和影响范围，避免历史报表在无说明的情况下改变含义。

## 常见误区

- **认为统一指标名称就能统一业务口径。** 公式、粒度、时间、过滤与单位必须一起定义。
- **把 Metric 当成简单列别名。** Metric 通常包含聚合或派生逻辑，其可加性和过滤范围需要明确。
- **用 Semantic View 修复错误事实表关系。** 错误 grain、重复主键和 fanout 应先在物理模型解决。
- **把同名指标强行合并。** 不同业务用途应拆成不同指标并解释差异。
- **认为 PRIVATE metric 就是对底层数据的完整安全控制。** 仍需 Role、对象权限和数据策略保护底层对象。
- **仅依赖 SEMANTIC_METRICS 自动审计正确性。** 它能列出定义与元数据，不能判断业务公式是否符合实际政策。

## 完成标准

- [ ] 能为一个业务指标写出公式、粒度、过滤、时间和可加性契约。
- [ ] 能说明 Semantic View 的 Facts、Dimensions、Metrics 与 Relationships。
- [ ] 能解释 PRIVATE Fact/Metric 的用途与限制。
- [ ] 能用 Golden Queries 检查指标结果和关系路径。
- [ ] 能通过 SEMANTIC_METRICS、角色权限和 owner 审批进行指标治理。

## 自测

1. “收入”在财务和销售报表中计算口径不同，应该统一名称还是拆成多个 Metric？需要由谁确认？
2. 为什么 Semantic View 中的 Metric 定义正确，也可能因底层事实表的 Join 基数错误而产生重复计数？
3. PRIVATE Metric 与给底层表增加 Masking Policy 解决的是同一类问题吗？两者的边界是什么？
4. SEMANTIC_METRICS 看不到某个 private metric，是否一定表示它没有定义？应该检查什么权限？
5. 某项收入指标的退款过滤条件发生变化，为什么这通常属于语义版本变更，而不是普通字段描述更新？

## 参考资料

- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Using SQL commands to create and manage semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/sql)
- [SEMANTIC_METRICS Information Schema view](https://docs.snowflake.com/en/sql-reference/info-schema/semantic_metrics)
- [Creating semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/creating)
