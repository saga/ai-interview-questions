# Cortex Agent 任务评测、工具轨迹与回归

## 本节要解决的问题

组合研究 Agent 回答：“F01 基金截至 2026-11-27 的科技行业权重是多少？发行人 A 的评级是否下调？”答案看起来合理，但它可能：
- 用了 11 月 26 日的持仓数据；
- 没有调用 Search，只用模型记忆生成研究结论；
- 调用了正确工具，却把错误的基金或估值日传给 Analyst；
- Search 返回了旧版报告，最终答案仍然引用了它。

只检查最终文字无法定位这些问题。Agent Evaluation 要同时测试最终回答、工具选择和工具执行过程，并在模型、提示、工具或数据语义变化后重复同一套案例。

## 核心知识

### 评测数据的 Ground Truth 要描述可判定的正确结果

Cortex Agent Evaluation 的数据表有两列：
- Input Query：输入问题，VARCHAR。
- Ground Truth：预期回答和/或工具调用约束，VARIANT。

Ground Truth 最常用的两个键：
- ground_truth_output：期望的最终回答，用于 answer_correctness。
- ground_truth_invocations：预期工具调用数组，用于 tool_selection_accuracy 和 tool_execution_accuracy。

例如：

~~~sql
CREATE OR REPLACE TABLE agent_eval_cases (
  input_query VARCHAR,
  ground_truth VARIANT
);

INSERT INTO agent_eval_cases
SELECT
  '截至 2026-11-27，基金 F01 的科技行业权重是多少？发行人 A 是否有评级下调？',
  PARSE_JSON('{
    "ground_truth_output": "必须使用 2026-11-27 的 F01 持仓口径。回答应给出科技行业权重、估值日期，以及发行人 A 最近一份在该日期之前发布的评级报告和发布日期。若没有有效报告，必须说明无法确认，不得推测。",
    "ground_truth_invocations": [
      {
        "tool_name": "portfolio_analyst",
        "tool_input": "查询 F01 在 2026-11-27 的行业权重，返回科技行业权重与估值日期。",
        "tool_output": "返回 F01、2026-11-27、Technology 和权重数值。"
      },
      {
        "tool_name": "research_search",
        "tool_input": "检索发行人 A 在 2026-11-27 之前发布的最新评级报告。",
        "tool_output": "返回报告 ID、发布日期、评级变化和可引用原文片段。"
      }
    ]
  }');
~~~

这只是数据结构示意。真实的数值、报告和预期调用必须来自固定的测试数据快照，并由业务专家核验；不能让同一个模型生成题目后再自行编造 Ground Truth 给自己打分。

Ground Truth 应明确：
- 使用哪个绝对日期、期间、币种、基金和数据范围；
- 数字允许的舍入误差、单位、排除项；
- 回答必须覆盖的事实与不允许做出的推断；
- 需要调用哪些工具、工具输入应该包含什么、预期返回哪些关键内容。

如果真实结果会变化，不要硬编码一个永远不适用的数字。可以写成可判定的答案规则，例如“必须给出用户指定估值日的值，并说明该日期；不能用当前日期数据替代”。但规则仍要具体到两个审核者对同一回答能作出相近判断。

### 四种系统指标对应不同的错误类型

| 指标 | 要回答的问题 | Ground Truth 要求 |
|---|---|---|
| answer_correctness | 最终回答是否符合预期事实和约束？ | 读取 ground_truth_output |
| tool_selection_accuracy（Public Preview） | Agent 是否调用了预期工具？ | 读取 ground_truth_invocations 中的 tool_name |
| tool_execution_accuracy（Public Preview） | 工具输入和返回是否符合预期？ | 读取 ground_truth_invocations 中的 tool_input / tool_output |
| logical_consistency | 指令、规划和工具调用是否前后一致？ | Reference-free，不需要 Ground Truth |

这四项不是可互换的总分。Agent 可能选对 Analyst 和 Search，却将不同日期的结果拼在一起；也可能答案碰巧正确，但工具路线与授权设计不符。需要根据具体风险选择指标，而不是默认所有问题都只跑 answer_correctness。

### TSA 与 TEA 的评分方式不同，Ground Truth 不能只填工具名

