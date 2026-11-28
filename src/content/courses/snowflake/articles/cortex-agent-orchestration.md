# Cortex Agents 的工具设计与任务编排

## 本节要解决的问题

将结构化数据分析、非结构化检索、计算和外部系统操作组合成一个可治理的 Agent 工作流。Cortex Agents 提供托管编排，但开发者仍需设计工具边界、执行身份、权限、失败处理和验收标准；不能把“Agent 能调用工具”理解为“Agent 获得任意系统权限”。

## 核心知识

### Agent 将模型、工具和指令组合成可复用对象

Cortex Agent 是 Schema 级对象，包含编排模型、工具列表、Orchestration Instructions 和 Response Instructions。运行时遵循 Plan、Use tools、Reflect and respond 的循环：先拆分任务并选工具，再执行工具，最后评估中间结果并继续调用或返回答案。

指令用于引导工具选择和回答行为，不是安全策略引擎。真正的访问边界由 Snowflake Role、对象 Grants、工具自身授权和外部服务认证决定。模型可能错误选择工具，也可能在工具执行失败后继续推理，所以关键操作必须有确定性校验与授权。

### 选择工具要匹配输入和输出契约

- **Cortex Analyst**：结构化指标与 SQL 生成，依赖 Semantic View。
- **Cortex Search**：非结构化文本检索，适合政策、文档和知识库。
- **Code Execution**：在隔离 Python Sandbox 中处理检索或分析结果。
- **Data to Chart**：基于工具返回的数据生成可视化。
- **Custom Tools**：Stored Procedure/UDF 实现业务操作或后端调用。
- **Agent Skills**：将稳定指令和脚本封装为可复用能力。
- **MCP Connectors**：接入远端 MCP Server 提供的工具。
- **Agent Toolsets**：引用另一个 Agent 并在运行时继承其工具集。
- **Web Search**：账户启用后访问公共网络实时信息。

每个工具都应定义输入 Schema、输出格式、最大执行时间、错误类型、副作用、幂等键和可访问的数据范围。对同一目标不应同时挂载功能重复但权限边界不同的工具，避免路由歧义和成本增长。

### 工具不可访问时的处理不是统一失败

orchestration.tool_not_accessible 控制运行开始时某些工具缺少权限的处理方式。默认 accept 会让 Agent 使用其余可访问工具并返回 warning；reject 在发现不可访问工具时拒绝运行；legacy 保留旧式首个权限失败行为。

预检并不覆盖所有工具类型。Snowflake 在开始运行时检查 Cortex Search、Cortex Analyst、MCP 和 Skill 工具；Custom Tools、SQL Execution、Code Execution 等工具的权限问题可能在实际调用时才暴露。不能因为 Agent Run 已启动就推断所有工具均可用。

### Thread、Run 与最终答案是不同对象

Thread 用于跨请求保留对话上下文；Run 代表一次请求，执行期间会发出事件，包含工具调用和反思信息。应用需要持久保存 thread_id、run_id、请求身份和业务关联 ID，以便恢复会话、审计调用和处理用户反馈。

Agent 的最终文本和引用不保证正确。对于需要外部副作用、财务审批、账户变更或其它业务决策的操作，应将 Agent 输出视为建议或候选计划，再通过独立的权限、业务规则和人工确认环节执行。

## 工程实施步骤

1. **明确任务类型。** 将用户请求拆分为结构化分析、文档检索、计算、外部读取和副作用操作，判断哪些步骤需要 Agent，哪些适合确定性代码。
2. **设计最小工具集。** 每个工具只暴露所需功能，并定义参数 Schema、返回结构、超时、错误和幂等键。
3. **划分身份权限。** 明确调用者 Role、Agent 对象权限、Semantic View/ Search Service USAGE、底层表权限、MCP Server USAGE 和外部凭证边界。
4. **撰写 Orchestration Instructions。** 描述任务分类、工具优先级、何时澄清、何时并行、何时停止，以及工具失败后允许使用的替代路径。
5. **配置不可访问工具行为。** 对权限缺失必须阻止执行的工作流使用 reject；只有允许降级且剩余工具可完成任务时才考虑 accept。
6. **处理 Thread 和 Run 事件。** 持久化 thread_id、run_id、请求 ID 和工具轨迹；对长时间运行和断线场景设计续接与结果查询。
7. **验证工具路由。** 使用正常、歧义、缺权限、工具超时、无结果、互相冲突证据和用户越权等测试集，确认 Agent 不会错误选择或绕过授权。
8. **限制副作用工具。** 将读操作与写操作分开，写工具要求幂等请求 ID、参数验证和明确授权；关键动作在业务侧增加审批或确认。
9. **监控运行质量。** 统计工具调用成功率、重复调用、无效参数、fallback、总延迟、token 消耗、输出引用质量和人工纠正率。
10. **持续评测和版本化。** 对工具规格、编排模型和指令变更保留版本，重跑固定任务集，检查任务成功率、越权拒绝、成本和回归。

