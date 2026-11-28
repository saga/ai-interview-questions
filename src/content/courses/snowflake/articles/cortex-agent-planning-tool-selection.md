# Agent 任务规划、工具选择与停止条件

## 本节要解决的问题

投资经理问：“F01 最近一个季度的行业敞口是否超过限额？如果超限，主要涉及哪些发行人？对应政策依据是什么？”

回答需要两类事实：组合指标必须从结构化持仓和风险模型中查询，限额及政策说明则来自有版本的政策文档。若 Agent 只查 Search，可能把政策条款当作实际敞口；若只查 Analyst，则只能给出数字，无法说明规则依据。

Cortex Agents 会先将用户请求拆分成子任务，再选择配置的工具完成工作。它不是一个固定 DAG 执行器；工具调用顺序由 Orchestration Model 根据请求、工具说明和 planning instructions 决定。架构设计的重点是把可用工具、输入输出、权限、任务预算和完成证据定义清楚，而不是试图靠 Prompt 写出一套不可变的流程脚本。

## Agent 的规划层在做什么

### Orchestration Model 负责分解请求和选择工具

在 Agent specification 中可以配置：
- models.orchestration：用于任务规划和工具选择的模型；
- instructions.orchestration：影响规划过程的指令；
- instructions.response：约束最终回答的要求；
- tools：允许 Agent 选择的工具及工具说明；
- tool_resources：每个工具引用的 Semantic View、Search Service、Warehouse 等资源；
- orchestration.budget：规划时间和 Token 预算；
- orchestration.tool_not_accessible：调用者无权访问配置工具时的处理策略。

Planning instructions 能引导选择，但不是权限控制或确定性条件分支。例如：

~~~yaml
instructions:
  orchestration: |
    Requests for numeric portfolio exposure must use portfolio_analyst.
    Requests for policy wording or policy effective dates must use policy_search.
    If the user asks whether a limit is breached, use both tools and compare
    the same portfolio, instrument scope, and effective date.
    Do not infer an actual breach from policy text alone.
  response: |
    Separate measured portfolio values from policy requirements.
    State the valuation date and policy version.
    If either source is unavailable, say that the conclusion is incomplete.
~~~

这类指令适合表达工具适用范围和业务约束，但模型仍需要根据请求选择调用步骤。若需要保证“必须先查询持仓、再查政策、最后校验规则”，应在 Custom Tool 或应用层实现确定性流程，而不是把硬性控制寄托在自然语言指令上。

### 工具说明是规划器的接口契约，不是装饰性描述

每个工具至少要讲清：
- 工具解决什么问题，什么请求应该使用；
- 需要哪些输入和过滤范围；
- 返回什么结构、字段、来源和业务日期；
- 什么情况返回空结果、业务拒绝或技术错误；
- 工具不可用时能否继续，还是必须停止。

例如，Cortex Analyst Tool 应描述它只查询已批准的组合 Semantic View，必须传入 fund_id 和 valuation_date；Cortex Search Tool 应描述它只检索政策文件，必须保留 policy_id、version、effective_from 和原文定位。

工具名和 description 影响模型选择。把所有工具都描述成“查询公司数据”会让它们难以区分；把工具说明写成整篇使用手册，又会增加规划上下文并模糊输入输出。较好的做法是职责单一、说明精确、返回结构稳定。

### 不要用增加工具数量代替任务拆分

一个只需要查询持仓总额的问题，用 Analyst 即可；不需要同时调用 Search、Code Execution 和 Agent Router。复合问题才需要组合工具，例如：
1. Analyst 查询指定日期的组合敞口；
2. Search 查找该日期有效的限额政策；
3. Agent 对齐发行人、资产类别、日期和指标口径；
4. 若两边范围或版本不一致，则明确说明不能得出超限结论。

工具越多，规划空间、权限配置、失败状态和运行成本也越大。只有当某种工具能补充当前任务真正缺少的证据或计算能力时，才值得加入 Agent。

## 预算、停止条件和部分完成

### orchestration.budget 限制规划，不是整个任务的总成本上限

Cortex Agents 支持按秒和输出 Token 设置编排预算：

~~~yaml
orchestration:
  budget:
    seconds: 45
    tokens: 12000
~~~

