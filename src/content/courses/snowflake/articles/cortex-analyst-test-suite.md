# Cortex Analyst 金标准问题集与 Text-to-SQL 回归

## 本节要解决的问题

财务团队维护一份销售分析 Semantic View。过去一个月，业务用户反复报告三个问题：
- “净销售额”有时返回订单头金额，有时返回订单明细金额；
- “去年同期”在季度边界上多包含或少包含一天；
- 一次 Relationship 调整后，之前正确的地区销售额查询开始重复累计。

单条 SQL 在 Snowsight 中能执行，只能说明它语法上可运行。要判断 Cortex Analyst 是否持续按业务口径生成查询，需要用真实业务问法、经过审核的金标准 SQL 和固定数据条件做回归。Cortex Analyst Evaluations 提供的核心机制是：对 Semantic View 中的 Verified Queries 执行生成 SQL，并比较查询结果，而不是对 SQL 文本逐字比对。

## 测试集的基础单元是 Verified Query

### 一条 VQ 是自然语言问题与期望 SQL 的配对

Cortex Analyst Evaluations 使用 Semantic View 关联的 Verified Queries 作为评测集。每条 Verified Query 包含：
- 自然语言问题；
- 对应的 SQL 查询；
- 可选的验证人、验证时间和 onboarding 标记等元数据。

SQL 应使用 Semantic View 的逻辑表和逻辑列，而不是绕过语义层直接引用物理表。问题要来自真实业务表达，同时把隐含口径变成明确的约束。

例如，不要只写“上季度各地区净销售额是多少？”，还要让 VQ 的 SQL 固定业务定义：
- 使用已批准的 Net Sales Metric；
- 按客户地区分组；
- 使用明确的财务季度和时区边界；
- 排除取消订单；
- 不重复累计订单头事实。

如果“净销售额”或“地区”尚未在 Semantic View 中定义清楚，就不应该先写 VQ 来绕过建模工作。应先解决指标和 Relationship，再把查询固化为金标准。

### VQ 应覆盖真实问法和容易出错的边界

一个可维护的测试集不需要大量近义句，而要覆盖不同的语义和关系路径：

| 类别 | 示例 | 要检查的核心问题 |
|---|---|---|
| 常用指标 | 按地区查询净销售额 | Metric 是否选对 |
| 粒度问题 | 平均订单金额 | 是否把头表金额按明细行重复累计 |
| 日期边界 | 2026 年 Q3 | 起止日期、时区和财务日历 |
| 维度关系 | 按客户地区汇总 | Relationship/Join 路径 |
| 过滤条件 | 排除取消订单 | 状态过滤是否一致 |
| 历史口径 | 某日生效的客户分层 | 是否使用当时有效的维度 |
| 不支持的指标 | 当前语义视图没有定义某项风险指标 | 是否承认无法回答，而不是猜列名 |

不要为了增加测试数量批量复制同一句问题并替换地区名称。相似样例只有在能检验不同关系、过滤、时间边界或指标定义时才值得加入。

## Cortex Analyst Evaluation 实际测量什么

### SQL Correctness 比较查询结果，不要求文本完全相同

Cortex Analyst Evaluation 执行生成的 SQL，并与对应 Verified Query 的结果进行比较。生成 SQL 的别名、Join 顺序或表达形式可以不同，只要结果在评测语义下正确，就不应因文本不同而判错。

评测结果主要包括：
- **Accuracy**：生成 SQL 被判断为正确的 Verified Query 百分比；
- **Regressions**：此前正确、当前版本失败的查询数量；
- **Latency**：Cortex Analyst 查询响应耗时；
- **Per-query result**：自然语言问题、期望 SQL、生成 SQL 和本次是否正确。

目前 Cortex Analyst Evaluations 支持的指标是 SQL Correctness。它不是通用 Agent Evaluation，不会检查 Search 引用、Agent Router、外部 API、最终中文回答质量或用户权限策略。若应用已经迁移到 Cortex Agents，仍要用 Agent Evaluation 和应用层测试覆盖工具选择、最终答案和跨工具证据关联；不要把 Analyst SQL Correctness 当成整个 Agent 应用的验收。

