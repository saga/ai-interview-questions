# 私募信贷、私募股权与信用风险分析

## 本节要解决的问题

私募信贷基金持有一笔面值 3,000 万美元的高级担保贷款。季度监控发现借款人的净杠杆从 4.2x 升到 5.1x，利息保障倍数下降，循环额度又有 700 万美元尚未提款。投资团队想知道：契约是否接近触发？若借款人违约，基金实际暴露是多少？这笔贷款的价值变化是否会影响基金整体回报？

私募信贷和私募股权都依赖非上市企业数据，但风险与绩效的衡量方式不同。私募信贷重点看借款人现金流、债务结构、担保品、契约、偿付和违约回收；私募股权还要看投资估值、资本调用、分配和退出。把两类资产都简单归为“非流动性投资”，会掩盖它们的数据粒度和风险驱动差异。

## 核心知识

### 先按 Borrower、Facility、Tranche 和 Valuation Date 建立数据粒度

同一借款人可能同时有 Term Loan A、Term Loan B、Revolver 和 PIK Notes；每种工具的优先级、利率、到期日、担保和提款状态可能不同。建议至少保留以下对象：

| 对象 | 一行代表什么 | 关键字段 |
|---|---|---|
| BORROWER | 一个借款法律实体 | borrower_id、集团关系、行业、注册地 |
| FACILITY | 一份信贷协议下的融资额度 | facility_id、承诺额、币种、到期日、循环/定期 |
| TRANCHE | 一项有独立条款的债务工具 | tranche_id、优先级、担保类型、利率、摊还条款 |
| POSITION_SNAPSHOT | 某基金在某估值日持有的贷款份额 | fund_id、tranche_id、持有本金、估值、应计利息 |
| BORROWER_FINANCIALS | 借款人在一个报告期的财务数据 | period_end、revenue、EBITDA、cash、debt |
| COVENANT_TEST | 某贷款在测试日的契约计算 | covenant_id、test_date、actual_value、limit、headroom |
| COLLATERAL_VALUATION | 某项担保品在估值日的价值 | collateral_id、valuation_date、value、haircut、source |
| CREDIT_EVENT | 一项违约、豁免、延期或重组事件 | event_type、effective_date、status、evidence_id |

Borrower、Facility 和 Tranche 不能混成一个键。一个借款人集团内可能有多个法律实体；一份 Facility 也可能包含多个 Tranche。若把借款人层面的 EBITDA 直接 Join 到每一笔贷款，再重复汇总集团债务，就会发生重复计数。借款人财务、贷款本金、基金持仓和估值应在各自粒度核算后再关联。

### 契约监控要计算余量，而不只是标记是否违约

常见财务契约包括：
- Total Net Leverage：净债务 / Covenant EBITDA；
- Interest Coverage：契约定义的 EBITDA 或现金流指标 / 利息费用；
- Fixed Charge Coverage：可用于偿付的现金流 / 固定偿付义务；
- Minimum Liquidity：可用现金和符合条件的未提款额度下限。

每份 Credit Agreement 对定义可能不同。例如 Covenant EBITDA 可能允许某些一次性费用和协同效应加回；净债务可能允许扣除受限制程度不同的现金；利息支出也可能包括或排除 PIK 利息。不能拿财务报表 EBITDA 直接替代契约 EBITDA。

假设贷款契约规定 Total Net Leverage 不得超过 5.5x，最近测试日净债务为 4.8 亿美元，契约 EBITDA 为 1 亿美元：

\[
ActualLeverage = 480 / 100 = 4.8x
\]

\[
MaximumNetDebt = 5.5 \times 100 = 550
\]

\[
DebtHeadroom = 550 - 480 = 70\text{ million}
\]

当前余量是 0.7x 或 7,000 万美元的净债务空间。若 EBITDA 下滑至 8,500 万美元而净债务不变，杠杆会上升到约 5.65x，超过该示例的 5.5x 上限。

