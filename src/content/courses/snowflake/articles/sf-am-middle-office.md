# 中后台运营：NAV、结算与对账

## 本节要解决的问题

某只基金 11 月 27 日的初步 NAV 为 2.43 亿，托管人发来的估值文件是 2.41 亿。差额集中在三只外币债券和一笔未确认的应计利息。中后台团队不能只把两份金额相减后发给经理：必须知道持仓是否一致、价格和汇率用了哪个时点、应计利息是否遗漏，以及差异由谁确认。

NAV、结算和对账是同一条运营链上的不同环节。NAV 回答基金在某一估值时点的净资产；结算确认交易、现金和证券交付是否完成；对账则把内部记录与托管人、管理员和交易对手的记录逐项比较。三者依赖同一批数据，但粒度、时间和确认责任不同。

## 核心知识

### NAV 是估值时点上的资产减负债，不是把所有持仓金额直接相加

基金净资产的基本关系是：

**NAV = 资产总额 − 负债总额**

若需要每份基金净值，还要除以估值时点的流通份额。资产可能包括证券持仓、现金、应收利息和应收股息；负债可能包括应付费用、应付赎回款、应付税费和其他应付款。具体项目和计价规则由基金估值政策决定。

计算前必须固定以下口径：

- 估值日期及市场截止时间，特别是跨时区市场。
- 价格类型：官方收盘价、估值价、经批准的替代价格或模型价格。
- 汇率来源、报价方向和汇率日期。
- 应计利息和公司行动的处理方式。
- 暂停交易、价格缺失、过期价格和手工调整的审批依据。
- 份额登记与赎回确认的截止时间。

一只债券在东京时间收盘、另一只在纽约市场收盘。不能只使用同一个 UTC 日期就假设两者价格代表同一估值时点。基金政策必须定义可接受的价格时间和跨市场估值规则。

### 估值数据要先按业务键选出唯一价格和汇率

假设组合持仓每行代表某基金在估值日持有某证券的一条头寸，价格表则可能同时包含不同来源、市场和价格类型：

| 数据 | 一行代表什么 | 用于 NAV 的关键条件 |
|---|---|---|
| POSITION_SNAPSHOT | 某基金在某估值时点持有某证券 | fund_id、instrument_id、as_of_ts |
| MARKET_PRICE | 某证券在某市场/来源/价格类型的一条价格 | instrument_id、price_ts、price_type、source |
| FX_RATE | 某币种对在某一时点的一条汇率 | from_ccy、to_ccy、rate_ts、rate_type |
| ACCRUED_INCOME | 某证券在估值时点的应计收入 | instrument_id、as_of_ts |
| FUND_LIABILITY | 某基金的一笔负债 | fund_id、as_of_ts、liability_type |

先根据政策挑选唯一价格和汇率，再与持仓连接。以下示例假设价格表已按估值日期、价格类型和批准来源选出唯一记录，汇率表也已按估值时点及报价方向唯一化：

~~~sql
WITH position_value AS (
  SELECT
    p.fund_id,
    p.instrument_id,
    p.quantity,
    px.price,
    i.currency,
    fx.rate,
    p.quantity * px.price * fx.rate AS market_value_base
  FROM position_snapshot p
  JOIN instrument i
    ON i.instrument_id = p.instrument_id
  JOIN approved_price_for_nav px
    ON px.instrument_id = p.instrument_id
   AND px.valuation_date = p.valuation_date
  JOIN approved_fx_for_nav fx
    ON fx.from_currency = i.currency
   AND fx.to_currency = 'USD'
   AND fx.valuation_date = p.valuation_date
),
assets AS (
  SELECT fund_id, SUM(market_value_base) AS asset_value
  FROM position_value
  GROUP BY fund_id
),
liabilities AS (
  SELECT fund_id, SUM(amount_base) AS liability_value
  FROM fund_liability
  WHERE valuation_date = '2026-11-27'
  GROUP BY fund_id
)
SELECT
  a.fund_id,
  a.asset_value,
  COALESCE(l.liability_value, 0) AS liability_value,
  a.asset_value - COALESCE(l.liability_value, 0) AS net_asset_value
