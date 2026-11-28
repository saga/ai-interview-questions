# Agent 评测、审计、权限与生产治理

## 本节要解决的问题

投资研究 Agent 在演示环境里能正确回答“基金前十大持仓是什么”，但进入生产后出现三类问题：

- 部分用户拿不到 Search 结果，Agent 却把工具不可用解释成“没有相关研究”。
- 研究报告引用正确，但持仓金额用了错误估值日，回答仍被打了高分。
- Agent 更新了工具配置后，同一个 Thread 前后两轮实际运行的已不是同一版本，事后无法确认哪条配置产生了问题。

生产治理要把权限、回答质量、工具执行、版本、运行轨迹和成本放在一起检查。Agent 演示成功、回答流畅或单次评测得分高，都不足以证明它已经达到生产要求。

## 核心知识

### 创建权限与运行权限应该分开

创建和修改 Agent 的角色应由平台工程团队控制，日常调用角色只拿完成工作所需的权限：

| 权限层 | 典型权限 | 责任 |
|---|---|---|
| Agent 构建 | Schema 上的 CREATE AGENT、Agent 的 MODIFY/OWNERSHIP | 创建、修改和发布配置 |
| Agent 调用 | SNOWFLAKE.CORTEX_AGENT_USER 或 SNOWFLAKE.CORTEX_USER、Agent USAGE | 调用 Agent |
| Analyst 工具 | SNOWFLAKE.CORTEX_ANALYST_USER、Semantic View USAGE、查询所需对象权限 | 执行结构化查询 |
| Search 工具 | Search Service USAGE、Database/Schema USAGE | 检索索引内容 |
| Custom Tool | 对应 Procedure/UDF 的 USAGE，以及工具执行需要的对象权限 | 执行受控业务逻辑 |
| 计算资源 | Agent 工具配置的 Warehouse USAGE | 执行 SQL 和工具 |

CORTEX_USER 默认可能被授予 PUBLIC，因此应检查账户是否有意向所有用户开放全部 Cortex 功能。若只开放 Agent，应评估撤销 PUBLIC 上的 CORTEX_USER，再授予指定运行角色 CORTEX_AGENT_USER。若 Agent 使用 Cortex Analyst，还要额外授予 SNOWFLAKE.CORTEX_ANALYST_USER；CORTEX_AGENT_USER 不包含 Analyst 权限。

不要让生产调用角色继承 ACCOUNTADMIN、Agent Builder 或宽泛的数据管理员角色。Agent 不能成为提权入口：调用身份仍由 Snowflake 请求上下文决定，工具权限也必须按真实用户/Role 检查。对持仓、研究、法务和客户数据分别做允许与拒绝测试，不能只用 Agent owner 账号验证成功路径。

### 评测集要描述问题、期望结果和预期工具行为

Cortex Agent Evaluation 使用包含两列的数据集：

- Input query：用户问题，VARCHAR。
- Ground truth：预期结果与工具行为，VARIANT。

Ground truth 的主要字段包括：
- ground_truth_output：面向用户的期望答案，用于 answer_correctness。
- ground_truth_invocations：预期工具调用数组，包含 tool_name、tool_input 和 tool_output，用于工具选择/执行评测。

例如，一个复合问题需要读取组合数据并检索研究材料：

~~~sql
CREATE OR REPLACE TABLE agent_eval_cases (
  input_query VARCHAR,
  ground_truth VARIANT
);

INSERT INTO agent_eval_cases
SELECT
  '截至 2026-11-27，基金 F01 的科技行业权重是多少？研究报告是否提到发行人 A 的评级下调？',
  PARSE_JSON('{
    "ground_truth_output": "应先给出 F01 在 2026-11-27 的科技行业权重，再说明发行人 A 的研究评级变化及其报告发布日期；如果找不到有效报告，必须明确说明无法确认。",
    "ground_truth_invocations": [
      {
        "tool_name": "portfolio_analyst",
        "tool_input": "查询基金 F01 在 2026-11-27 的行业权重，返回科技行业权重和估值日期。",
        "tool_output": "从批准的组合 Semantic View 返回科技行业权重及 2026-11-27 估值日期。"
      },
      {
        "tool_name": "research_search",
        "tool_input": "检索发行人 A 在 2026-11-27 之前已发布的评级报告。",
        "tool_output": "返回报告 ID、发布日期、评级变化、原文引用和有效版本。"
      }
    ]
  }');
~~~

这是评测数据结构示意，表中的数值和返回内容必须由实际业务样本及人工标注产生，不能让生成模型自行编造 Ground Truth。对金融场景，输入问题要包含绝对估值日、期间、币种和基金范围，避免“最近”“本季度”这类随运行日期变化的提问造成标签漂移。

### 不同评测指标检查不同错误，不能只看一个总分

Snowflake 当前提供的系统指标各有不同关注点：