这只是教学数据。生产模型必须保存契约条款版本、定义、加回项目、测试周期、豁免和计算来源。接近限额不等于已违约；是否触发 covenant breach 还要按协议中的 cure period、测试日、豁免条款和法律判断确认。

### 现金利息、PIK 利息和可用额度会改变实际现金风险

私募信贷贷款的现金收益率不能只看名义票息。需要区分：
- Cash Interest：借款人按期实际支付的现金利息；
- PIK Interest：利息资本化并增加本金余额，当前不产生等额现金流；
- OID / Upfront Fee：初始发行折价和前端费用；
- Floating Rate：基准利率加 Margin，另有 Floor、Cap 或 Reset Date；
- Undrawn Commitment：尚未提款但可能在压力情景下变成 EAD 的额度；
- Amortization / Maturity：本金摊还计划和最终到期集中偿还。

例如一笔 3,000 万美元 Term Loan，现金利息为 SOFR + 550bp，另有 200bp PIK。借款人当前的现金利息负担与合同总收益率不是一回事。PIK 会增加到期本金，也可能使未来违约时的 EAD 增大。循环额度的已提款金额之外，还要根据适用风险模型判断未提款部分的信用转换和潜在提款。

### PD、LGD 和 EAD 是不同风险参数，不能彼此替代

在采用 Basel 信用风险参数口径时：
- PD（Probability of Default）：给定时间窗口内违约的可能性；
- LGD（Loss Given Default）：发生违约后，在回收和担保品处置后损失占 EAD 的比例；
- EAD（Exposure at Default）：违约时预期暴露金额，包括当时本金、应计项目以及适用的未提款额度转换。

预期损失可写为：

\[
ExpectedLoss = PD \times LGD \times EAD
\]

假设某贷款的一年期 PD 为 3%，LGD 为 40%，预计违约时 EAD 为 2,700 万美元：

\[
ExpectedLoss = 3\% \times 40\% \times 27m = 0.324m
\]

示例预期损失为 32.4 万美元。它不是贷款的市场公允价值，也不能直接等同于会计减值准备。模型应明确 PD 时间窗口、违约定义、LGD 回收期和处置折价，以及 EAD 对未提款承诺的处理。不同基金策略和会计/监管框架可能采用不同口径。

### 担保品估值和债权优先级决定回收，不只是账面覆盖率

一笔贷款有担保，不代表违约时能按担保品当前估值全额回收。需要记录：
- 担保品类型、法律权属、抵押顺位和可执行性；
- 最新估值日期、估值机构、估值方法和币种；
- 处置时滞、折价、法律费用和税费；
- 同一资产上的优先债权、留置权和其他担保；
- 担保品是否已经出售、转移或追加抵押。

LTV、Recovery Rate 和 LGD 的分母与资产口径必须一致。企业价值、担保品价值和借款人股权价值不是同一个数字。担保品价值下降也可能与借款人现金流恶化同时发生，因此不能把历史平均 LGD 直接用于所有贷款。

### 私募股权绩效要分 Fund-Level 与 Portfolio-Level

私募股权基金的业绩数据同时涉及基金与 LP 之间的现金流，以及基金与被投企业之间的现金流。ILPA 的 Performance Template 将两者分别报告，避免把 Gross Portfolio Return 和 LP 实际 Net Return 混为一谈。

常用指标：

| 指标 | 含义 | 主要用途 |
|---|---|---|
| DPI | Distributions to Paid-In | 已分配现金相对实缴资本的倍数 |
| RVPI | Residual Value to Paid-In | 尚未实现价值相对实缴资本的倍数 |
| TVPI | Total Value to Paid-In | DPI + RVPI，反映已分配与剩余价值 |
| IRR | Internal Rate of Return | 按现金流金额和日期计算的年化回报 |
| MOIC | Multiple on Invested Capital | 已实现/未实现价值相对投资成本的倍数 |

不能只看 TVPI 或 IRR。未实现资产的公允价值可能受估值模型影响；IRR 还会受到资本调用、分配时点以及 Subscription Facility 的影响。比较基金时应同时看 gross/net、基金层面/投资组合层面、realized/unrealized，以及是否受 Subscription Facility 影响。