工具设计示例（仅描述路由策略，不代表安全授权）：

~~~yaml
instructions:
  orchestration: |
    - 结构化指标问题使用 Cortex Analyst。
    - 企业文档和政策问题使用 Cortex Search。
    - 只有在工具返回的数据需要确定性计算时才使用 Code Execution。
    - 若关键工具不可用或证据冲突，明确说明限制并停止推断。
  response: |
    区分检索证据、计算结果和推断。
    对有副作用的操作只给出待确认计划，不直接视为已批准。
orchestration:
  tool_not_accessible: reject
~~~

## 场景分析

业务用户询问“比较本季度退款原因，并找出受影响最大的产品；如果符合政策，自动创建补偿工单”。问题包含文档检索、结构化分析和外部写入，不能让一个宽权限工具包同时负责所有步骤。

Agent 可以先用 Cortex Search 检索退款政策，再用 Cortex Analyst 查询退款原因和产品指标，最后用 Code Execution 对已返回的数据进行统计。创建补偿工单应使用独立 MCP/Custom Tool，并通过确定性规则核实订单状态、政策适用性和用户权限；如需人工审批，则把待执行参数和证据交给审批系统，只有获得明确批准后才执行。

验收要覆盖政策检索无结果、Analyst 无法生成 SQL、调用者缺少某一工具权限、MCP 断线、重复 Run、工单创建超时以及人工拒绝等情况。确保失败不产生重复工单，权限不足时不会通过另一工具绕过授权。

## 常见误区

- **把自然语言指令当安全边界。** Prompt 只引导编排；权限必须由 Role、Grants 和工具认证控制。
- **将所有工具交给 Agent。** 工具过多会增加路由歧义、权限面和审计成本。
- **认为 Run 启动成功代表所有工具可访问。** 有些权限在预检，有些只在实际调用时检查。
- **让读取工具和写入工具使用同一宽权限身份。** 应拆分权限和职责，并为副作用增加幂等与审查。
- **把 Thread 当作单次执行记录。** Thread 持久化跨轮上下文，Run 才是单次请求执行。
- **认为 Agent 答案及引用一定正确。** 必须通过独立任务评测、来源核对和业务校验。
- **把 Agent 的工具选择视为确定性 DAG。** 编排由模型参与，必须测试分支、停止条件和失败处理。

## 完成标准

- [ ] 能说明 Agent Object、Tool、Orchestration、Thread 和 Run 的关系。
- [ ] 能根据任务需要选择 Analyst、Search、Code Execution、Custom Tool 和 MCP。
- [ ] 能区分编排指令与实际授权边界。
- [ ] 能解释 tool_not_accessible 的 accept/reject/legacy 行为与预检范围。
- [ ] 能为副作用工具设计幂等、授权、确认与审计。
- [ ] 能用固定任务集评估路由、权限拒绝、恢复、结果质量和成本。

## 自测

1. Cortex Agent 可以访问 Cortex Search，但没有 Cortex Analyst 权限；tool_not_accessible 默认 accept 时可能发生什么？如果必须依赖 Analyst，应采用哪种处理策略？
2. 为什么 tool_not_accessible 预检不能保证 Custom Tool、SQL Execution 和 Code Execution 在实际运行时一定成功？
3. Thread 与 Run 分别代表什么？应用为何需要同时保存两类 ID？
4. Agent 生成了符合退款政策的补偿建议，为什么仍不能直接把它当作已审批的写操作？
5. 当 Cortex Search 与 Analyst 返回互相矛盾的证据时，编排指令和业务层应如何处理？

## 参考资料

- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Create and manage agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-manage)
- [Inaccessible tool handling](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-inaccessible-tool-handling)
- [Cortex Agents REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-rest-api)