### 评测会移除被选作 Ground Truth 的 VQ，防止自我命中

运行评测时，Snowflake 会为此次 Evaluation 创建一份临时 Semantic View 副本，并从副本中移除本次选作 Ground Truth 的 Verified Queries。Analyst 在评测时不能直接命中这几条 VQ，从而避免只靠完全匹配的已验证问题获得虚高成绩。

没有被选作 Ground Truth 的其他 VQ 仍然留在临时语义视图中，可以像正常运行时一样指导 Analyst。

这意味着同一条 VQ 可以作为运行时优化样例，也可以作为某一次 Evaluation 的测试答案，但不能在同一次评测中同时充当两种角色。对高频问题，应准备多个等价但非重复的 VQ，并轮换选择评测子集，避免整个测试集都被模型直接记住。

### 固定日期和数据条件，避免金标准漂移

“上季度”“最近一个月”“当前活跃客户”都会随时间变化。若 VQ 的 SQL 每次执行都读取相对日期，而底层数据持续更新，那么同一条问题的 Ground Truth 结果会变化。测试失败可能来自数据变化，而不是语义模型退化。

推荐将问题集按数据类型分层：
- 对历史数据问答，使用绝对业务日期和稳定的历史数据；
- 对动态指标，固定数据快照或在测试前保存预期结果；
- 对边界测试，明确时区、财务日历、起止日期是否采用半开区间；
- 对状态字段，固定允许状态和过滤规则；
- 对维度有效期，固定事件日和当时的维度版本。

如果无法固定数据快照，就要明确区分“语义定义回归”和“业务数据每天变化”的验证目标，不应把实时数据差异误判成模型质量变化。

## 创建和运行 Evaluation

### 运行 Evaluation 需要额外的角色权限

Evaluation 不是简单调用一次 Analyst API。它通过 Snowflake Task 执行，并调用 Judge Model。运行 Role 所需权限包括：
- SNOWFLAKE.CORTEX_USER；
- USE AI FUNCTIONS 账户权限，或适用的单函数权限；
- EXECUTE TASK ON ACCOUNT；
- Semantic View 所在 Schema 的 CREATE TASK；
- 用于保存 Evaluation 数据的 Schema 上的 CREATE DATASET；
- Semantic View 和其引用的底层表/视图的 SELECT；
- Semantic View 的 MONITOR；
- Snowsight 中运行时所需的 Warehouse USAGE；
- 若启用了模型级访问控制，还需相应 Judge Model 的访问权限。

这些权限必须在同一个 Primary Role 下具备。Evaluation 使用 Snowflake Task 运行，不会把 Secondary Role 权限合并进来。直接调用 AI_COMPLETE 成功，不代表 Evaluation 的 Judge Model 权限就一定齐全。

如果所有评测结果突然都是 0 分，或 Judge 调用被拒绝，应先检查 USE AI FUNCTIONS、Judge Model RBAC 和 Evaluation Role，而不是立即认定语义模型整体退化。

### 在 Snowsight 中创建一轮评测

对一个已有 Verified Query Repository 的 Semantic View：
1. 在 Snowsight 打开 AI & ML → Cortex Analyst；
2. 选择需要评测的 Semantic View；
3. 打开 Evaluations；
4. 创建 Evaluation Run 并设置唯一 run name；
5. 选择 SQL Correctness Metric Version；
6. 选择本次作为 Ground Truth 的 Verified Queries；
7. 启动运行，查看 Accuracy、Regressions、Latency 和逐条 SQL 对比。

Metric Version 会固定 Judge Model、Prompt、Rubric 和阈值。不同版本的分数不能直接混在同一条趋势线上；应在测试集、Semantic View 和 Metric Version 固定的条件下比较模型或语义定义变更。