ILPA Performance Template 适用于 2026 年 1 月 1 日或以后开始运营的基金；其模板对不同 GP 现金流处理方法提供不同版本。历史基金和不同报告模板之间的比较要保留口径差异，不能把一个基金的 gross portfolio IRR 与另一个基金的 net LP IRR直接排名。

### 私募信贷监控需要同时保留定量结果和原始证据

借款人季度报告中的 EBITDA、净债务、流动性和契约计算往往依赖财报、合规证书、审计说明和贷款协议。系统应把计算结果链接到：
- 财务报表的具体期间和页码；
- Covenant Compliance Certificate 的定义和签署日期；
- Loan Agreement 的条款编号及修订版本；
- 担保品估值报告及估值日期；
- Waiver / Amendment 的审批与生效日期；
- 监控人员的复核结论。

Agent 可以提取契约数字、比较前后期变化并列出异常，但不能仅凭 OCR/检索结果就确认违约或自动豁免契约。必须回到合同条款、最新合规证书和授权人员判断。

## 工程实施步骤

1. 建立 Borrower、Legal Entity、Facility、Tranche、Fund Position 和 Collateral 的稳定标识及关系。
2. 将贷款条款、修订协议、财报、合规证书、担保品报告和交易记录分别登记版本、日期、来源和访问范围。
3. 对每个 Tranche 明确利率结构、现金/PIK 利息、基准利率 Floor、未提款承诺、摊还和到期日。
4. 按合同定义计算 EBITDA、净债务、利息保障倍数、契约限额和余量；保存每项加回、调整和来源页码。
5. 将 Covenant Test、Waiver 和 Default Event 作为有状态、有生效日期的记录保存，不覆盖历史判断。
6. 对 PD、LGD、EAD 分别保存模型版本、时间窗口、回收假设和未提款额度处理，并独立验证 Expected Loss 计算。
7. 按抵押优先级和处置成本评估担保品回收，不将企业价值或账面估值直接当成可回收现金。
8. 私募股权现金流按 Fund-Level 和 Portfolio-Level 分开存储，记录 Capital Call、Distribution、Valuation、Realized/Unrealized 和 Subscription Facility 影响。
9. 按 ILPA 适用模板计算 DPI、RVPI、TVPI、IRR 和 MOIC，保留 Gross/Net 与 Fund/Portfolio 报告边界。
10. 为借款人风险迁移、契约余量下降、流动性不足、付款迟延、估值过期和未提款额度集中设置监控。
11. 用来源证据复核 Agent 抽取的财务数字、条款、发布日期和政策版本；缺失或冲突的资料进入人工调查队列。
12. Agent 的输出用于风险摘要、差异分析和尽调准备；违约确认、契约豁免、估值调整和交易决策必须由授权人员处理。

## 场景分析

借款人 B 有一笔 3,000 万美元 Term Loan 和 700 万美元未提款 Revolver。季度合规证书显示净债务 4.8 亿美元、Covenant EBITDA 1 亿美元，净杠杆限额为 5.5x。财务报表同时披露现金利息 2,100 万美元和 PIK 利息 500 万美元。

系统应先按贷款协议的定义重算 EBITDA 和净债务，再将 4.8x 的实际杠杆与 5.5x 上限比较，得出 0.7x 的契约余量。若借款人 EBITDA 下一季度下降到 8,500 万美元，而净债务保持不变，模型计算的杠杆约为 5.65x，提示可能超过上限；这仍需按合同测试日和 Cure Period 确认，不应直接将状态标成已违约。

PD/LGD/EAD 分析要单独处理未提款的 700 万美元 Revolver，不能只用当前已提款本金。担保品回收模型还要考虑优先级、估值折价和处置费用。风险 Agent 应把财务报表、合规证书和协议条款链接到同一 Borrower/Facility/Tranche，并将定义不一致的项目列为待复核。

## 常见误区