Tool Selection Accuracy（TSA）比较 Ground Truth 中的预期工具名和真实调用：
- 每个实际调用最多匹配一次；
- 允许多个工具并行或不同顺序，调用顺序不参与评分；
- 计算方式为匹配到的工具数除以预期工具条目数与实际工具调用数的较大值；
- 对给定的实际工具调用记录，TSA 是确定性评分，不使用 LLM Judge。

Tool Execution Accuracy（TEA）会匹配预期工具调用，再评估输入和输出是否符合 Ground Truth：
- tool_input 用来检查 Agent 是否向工具传入正确问题、日期、参数或过滤条件；
- tool_output 用来检查工具是否返回预期数据、SQL、引用或结果；
- 预期工具没有被调用，该项 TEA 得 0；
- 额外调用的工具不通过 TEA 扣分，工具数量或选择错误由 TSA 反映；
- 如果只提供 tool_name、不提供 tool_input/tool_output，TEA 实际上只能确认该工具被调用，不能证明输入和输出正确。

因此，金融或监管场景不应只在 Ground Truth 中列两个工具名。至少为关键工具写明估值日期、基金、证券 ID、搜索时间边界和返回的核心字段。

### 不同工具并不都在 TSA/TEA 的评分范围内

TSA/TEA 目前对文档明确支持的工具类型评分，例如 Cortex Analyst、Cortex Search、Custom Tool、Web Search 和 Agent Router。未列入支持范围的工具仍会执行，但不会被这两个工具级指标评分。

如果 Agent 使用 MCP、Code Execution 或其他尚未纳入评分范围的工具，不能看到 TSA/TEA 分数就认定这些工具工作正常。可以使用：
- answer_correctness / logical_consistency 评估最终回答与整体逻辑；
- Custom Metric 读取完整执行 Trace，检查其他工具的输入、输出和副作用；
- 独立集成测试验证 MCP 连接、代码执行、文件生成和外部副作用。

Agent Evaluation 中的 Code Execution 会运行，但它写出的文件不会保存到用户 Stage；因此不能用 Evaluation 证明文件导出成功。

### Ground Truth 有效期和测试数据漂移必须控制

输入问题应尽量使用绝对日期、明确基金 ID、币种、指标和期间。例如：
- 好：“F01 在 2026-11-27 的净资产是多少？”
- 不好：“F01 最近的净资产是多少？”

第二种问题的 Ground Truth 会随测试时间变化；第一种可以使用固定数据快照和固定期望值。对动态数据，也要固定源表版本或业务时间范围。

评测集还要覆盖不同类型的场景：
- 事实型：值、单位、容差和数据范围；
- 动态型：答案应该包含什么，不能包含什么；
- 越界型：应拒答什么，不能编造什么；
- 多事实调查：必须连接哪些事实和时间关系；
- 工具失败型：一个工具无权访问或返回空结果时，Agent 应如何表达不确定性。

### Judge Metric Version 与 Agent Version 是两件不同的事

Agent Version 固定被评估的配置，例如 instructions、tools 和 orchestration model；Metric Version 固定评测 Judge、Prompt、Rubric 和阈值。二者都要记录。

Cortex Agent Evaluation 的当前系统指标版本中：
- v1 依赖的 claude-4-sonnet 已于 2026-10-14 结束生命周期，新的评测不应再 pin v1；
- v2 和 v3 使用较新的 Judge 组合；
- 当前文档将 v3 列为默认版本，并建议长 Trace 使用 v3。

已固定 Agent Version 和 Metric Version，并不意味着重复评测会得到完全相同的 Trace。Agent 编排本身具有非确定性，同一个问题可能走不同的有效工具路径，产生不同评分。评测要重复运行，记录均值、分布、失败类型和分数波动，而不是用一次分数决定发布。

### 运行评测也需要专门的权限和计算资源

运行 Evaluation 的 Role 除了能够调用 Agent 和它的工具，还需要：
- SNOWFLAKE.CORTEX_USER、CORTEX_AGENT_USER、CORTEX_ANALYST_USER 或 CORTEX_REST_API_USER 中适用的数据库角色；
- EXECUTE TASK ON ACCOUNT；
- Agent 与评测数据所在 Database/Schema 的 USAGE；
- Agent 的 USAGE 或 OWNERSHIP，以及 MONITOR 或 OWNERSHIP；
- 若启用模型级访问控制，还需访问所选 Metric Version 的 Judge Model；
- 使用 Snowsight 时，还需要运行评测所用 Warehouse 的 USAGE。

