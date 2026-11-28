# 资产管理多 Agent 架构与工具选型

## 本节要解决的问题

投资运营人员每天会问三类问题：

- “基金今天的行业敞口和前十大持仓是多少？”——需要受治理的结构化数据。
- “发行人 A 最近一次评级下调的理由是什么？”——需要检索研究报告和正式公告。
- “发行人 A 是否触发投资政策？如果触发，差异来自哪个数据源？”——需要把持仓、政策和文档证据按同一日期关联起来。

如果把三个问题都交给一个没有边界的 Agent，它可能把研究报告中的目标权重当成真实持仓，也可能在 Search 失败时编造政策结论。如果把每个查询步骤都拆成独立 Agent，又会增加调用延迟、权限配置和版本维护成本。

设计重点不是 Agent 数量，而是区分任务边界、工具复用和请求路由：什么时候一个 Agent 加多个工具就够了，什么时候值得建立专用 Agent，什么时候需要 Router 或 Toolset。

## 核心知识

### 先判断任务需要组合工具，还是在不同专家之间择一

Cortex Agents 的常用工具包括：

| 工具 | 处理的数据/任务 | 资产管理示例 |
|---|---|---|
| Cortex Analyst | 根据 Semantic View 对结构化数据生成 SQL | 持仓、NAV、行业敞口、风险限额 |
| Cortex Search | 对非结构化材料执行检索 | 研究报告、政策文件、会议纪要 |
| Code Execution | 在隔离 Python 环境中处理已返回的数据 | 对有限结果进行计算、整理或绘图 |
| Custom Tool | 调用受控 Stored Procedure、UDF 或后端能力 | 证券标识映射、受控风险检查 |
| Agent toolset | 复用另一个 Agent 已配置的工具集合 | 多个业务 Agent 共用标准持仓查询工具 |
| Agent Router | 根据请求选择一个指定的子 Agent | 把持仓分析、研究检索和运营问题分流 |

一个问题需要同时使用持仓和研究证据时，通常应由一个有明确职责的分析 Agent 同时配置 Analyst 和 Search，再按任务顺序组合证据。Router 的作用是从候选子 Agent 中选择一个，不是让多个 Agent 自动并行执行并汇总结果。

### 单 Agent 多工具是最简单的组合方式

例如“比较基金 F01 的科技行业敞口和最近研究报告中的风险观点”，就需要结构化事实与文档证据。可以将 Analyst 和 Search 配置在同一个 Portfolio Research Agent 中：

~~~yaml
models:
  orchestration: auto
instructions:
  response: |
    结构化持仓和风险数字必须来自已批准的 Semantic View。
    研究观点必须来自 Cortex Search 返回的有效报告。
    对齐 fund_id、issuer_id 和估值日期后再比较。
    报告发布日期晚于问题日期的材料不能作为当时已知证据。
    缺少价格、政策版本或研究来源时，明确说明无法确认。
tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: portfolio_analyst
  - tool_spec:
      type: cortex_search
      name: research_search
~~~

示例省略了 tool_resources 中的 Semantic View、Search Service 和 Warehouse 配置。它说明的是职责边界：Analyst 计算持仓事实，Search 找研究证据，Agent 负责把结果按日期和证券身份对齐。它不应让 Search 自行计算 NAV，也不应让 LLM 凭研究片段估算持仓。

当工具数量少、任务需要组合结果、数据域共享同一授权上下文时，单 Agent 多工具更直接，通常也更容易测试和运维。

### Agent Router 是请求路由，不是多 Agent 并行协作

Agent Router（Preview）通过 agent_router 工具，将每个用户问题路由到配置的某一个子 Agent。每个子 Agent 有完整限定名和用途说明：

~~~yaml
models:
  orchestration: auto
tools:
  - tool_spec:
      type: agent_router
      name: business_router
tool_resources:
  business_router:
    subagents:
      - name: ANALYTICS_DB.AGENTS.PORTFOLIO_AGENT
        description: 组合持仓、估值、基准和表现分析
      - name: ANALYTICS_DB.AGENTS.RESEARCH_AGENT
        description: 研究报告、公告和政策文件检索
      - name: ANALYTICS_DB.AGENTS.OPERATIONS_AGENT
        description: 交易状态、结算和托管对账
~~~

Router 每次选择其中一个 Agent 执行；路由深度只有一层。通过 Router 到达的子 Agent 不会再使用自己的 agent_router 工具向下路由。若要访问更深层的 Agent，必须将其直接列在顶层 Router 的 subagents 中，或让中间 Agent 通过 toolset 继承其工具。

