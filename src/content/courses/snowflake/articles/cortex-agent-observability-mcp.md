# Agent 运行证据、评测与 MCP 集成

## 本节要解决的问题

Agent 在生产环境中给出错误答案时，不能只看最终文本。需要还原用户请求、规划、工具选择、工具输入输出、SQL 执行、响应生成和用户反馈，并判断问题发生在检索、工具执行、编排还是最终回答阶段。本节聚焦 Cortex Agent 的可观测性、离线评测和 MCP 外部工具边界。

## 核心知识

### 一次用户回合对应一条 Trace，内部执行由 Span 组成

Cortex Agent Monitoring 使用 OpenTelemetry 风格事件。一个 Thread 表示持续对话；一个 Turn 是一次用户请求和 Agent 响应；每个 Turn 对应一条 Trace；Trace 内部包含多个 Span，例如 LLM planning、Cortex Search、Cortex Analyst、MCP connector、SQL execution、Code Execution 和 response generation。

生产 Trace 记录在 SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS。可从 Snowsight 的 Agent Observability 面板按 Thread 查看，也可以使用 GET_AI_OBSERVABILITY_EVENTS 查询事件。排查时应从 thread_id 找到 Turn，再通过 trace_id 筛选本次请求的所有 Span，按时间和父子关系重建执行路径。

Trace 记录的是系统实际执行证据，不自动证明数据正确。工具输入和输出可能包含敏感内容，Snowflake 会按权限控制明细可见性；拥有 MONITOR 权限可以查看工具名称、耗时和部分用量信息，查看未脱敏输入输出还需要 READ UNREDACTED AI OBSERVABILITY EVENTS TABLE。

### 生产 Observability 与离线 Evaluation 解决不同问题

Observability 用于检查真实用户请求：查看对话历史、计划、工具调用、SQL、响应和用户反馈，定位已经发生的生产问题。Evaluation 用固定 Dataset 在上线前或发布后做批量评测，比较不同 Agent 版本、模型、指令和工具配置。

Cortex Agent Evaluations 内置的核心指标包括：

- answer_correctness：将答案与 Ground Truth 对比。
- logical_consistency：检查指令、规划和工具调用之间是否一致，不需要 Ground Truth。
- tool_selection_accuracy：检查是否选择预期工具。
- tool_execution_accuracy：检查工具调用的参数和返回结果是否符合预期。

工具选择与工具执行指标在当前文档中标注为 Public Preview。LLM Judge 指标需要记录 metric version；更换 judge、提示或 rubric 版本后，评分不一定能直接与旧版本横向比较。Evaluation 运行也会消耗 Agent 调用、Judge 推理、Warehouse 和存储资源。

### MCP Connector 是受限工具接口，不等于完整 MCP Runtime

Cortex Agent MCP Connector 通过 API Integration 连接远端 MCP Server，并将远端工具暴露给 Agent。当前外部 MCP Server 主要支持 Tools 能力，不支持 Resources、Prompts、Roots、Notifications、协议版本协商、Lifecycle 和 Sampling。不要因为服务器实现了完整 MCP，就认为 Cortex Connector 会暴露所有协议能力。

MCP Connector 的认证、token 生命周期和远端 API 权限需要单独管理。禁用 API Integration 会使相关 token 失效并阻止工具调用；删除 Integration 会连同配置和 Secrets 一起删除。Agent Trace 会记录 MCP 工具调用，但完整输入/输出可能被脱敏。

## 工程实施步骤

1. 为每个业务请求保存 thread_id、turn/run 标识、用户、Role、业务请求 ID 和应用版本，建立从用户操作到 Snowflake 执行记录的关联键。
2. 在生产 Snowsight Agent Observability 中查看 Thread 和 Turn，使用 trace_id 获取本次请求的完整 Span；将计划、工具调用、SQL、错误和最终响应按时间重建。
3. 对关键 Agent 授予最小 MONITOR 权限；只有经过审查且确有需要的调查角色才授予未脱敏事件表读取权限。
4. 为工具调用记录输入契约、返回状态、耗时、重试次数和幂等请求 ID；将工具返回值视为数据，不把其中的指令当系统指令执行。
5. 建立独立 Evaluation Dataset，覆盖正常、歧义、无结果、错误工具、权限不足、证据冲突和高风险请求。
6. 选择 Ground Truth 与 reference-free 指标；固定 Judge metric version，并对工具选择、参数构造、工具执行结果和最终答案分别设门槛。
7. 每次修改 Prompt、工具 Schema、Agent 版本或模型后重跑评测；记录各指标变化和成本，避免混用不同 metric version 的分数。
8. 配置 MCP Server 时使用专用 API Integration 和 Secret，限制 OAuth/访问范围、外部域名、token 生命周期及可执行工具数量。
9. 验证远端 MCP 工具调用失败、token 过期、Integration 被禁用、服务端断连和工具返回畸形 JSON 的行为；关键操作要保证幂等和可恢复。
10. 发生生产事故时，先通过 Trace 找到失败 Span，再复用同一输入构建可重放评测用例；修复后验证指标改善且未增加越权、错误执行或成本。

