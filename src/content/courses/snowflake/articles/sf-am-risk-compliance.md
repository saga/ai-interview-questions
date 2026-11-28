# 风险、合规、ESG 与政策驱动检查

## 本节要解决的问题

风险团队周五收到一份组合监控报告：某基金对发行人 A 的敞口为 11.4%，系统标记为超限。但投资经理认为基金适用的发行人集中度上限是 15%；合规团队则指出，监管辖区在本月初更新了政策，当前基金应执行 10% 上限。

问题不是简单比较两个百分数。风险判断依赖基金类型、法律辖区、资产类别、估值日期、政策版本和豁免状态。ESG 评级、制裁名单匹配和风险阈值也不是同一种证据，不能把一个供应商评分直接当成法律结论。

## 核心知识

### 先把风险敞口算在正确的粒度上

以发行人集中度为例，分子是基金在估值时点对该发行人的总敞口，分母是同一时点、同一币种口径的 NAV：

**Issuer Concentration = Issuer Exposure / Fund NAV**

假设一只基金对发行人 A 持有三只债券和一只股票。要先将头寸按 fund_id、issuer_id、valuation_date 汇总，再除以同一估值日的 NAV。不能在原始头寸明细上把 NAV 连接到每条证券记录后重复累计。

~~~sql
WITH issuer_exposure AS (
  SELECT
    fund_id,
    issuer_id,
    valuation_date,
    SUM(market_value_base) AS exposure_amount
  FROM valued_positions
  WHERE valuation_date = '2026-11-27'
  GROUP BY fund_id, issuer_id, valuation_date
),
fund_nav AS (
  SELECT
    fund_id,
    valuation_date,
    net_asset_value
  FROM nav_snapshot
  WHERE valuation_date = '2026-11-27'
)
SELECT
  e.fund_id,
  e.issuer_id,
  e.valuation_date,
  e.exposure_amount,
  n.net_asset_value,
  e.exposure_amount / NULLIF(n.net_asset_value, 0) AS concentration_ratio
FROM issuer_exposure e
JOIN fund_nav n
  ON n.fund_id = e.fund_id
 AND n.valuation_date = e.valuation_date;
~~~

这是一个教学计算。实际定义还要明确是否计入衍生品名义敞口、担保、穿透后的基金持仓、空头头寸和净额结算。若分子和分母使用不同汇率、估值时间或币种，结果即使算式正确也不可信。

### 风险限额必须按基金、辖区和生效日期匹配政策版本

不要在 SQL 中写死一个 10% 或 15% 的阈值。将政策建成有版本和有效期的数据：

| 字段 | 用途 |
|---|---|
| policy_id / policy_version | 追溯批准的规则版本 |
| jurisdiction | 适用监管辖区 |
| fund_type | 适用基金类别 |
| exposure_type | 发行人、行业、国家或资产类别 |
| limit_ratio | 限额或预警阈值 |
| effective_from / effective_to | 政策生效和失效日期 |
| approval_status | 是否已经批准生效 |

计算时必须使用估值日期匹配有效政策版本：

~~~sql
SELECT
  e.fund_id,
  e.issuer_id,
  e.valuation_date,
  e.concentration_ratio,
  p.policy_id,
  p.policy_version,
  p.limit_ratio,
  CASE
    WHEN e.concentration_ratio > p.limit_ratio THEN 'BREACH'
    WHEN e.concentration_ratio > p.limit_ratio * 0.9 THEN 'WARNING'
    ELSE 'WITHIN_LIMIT'
  END AS control_status
FROM issuer_concentration e
JOIN fund_policy_assignment f
  ON f.fund_id = e.fund_id
JOIN risk_limit_policy p
  ON p.jurisdiction = f.jurisdiction
 AND p.fund_type = f.fund_type
 AND p.exposure_type = 'ISSUER'
 AND e.valuation_date >= p.effective_from
 AND (p.effective_to IS NULL OR e.valuation_date < p.effective_to)
 AND p.approval_status = 'APPROVED';
~~~

这里的 90% 预警线只是内部控制示例，不代表法规要求。真实政策还可能有例外审批、穿透计算、豁免期限和不同资产类型的分母口径。若同一估值日期匹配到多条有效政策，系统应报数据质量异常，而不是任选一条。

### 制裁和观察名单匹配是调查线索，不是自动定罪

制裁筛查通常需要比较客户、发行人、交易对手和受益所有人的身份信息与外部名单。名称相似度可能受到别名、音译、拼写、出生日期、注册地和企业结构影响。

一个匹配候选至少要保留：
- 使用的名单来源、版本和发布日期。
- 匹配对象的规范 ID、原始名称和别名。
- 匹配字段、算法或供应商评分。
- 需要人工确认的身份信息和排除理由。
- 检查日期、案件负责人和最终处置。

模糊匹配得分高只意味着需要调查，不能直接等同于确认命中。名单更新、同名实体和法人关系变化都可能改变结果。对于制裁等高影响控制，系统应建立人工升级和留痕流程，不能让模型仅凭名称相似就冻结资产或拒绝客户。

### ESG 评级、政策规则和合规结论要分开存储

ESG 数据可能来自企业披露、评级机构、行业分类、媒体事件和外部数据商。不同供应商对行业、权重和争议事件的解释并不一致。评级下降不自动意味着违规；评级较高也不能证明企业满足所有适用法律和投资政策。

