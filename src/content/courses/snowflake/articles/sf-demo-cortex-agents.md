# Cortex Agents 工具编排与边界

## 本节要解决的问题

投资运营人员问：“华东基金的前十大持仓里，哪些发行人的最新研究评级下调了？对应的风险政策有没有触发？”

这个问题需要两种不同的数据能力：持仓与风险敞口来自结构化数据，研究评级和政策说明来自文档。Cortex Agents 可以将 Cortex Analyst、Cortex Search 和其他工具组合成一个请求流程，但工具能否被调用、使用哪个 Warehouse、以谁的身份访问数据，都由 Agent 配置和 Snowflake 调用上下文共同决定。

Agent 的作用是拆分问题、选择工具、理解返回结果并组织回答。它不应凭语言模型记忆编造持仓数字，也不应仅凭研究摘要执行卖出或修改权限等业务动作。

## 核心知识

### Agent 对象把模型、工具和编排指令放在一起

一个 Cortex Agent 对象包含模型配置、指令、工具定义、工具资源和编排预算。工具不是只写一个名字，还需要工具说明和输入 Schema；工具资源再提供该工具运行时使用的具体对象与配置。

常见工具包括：

| 工具 | 能做什么 | 需要配置的资源 |
|---|---|---|
| Cortex Analyst | 根据语义模型回答结构化数据问题并生成 SQL | Semantic View、Warehouse、查询超时 |
| Cortex Search | 检索非结构化文档 | Search Service、过滤条件、可搜索列、返回数量 |
| Code Execution | 在隔离环境内运行 Python，处理工具返回的数据 | 是否启用及执行环境 |
| Data to Chart | 根据数据生成图表 | 数据结果与可视化配置 |
| Custom Tool | 调用业务自有工具或服务 | 工具描述、输入/输出 Schema、服务端执行逻辑 |

Agent 对象本身不等于权限代理。配置里列出某个 Semantic View 或 Search Service，只表示 Agent 可以尝试调用它；实际请求仍受调用人的 Snowflake 权限约束。

### Orchestration instructions 决定怎样拆任务和选择工具

以持仓和研究报告问题为例，可以为 Agent 指定类似的规划规则：

- 前十大持仓、敞口、地区和行业统计必须通过 Cortex Analyst 查询批准的 Semantic View。
- 研究评级、报告发布日期和政策原文必须通过 Cortex Search 检索。
- 比较评级变化时，必须核对报告发布日期和发行人标识，不把目标价或分析师观点当成当前持仓数据。
- Search 找不到有效版本或 Analyst 没有返回必要指标时，应说明缺少的证据，不得用模型记忆补齐。
- Code Execution 只用于处理已经返回的有限结果，不代替 Analyst 查询全量数据。

这类指令影响工具选择和回答方式，但不能修复工具本身的错误配置，也不能赋予调用人原本没有的权限。工具参数、Search 过滤列和 Analyst Semantic View 应在 Agent 定义中提前收敛范围，而不是让模型自由访问账户里的全部对象。

### 工具权限由请求的 Snowflake 上下文决定

调用 Agent 的角色需要获得 SNOWFLAKE.CORTEX_USER 或 SNOWFLAKE.CORTEX_AGENT_USER 数据库角色。后者只开放 Cortex Agents、CoWork 和 CoCo，不等于开放所有 Cortex AI 功能。如果 Agent 配置了 Cortex Analyst 工具，还需要单独授予 SNOWFLAKE.CORTEX_ANALYST_USER；CORTEX_AGENT_USER 本身不包含 Analyst 权限。

REST API 请求通过认证方法识别调用者，再由 X-Snowflake-Role 指定授权角色；省略该 Header 时使用用户的 Default Role。请求上下文中启用的 Secondary Roles 也参与权限检查和数据保护策略评估。Snowsight/CoWork 则使用界面中选择的 Role。调用者还需要对 Agent 及其 Database/Schema 有 USAGE，并对 Agent 使用的 Warehouse 和工具对象拥有相应权限。