调用者除了拥有 Router 的 USAGE，还必须拥有每个可路由子 Agent 的 USAGE。没有权限的子 Agent 会按 tool_not_accessible 的行为被跳过或导致请求失败。这个权限模型不能用 Router 绕开业务数据授权。

Router 适合“这次请求应由哪个专业 Agent 处理”，不适合“同一个请求必须同时让三个 Agent 各自分析，再由主 Agent 对比结果”。后一种需求需要一个配置了相应工具的组合 Agent，或由应用层显式编排多次调用并保存各步输出。

### Agent toolset 复用的是工具集合，不是另一个 Agent 的完整推理流程

如果 Portfolio Agent、Risk Agent 和 Operations Agent 都需要查询相同的证券主数据和已批准的持仓视图，可以创建一个专门的工具集合 Agent，再由业务 Agent 引用其工具：

~~~yaml
tools:
  - tool_spec:
      type: agent_toolset
      name: shared_portfolio_tools
tool_resources:
  shared_portfolio_tools:
    agent_name: ANALYTICS_DB.AGENTS.PORTFOLIO_TOOLKIT
~~~

运行时，Snowflake 读取被引用 Agent 的 tools 和 tool_resources，并把它们合并到调用 Agent 的有效工具列表中。Orchestrator 看到的是展开后的工具；它不会把被引用 Agent 的原始规划、对话历史或回答当作一次子 Agent 调用结果。

调用者需要同时具有调用 Agent 和被引用 Agent 的 USAGE。Toolset 解析可以递归，但有最大深度和引用 Agent 数量限制；循环引用会失败。若被引用 Agent 不存在或调用者没有权限，引用工具集合可能被静默跳过，主 Agent 仍使用自己的工具继续运行。生产环境必须监控工具实际可用情况，避免缺少共享工具却仍返回看似完整的结果。

因此，Toolset 适合复用稳定工具定义，不适合替代真正需要独立推理、不同上下文或不同发布节奏的专业 Agent。

### 资产管理 Agent 应按业务责任划分，不按每张表或每个工具拆分

一个可维护的划分可以是：

- **Portfolio Agent**：持仓、估值、基准、表现和结构化组合指标。
- **Research Agent**：研究报告、公告、评级变化和文档引用。
- **Operations Agent**：交易状态、结算、现金和托管对账。
- **Risk Agent**：政策版本、集中度、限额和待调查风险。
- **Router（按需）**：接收不同类型的问题并选择对应 Agent。

这不是要求一定创建五个 Agent。若 Portfolio Agent 已经需要 Analyst 和 Search 联合回答，没必要再把每个检索动作拆为一个 Agent。若所有业务问题都经过同一个应用入口，且权限上下文一致，应用层路由也可能比 Snowflake Agent Router 更简单。

拆分的实际收益应当是边界清楚、权限不同、工具契约稳定或团队独立发布。只因为系统图里画出多个 Agent，不代表任务更可靠。

### 权限和数据来源不能通过 Agent 层级放大

Cortex Agent 的调用权限来自请求中的 Snowflake 用户/Role 上下文。Agent Router 和 Toolset 不会创建更高权限身份，也不应通过一个拥有宽泛权限的主 Agent 替普通调用者查询受限数据。

需要分别授予：
- Cortex Agent API 所需的数据库角色；
- 调用 Agent 和被引用 Agent 的 USAGE；
- 对应 Database、Schema 和 Warehouse 的权限；
- Analyst Semantic View、Search Service、Custom Tool 和其他源对象的必要权限。

Cortex Analyst 还需要单独的 SNOWFLAKE.CORTEX_ANALYST_USER；CORTEX_AGENT_USER 本身不包含 Analyst 权限。若采用 Router，调用者还需要对可能被选择的子 Agent 具备 USAGE。所有专业 Agent 都要在真实业务 Role 下做正向与负向测试。

## 工程实施步骤