FROM assets a
LEFT JOIN liabilities l
  ON l.fund_id = a.fund_id;
~~~

这段查询假设应计收入已经包含在持仓估值或独立资产表中，实际模型必须避免把同一项利息既计入价格又作为应收收入重复相加。任何价格或汇率 Join 前都要检查一对一匹配；多条记录必须按价格政策进行选择和人工例外处理，不能让 SQL 随意取一行。

### 结算关注交易状态、现金与证券交付，不等于交易记录已入仓

一笔交易可能依次经历交易确认、分配、匹配、结算指令、现金/证券交付和最终确认。交易成交不表示结算已完成；结算失败也不一定意味着交易要删除。

中后台需要区分：

- **Trade date**：交易达成日期。
- **Settlement date**：双方约定交付现金与证券的日期。
- **Instruction status**：结算指令是否已提交、匹配或被拒绝。
- **Settlement status**：现金和证券是否实际交付。
- **Fail reason**：失败原因、责任方和预计解决时间。

要保留每次状态变化，而不是只保留一条覆盖后的当前状态。否则无法解释“昨天显示待结算、今天变成失败、下午又完成”的业务过程，也不能准确计算失败率与未结算敞口。

### 对账需要把差异分类并交给责任人处理

内部头寸与托管人头寸要在同一业务日期、基金、证券和币种口径下比较。先分别聚合到相同粒度，再做 FULL OUTER JOIN：

~~~sql
WITH internal_pos AS (
  SELECT
    fund_id,
    instrument_id,
    SUM(quantity) AS internal_qty
  FROM internal_position
  WHERE as_of_date = '2026-11-27'
  GROUP BY fund_id, instrument_id
),
custodian_pos AS (
  SELECT
    fund_id,
    instrument_id,
    SUM(quantity) AS custodian_qty
  FROM custodian_position
  WHERE as_of_date = '2026-11-27'
  GROUP BY fund_id, instrument_id
)
SELECT
  COALESCE(i.fund_id, c.fund_id) AS fund_id,
  COALESCE(i.instrument_id, c.instrument_id) AS instrument_id,
  i.internal_qty,
  c.custodian_qty,
  COALESCE(i.internal_qty, 0) - COALESCE(c.custodian_qty, 0) AS quantity_break,
  CASE
    WHEN i.instrument_id IS NULL THEN 'CUSTODIAN_ONLY'
    WHEN c.instrument_id IS NULL THEN 'INTERNAL_ONLY'
    WHEN i.internal_qty <> c.custodian_qty THEN 'QUANTITY_MISMATCH'
    ELSE 'MATCHED'
  END AS break_type
FROM internal_pos i
FULL OUTER JOIN custodian_pos c
  ON c.fund_id = i.fund_id
 AND c.instrument_id = i.instrument_id;
~~~

这只检查数量差异。金额差异还要继续区分价格来源、汇率、应计利息和费用。对账系统应保存差异类型、首次出现时间、金额/数量、严重级别、责任团队、调查说明、调整凭证和关闭时间。不能直接覆盖原始双方记录来“消除差异”。

### NAV 发布需要双人复核和版本化证据

初步 NAV 与最终 NAV 应分别记录状态和计算版本。对价格缺失、手工估值、价格过期、重大对账差异和临近截止时间未结算交易，设置例外队列。每项例外都要有金额影响、原因、批准人和证据。

Agent 可以帮助找到差异、汇总托管文件和解释潜在原因，但不能自动批准估值调整、记账、现金划拨或最终 NAV 发布。最终发布属于受监管的业务控制，需要责任人确认并保留审批记录。

## 工程实施步骤

