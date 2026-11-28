# 持仓、估值、基准与组合表现

## 本节要解决的问题

投资委员会要求解释一个全球股票组合截至 11 月 27 日的持仓和表现：组合超配了哪些行业？相对基准的主动收益来自哪里？某只外部 ETF 的持仓披露为什么与基金内部持仓不同？

这些问题依赖不同的记录。内部持仓是组合管理系统在某个估值时点的资产；外部机构持仓通常来自定期披露，有报告日、发布日期和披露滞后；基准成分及权重来自特定指数版本。它们不能因为证券代码相同就被当作同一份持仓。

本节重点是把持仓、估值、基准和表现数据对齐到同一业务时点与口径。组合表现不能只靠“当前数量 × 当前价格”推算，也不能把价格收益、总回报和相对收益混在一起。

## 核心知识

### 持仓记录必须说明来源、估值时点和一行代表什么

内部组合持仓、托管持仓、外部基金披露和基准成分是四种不同数据：

| 数据对象 | 一行代表什么 | 主要用途 |
|---|---|---|
| INTERNAL_POSITION_SNAPSHOT | 某组合在某估值日持有某证券的数量 | 计算内部组合敞口 |
| CUSTODIAN_POSITION | 托管系统在某个截止时点确认的证券数量 | 对账与运营核查 |
| EXTERNAL_FUND_HOLDINGS | 某外部基金在其披露日持有的证券 | 外部机构持仓研究 |
| BENCHMARK_CONSTITUENT | 某指数版本在某生效日的成分和权重 | 组合基准比较 |

外部基金披露可能晚于持仓实际发生日期，不能把它标成当前实时持仓。不同披露来源对现金、衍生品、借券和基金份额的覆盖范围也可能不同。分析时要保留来源、披露日、报告期和取得日期。

### 估值必须按价格类型、币种和时间选出唯一记录

证券市值通常按数量、价格、合约乘数和币种换算计算。债券等工具还需要明确采用净价还是全价，以及应计利息是否单独计入。期货、期权和其他衍生品不能一概按证券数量乘价格解释敞口。

假设组合持仓已经按估值日选出，价格和外汇表也已按批准来源筛成唯一记录：

~~~sql
WITH position_value AS (
  SELECT
    p.portfolio_id,
    p.instrument_id,
    p.valuation_date,
    p.quantity,
    px.price,
    i.currency,
    fx.rate_to_base,
    p.quantity * px.price * COALESCE(i.contract_multiplier, 1)
      * fx.rate_to_base AS market_value_base
  FROM internal_position_snapshot p
  JOIN instrument i
    ON i.instrument_id = p.instrument_id
  JOIN approved_price_for_nav px
    ON px.instrument_id = p.instrument_id
   AND px.valuation_date = p.valuation_date
  JOIN approved_fx_for_nav fx
    ON fx.from_currency = i.currency
   AND fx.to_currency = 'USD'
   AND fx.valuation_date = p.valuation_date
)
SELECT
  portfolio_id,
  instrument_id,
  valuation_date,
  quantity,
  market_value_base
FROM position_value;
~~~

这只是说明 Join 和计算关系。生产模型还要处理现金、应计利息、应收股息、负债、空头和衍生品风险敞口。最重要的是在 Join 前验证每个证券在估值时点最多只有一条符合政策的价格和汇率。否则一个持仓连接到多条价格记录，会造成市值被重复累计。

### 组合权重和主动权重必须使用同一分母口径

组合权重通常是某证券的市值除以组合净资产；基准权重则来自指数供应商在对应生效日发布的权重。主动权重定义为：

\[
ActiveWeight_i = PortfolioWeight_i - BenchmarkWeight_i
\]

只有估值日期、币种、证券标识和资产范围对齐后，主动权重才有意义。若组合持有现金、衍生品或不在基准中的资产，不能简单地把所有证券权重都强制归一到 100%，而应明确是否包括现金、非基准资产和杠杆。

下面的 SQL 将已经审核的组合权重和基准权重对齐：

~~~sql
WITH portfolio_weight AS (
  SELECT
    portfolio_id,
    valuation_date,
    instrument_id,
    SUM(market_value_base) / NULLIF(MAX(net_asset_value_base), 0) AS weight
  FROM valued_portfolio_positions
  WHERE valuation_date = '2026-11-27'
  GROUP BY portfolio_id, valuation_date, instrument_id
),
benchmark_weight AS (
  SELECT
    benchmark_id,
    effective_date,
    instrument_id,
    weight
  FROM approved_benchmark_weights
  WHERE effective_date = '2026-11-27'
)
SELECT
  p.portfolio_id,
  b.benchmark_id,
  COALESCE(p.instrument_id, b.instrument_id) AS instrument_id,
  p.weight AS portfolio_weight,
  b.weight AS benchmark_weight,
  COALESCE(p.weight, 0) - COALESCE(b.weight, 0) AS active_weight
FROM portfolio_weight p
FULL OUTER JOIN benchmark_weight b
  ON b.instrument_id = p.instrument_id;
~~~

示例省略了组合与基准映射表的关联条件，实际查询必须先确定每个 Portfolio 适用哪个 Benchmark。若有不同币种、成分调整日或证券类别，也要在 Join 键中体现。FULL OUTER JOIN 可以保留组合独有和基准独有的证券，避免只看交集后误以为权重总和完整。

### 价格收益、总回报和组合净值是不同指标

价格收益只反映价格变化；总回报还包括股息、票息及相关再投资处理。对于债券和基金，若只用价格变化比较表现，可能遗漏票息、分配和应计收入。

组合表现还要处理外部现金流：
- Time-Weighted Return（TWR）将现金流影响从投资管理表现中剥离，通常按外部现金流切分子期间收益，再几何链接。
- Money-Weighted Return（MWR）考虑现金流的金额和时点，更接近投资者实际资金经历，通常用 IRR 思路计算。