两个限制的含义不同：
- tokens 统计 Orchestration Model 在所有规划步骤中生成的输出 Token；不包括输入 Token，也不包括 Analyst、Search 或 Custom Tool 消耗的 Token。
- seconds 从第一个编排步骤开始计时。
- 预算在编排步骤之间检查。已经开始执行的工具步骤可能在预算超限后才完成。
- 超限后会产生 budget_tokens_exceeded 或 budget_timeout_exceeded 状态更新。
- 不设置预算时，Snowflake 使用较高的默认限制，默认值可能变化。
- 这些 Agent specification 预算不适用于 Snowflake CoWork；CoWork 请求使用默认预算。

因此，不能把 45 秒预算描述成“所有 SQL、Search 和外部 API 都必须在 45 秒内停止”。如果任务需要严格总耗时、工具执行超时或成本上限，应在工具自身、Warehouse、外部服务和应用层另行配置。

### 完成条件应由业务结果定义，不是“模型已经写完计划”

对于前面的风险问题，任务至少要拿到：
- 指定 fund_id 和 valuation_date 的风险敞口；
- 适用的 policy_id、version 和 effective date；
- 同一指标和资产范围的可比较值；
- 计算结果以及必要的引用。

只有生成了一段“我将查询持仓并检索政策”的文字，不代表任务已经完成。如果 Analyst 无权访问、Search 未命中有效政策或两边日期不一致，Agent 应标记为不完整，而不是自动补写一个结论。

对高风险任务，可以将最终校验放在 Custom Tool 或业务应用中。它应检查必需工具结果、字段和时间边界，缺一项就返回明确的未完成状态。不要让 LLM 根据自己的总结判断所有必需证据是否都已取得。

### 工具缺权可能导致 Agent 继续运行

Cortex Agents 的 orchestration.tool_not_accessible 默认值为 accept。调用者无权访问某个已配置工具时，Agent 仍可使用其他有权工具继续执行，并将不可用工具作为 Warning 报告。若任务必须同时取得 Analyst 和 Search 的结果，可以选择 reject，让工具缺权时整次运行失败。

这个设置属于 Agent specification 顶层 orchestration 配置，不是用户每次请求都能随意传入的参数。使用已有 Agent Object 的 agents/{name}:run 时，应通过更新 Agent specification 改变策略；直接向 agent:run 提交完整 specification 时，才在该请求的 specification 中设置。

选择 accept 还是 reject 应由任务容错要求决定：
- 纯文档问答可能允许 Search 可用而其他工具不需要；
- 风险限额检查需要持仓数值和政策依据同时可用，缺少一侧就不能输出完整结论；
- 若允许部分结果，界面必须清楚标出缺失的工具和证据。

### 停止条件应该覆盖预算、业务拒绝和证据不足

一个 Agent 任务不只有成功和失败。至少区分：
- SUCCEEDED：必需步骤完成，结果通过校验；
- PARTIAL：部分工具可用，业务明确允许返回部分结果；
- INCOMPLETE：预算或步骤终止，缺少必需证据；
- REJECTED：用户权限不足或业务政策拒绝；
- FAILED：工具或编排发生不可恢复错误；
- REQUIRES_REVIEW：证据冲突、结果未知或需要人工判断。

这些状态可以由应用层根据 Agent 状态更新、Warning 和工具结果映射。Agent 的最终文字不应成为唯一的状态判定依据。

## 工程实施步骤

1. 收集真实请求，标注每类问题需要的事实、文档证据和业务校验。
2. 为每种职责选择最少的工具；单一结构化查询不额外加入无关工具。
3. 为每个 Tool Spec 写清用途、适用问题、输入、输出、来源标识和失败语义。
4. 为工具资源配置 Semantic View、Search Service、Warehouse 和必要对象权限。
5. 编写 planning instructions，让模型知道哪些问题用哪个工具，以及哪些问题必须组合证据。
6. 对必须执行的顺序、预算、审批和业务状态转换，使用应用层或 Custom Tool 的确定性逻辑。
7. 设置 orchestration.budget，并另外配置工具/SQL/外部 API 的超时、并发和费用控制。
8. 根据任务是否允许部分结果设置 tool_not_accessible 为 accept 或 reject。
9. 用固定问题集检查工具选择、参数、调用顺序是否满足业务依赖、最终答案和停止状态。
10. 注入工具缺权、空结果、版本不匹配、超时和预算耗尽故障，验证 Agent 不会把不完整结果伪装成完成。
11. 保存 Agent Version、Trace、工具输入/输出、Warning、Query ID 和预算状态。
12. 定期复核工具描述、planning instructions 和测试集，防止语义定义或服务配置变化后规划路径失效。