需要分别保存：
- 原始 ESG 分数、评级机构、方法版本和发布日期。
- 温室气体排放、能源消耗和争议事件等底层指标。
- 适用的政策、行业分类和辖区。
- 人工审阅、证据链接和最终判断。
- 数据缺失、估算值、覆盖范围和更新时间。

报告中应明确“供应商给出的评级”“组合内部评分”“政策是否违反”和“是否需要人工复核”是不同字段。不要把它们合并成一个含义不清的 ESG 合规标签。

### 政策驱动检查要能回放当时为什么触发

风险政策会变更。如果只保留当前阈值，团队无法解释三个月前某基金为什么没有触发预警，也无法在重算历史报告时还原当时的政策。

每条风险检查结果应保存：
- fund_id、instrument/issuer_id、估值日期和使用的源数据版本。
- 指标分子、分母、计算值、容差和单位。
- policy_id、policy_version、生效日期和批准状态。
- 数据缺失、豁免、人工覆盖和触发原因。
- 运行 Query ID、规则版本和复核案件 ID。

这样才能区分“当时没有违反政策”和“当时没有足够数据完成判断”。

## 工程实施步骤

1. 和风险、合规及投资运营团队确认每类风险指标的分子、分母、事实粒度、估值时点和适用范围。
2. 将政策版本、辖区、基金类别、限额、生效/失效时间和审批状态建成可查询的数据对象。
3. 为持仓估值、NAV、发行人映射和外部评级定义源版本、更新时间和唯一性检查。
4. 将风险敞口先汇总到政策所需粒度，再按基金和有效日期匹配限额，验证同一估值时点只命中一条有效规则。
5. 对制裁名单或 ESG 外部数据保留原始来源、版本、匹配字段、供应商评分和人工处置，不让供应商评分直接变成最终结论。
6. 为缺少价格、过期评级、政策版本冲突和发行人映射失败建立数据质量异常，而不是把空值当作未超限。
7. 将 WARNING、BREACH 和 REVIEW_REQUIRED 分开处理，设置责任人、确认期限、升级路径和关闭证据。
8. 对政策更新做历史回放：比较新旧版本会影响哪些基金、证券、报告和未关闭案件。
9. 保留原始结果、调整原因、审批记录和计算版本；严禁在结果表中直接覆盖旧的风险判断。
10. 用固定组合和历史日期建立回归集，确认规则变更只影响预期范围，并能解释每个触发结果。

## 场景分析

基金 F01 在 11 月 27 日对发行人 A 的集中度是 11.4%。政策表中有两条规则：旧版 15% 的 effective_to 是 11 月 1 日，新版 10% 从 11 月 1 日生效。系统需要根据基金辖区、类型和估值日期匹配新版规则，并记录超限金额和政策版本。

如果只按 fund_id 连接政策表，就会将两条规则都匹配上，产生两条状态；若只取最新创建的记录，又可能把新规则错误应用到生效日前的历史报告。正确方式是同时检查适用辖区、基金类别、指标类型和有效时间，且检查是否存在重叠的有效区间。

11.4% 超过新版 10% 限额后，系统应创建风险案件并附上持仓、NAV、政策条款和计算版本。风险负责人需要确认是否有正式豁免、数据错误或需采取减仓措施。报告可以说明“按政策版本 2026-11-A 计算，发行人 A 敞口为 11.4%，超过 10% 阈值”；没有进一步批准前，不能让 Agent 自动卖出资产或将案件标为关闭。

## 常见误区

- **把风险比例当成不需要粒度定义的简单除法。** 分子、分母、币种、估值时间和穿透范围必须一致。
- **在 SQL 中写死风险阈值。** 限额要按辖区、基金类别、指标类型和有效日期匹配版本。
- **用名单模糊匹配分数直接判断制裁命中。** 相似度只生成调查线索，还要复核身份属性和名单来源。
- **把 ESG 评级下降直接等同于违规。** 评级方法、政策规则、披露证据和合规结论必须分开。
- **只保存最新规则和最新结果。** 没有政策版本和历史生效时间，就无法重放旧报告。
- **把缺失数据当成未超限。** 缺价格、缺 NAV、映射失败和政策不完整应该进入 REVIEW_REQUIRED。
- **让 Agent 自动执行高影响处置。** 风险案件、豁免、冻结和减仓需要授权人员确认与审计。

## 完成标准

- [ ] 能定义集中度等风险指标的粒度、分子、分母和估值时点。
- [ ] 能按基金、辖区、指标类型和生效日期匹配政策版本。
- [ ] 能识别政策重叠、缺失和未批准版本。
- [ ] 能区分制裁候选匹配、人工确认和最终处置。
- [ ] 能区分 ESG 评级、底层证据和合规判断。
- [ ] 能回放历史风险结果并保留人工审批证据。

## 自测

1. 一个基金的发行人集中度为 11.4%，旧政策限额 15%，新政策限额 10%。如何判断新旧政策分别适用于哪些估值日期？
2. 同一估值日期匹配到两条有效政策。为什么不能简单取最新创建的一条？应该如何处理？
3. 制裁名单匹配分数很高，但出生日期和注册地不同。为什么不能自动将其判定为命中？
4. ESG 评级下降，但没有政策违规证据。报告应如何分别记录评级、政策状态和待调查事项？
5. 风险数据缺少 NAV，无法计算集中度。为什么不应将结果记为 WITHIN_LIMIT？

## 参考资料

- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Data Quality Monitoring](https://docs.snowflake.com/en/user-guide/data-quality-intro)
- [Access History](https://docs.snowflake.com/en/user-guide/access-history)