1. 从基金估值政策和运营流程确认估值日、市场截止、价格类型、汇率来源、利息、费用和份额口径。
2. 为持仓、价格、汇率、应计收入、负债和结算状态分别定义一行代表什么。
3. 为价格与汇率选择建立可追溯规则，保留来源、时间戳、版本、价格类型和手工覆盖记录。
4. 在 NAV 计算前检查每个持仓是否唯一匹配价格和汇率；无匹配、多匹配和过期价格进入例外队列。
5. 按同一估值时点计算资产、负债和 NAV，并与基金管理员或托管人控制总额对账。
6. 对内部与托管头寸、现金和交易状态分别执行数量与金额对账，分类差异并分配责任人。
7. 对结算失败、未匹配交易、现金短缺和公司行动设置处理时限与升级路径。
8. 保存初步、调整后和最终 NAV 的计算版本、来源快照、差异清单和人工审批证据。
9. 发布前复核重大例外、估值调整和差异关闭状态；没有批准的调整不得自动进入最终 NAV。
10. 复盘 NAV 重算次数、未结算敞口、对账差异的年龄和人工调整频率，持续改善源数据和运营流程。

## 场景分析

基金内部持仓显示一笔 10,000 股的日股头寸，托管人文件显示 9,500 股。NAV 计算又使用了两条价格记录：东京官方收盘价和盘中快照。

不能先选一条价格、再把数量差异写成“估值误差”。需要分别调查：

1. 持仓数量差异是否来自一笔未完成的证券交付、公司行动或交易分配。
2. 价格差异是否因为市场、价格类型或估值时间不同。
3. 两份记录是否按相同证券标识和币种对齐。
4. 这项差异对 NAV 的金额影响和是否超过基金政策的容差。
5. 若需要手工调整，由谁批准、使用哪条证据、如何保留原始值。

最终 NAV 只能在数量、价格、汇率和例外处理都达到政策要求后发布。差异没有解决时，应保留例外并按流程升级，而不是把它从报表里隐藏。

## 常见误区

- **把 NAV 当成持仓市值的简单求和。** 还需要负债、应计收入、费用、现金、汇率和份额口径。
- **只按证券代码和日期连接价格。** 还要明确市场、价格类型、来源、时间和版本。
- **把成交当作结算完成。** Trade date、Settlement date、Instruction status 和 Settlement status 是不同概念。
- **用覆盖原始记录的方式消除对账差异。** 应保留双方来源、差异类型、调整凭证和关闭证据。
- **用一个全局容差处理所有资产。** 不同资产类别、流动性和估值方式可能需要不同容差和审批规则。
- **让 Agent 自动批准 NAV 或记账调整。** 这些是受控业务动作，必须由授权人员复核与批准。

## 完成标准

- [ ] 能说明 NAV 的资产、负债、应计收入和份额口径。
- [ ] 能解释价格与汇率选择必须满足的唯一性和时间条件。
- [ ] 能区分交易成交、结算指令和结算完成状态。
- [ ] 能按相同粒度对内部与托管头寸进行 FULL OUTER JOIN 对账。
- [ ] 能分类差异并保留责任人、调整和关闭证据。
- [ ] 能设计初步 NAV、例外处理、双人复核和最终发布的控制流程。

## 自测

1. 某基金有 10,000 股债券头寸，价格表中同一天有官方收盘价和盘中价两条记录。直接 Join 后会发生什么？NAV 计算前应怎样选价？
2. 内部持仓为 10,000 股，托管持仓为 9,500 股。为什么不能把 500 股差异直接计入 NAV 调整？
3. 一笔交易已经成交，但证券尚未交付。它的 Trade status 和 Settlement status 应如何区分？
4. 对账发现 NAV 差异来自一笔未确认的应计利息。系统应保留哪些来源、金额影响和审批证据？
5. Agent 找到了一个可能的估值错误，为什么不能直接修改价格并发布最终 NAV？

## 参考资料

- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Querying data with joins](https://docs.snowflake.com/en/user-guide/querying-joins)
- [Access History](https://docs.snowflake.com/en/user-guide/access-history)