如果缺少 Judge Model 权限，评测可能在 Judge 调用前被拒绝，并出现 0 分而没有清晰的可操作错误。遇到所有评测项突然归零时，应检查 Judge Model 权限，而不是马上认定 Agent 质量崩溃。

### 可以用 Snowsight 批量评测，也可以用 SQL 接入持续回归

Snowsight 的 Evaluations Tab 可以选 Agent Version、Dataset、Role、Warehouse 和 Metric Version，保存并查看评测结果。

若要加入自动化，可以将 YAML 配置文件放在 Stage，再调用 EXECUTE_AI_EVALUATION：

~~~sql
CALL EXECUTE_AI_EVALUATION(
  'START',
  OBJECT_CONSTRUCT('run_name', 'portfolio-agent-regression-2026-11-28'),
  '@EVAL_DB.EVAL_SCHEMA.CONFIG/portfolio_agent_eval.yaml'
);
~~~

随后使用 STATUS 查询运行状态；需要时可以 CANCEL 或 DELETE。也可以将评测任务放入 Task 定期运行。CI/CD 不应只检查 Agent 对象是否能创建，而应对候选版本运行固定评测集，再与当前生产版本比较。

### 评测成本包含 Agent 本身和 Judge，不只是 Warehouse

一次评测至少会产生：
- Agent 对每条测试输入的运行成本；
- LLM Judge 对每条输入、每个所选指标的评分成本；
- 管理评测的 Task/Warehouse 使用；
- 指标查询和读取 Snowsight 结果的 Warehouse 使用；
- Dataset 和 Evaluation 结果的存储成本。

当测试集从 50 条扩大到 2,000 条，或从 1 个指标增加到 4 个指标，运行成本会明显增长。评测计划应先用小样本调试 Ground Truth 和指标配置，再对完整数据集运行，不要在 Ground Truth 未校准时反复全量打分。

## 工程实施步骤

1. 从生产请求、用户反馈和已知故障中收集评测案例，不要只生成容易答对的理想问题。
2. 为每条输入标注绝对日期、业务范围、Ground Truth Output 和预期工具行为。
3. 为每个预期工具填写 tool_name；对关键调用补齐 tool_input 和 tool_output。
4. 检查工具类型是否在 TSA/TEA 支持范围内；未覆盖的工具安排 Custom Metric 或独立集成测试。
5. 选择 Agent Version 和 Metric Version；固定 v3 等具体版本，避免长期 CI 指标随默认 Judge 变化。
6. 检查 Evaluation Role 的数据库角色、EXECUTE TASK、对象权限和 Judge Model 访问权限。
7. 先运行 10–20 条样例检查 Ground Truth 与评分，再对完整测试集运行。
8. 对低分案例检查 Answer、TSA、TEA 和 Logical Consistency 的分项结果及工具 Trace，不只看总分。
9. 对非确定性任务重复运行，比较分数分布、工具路径和错误类型；建立基于多次运行的回归阈值。
10. 在 Agent/Tool/Semantic View/Search Service/Prompt 更新后重跑相关子集和完整回归集。
11. 对 RLS Session Attributes、MCP 和 Code Execution 文件副作用做独立测试，不将 Evaluation 通过当成这些路径的验收。
12. 保存 Dataset 版本、Agent Version、Metric Version、Judge 可用性、Warehouse、run_name 和结果，支持版本间对比。

## 场景分析

Portfolio Agent 需要回答前十大持仓和评级变化。评测集里有 100 条问题：
- 40 条只需要 Analyst；
- 30 条需要 Search；
- 20 条需要 Analyst + Search；
- 10 条是超出资产管理范围的问题，应说明无法回答。

若只运行 answer_correctness，Agent 可能没有调用 Search，却根据训练记忆给出了一个碰巧正确的摘要。增加 TSA 后可以检查它是否选了正确工具；增加 TEA 后，进一步检查 Analyst 是否传入 F01 和正确估值日期，Search 是否限制在问题日期之前并返回有效报告版本。