| 指标 | 检查什么 | 适用边界 |
|---|---|---|
| answer_correctness | 最终回答与 Ground Truth 是否匹配 | 关注用户看到的内容，不能独立证明调用路径安全 |
| tool_selection_accuracy（Public Preview） | 是否调用了预期工具 | 对给定工具调用记录确定性评分 |
| tool_execution_accuracy（Public Preview） | 工具调用输入和输出是否符合预期 | 检查工具契约，不等于最终业务结果正确 |
| logical_consistency | 指令、规划和工具调用之间是否一致 | Reference-free，不需要 Ground Truth |

一个 Agent 可能调用了正确的 Analyst 和 Search 工具，但把不同估值日期的结果拼在一起；也可能答案恰好正确，却绕过了预期的检索路径。要同时看答案正确性、工具选择和工具执行结果。

Judge-based 指标带有版本。不同 metric version 可能使用不同 Judge 模型、Prompt、Rubric 和阈值，版本之间的得分不应直接比较。工具选择指标对给定调用记录是确定性评分，不会因为 Judge 版本而变化。长期评测应固定 Agent 版本和 metric version，并在 CI 中重复跑同一数据集，先了解正常分数波动范围，再设置门禁阈值。

### 评测不等于安全测试，当前能力还有明确限制

Cortex Agent Evaluations 目前不能覆盖所有生产场景：

- 依赖 Session Attributes/Variables 的查询（包括依赖这些属性的 Row Access Policy）无法在评测中重现生产会话上下文。
- MCP Connector 工具目前不会在 Evaluation 运行时实际调用，因此评测分数不能证明 MCP 服务行为正确。
- Code Execution 的文件副作用不会写入用户 Stage，不能通过该评测验证生成文件的输出。
- tool_selection_accuracy 和 tool_execution_accuracy 为 Public Preview，且只对 Ground Truth 中描述的工具调用评分。

因此，不能用 Evaluation 替代真实用户 Role 下的行级策略测试、Search 跨授权域负向测试、MCP Connector 集成测试和文件落地验收。需要把评测、权限验证、集成测试和用户验收分开安排。

### Observability 记录每个 Turn 的执行过程，Thread 不等于单一版本

Cortex Agents 的生产可观测数据按以下层次组织：

| 概念 | 含义 |
|---|---|
| Thread | 一段持久化的多轮对话，由 thread_id 标识 |
| Turn | 用户的一条消息和 Agent 对应的一次完整响应 |
| Trace | 一个 Turn 对应一条 OpenTelemetry Trace |
| Span | Trace 内的一步，例如规划、工具调用、SQL 执行、图表或最终响应 |
| Session | Snowflake 的用户、Role、Warehouse 等平台会话上下文，独立于 Thread |

Agent 运行日志包含对话历史、每轮 Trace、工具输入/输出、SQL 执行和用户反馈。可在 Snowsight 的 AI & ML → Agents → Observability 中检查，也可查询 Snowflake 的 AI Observability Events。

一个 Thread 可以跨越 Agent 版本更新：第一轮可能由 VERSION$3 执行，第二轮可能由新的 Default/Production 版本执行。因此版本应该按 Turn 记录，不能只给整个 Thread 标一个 Agent Version。排查问题时至少要保留 request_id、thread_id、trace_id、Agent version/alias、调用 Role、工具调用记录和最终反馈。

### 评测、线上监控和成本分析要使用同一版本脉络

评测回答“这版配置在固定测试集上表现如何”；Observability 回答“生产请求实际经历了什么”；Usage History 回答“产生了哪些计算和 Token 成本”。三者应使用一致的 Agent version、工具配置和发布标识关联。

上线前可以比较候选版本和当前生产版本的固定评测集；上线后观察实际用户反馈、工具调用失败、SQL/检索延迟、异常退出和成本。若修改 Prompt、Tool、Semantic View 或 Search Service，应该重新评测相关问题集，而不是只确认 Agent 还能正常运行。

## 工程实施步骤

1. 建立独立的 Agent Builder Role 和 Runtime Role；不要让普通调用用户拥有 CREATE AGENT 或 MODIFY 权限。
2. 为运行角色授予必要的 Cortex 数据库角色、Agent USAGE、Database/Schema USAGE、工具对象和 Warehouse 权限。
3. 按业务身份执行正向与负向测试：允许访问的基金、禁止访问的基金、受限研究报告、缺失政策和工具权限不足。
4. 建立评测数据集，覆盖常见问题、边界输入、过期文档、错误日期、工具缺权、工具失败和无证据场景。
5. 为 Ground Truth 标注期望答案与预期工具调用；对重要金融字段人工核验数据源、单位、币种和估值日期。
6. 固定 Agent 版本、编排模型和评测 Metric Version；多次运行同一数据集，了解分数波动后再设置发布门槛。
7. 把 answer_correctness、logical_consistency、tool_selection_accuracy 和 tool_execution_accuracy 分开看，不用一个平均分掩盖严重工具错误。
8. 对 Session Attribute、Row Access Policy、MCP Connector 和文件副作用等不受评测覆盖的路径，增加独立集成与安全测试。
9. 在生产中检查 Thread/Turn/Trace/Span、请求身份、工具输入输出、SQL 和用户反馈；每个问题关联具体 Agent Version。
10. 关联 CORTEX_AGENT_USAGE_HISTORY 和工具自身消耗，分析 Token、Warehouse、Search 与 Analyst 成本。
11. 发布时记录 Agent Version、Alias 指向、工具配置、评测结果和回滚版本；更新 alias 后复测实际生产入口。
12. 发生越权、错误数字或引用失真时，先撤回有问题的版本或禁用相关工具，再保存 Trace、源数据快照和请求 ID 供复盘。