1. 收集典型问题，按“需要组合多个工具”“只需一个专业能力”“需要路由到不同业务”分组。
2. 为每种任务定义输入、必需证据、输出字段、业务日期和无法回答的条件。
3. 优先用一个 Agent 配置多个工具完成需要组合证据的任务，不要为了多 Agent 而拆分。
4. 只有在专业职责、权限域或独立发布节奏确实不同的情况下，才创建专用 Agent。
5. 对需要按问题择一的请求评估 Agent Router；确认 Preview 状态、一层路由限制和每个子 Agent 的调用权限。
6. 对需要多个 Agent 共用稳定工具的场景评估 Agent toolsets；检查递归深度、引用数量、同名工具覆盖规则和静默跳过风险。
7. 给每个 Agent 写清楚职责范围、必用工具、数据来源、工具失败时的行为和最终输出契约。
8. 按调用 Role 授予 Agent、Toolset 引用、Warehouse、Semantic View、Search Service 和 Custom Tool 的最小权限。
9. 使用固定问题集测试路由是否选对 Agent、复合任务是否拿全证据、无权工具是否正确失败，以及缺失证据是否被如实报告。
10. 保存 Agent 版本、工具配置、路由结果、请求 ID、Thread/Turn 和数据查询证据，支持回放和独立评测。

## 场景分析

投资委员会提出两个请求：

1. “给我 F01 基金截至 11 月 27 日的前十大持仓。”这是 Portfolio Agent 的结构化问题，使用 Analyst 即可。
2. “F01 的前三大持仓中，哪些发行人的最新评级发生了变化？是否触发投资限额？”这需要 Portfolio 数据、Research 文档和 Risk Policy。仅靠 Router 路由到单一 Research Agent 不会自动拿到组合和政策结果。

第二个请求应由一个组合研究 Agent 配置 Analyst、Search 和受控风险查询工具；或由业务应用依次调用 Portfolio、Research 和 Risk Agent，并在服务端按 issuer_id、valuation_date、policy_version 关联结果。若选择应用层编排，必须保留每个 Agent 的版本、权限上下文和工具结果，不能只保存最终总结。

如果只有不同类别的独立问题，Router 可以减少应用层路由代码；如果多个 Agent 共享同一组证券和持仓查询工具，Toolset 可以减少重复配置。它们解决的是不同问题，不能因为名字里都有 Agent 就混为一谈。

## 常见误区

- **把所有问题交给一个没有边界的 Agent。** 工具描述、输入/输出和数据来源不清楚时，很难判断错误发生在规划、查询还是证据关联。
- **把每个工具或每张表都拆成一个 Agent。** 会增加调用、授权、版本和排障成本，并不自动提升准确性。
- **认为 Router 会让所有子 Agent 并行分析后汇总。** Router 每次路由到一个子 Agent，且路由深度为一层。
- **把 Agent toolset 当成完整子 Agent 调用。** Toolset 只继承被引用 Agent 的 tools 和 tool_resources，不执行它的完整规划与回答。
- **认为 Toolset 引用失败一定会报错。** 被引用 Agent 缺失或调用者没有 USAGE 时，其工具可能静默跳过，必须监控最终工具集合。
- **认为 Agent 层级可以绕过 Snowflake 权限。** 每个调用者都需要对 Agent、被引用 Agent 和实际工具对象具备相应权限。
- **为多 Agent 架构重新复制 Semantic View 和 Verified Queries。** 专业 Agent 应复用已治理的结构化定义，除非模型边界或业务语义确实不同。

## 完成标准

- [ ] 能判断一个问题需要单 Agent 多工具、Agent Router、Agent toolset 还是应用层编排。
- [ ] 能说明 Router 每次选择一个子 Agent，且只路由一层。
- [ ] 能说明 Toolset 继承工具定义，不等于运行被引用 Agent 的完整推理流程。
- [ ] 能识别 Toolset 引用静默跳过、循环和深度/数量限制。
- [ ] 能按业务职责划分 Portfolio、Research、Operations 和 Risk Agent。
- [ ] 能说明 Router/Toolset 不会提升调用者的数据权限。
- [ ] 能用组合事实、研究证据和政策版本验证复合问题是否完整回答。

## 自测

1. 用户询问基金前三大持仓的评级变化和限额状态，需要同时使用 Portfolio、Research 和 Risk 结果。为什么单纯使用 Router 选择一个 Agent 不足以保证结果完整？
2. Agent toolset 引用一个 Portfolio Toolkit Agent 后，调用 Agent 实际得到的是什么？它会执行被引用 Agent 的完整对话和推理流程吗？
3. Toolset 引用的 Agent 被删除或调用者没有 USAGE，主 Agent 可能怎样运行？为什么这需要额外测试？
4. Agent Router 的调用者有 Router USAGE，但没有 Research Agent USAGE。是否应该期待 Router 以更高权限调用 Research Agent？
5. 什么时候应用层显式编排多个 Agent 比 Snowflake Agent Router 更适合？

## 参考资料

- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Create and manage agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-manage)
- [Agent router](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-router)
- [Agent toolsets](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-toolsets)
- [Access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