- **把借款人、Facility 和 Tranche 当成同一层级。** 多个融资工具的利率、优先级、担保和到期条款可能不同。
- **直接用财报 EBITDA 计算 Covenant Leverage。** 契约 EBITDA 可能有特定定义、加回和限制，应按协议重算。
- **把 PIK 利息当成已收到现金。** PIK 会增加债务本金，但不是当前现金流入。
- **只用当前已提款本金计算 EAD。** 未提款承诺在违约前可能被使用，需要依模型定义处理。
- **把 PD × LGD × EAD 当成公允价值或会计减值。** 预期损失、估值和会计减值属于不同口径。
- **用担保品市值直接当回收金额。** 还要考虑抵押顺位、处置时间、折价和成本。
- **只比较私募股权基金 IRR 或 TVPI。** 要同时看 gross/net、基金层面/投资组合层面、realized/unrealized 和 Subscription Facility 影响。
- **把接近 covenant limit 当作已违约。** 需要检查测试日、定义、豁免和 Cure Period。
- **用 2013 年旧版美国 Leveraged Lending Guidance 的 6x 值作为通用监管阈值。** OCC 和 FDIC 于 2025 年 12 月撤销该指导文件；不能把它作为当前普遍适用的硬阈值。
- **让 Agent 自动认定违约、批准豁免或修改估值。** 这些结论依赖合同、完整证据和授权审批。

## 完成标准

- [ ] 能区分 Borrower、Facility、Tranche、Position 和 Collateral 的数据粒度。
- [ ] 能按 Loan Agreement 定义计算杠杆、利息覆盖和 Covenant Headroom。
- [ ] 能区分现金利息、PIK 利息、未提款额度和到期偿还风险。
- [ ] 能说明 PD、LGD、EAD 的含义并计算示例 Expected Loss。
- [ ] 能解释担保品估值、优先级和处置成本如何影响回收。
- [ ] 能区分私募股权 Fund-Level 与 Portfolio-Level 的 Gross/Net 表现指标。
- [ ] 能使用 ILPA 口径解释 DPI、RVPI、TVPI、IRR 和 MOIC。
- [ ] 能将财务数据、契约条款、报告版本和 Agent 摘要关联到可审计证据。

## 自测

1. 一个 Borrower 有 Term Loan、Revolver 和 PIK Notes。为什么不能只按 borrower_id 汇总所有条款和本金后就完成 tranche-level 风险分析？
2. Covenant Net Leverage 上限 5.5x，净债务 4.8 亿美元，Covenant EBITDA 1 亿美元。当前 headroom 是多少？如果 EBITDA 下滑到 8,500 万美元，杠杆是否仍在限额内？
3. 贷款有 700 万美元未提款 Revolver。为什么当前账面本金不是唯一的 EAD 输入？
4. PD=3%、LGD=40%、EAD=2,700 万美元。Expected Loss 是多少？它为什么不等同于贷款公允价值？
5. 私募股权基金的 Fund-Level Net IRR 与 Gross Portfolio IRR 为什么不能直接横向比较？
6. Agent 从合规证书中提取出 covenant breach，但贷款协议有 30 天 Cure Period。系统应如何区分计算预警、正式违约状态和人工法律判断？

## 参考资料

- [ILPA Performance Template](https://ilpa.org/industry-guidance/templates-standards-model-documents/ilpa-templates-hub/ilpa-performance-template/)
- [ILPA Performance Template Suggested Guidance](https://ilpa.org/wp-content/uploads/2025/01/ILPA-Performance-Template-Suggested-Guidance-Granular-Methodology.pdf)
- [Basel Framework: Calculation of Expected Losses](https://www.bis.org/committees/bcbs/basel-framework/standard/srp/32/inforce/2023-01-01/published/2020-03-27.htm)
- [Interagency Statement on Withdrawal from the Leveraged Lending Guidance](https://www.occ.gov/news-issuances/news-releases/2025/nr-ia-2025-119.html)
- [Snowflake Model Registry](https://docs.snowflake.com/en/developer-guide/snowflake-ml/model-registry/overview)