## 场景分析

Portfolio Research Agent v3 在演示环境表现正常。生产发布后，东京客服用户收到了一条包含法务争议档案的引用；与此同时，另一个用户问 F01 的 11 月 27 日持仓时，Agent 返回了 11 月 26 日的估值结果。

这两类问题不能靠增加模型提示解决。法务资料暴露要检查 Search Service 的 Owner’s Rights、服务授权域、底层 Row Access Policy 是否在检索路径生效，以及调用角色是否能直接访问该服务。估值日期错误则要检查 Analyst 生成 SQL、Semantic View 的日期关系、Ground Truth 和最终回答引用。

治理流程应分别保留：
- 生产请求的 thread_id、turn trace_id、request_id 和调用 Role；
- Analyst 执行的 Query ID、估值日期和返回结果；
- Search 返回的文档 ID、版本、页码和权限范围；
- Agent 当前版本及工具配置；
- 用户反馈、复核结论和修复后的评测记录。

如果 Evaluation 因 Session Attribute 限制没有覆盖 Row Access Policy，不能把“评测通过”当成安全证明；必须在真实的东京客服 Role 下执行负向访问测试。修复后固定 Agent 版本重跑评测，再将 Production Alias 切到通过验收的版本。

## 常见误区

- **把 Agent Builder Role 直接授予日常调用者。** 创建/修改权限与运行权限应该分开，避免运行身份可以改写自己依赖的工具配置。
- **把 CORTEX_AGENT_USER 当成 Analyst 权限。** 使用 Cortex Analyst 工具还需要 CORTEX_ANALYST_USER。
- **只看 answer_correctness。** 正确答案可能来自错误工具路径，工具调用正确也可能产生错误答案；要分开评估。
- **把 Preview 工具选择/执行分数当成全面质量证明。** 它只检查评测 Ground Truth 中定义的工具调用，不覆盖所有生产安全与业务行为。
- **混用不同 Metric Version 的分数。** Judge、Rubric 和阈值发生变化后，分数不宜直接横向比较。
- **用 Agent Evaluation 替代权限测试。** 依赖 Session Attributes/RLS 的路径当前不能通过评测完整重现。
- **认为一个 Thread 永远对应一个 Agent Version。** 不同 Turn 可能跨版本，版本必须按调用记录。
- **把 Observability 当成成本报表。** Trace 用于解释执行路径；Token 与 Credit 消耗还要结合 Usage History。
- **只在发布前做一次评测。** 工具、数据、策略和模型变化后，固定测试集与生产监控都要持续运行。

## 完成标准

- [ ] 能划分 Agent Builder Role 与 Runtime Role。
- [ ] 能列出 Agent、Analyst、Search、Custom Tool 和 Warehouse 所需权限。
- [ ] 能构建包含 Input Query、Ground Truth Output 和 Ground Truth Invocations 的评测数据集。
- [ ] 能区分 answer_correctness、logical_consistency、tool_selection_accuracy 和 tool_execution_accuracy。
- [ ] 能说明 Evaluation 对 Session Attributes/RLS、MCP Connector 和文件副作用的限制。
- [ ] 能区分 Thread、Turn、Trace、Span 和 Snowflake Session。
- [ ] 能按 Turn 关联 Agent Version、请求身份、工具调用和用户反馈。
- [ ] 能把 Evaluation、Observability、安全测试和成本分析纳入持续发布流程。

## 自测

1. 一个生产 Agent 同时使用 Analyst 和 Search。调用用户已有 CORTEX_AGENT_USER，但没有 CORTEX_ANALYST_USER。为什么不能认为所有工具都已获权？
2. Ground Truth 中定义了正确的最终答案，但没有定义 ground_truth_invocations。还可以评估哪些指标？不能证明什么？
3. tool_selection_accuracy 得分很高，但 answer_correctness 很低。可能分别反映什么问题？
4. 评测环境没有传递 Session Attributes，而生产 Row Access Policy 依赖它们。为什么评测通过仍不能证明行级安全正确？
5. 一个 Thread 跨过 Agent 版本更新。事后要确定某一轮错误由哪版配置产生，应该查哪些标识？
6. 用户看到的引用来自 Search，但持仓金额错误。应沿哪些 Trace Span 和 Query ID 定位问题？

## 参考资料

- [Access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Cortex Agent evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations)
- [Monitor Cortex Agent requests](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-monitor)
- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [CORTEX_AGENT_USAGE_HISTORY](https://docs.snowflake.com/en/sql-reference/account-usage/cortex_agent_usage_history)