例如，REST 调用的访问身份应由服务端根据当前用户身份确定：

~~~http
POST /api/v2/databases/ANALYTICS/schemas/AGENTS/agents/PORTFOLIO_RESEARCH:run
Authorization: Bearer <snowflake-token>
X-Snowflake-Role: PORTFOLIO_ANALYST
Content-Type: application/json
~~~

上例展示的是请求头和资源路径示意，不包含真实账户 URL 或认证流程。不能让用户在自然语言问题中指定 X-Snowflake-Role，也不能信任检索到的文档要求 Agent 切换到管理员角色。

工具缺权处理由 Agent specification 顶层的 orchestration.tool_not_accessible 控制，允许值为 accept、reject 和 legacy。当前默认值是 accept：调用者缺少某个工具权限时，整次运行继续使用可访问的工具，并把不可用工具作为 Warning 报告；reject 则让该次运行失败。legacy 保留旧版兼容行为。这个设置不是请求 Header，也不能由每次 agents/{name}:run 调用临时覆盖，应通过 Agent specification 更新。

对必须同时取得结构化结果和文档证据的风险分析，建议使用 reject，或由应用端严格检查工具 Warning 与完成状态；不能把“部分工具可用”误报成完整分析。只有业务明确允许部分结果时，才采用 accept，并在界面上标出哪些证据缺失。

### 编排预算和 API 限流需要纳入运行设计

Agent 的 orchestration.budget 可以设置 seconds 和 tokens。seconds 从首次编排步骤开始计时；tokens 统计编排模型在规划过程生成的输出 Token，不包括输入 Token，也不包括 Analyst、Search、Custom Tool 等工具消耗的 Token。预算在编排步骤之间检查，因此已经开始执行的工具步骤可能在预算超过后才结束。达到上限时，Agent 会发出 budget_tokens_exceeded 或 budget_timeout_exceeded 状态更新；应用必须将它显示为未完成，而不是正常回答。

不要把编排 Token Budget 当成整个请求的总成本上限。需要跟踪完整消耗时，应结合 CORTEX_AGENT_USAGE_HISTORY 和工具自身的使用记录。REST API 如果返回 429，应按服务返回的错误信息控制并发并执行有限退避；不要在没有确认请求是否已受理时无限快速重试。

调用方还应区分：
- Agent 正在规划或运行工具。
- 工具返回错误或无权限。
- Agent 达到 budget_tokens_exceeded 或 budget_timeout_exceeded。
- Agent 正常完成但证据不足。
- Agent 正常完成且有充分证据。

这些状态不能都映射成一个“成功/失败”布尔值。

### Thread 维护对话上下文，不是业务事实库

Agent 可以使用 Thread 保留多轮对话上下文，调用方无需每轮都重发所有消息。但 Thread 不是交易状态表、政策数据库或审计主记录。不能把用户上一次说的“该基金适用 15% 限额”当作当前有效政策。

对高风险问题，Agent 每次都应从权威数据源重新读取当前政策和相关日期；Thread 只用于理解追问上下文。最终回答应保留工具结果引用、查询标识、文档版本和运行状态，便于审查。

## 工程实施步骤

1. 先确定 Agent 的单一业务职责和允许回答的问题范围，不要把所有 Analyst、Search、SQL 和外部 API 都塞入同一个 Agent。
2. 为结构化问题准备受治理的 Semantic View；为文档问题准备带有发行人 ID、发布日期、文档版本和权限属性的 Cortex Search Service。
3. 为每个工具配置描述、输入 Schema、目标对象和 Warehouse；Search 只暴露所需的过滤与返回字段。
4. 为 Agent 编写 Orchestration instructions，明确何时使用 Analyst、何时使用 Search，以及哪些证据缺失时必须停止。
5. 配置 tool_not_accessible 行为和编排时间/Token budget，按业务风险测试工具缺权和预算耗尽。
6. 使用真实业务身份调用 Agent，验证 X-Snowflake-Role、Cortex 数据库角色、Agent 权限、Semantic View 和 Search Service 权限。
7. 保存 Agent 版本、模型配置、工具资源、指令版本、Thread/请求标识、工具结果、错误和最终回答。
8. 用固定问题集测试工具选择、SQL 结果正确性、文档引用、权限拒绝、过期文档处理、预算耗尽和 429 恢复。
9. 对状态修改类 Custom Tool 使用服务端幂等键、参数校验和专门的授权/审批流程，不把高影响操作开放成任意工具调用。
10. 发布前比较一次完整的端到端结果与独立 SQL/人工核对结果；上线后持续监控工具调用分布、错误率、成本和延迟。