示例：按一次 Agent Turn 查询观测事件。

~~~sql
SELECT *
FROM TABLE(
  SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(
    'ANALYTICS',
    'AGENT_SCHEMA',
    'SUPPORT_AGENT',
    'CORTEX AGENT'
  )
)
WHERE TRACE:trace_id::STRING = '<trace-id>';
~~~

实际 UDTF 参数和可见字段应按 Agent 类型及当前账户文档确认。生产分析优先使用受控视图，避免将未脱敏工具内容广泛暴露。

## 场景分析

客服 Agent 先检索退款政策，再通过 Analyst 查询订单，最后调用 MCP 工具创建补偿工单。用户反馈工单重复创建，但 Agent 最终回答只显示“已完成”。

先查看该 Turn 的 Trace，确认是否调用了两次 MCP 工具、是否发生超时后重试、两次工具返回的 request ID 是否相同。若工具已执行但响应丢失，单靠最终回答无法判断服务端是否已经创建工单。应在 MCP 工具端使用业务幂等键，按请求 ID 查询工单状态，再决定是否重试。

将事故输入加入 Evaluation Dataset，分别评估工具选择、工具参数、执行结果和最终回答。对创建工单这类副作用操作，离线评分只能发现行为回归，仍需由工具端授权和幂等逻辑阻止重复执行。

## 常见误区

- **只保留 Agent 最终回答。** 没有 Trace 和 Span 就无法区分计划、工具、SQL 与响应阶段的问题。
- **把 Thread、Turn 和 Trace 当同一个对象。** Thread 包含多个 Turn，一个 Turn 对应一条 Trace，Trace 包含多个 Span。
- **把生产 Observability 当批量 Evaluation。** 前者调查真实运行，后者使用固定数据集评估版本和行为。
- **只评答案正确性。** 工具选择、工具执行、逻辑一致性和最终答案需要分开测量。
- **认为 MCP Connector 支持完整 MCP 协议。** 外部 MCP Connector 当前以 Tools 为主，不支持 Resources、Prompts、Roots、Notifications 等全部能力。
- **认为 MONITOR 权限就能读取所有敏感工具输入输出。** 未脱敏内容还需要专门权限，必须按调查需要授权。
- **用 LLM 评测分数代替副作用安全。** 工单、付款和权限变更仍需服务端幂等、授权和审计。

## 完成标准

- [ ] 能解释 Thread、Turn、Trace 和 Span 的层级关系。
- [ ] 能通过 trace_id 重建 Cortex Agent 的一次执行路径。
- [ ] 能区分生产 Observability 与批量 Evaluation。
- [ ] 能使用 answer_correctness、logical_consistency、tool_selection_accuracy 和 tool_execution_accuracy 设计评测。
- [ ] 能说明评测版本、权限脱敏和评测成本的边界。
- [ ] 能解释 MCP Connector 的协议范围、认证和工具调用审计要求。

## 自测

1. 同一个 Thread 中连续提问三次，通常会有几个 Turn 和几条 Trace？为什么不能只按 thread_id 分析单次失败？
2. Trace 显示 Analyst 工具返回正确数据，但最终回答引用错了数据，应该重点检查哪个阶段？
3. tool_selection_accuracy 和 tool_execution_accuracy 分别检查什么？为什么两者都不能替代最终答案评估？
4. 远端 MCP Server 支持 Resources 和 Prompts，Cortex Agent Connector 是否一定能调用？需要检查哪些协议能力？
5. Agent 创建工单后客户端超时，怎样结合 Trace、幂等键和业务查询避免重复创建？
6. 为什么切换 Evaluation Judge metric version 后，不应直接把新旧分数当成同一口径？

## 参考资料

- [Monitor Cortex Agent requests](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-monitor)
- [Cortex Agent evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations)
- [MCP Connectors](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp-connectors)
- [AI Observability events](https://docs.snowflake.com/en/sql-reference/functions/get_ai_observability_events)
- [Account privilege for unredacted AI observability events](https://docs.snowflake.com/en/user-guide/security-access-control-privileges)
