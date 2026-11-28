# 组合构建、优化、回测与压力测试

## 本节要解决的问题

投资团队准备在全球股票组合中加入新的行业策略。研究员给出了一组预期收益和协方差矩阵，优化器返回了一个“最优组合”，但投资经理发现它把 42% 的权重配置给了同一行业中的三只股票；回测报告又没有扣除换手成本，结果看上去明显好于实际可执行的策略。

组合优化不是把历史收益率输入 Solver 后取最大值。输入数据是否可在决策时获得、目标函数是否符合投资目标、约束是否真实、交易成本如何处理，以及回测是否模拟真实交易流程，都会改变结果。Snowflake 适合承载证券主数据、价格、持仓、风险输入和实验结果；数值优化器负责求解权重，Agent 可以组织和解释流程，但不能代替约束求解和风险审批。

## 核心知识

### 优化开始前先确定投资范围和决策时点

每次再平衡都需要一份带时间戳的可投资证券清单。清单至少要说明：
- 证券身份和上市/退市状态；
- 在该决策日是否允许投资；
- 币种、资产类别、行业和国家分类；
- 停牌、流动性、交易单位和做空限制；
- 价格与公司行动数据在决策时是否已经可用。

如果回测只保留当前仍然上市的证券，已经退市或合并的公司会消失，形成 Survivorship Bias。如果用本月最终公布的财报指标构建上月组合，就引入 Look-ahead Bias。Universe Snapshot、Fundamental Snapshot 和行情的可用时间必须能够还原到每个再平衡日。

### 优化目标必须对应明确的风险和收益口径

最小方差模型是一个常见起点。设 \(w\) 是证券权重，\(\Sigma\) 是同一估计窗口、同一收益频率下的协方差矩阵：

\[
\min_w \quad w^\mathsf{T}\Sigma w
\]

典型约束包括：

\[
\sum_i w_i=1,\quad 0\le w_i\le u_i
\]

其中 \(u_i\) 是单证券上限。还可以增加行业上限、国家上限、最低流动性、跟踪误差、目标收益、现金比例和换手约束。

最大化预期收益或 Sharpe Ratio 是不同的目标，不应把它们混为“优化”。预期收益估计误差通常比优化器的数值误差更大；一个求解器可以精确地优化一组不可靠的输入。上线前要记录收益预期、协方差、估计窗口、缺失值处理和参数版本。

### 用明确的约束和交易成本求解，不依赖 Agent 生成权重

下面的例子使用 CVXPY 展示一个最小方差组合。预期收益和协方差矩阵是由上游研究流程生成并经过验证的数据，不是模型临时猜测的数值：

~~~python
import cvxpy as cp
import numpy as np

# mu: annualized expected returns, shape (n,)
# cov: annualized covariance matrix, shape (n, n)
# previous_weights: current portfolio weights, shape (n,)

n = len(mu)
weights = cp.Variable(n)

max_weight = 0.20
min_expected_return = 0.06
turnover_penalty = 0.002

objective = cp.Minimize(
    cp.quad_form(weights, cov)
    + turnover_penalty * cp.norm1(weights - previous_weights)
)

constraints = [
    cp.sum(weights) == 1,
    weights >= 0,
    weights <= max_weight,
    mu @ weights >= min_expected_return,
]

problem = cp.Problem(objective, constraints)
problem.solve(solver=cp.OSQP)

if problem.status not in ("optimal", "optimal_inaccurate"):
    raise RuntimeError(f"Optimization failed: {problem.status}")

candidate_weights = np.asarray(weights.value).ravel()

assert np.isclose(candidate_weights.sum(), 1.0, atol=1e-6)
assert candidate_weights.min() >= -1e-6
assert candidate_weights.max() <= max_weight + 1e-6
assert mu @ candidate_weights >= min_expected_return - 1e-6
~~~

这里的 L1 换手惩罚是一个简化项，用于说明如何把交易活动纳入目标函数；真实交易成本还可能包含佣金、税费、买卖价差、市场冲击、最小交易单位和流动性约束。若模型允许做空或使用杠杆，权重边界、净敞口和总敞口约束也必须重新定义。

在生产环境中，CVXPY 等求解器可以运行在经批准的 Python/容器环境中，优化输入和结果再写回 Snowflake。不要默认任意 Python 优化库都能直接安装在 Snowflake Notebook 或 Warehouse Runtime；先确认目标 Runtime 的包和执行限制。

### 回测要按真实时间顺序模拟“当时能做出的决策”

可靠的回测不是在整个历史区间先算好一次权重，再把它应用到每一天。滚动回测通常按以下顺序推进：

1. 在再平衡日期 \(t\)，确定当时可投资的证券集合。
2. 只使用截至 \(t\) 已经可获得的数据估计收益、风险和约束。
3. 求解目标权重，并按实际执行时点生成订单。
4. 在下一持有期应用实际总回报、现金流和公司行动。
5. 扣除交易成本、融资成本、税费和必要的市场冲击。
6. 到下一再平衡日重新估计，再重复整个流程。

如果用收盘后才能得到的收盘价计算权重，又假设以同一个收盘价成交，通常会产生不可执行的回测假设。应该明确决策时间、信号可用时间、订单提交时间和成交价格的时间关系。

### 压力测试补充历史回测没有覆盖的市场状态

历史回测只覆盖样本中出现过的环境。压力测试可以构造组合对市场冲击的敏感性，例如：

