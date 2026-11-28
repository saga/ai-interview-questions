# 资产管理语义视图、数据模型与血缘

## 本节要解决的问题

投资委员会报告显示某组合截至 11 月 27 日的市值为 4.82 亿，资产管理 Agent 的回答却是 4.91 亿。两边都引用了 Snowflake 中的数据。排查后发现，报告按估值日的持仓和收盘价计算，Agent 的查询却把同一证券的多个价格记录连接到了每一条持仓上；此外，Agent 引用了一份旧研究备忘录，把其中的目标价误当成当前市场价格。

这类分析不能把结构化指标、文档证据和数据血缘混成一件事。Semantic View 负责统一业务查询的实体、关系和指标；文档检索负责找到研究材料和政策解释；Data Lineage 与 Access History 帮助追踪数据依赖和使用情况。它们提供的证据不同，不能互相替代。

## 核心知识

### 先确定“市值”由哪几张权威数据表计算

以组合估值为例，至少涉及四类数据：

| 数据对象 | 一行代表什么 | 关键字段 | 用途 |
|---|---|---|---|
| POSITION_SNAPSHOT | 某组合在估值日持有某证券的一条头寸 | portfolio_id、instrument_id、as_of_date、quantity | 持仓数量 |
| INSTRUMENT | 一种证券 | instrument_id、ticker、currency | 证券标识和计价币种 |
| MARKET_PRICE | 某证券在某市场/价格类型/日期的一条价格 | instrument_id、price_date、price_type、price | 估值价格 |
| FX_RATE | 某币种对在某日期的一条汇率 | from_currency、to_currency、rate_date、rate_type、rate | 统一报告币种 |

组合市值不是简单地把持仓数量乘上任意一条价格。还要明确：

- 估值日采用交易日、市场收盘日还是报告日。
- 价格采用官方收盘价、估值价还是经批准的替代价格。
- 外币持仓使用哪一种 FX rate 和哪一个汇率日期。
- 无价格、停牌、过期价格和手工覆盖如何处理。

例如，报告币种为 USD，单笔头寸的基本计算可以表达为：

~~~sql
SELECT
  p.portfolio_id,
  p.instrument_id,
  p.as_of_date,
  p.quantity * px.price * fx.rate AS market_value_usd
FROM position_snapshot p
JOIN market_price px
  ON px.instrument_id = p.instrument_id
 AND px.price_date = p.as_of_date
 AND px.price_type = 'OFFICIAL_CLOSE'
JOIN instrument i
  ON i.instrument_id = p.instrument_id
JOIN fx_rate fx
  ON fx.from_currency = i.currency
 AND fx.to_currency = 'USD'
 AND fx.rate_date = p.as_of_date
 AND fx.rate_type = 'OFFICIAL_CLOSE';
~~~

这段 SQL 只展示计算关系。上线前还要验证每个头寸在指定估值日最多匹配一条价格和一条汇率。若市场价格存在多个来源、多个交易场所或修订版本，必须先按业务规则确定选用记录，不能让 Join 自行扩行。

### Semantic View 让业务查询共享同一套口径

在语义模型中，可以将持仓、证券、价格和汇率映射为逻辑表，定义它们之间的关系，再将数量、价格、汇率作为事实或属性，最后定义组合市值等 Metric。

| 语义对象 | 建议内容 |
|---|---|
| Logical Tables | Positions、Instruments、Prices、FX Rates |
| Relationships | Position 到 Instrument；Position 按估值日关联 Price；Instrument Currency 关联 FX Rate |
| Facts | Position Quantity、Market Price、FX Rate |
| Dimensions | Portfolio、Instrument、Asset Class、As-of Date、Currency |
| Metrics | Market Value USD、Position Count、Unpriced Position Count |

指标定义应包含价格类型、估值日、汇率方向和缺失处理。不能把“市值”写成一个不带条件的 SUM(quantity × price)，然后期待用户每次提问时自行补齐财务口径。

Semantic View 负责让 SQL/自然语言查询遵守模型里定义的语义，不会自动修复底层重复价格、无效证券映射或错误时间键。物理层必须先通过唯一性、引用完整性和时间有效性测试。

### 研究文件和政策文档只能支持它们真正能证明的内容

资产管理分析常常需要结构化数据之外的材料，例如研究员备忘录、评级变更说明、投资政策和风险委员会纪要。这些材料适合通过检索提供背景与解释，但不应替代持仓和估值数据。

例如，研究备忘录写着“目标价 120 美元”，它可以说明研究员对未来价格的判断，却不能证明某组合在 11 月 27 日的市值。投资政策中的集中度上限可以作为规则依据，但是否超限仍要用实际持仓和批准的分类口径计算。

Agent 的回答应区分：
- 数据事实：某估值日、某证券数量和采用价格所计算的金额。
- 文件证据：研究备忘录的作者、版本、发布日期和引用段落。
- 业务规则：集中度阈值、限额和估值政策的适用版本。
- 推断：价格变化、评级变化与组合风险之间的可能关系。

若文档版本过期，或其适用组合、地区和日期不符，不能因为语义相似就当作当前规则。

### Data Lineage 与 Access History 回答的问题不同