其中 10 条越界问题的 Ground Truth 应明确要求不编造，不应给出假数据。对于用 MCP 查询内部监管库的案例，TSA/TEA 当前不会执行/评分 MCP 工具；这部分要独立做连接和权限测试，或者使用 Custom Metric 检查 Trace。若应用依赖用户 Session Attributes 做 Row Access Policy，Evaluation 不会传递这些属性，必须在真实用户 Role 下做安全验证。

候选 Agent v4 的 answer_correctness 比 v3 高 4 分，但 TSA 下降、TEA 中日期参数错配增多。不能因为总分上涨就发布 v4。应修复工具输入生成并重复评测，确认回答准确性、工具使用和安全约束都达到门槛。

## 常见误区

- **Ground Truth 只写一句“回答正确”。** 没有具体日期、单位、容差和排除范围，Judge 无法稳定判断。
- **只填写 ground_truth_invocations 的 tool_name。** TEA 不能验证输入和输出是否正确。
- **把 TSA 当成 LLM Judge 的主观评分。** 对给定工具调用，TSA 是确定性匹配；不同分数表示 Agent 实际调用路径不同。
- **把 TEA 的高分当成最终答案正确。** 工具执行正确也可能被模型错误解释；还要看 answer_correctness。
- **把未支持工具的 TSA/TEA 分数当成 0 就说明工具失败。** 未纳入评分的工具会被跳过，要用 Custom Metric 或集成测试补足。
- **混用不同 Metric Version 的分数。** Judge、Prompt、Rubric 和阈值不同，分数不能直接横向比较。
- **假设固定 Agent/Metric Version 后 Trace 也固定。** 编排有非确定性，应重复运行观察方差。
- **把 Evaluation 当作生产权限测试。** 依赖 Session Attributes 的 RLS、MCP Connector 和文件副作用有已知限制。
- **忽略 Judge Model 权限。** Judge 无权限可能让评测返回 0 分，造成错误诊断。
- **只看分数不看成本。** Agent 运行、Judge、Warehouse、Task 和存储都有成本。

## 完成标准

- [ ] 能建立 Input Query / Ground Truth VARIANT 评测数据集。
- [ ] 能区分 ground_truth_output 与 ground_truth_invocations 的用途。
- [ ] 能解释 answer_correctness、TSA、TEA 和 logical_consistency。
- [ ] 能为关键工具调用标注 tool_name、tool_input 和 tool_output。
- [ ] 能判断哪些工具类型不在 TSA/TEA 当前评分范围内。
- [ ] 能说明 Agent Version 与 Metric Version 固定的对象不同。
- [ ] 能解释重复运行出现分数波动的原因。
- [ ] 能检查评测所需权限、Judge Model 可用性和运行成本。

## 自测

1. Ground Truth 中只有 ground_truth_output，没有 ground_truth_invocations。还能评估哪些指标？不能证明什么？
2. TSA 的预期工具有 Analyst、Search 两个，实际调用顺序相反但都调用了。顺序变化会扣分吗？若多调用了一个不必要工具会怎样？
3. TEA 的 ground_truth_invocations 只写 tool_name，没有 tool_input 和 tool_output。它实际上检查了什么？
4. Agent 版本和 Metric Version 都固定，重复运行却出现不同 TSA 分数。更可能是 Judge 变化，还是 Agent 调用了不同工具？
5. Evaluation 结果所有指标都为 0，Agent 本身在 Snowsight 可以正常运行。应检查哪些评测 Role 和 Judge Model 权限？
6. Agent 使用 MCP 工具且依赖 Session Attribute 的 Row Access Policy。为什么 Evaluation 不能代替真实环境权限与集成测试？
7. 新版本 answer_correctness 提升，但 TEA 下降、TSA 也下降。为什么不能只根据总分上涨发布？

## 参考资料

- [Cortex Agent evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations)
- [Monitor Cortex Agent requests](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-monitor)
- [Best Practices for Evaluating Cortex Agents](https://www.snowflake.com/en/developers/guides/best-practices-for-evaluating-cortex-agents/)