## 场景分析

投资运营人员询问华东基金前十大持仓中哪些发行人最近下调评级，并且是否触发风险政策。

Agent 应先用 Analyst 从持仓 Semantic View 获取基金、估值日、发行人和敞口；然后用 Search 按发行人规范 ID 检索最新有效研究报告与政策文件；最后将两个结果按发行人 ID 和日期对齐。若研究文档只有简称、无法可靠映射到发行人，必须标记为待确认，不得仅凭名称相似强行关联。

若 Analyst 工具无权读取该基金，Agent 不应改用另一个宽权限角色继续查询；若 Search 服务暂不可用，则可以报告持仓结果已获取、研究证据缺失，但不能得出“没有评级下调”的结论。若预算耗尽，应用应显示任务未完成并保留已完成工具步骤，而不是把部分结果包装成完整报告。

即使报告显示某发行人超限，Agent 也只能说明所用政策版本、计算值和证据。是否减仓、冻结交易或申请豁免，需要由具有相应职责的人员和流程决定。

## 常见误区

- **只给 Agent 配置工具，不检查调用身份。** 工具权限由请求的 Snowflake 上下文决定，配置了资源不等于调用人有权使用。
- **把 Orchestration instructions 当作安全边界。** 指令影响选工具方式，权限仍由 Snowflake GRANT、调用角色和服务端实现控制。
- **工具不可用时继续给出看似完整的回答。** 应配置明确的拒绝/继续策略，并标记缺失证据。
- **把 Thread 当成当前业务状态或政策库。** 多轮记忆不能替代权威数据源和有效期判断。
- **把 Agent 预算耗尽当作正常完成。** 应向调用方暴露未完成状态和已完成步骤。
- **把 429 当成工具内部错误。** 它是 API 请求限流，应控制并发、指数退避并重试。
- **让 Agent 直接执行高影响操作。** Custom Tool 应具备独立授权、幂等和必要的审批机制。

## 完成标准

- [ ] 能说明 Agent 对象包含模型、工具、资源、指令和预算配置。
- [ ] 能区分 Analyst、Search、Code Execution 和 Custom Tool 的职责。
- [ ] 能解释 X-Snowflake-Role、Cortex 角色和工具对象权限如何影响调用。
- [ ] 能配置工具缺权时的拒绝/继续策略。
- [ ] 能处理编排预算耗尽、工具错误和 REST API 429。
- [ ] 能区分 Thread 上下文与权威业务事实、政策和审计记录。
- [ ] 能设计固定问题集评测工具选择、证据质量和权限拒绝。

## 自测

1. Agent 配置了某个 Cortex Search Service，但调用人的 Role 没有该服务的权限。应期待什么结果？tool_not_accessible 可以控制什么行为？
2. REST API 请求带有 X-Snowflake-Role: PORTFOLIO_ANALYST。这个角色由谁决定？为什么不能让用户在问题文本中指定？
3. Search 没有返回最新政策文件。Agent 能否回答“未触发风险政策”？还缺少什么证据？
4. Agent 达到 Token budget 后停止，但已经完成 Analyst 查询。应用应如何向用户表示执行状态？
5. Agents API 返回 429。应怎样处理并发和重试？为什么不能不受限制地立即重试？

## 参考资料

- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Create and manage agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-manage)
- [Cortex Agents REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-rest-api)