### 用 SQL 将评测接入回归流程

也可以将 Evaluation 配置 YAML 放到 Stage，再调用 EXECUTE_AI_EVALUATION：

~~~sql
CALL EXECUTE_AI_EVALUATION(
  'START',
  OBJECT_CONSTRUCT('run_name', 'sales_semantic_regression_2026_11_28'),
  '@EVAL_DB.EVAL_SCHEMA.CONFIG/analyst_evaluation.yaml'
);
~~~

查询状态：

~~~sql
CALL EXECUTE_AI_EVALUATION(
  'STATUS',
  OBJECT_CONSTRUCT('run_name', 'sales_semantic_regression_2026_11_28'),
  '@EVAL_DB.EVAL_SCHEMA.CONFIG/analyst_evaluation.yaml'
);
~~~

完成后，在 Snowsight 查看结果，或使用 GET_ANALYST_AI_EVALUATION_DATA 获取逐条评测数据。CI/CD 可以在 Semantic View、Relationships、Metrics、VQR 或模型配置变更后触发评测，再比较本次 Accuracy、Regressions 和 Latency 与基线。

## 结果失败后如何定位

### 先看失败的 VQ，再判断是模型、语义定义还是数据

当一条问题从正确变成错误时，不要第一时间扩写 prompt。先比较：
- 生成 SQL 是否选择了不同 Metric；
- Join 路径是否变化；
- 过滤条件和日期边界是否改变；
- 事实表粒度是否被错误扩展；
- Semantic View Relationship、Primary Key 或派生指标是否变更；
- Verified Query 金标准是否仍符合当前业务定义；
- 底层数据是否真的发生变化。

示例：地区销售额在一次 Semantic View 变更后从 120 万变成 240 万。若生成 SQL 将 ORDERS 与 ORDER_LINES 一对多 Join 后 SUM(ORDERS.ORDER_TOTAL)，问题是指标粒度/Join 造成重复累计；不应通过更新 Ground Truth 把 240 万“接受”为新正确结果。

### 性能回归与正确性回归要分开处理

SQL Correctness 通过，并不代表查询性能符合生产目标。Latency 是单独记录的指标；在实际发布门禁中还要结合 Query History/Profile 检查扫描量、Warehouse 排队、Join 扩行和 Spill。

反过来，查询耗时变快也不能证明指标正确。不要把 Accuracy、Regressions 和 Latency 合并成一个没有解释的总分。发布条件应分别设置正确性底线、回归容忍度和性能目标。

## 工程实施步骤

1. 盘点 Semantic View 的关键 Metrics、Dimensions、Relationships 和 Verified Queries。
2. 为每条 VQ 确认真实业务问法、逻辑 SQL、指标口径、日期边界和 owner。
3. 按常用、歧义、Join 粒度、历史维度、边界日期和不可回答问题分组。
4. 对需要历史可复现的测试固定绝对日期和源数据快照；对动态数据明确漂移处理方式。
5. 确认评测 Role 的权限在一个 Primary Role 下完整具备，并核对 Judge Model 的 RBAC。
6. 确定 Metric Version 和评测子集；记录本次作为 Ground Truth 的 VQ，避免与运行时引导样例混淆。
7. 在 Snowsight 或 EXECUTE_AI_EVALUATION 中运行评测。
8. 对每条失败比较 Expected SQL、Generated SQL、执行结果、语义关系和数据快照。
9. 将失败归类为 Metric 定义、Join 基数、过滤边界、时态关系、数据变化或生成偏差。
10. Semantic View、Relationship、Metric、VQR 或模型修改后，用同一套回归集重跑。
11. 将 Accuracy、Regressions、Latency 和 Query Profile 分开设定验收门槛。
12. 将评测记录、版本、VQ、SQL 差异、Query ID 和修复理由纳入发布审查。

## 场景分析

销售 Semantic View 有 40 条 Verified Queries。某次开发者修改了客户地区 Relationship，使原本按客户当前地区汇总的查询改成按订单发生时的历史地区汇总。