| 冲击 | 需要重新估算的风险 |
|---|---|
| 股票市场下跌 20% | 权益敞口、行业集中度和尾部损失 |
| 无风险利率上升 150bp | 债券久期、现金流折现和利率敏感度 |
| 信用利差扩大 250bp | 信用债价格、违约概率和流动性折价 |
| 本币对 USD 贬值 10% | 未对冲外汇敞口和资产负债币种错配 |
| 主要行业停牌或流动性下降 | 可交易性、变现时间和集中度约束 |

冲击幅度只是情景参数，不是预测。还要测试组合在冲击后是否违反投资授权、杠杆、流动性或保证金要求。对于多个风险驱动因素同时变化的情景，不能简单把各个独立冲击的损失相加，除非模型明确采用线性近似。

## 工程实施步骤

1. 在 Snowflake 中保留有生效时间的 Universe Snapshot、证券主数据、价格、公司行动、收益、风险和持仓快照。
2. 为每次优化建立 experiment_id，记录 rebalance_date、数据截止时间、Universe 版本、收益估计窗口、协方差版本和约束版本。
3. 先做输入质量检查：证券标识唯一性、退市证券、缺失收益、价格日期、币种、异常值和协方差矩阵半正定性。
4. 将输入数据按再平衡日期导出或传给受控 Python 优化环境，确保只使用决策时点已知的数据。
5. 保存目标函数、约束、求解器版本、求解状态、候选权重和约束余量。
6. 将候选权重与当前权重比较，计算交易金额、换手率、流动性占比和预计成本。
7. 用真实成交时间与可执行价格回放下一持有期；处理停牌、退市、分红、拆股、换股和现金流。
8. 执行滚动或 Walk-forward 回测，并与基准、原组合及简单策略进行同口径比较。
9. 计算年化收益、波动率、最大回撤、Sharpe、换手率、容量和成本后收益；不要只展示一个 Sharpe Ratio。
10. 对利率、股市、信用利差、汇率和流动性执行历史及假设情景压力测试。
11. 将 Solver 失败、约束不可行、数据缺失和结果异常分开记录；不要自动放宽投资约束来追求可行解。
12. 由投资与风险负责人复核候选权重、假设和压力结果，再走交易授权流程；Agent 只能准备分析材料，不能自动批准组合变更。

## 场景分析

某全球股票策略每月末再平衡。研究团队使用过去 252 个交易日估计预期收益和协方差，优化器给出 30 只股票的目标权重。回测显示年化收益 12%，基准为 8%。

进一步检查发现，策略在每个月末使用了当月最后一个交易日收盘后的财务指标，却假设在当日收盘价成交；回测的证券清单也只保留了当前仍上市的股票。两个问题都可能抬高历史表现。

修正方式是按信息实际公开时间构建 Point-in-time Fundamental Snapshot，使用当时可投资的证券集合，并将决策时间与成交时间分开。回测还要扣除换手成本和市场冲击，再比较成本前后收益、回撤和换手率。如果修正后模型不再优于基准，应如实报告，而不是通过调整窗口直到得到更好结果。

## 常见误区

- **把 Solver 返回 optimal 当成投资组合可执行。** 数值最优只说明模型满足了输入的目标与约束；输入、成本和市场可交易性仍需检查。
- **只用当前仍上市证券回测历史。** 这会产生 Survivorship Bias。
- **在历史回测中使用后来才公布的数据。** 这会产生 Look-ahead Bias。
- **忽略换手成本和成交时点。** 理论权重不等于可实现收益。
- **只追求最大收益或最高 Sharpe。** 还要考虑约束、容量、流动性、回撤和估计不确定性。
- **把压力情景当作概率预测。** 情景用于观察敏感性，不意味着该冲击一定发生。
- **让 Agent 自行决定放宽约束或发布权重。** 投资授权和风险边界必须由明确规则和负责人控制。

## 完成标准

- [ ] 能定义投资范围、数据截止时间和 Point-in-time Universe。
- [ ] 能区分目标函数、约束条件和求解器状态。
- [ ] 能检查权重和风险约束，并把交易成本纳入评估。
- [ ] 能按时间顺序执行滚动/Walk-forward 回测。
- [ ] 能识别 Survivorship Bias、Look-ahead Bias 和不可执行的成交假设。
- [ ] 能设计历史和假设压力测试，并说明其局限。
- [ ] 能区分 Agent 的编排/解释职责与数值优化、投资审批职责。

## 自测

1. 优化器返回所有约束均满足的权重，但 35% 组合权重集中在同一行业。应检查输入、行业约束还是求解器状态？为什么？
2. 回测使用了月末最后一天收盘后的财报数据，又假设在当天收盘成交。这里分别存在什么时间问题？
3. 当前证券名单中没有已经退市的公司。用这份名单回测五年前的策略会造成什么偏差？
4. 目标权重变化很大，但模型没有交易成本项。回测的毛收益与可实现净收益会有什么差异？
5. 优化器报告 infeasible。为什么不能自动删除行业上限或放宽风险约束来让求解器返回结果？
6. 压力测试中权益下跌、信用利差扩大和本币贬值同时发生。为什么不能总把三个独立单因子损失直接相加？

## 参考资料

- [CFA Institute: Backtesting & Simulation (2026 curriculum)](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/backtesting-and-simulation)
- [CFA Institute Research Foundation: Investment Model Validation](https://rpc.cfainstitute.org/research/foundation/2023/investment-model-validation)
- [Snowpark Python DataFrames](https://docs.snowflake.com/en/developer-guide/snowpark/python/working-with-dataframes)