不要把 TWR 和 MWR 当成两种可以互换的“收益率”。评估基金经理相对基准的管理表现时，常用 TWR；分析投资者实际资金回报时，MWR 可能更有解释力。具体报告口径要遵循基金、客户和绩效报告制度的要求。

### 基准比较要确认总回报版本、币种与对冲规则

同一个指数可能有 Price Return、Gross Total Return、Net Total Return 等不同版本；外币组合还可能采用本币、不对冲或对冲后的基准收益。报告必须说明：
- 基准全名、版本、供应商和生效日期；
- 使用价格收益还是总回报指数；
- 基准币种和汇率时点；
- 是否采用外汇对冲，以及对冲频率；
- 基准是否经过定制、拼接或再平衡。

如果组合使用含股息再投资的总回报，而基准只用 Price Return，主动收益就不是同口径比较。若组合持仓日期与指数权重生效日错位，行业和证券主动权重也可能被错误解释。

### 组合表现报告要区分 Return Contribution 与 Return Attribution

Contribution 回答“哪个证券或行业贡献了组合的绝对收益”；Attribution 回答“相对基准的超额收益来自哪些投资决策”。两者需要不同的分子和比较基准，不能在报告里都叫“收益贡献”。

本篇只把归因需要的对齐数据准备好；Brinson 归因、因子暴露和多期归因方法在《绩效归因、因子暴露与市场状态》中展开。

## 工程实施步骤

1. 明确每个持仓来源的报告日、估值日、数据到达时间和一行粒度。
2. 维护内部组合、托管、外部披露和基准成分的独立数据模型，不混用来源。
3. 为证券身份建立稳定 instrument_id，并记录供应商代码、交易所代码和有效期。
4. 为估值日选择批准的价格、外汇、乘数和应计利息口径，检查 Join 唯一性。
5. 计算资产、负债、NAV 和证券权重，核对总额是否与组合估值控制数一致。
6. 使用相同估值日、证券标识、币种和基准版本计算主动权重，保留组合/基准独有证券。
7. 为表现序列选择总回报数据；明确现金流切分和 TWR/MWR 的适用用途。
8. 与基准比较时核对总回报版本、币种、对冲和生效日期，避免 Price Return 与 Total Return 混用。
9. 保存 Query ID、数据快照、基准版本、价格源和计算规则，确保报告可以重现。
10. 对外部披露数据标注报告日和发布日期，不将延迟披露直接描述为当前市场持仓。

## 场景分析

投资委员会看到组合在 11 月 27 日对某科技股的权重是 6.2%，基准权重是 4.8%，于是将其列为 1.4% 主动超配。另一份数据却显示某大型 ETF 在 11 月 27 日只持有 5.1%。

这两组数据可能分别是组合内部持仓和 ETF 上一个披露期的持仓。先核对 ETF 披露报告期、发布日期和是否包含衍生品，再比较它与组合的实际估值时点。不能因为两份报告的日期都是 11 月 27 日，就认为它们具有相同的数据时效。

同时，要确认 4.8% 的基准权重属于指数总回报还是价格指数版本，证券标识是否与组合的 instrument_id 一致。完成这些检查后，才可以将 1.4% 的主动权重用于解释组合风险和投资决策。

## 常见误区

- **把外部机构披露持仓当成本组合实时持仓。** 披露有报告期和发布日期，通常存在时间滞后。
- **只按证券代码和日期连接价格。** 还要核对市场、价格类型、来源、币种和合约乘数。
- **把价格收益当作总回报。** 股息、票息和分配可能改变证券与组合的实际表现。
- **把 TWR 和 MWR 当作同一种收益率。** 一个侧重管理表现，一个体现投资者资金时点影响。
- **用不同时点或不同币种的组合和基准权重计算主动权重。** 比较前先对齐估值日期、指数版本和汇率口径。
- **把 Contribution 和 Attribution 都叫收益贡献。** Contribution 解释绝对收益来源，Attribution 解释相对基准的超额收益。
- **只做 INNER JOIN。** 组合独有和基准独有证券会消失，权重分析可能不完整。

## 完成标准

- [ ] 能区分内部持仓、托管持仓、外部披露和基准成分。
- [ ] 能解释价格、币种、乘数和应计收入如何进入估值。
- [ ] 能计算组合权重和主动权重，并检查 Join 基数。
- [ ] 能区分 Price Return、Total Return、TWR 和 MWR。
- [ ] 能确认基准版本、币种和外汇对冲口径。
- [ ] 能区分 Return Contribution 与 Return Attribution。

## 自测

1. 外部基金报告期是 9 月 30 日，但发布日期是 11 月 20 日。11 月 27 日的报告能否把该持仓写成实时数据？
2. 同一证券当天存在官方收盘价和供应商修订价。计算组合权重前应如何确定选用价格？
3. 一个组合使用总回报指数，基准却使用价格指数。主动收益会产生什么问题？
4. 哪种收益率更适合剥离客户申赎时点对基金经理管理表现的影响？哪种更接近投资者实际资金经历？
5. 组合独有证券和基准独有证券在主动权重分析中为什么不能被 INNER JOIN 丢弃？

## 参考资料

- [CFA Institute: Guide for Return Attribution Reporting (2026)](https://rpc.cfainstitute.org/research/reports/2026/guide-return-attribution-reporting)
- [CFA Institute: Performance Attribution — History and Progress](https://www.cfainstitute.org/sites/default/files/-/media/documents/book/rf-lit-review/2019/rflr-performance-attribution.pdf)
- [Snowpark Python DataFrames](https://docs.snowflake.com/en/developer-guide/snowpark/python/working-with-dataframes)