评测中 6 条问题从正确变成失败：
- 3 条生成 SQL 仍使用当前客户地区；
- 2 条 SQL 选择了另一条客户关系路径；
- 1 条 VQ 本身仍按旧业务口径写 SQL。

正确处理是先确定此次变更是否要改变历史分析口径，再更新相关 Semantic View 定义和 VQ。不能为了让 Accuracy 回到 100% 而把所有失败 SQL 和 VQ 改成新结果；要由业务 owner 确认预期语义后，更新金标准并重新运行回归。

如果评测中 6 条问题都失败，但错误信息指向 Judge Model 权限，先修复 Evaluation Role；权限错误造成的 0 分不是 SQL 生成能力退化。

## 常见误区

- **要求 SQL 文本完全一致。** SQL 可以有不同的别名、Join 顺序和表达形式，评测关注执行结果是否正确。
- **只收集简单 happy-path 问题。** 测试集还要覆盖歧义、日期边界、Join 粒度和不可回答问题。
- **将 Verified Query 当作未经验证的 SQL 样例库。** 每条 VQ 必须由业务 owner 核对问题、口径和结果。
- **同一条 VQ 同时指导生成又作为本轮 Ground Truth。** 评测会从临时语义视图移除被选的 VQ，以避免自我命中。
- **使用相对日期作为稳定金标准。** 数据和时间变化可能造成测试漂移。
- **只看 Accuracy，不看 Regressions 和 Latency。** 新版本可能提升总体准确率，却让几个高价值问题退化或增加延迟。
- **认为评测所需权限可通过 Secondary Role 补齐。** 所需权限必须来自同一个 Primary Role。
- **所有分数为 0 就认为模型变差。** 先排查 USE AI FUNCTIONS 和 Judge Model RBAC。
- **把 Analyst Evaluation 当成完整 Agent 测试。** 它测量 Text-to-SQL 的 SQL Correctness，不覆盖 Search 引用、工具权限和最终回答行为。

## 完成标准

- [ ] 能设计由真实自然语言问题与期望 SQL 组成的 Verified Query 测试集。
- [ ] 能解释 SQL Correctness 比较的是执行结果，而不是 SQL 文本。
- [ ] 能覆盖常用、歧义、Join、日期、历史维度和不可回答问题。
- [ ] 能解释被选作 Ground Truth 的 VQ 为什么会从临时语义视图移除。
- [ ] 能固定 Metric Version、数据条件和评测子集进行回归。
- [ ] 能列出 Evaluation Role 的权限，并说明必须由同一个 Primary Role 授予。
- [ ] 能分开诊断 SQL 正确性、回归数量和查询延迟。
- [ ] 能说明 Analyst Evaluation 与完整 Cortex Agent Evaluation 的范围差异。

## 自测

1. 一个 Analyst 生成的 SQL 与 VQ SQL 文本完全不同，但执行结果一致。应判为失败还是正确？依据是什么？
2. 为什么评测集要同时包含指标歧义、日期边界、Join 粒度和不可回答问题？
3. 一条 VQ 被选作 Ground Truth 后，为什么不能继续在同一轮评测中指导模型生成？
4. Evaluation Role 的 CREATE TASK 和 Semantic View SELECT 分别授予了两个不同 Role。为什么仍可能运行失败？
5. 所有 SQL Correctness 分数突然为 0，但普通 Analyst 查询正常。应优先检查什么权限？
6. 新版本 Accuracy 上升，但 Regressions 中有一条财务关键指标从正确变为错误。是否可以直接发布？还要看哪些结果？
7. Semantic View 改了 Relationship 后，几条 VQ 失败。如何区分生成 SQL 回归、语义口径有意改变和 Ground Truth 过时？

## 参考资料

- [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
- [Cortex Analyst Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
- [Semantic Views overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [CREATE SEMANTIC VIEW](https://docs.snowflake.com/en/sql-reference/sql/create-semantic-view)
- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