Snowsight 的 Data Lineage 展示 Snowflake 对象之间的数据依赖关系。当前支持的对象包括表、动态表、外部表、Iceberg 表、视图、物化视图和 Semantic View 等；它适合回答“这个对象依赖哪些上游对象、哪些下游对象可能受影响”。

Column Lineage 可以进一步展示写入操作中源列到目标列的数据流向，相关信息可从 Access History 中查看。但要注意，Snowflake 当前文档明确指出：**Semantic View 暂不支持 Column Lineage**。因此不能承诺在血缘图里看到每一个 Semantic View Metric 的列级计算链。

Access History 还可以帮助审计某段时间内哪些查询访问了哪些对象。它与对象血缘图不是同一种数据，也不是完整的业务来源档案。对外部 ETL、手工文件、应用计算和业务审批的依赖，需要结合外部血缘或自有元数据补充。

## 工程实施步骤

1. 让财务/投资运营确认估值日、价格类型、汇率类型、报告币种和无价格处理规则。
2. 对 POSITION_SNAPSHOT、MARKET_PRICE 和 FX_RATE 检查业务键唯一性，列出同一证券同一天的多价格、多汇率样本。
3. 建立统一的证券身份映射，记录 ticker、交易所代码、供应商代码和 instrument_id 的来源及有效期。
4. 将持仓、证券、价格和汇率映射为 Semantic View 逻辑表，明确关系键、时间条件和 Metric 口径。
5. 用固定估值日和少量证券建立 Golden Portfolio，手工计算预期市值，再与 Semantic View 查询结果对账。
6. 在 Snowsight 查看对象级 Data Lineage，确认报表视图、物化视图、Semantic View 和上游表的依赖关系。
7. 对关键数据写入流程查看 Access History 的对象和列级信息；对 Semantic View 列级计算链的不可见部分，用模型定义、SQL 和查询记录补充审计证据。
8. 对研究文件和投资政策记录来源 ID、版本、生效日期和适用范围，不将文档内容直接当作当前数值。
9. Agent 输出中分别保留查询 ID、Semantic View 版本、估值日、价格来源、文档版本和引用片段。
10. 语义模型、价格源或汇率规则改变时，重跑 Golden Portfolio，并比较差异及受影响的下游对象。

## 场景分析

某全球股票组合在 11 月 27 日有一笔 10,000 股的日股头寸。价格源中同时存在东京市场官方收盘价、盘中快照和供应商修订价；汇率表里也有交易日收盘价和纽约收盘价。

如果直接按 instrument_id 和日期连接，单笔持仓可能匹配三条价格和两条汇率，产生六条结果。汇总后市值会被放大。正确做法是先确认估值政策要求的市场、价格类型和汇率时点，将价格与汇率各自筛成唯一记录，再计算市值。

若 Agent 同时检索到一份研究员备忘录，报告可以引用其中的投资观点，但必须把它与官方估值数据分开。Data Lineage 可以展示估值数据对象的依赖关系；若需要证明某条 Metric 的列级表达式，还需查看语义模型定义和执行 SQL，不能假装血缘图已经完整显示这一层。

## 常见误区

- **把价格和汇率当成每个证券每天只有一条记录。** 价格来源、市场、类型和修订版本可能不同，必须先定义选用规则。
- **只按 instrument_id 和日期 Join。** 还需要市场、价格类型、币种和汇率类型等业务条件。
- **让研究目标价替代估值价格。** 研究材料是分析证据，不是当前持仓估值数据。
- **把 Semantic View 当成自动数据治理工具。** 语义定义不能修复底层重复键和错误业务口径。
- **把 Data Lineage、Column Lineage 和 Access History 当作同一功能。** 它们分别描述对象依赖、列级写入流向和访问行为。
- **承诺 Semantic View 有完整列级血缘。** 当前文档指出 Semantic View 暂不支持 Column Lineage；要用模型定义、SQL 和审计记录补充。

## 完成标准

- [ ] 能说明组合市值依赖持仓、价格、证券币种和汇率哪些字段。
- [ ] 能找出多价格或多汇率 Join 导致的 fanout。
- [ ] 能区分 Semantic View 的逻辑关系与底层数据质量约束。
- [ ] 能区分结构化估值数据、研究文件和投资政策的证据作用。
- [ ] 能解释 Data Lineage、Column Lineage 和 Access History 的差别。
- [ ] 能指出 Semantic View 当前列级血缘支持的边界。

## 自测

1. 同一证券同一天有三种价格记录、两种汇率记录。直接连接后会产生多少条组合记录？要先按哪些字段选出唯一记录？
2. 研究员备忘录给出的目标价为 120 美元，为什么不能直接将其用于计算当前持仓市值？
3. Semantic View 能否自动保证 POSITION_SNAPSHOT 的业务键唯一？还需要什么数据质量检查？
4. Snowflake 的列级血缘暂不支持 Semantic View。若审计人员要确认 Market Value USD 的计算来源，还需要保留哪些定义和执行证据？

## 参考资料

- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Data Lineage](https://docs.snowflake.com/en/user-guide/ui-snowsight-lineage)
- [Access History](https://docs.snowflake.com/en/user-guide/access-history)