## 场景分析

F01 的投资经理问：“截至 2026-11-27，科技行业是否超过 25% 的限额？列出主要发行人和政策依据。”

Agent 应使用 Analyst 查询 F01 在 2026-11-27 的科技行业权重和发行人明细，再使用 Search 查找 2026-11-27 当日生效的限额政策。如果 Search 返回的是 2026-12-01 生效的新政策，不能用它判断 11 月 27 日的限额；如果 Analyst 返回了 11 月 26 日的持仓，也不能直接相减。

假设 Analyst 有权限、Search 无权限，默认 accept 可能让 Agent 只用 Analyst 返回数字，并继续生成回答。对于这个必须同时有两类证据的任务，应设置 reject，或者由应用层在收到 Warning 后将状态改为 INCOMPLETE。不能把“25.8%”单独报告为“违反政策”，因为限额版本和有效日期没有核实。

## 常见误区

- **认为 Agent 会按 Prompt 写好的步骤机械执行。** Orchestration Model 会根据请求和工具配置规划；需要强保证的流程应由确定性代码控制。
- **把工具 Description 写成一句“查询数据”。** 规划器需要知道工具的适用范围、输入、输出和失败语义。
- **为每个数据表创建一个工具。** 工具数量过多会扩大规划空间，优先围绕业务动作和明确契约组织。
- **只给 Agent 设置 seconds 就以为限制了所有工具成本。** seconds 和 tokens 约束编排过程，不包含工具 Token 和正在运行的工具步骤。
- **把预算超限当成业务成功或工具一定停止。** 已开始的步骤可能完成，结果应作为不完整状态处理。
- **依赖默认 accept 却不检查 Warning。** 缺权工具可能被跳过，Agent 仍然返回一个看似完整的回答。
- **把最终文本当作任务完成证明。** 完成条件需要验证必需的工具结果、日期、指标和来源。
- **所有任务都强制调用相同工具。** 工具选择应由证据需求决定，不是工具列表越长越好。

## 完成标准

- [ ] 能解释 Orchestration Model、planning instructions、response instructions 和 Tool Spec 的职责。
- [ ] 能按业务任务设计工具输入、输出、资源和失败契约。
- [ ] 能区分模型规划和应用层的确定性工作流控制。
- [ ] 能解释 orchestration.budget 中 seconds/tokens 的统计范围和检查时机。
- [ ] 能根据完整证据要求选择 tool_not_accessible 的 accept 或 reject。
- [ ] 能将 SUCCEEDED、PARTIAL、INCOMPLETE、REJECTED 和 REQUIRES_REVIEW 等状态与实际工具证据关联。
- [ ] 能设计包括空结果、权限不足、日期不匹配和预算耗尽的规划回归测试。

## 自测

1. 用户只问某基金的净资产，为什么通常不应调用 Cortex Search？什么时候才需要它？
2. 用户问政策是否导致持仓超限，Analyst 和 Search 的结果必须满足哪些相同范围和时间条件？
3. orchestration.budget.seconds 为 45 秒，但 Analyst SQL 已经执行 60 秒才返回。为什么预算没有保证 SQL 在 45 秒内终止？
4. Agent 只有 Search 权限，没有 Analyst 权限。tool_not_accessible 默认 accept 会出现什么行为？什么任务应改用 reject？
5. 为什么工具数量不应等于数据库表数量？工具 Description 应包含哪些关键内容？
6. Agent 输出“我已完成分析”，但缺少有效政策版本。应用为什么仍应标记 INCOMPLETE？
7. 哪些停止条件可以由 Agent 指令表达，哪些必须由后端工具或应用状态机强制执行？

## 参考资料

- [Create and manage agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-manage)
- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Inaccessible tool handling](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-inaccessible-tool-handling)
- [Cortex Agent evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations)
