# Agent 工具失败、补偿、幂等与人工接管

## 本节要解决的问题

客户要求 Agent 为订单 O-82013 发起退款。Agent 调用支付服务，支付服务已经受理退款，但响应在网络中丢失。应用只看到超时，于是再次调用退款接口；结果客户收到两笔退款。

这里真正的问题不是“重试次数不够”，而是调用方不知道第一次操作是否已经产生副作用。失败恢复必须区分三件事：请求是否到达、业务动作是否完成、调用方是否拿到结果。对于只读查询，重复执行通常只是浪费资源；对于退款、下单、发通知和修改权限，盲目重放会改变业务状态。

## 先判定失败属于哪一层

### Agent 请求、模型编排和工具执行不是同一个故障点

一次 Agent 任务可能包含：
1. 客户端向 Cortex Agent REST API 或 SDK 发起请求；
2. Snowflake 接收请求并执行编排；
3. Orchestrator 选择工具；
4. 工具访问 Semantic View、Search Service、Custom Tool 或 MCP 服务；
5. 工具可能再调用外部系统；
6. Agent 整理工具结果并返回响应。

不同层的失败含义不同：

| 故障位置 | 典型现象 | 应检查的证据 |
|---|---|---|
| 客户端网络 | DNS/TLS/连接超时、连接中断 | SDK 异常、request ID、网络日志 |
| Agent API | 400、401/403、404、409、429、5xx | HTTP 状态、错误体、请求 ID |
| 编排过程 | 预算耗尽、工具不可用、Agent 停止 | budget 状态、Warning、Turn/Trace |
| 工具调用 | SQL 错误、Search 无权限、Custom Tool 超时 | tool_use/tool_result、Query ID、工具错误 |
| 外部副作用 | 请求已受理但调用方未收到结果 | operation_id、外部系统交易状态 |
| 最终响应 | 工具成功但回答未完成、流式连接中断 | run ID、Thread、Trace、已持久化事件 |

不要把所有异常都包装成“Agent 执行失败”。例如，工具返回权限不足与支付服务请求超时，需要完全不同的恢复动作。

### 按错误类别决定重试、修正还是停止

| 错误类型 | 例子 | 处理方式 |
|---|---|---|
| 瞬时传输错误 | 408、连接中断、暂时性 5xx | 在有界重试预算内使用退避；写操作还要先考虑结果是否未知 |
| 限流 | 429 Too Many Requests | 遵循 Retry-After 或服务端退避建议，减少并发 |
| 输入/契约错误 | 400、422、参数或 Schema 不匹配 | 不重复发送相同请求；修正输入或工具契约 |
| 身份/权限错误 | 401、403、工具无权访问 | 检查 Token、Role、对象权限和授权配置；未经授权不能靠重试解决 |
| 资源不存在 | Agent、Thread、工具资源 404 | 检查对象名、版本和资源生命周期 |
| 冲突/状态错误 | 409、操作状态冲突 | 读取当前状态，再决定是否可以继续；不能自动覆盖业务状态 |
| 业务拒绝 | 余额不足、政策不允许、订单已取消 | 停止重试，返回业务拒绝或进入人工处理 |
| 预算/截止时间耗尽 | budget_timeout_exceeded、budget_tokens_exceeded | 作为未完成处理，保存进度并由应用决定续跑或接管 |

网络超时只说明客户端没有按时收到结果，并不等于服务端没有执行。对只读请求，可以在预算内重试；对有副作用的 POST 或工具操作，要先确定是否有安全的幂等键或可查询的操作状态。

## Cortex Agent SDK 的重试边界

### SDK 自动重试是有范围的，不等于 Agent 运行天然幂等

当前 Cortex Agent SDK 文档列出的可重试传输状态包括 408、409、429 和 5xx。客户端级默认重试只自动作用于 GET、HEAD、OPTIONS 等安全方法。Agent Run、资源创建等写操作需要在单次请求上显式提供 retry policy，才会在瞬时错误后重放请求。

SDK 的 TypeScript 与 Python 默认退避参数也不完全相同。当前文档中 TypeScript 默认初始延迟 500ms、指数倍增、名义最大延迟 30 秒并加入抖动；Python 默认 0.5 秒初始延迟、最大 8 秒，并支持 Retry-After。具体默认值会随 SDK 版本演进，应用不应把它们写成永久不变的业务 SLA。

对 Agent Run 尤其要谨慎：

~~~typescript
// 只读查询可以使用客户端级 retry policy。
const client = new CortexAgentClient({
  account,
  auth,
  retryPolicy: { maxRetries: 3 },
});

// Agent Run 是写请求。是否重放应按本次请求的副作用风险决定。
const response = await api.agent.run(
  {
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Summarize the current order status." }]
    }],
    stream: false,
  },
  { retryPolicy: { maxRetries: 0 } },
);
~~~

示例把 Agent Run 的重试设为 0，是为了强调调用方需要显式选择策略，不代表所有 Agent Run 都必须禁用重试。纯只读、可重复执行的 Agent 查询可以按请求策略开启有限重试；如果 Agent 可能调用付款、退款、发信或变更工单等工具，就先把这些副作用的幂等和执行状态设计好。

SDK 的流式请求默认不自动重试，包括还没收到首个响应事件的网络失败。已经开始的流中途断开，也不能简单地重新 POST 相同 Agent Run；应根据 run ID 使用对应的 resume 接口，或从应用保存的事件位置恢复。SDK 对事件回放有容量限制，默认只保留最近 1,000 个事件且受 8 MiB 上限约束；需要完整审计的应用要在接收事件时自己持久化。

### 先区分 Agent API 超时与后台运行

Cortex Agent REST API 的普通请求默认 15 分钟超时。需要更长任务时可以使用 background 模式，但需满足使用 Thread 管理对话历史等条件；后台运行最长可达 6 小时，并可通过 Stream Agent Run 接口重新连接。这个选项解决的是长任务连接生命周期，不代表工具调用自动获得幂等保证。

应用还要区分：
- Agent 正常完成；
- Agent 返回预算耗尽状态；
- Agent Run 已进入后台但当前客户端断开；
- 当前响应流中断，运行状态尚未确认；
- 外部工具已经执行，但最终回答没有返回。

这些情况不应该都被映射为同一个 FAILED 状态。至少需要区分 SUCCEEDED、FAILED、CANCELLED、RUNNING、OUTCOME_UNKNOWN 和 REQUIRES_REVIEW。

## 对有副作用的工具建立幂等协议

### 幂等键必须来自业务操作，而不是模型临时生成

每个有副作用的业务动作都应有稳定的 operation_id。例如退款请求可以由订单号、退款申请号和动作类型组成：

~~~text
operation_id = REFUND:O-82013:CASE-2026-118:CREATE
~~~

服务端将 operation_id 作为唯一键保存执行记录，至少包含：
- operation_id；
- 调用人、Agent/工具版本和业务对象；
- 规范化请求内容的 payload_hash；
- 状态：RECEIVED、RUNNING、SUCCEEDED、FAILED 或 OUTCOME_UNKNOWN；
- 外部服务返回的 transaction_id；
- 创建/更新时间、重试次数和错误信息。

同一 operation_id 且 payload_hash 相同的重复请求，应返回已保存的操作状态或结果，不应再次执行外部动作。同一 operation_id 却对应不同 payload_hash，应作为冲突拒绝，不能静默覆盖旧请求。

### 超时后先查状态，不要立即再执行一次

安全的退款调用流程：

~~~mermaid
sequenceDiagram
  participant A as Agent / 应用
  participant O as Operation Store
  participant P as Payment Service
  A->>O: 创建 operation_id
  O-->>A: RECEIVED
  A->>P: 发起退款（携带 operation_id）
  P-->>P: 退款已受理并提交
  P--xA: 响应超时/连接中断
  A->>O: 标记 OUTCOME_UNKNOWN
  A->>P: 按 operation_id 查询退款状态
  P-->>A: 已退款 + transaction_id
  A->>O: 更新 SUCCEEDED 并保存结果
  A-->>Agent: 返回已确认结果
~~~

如果支付服务支持 Idempotency-Key，就把同一个 operation_id 传给服务；如果它支持按商户流水号查询，也应使用该 ID 查回状态。只有确认第一次请求没有产生副作用，才考虑重新发起。若外部系统既不支持幂等，也无法查询状态，就不能安全地自动重放，应进入人工对账。

幂等记录应在外部调用前持久化。否则应用在调用成功后、保存结果前崩溃，恢复时仍然不知道这笔操作是否发生。

### 幂等键不能代替业务状态机

一个退款请求还需要业务状态，例如：

~~~text
REQUESTED
  -> VALIDATED
  -> SUBMITTED
  -> CONFIRMED
  -> RECONCILIATION_REQUIRED
  -> REJECTED
~~~

Agent 可以准备退款理由、核对政策和生成请求；是否允许退款仍由确定性业务规则和授权人员决定。提交后，状态只能由外部服务回执、对账任务和经授权的人工操作推进。不要让模型根据对话内容自行把 SUBMITTED 改成 CONFIRMED。

执行状态与 Agent Thread/Message 不是一回事。Thread 保存对话历史；operation store 保存业务操作和副作用结果。应用重启、用户换会话或 Agent 版本更新后，仍然必须能查到 operation_id 的最终状态。

## 多步骤业务任务需要补偿，不是简单数据库回滚

### 外部副作用之间没有一个共同事务

例如订单履约可能依次完成：
1. 建立订单；
2. 锁定库存；
3. 扣款；
4. 创建物流单；
5. 发送客户通知。

这些操作分布在不同服务中，不在同一个数据库事务里。若扣款完成后创建物流单失败，不能简单执行 SQL ROLLBACK 来撤销已经完成的扣款。

可以将工作流设计为 Saga：
- **Forward Recovery**：临时故障恢复后，继续执行后续步骤；
- **Compensation**：业务无法继续时，执行补偿动作，例如取消订单、释放库存或申请退款。

补偿是一个新的业务操作，不是对已经发生的历史做物理回滚。它可能失败、需要再次重试，也可能无法完全逆转，例如邮件已经发送就无法让收件人“没收到”。每个补偿动作同样需要 operation_id、状态记录和审计证据。

### 选择继续、补偿还是人工接管

| 故障情况 | 处理方向 | 例子 |
|---|---|---|
| 临时服务不可用，且动作可幂等重放 | 有界重试后继续 | 查询订单状态、读取客户资料 |
| 前序操作已完成，后续暂时失败 | 状态确认后前向恢复 | 支付成功，物流 API 暂时不可用 |
| 业务规则拒绝继续，且有安全补偿 | 执行补偿流程 | 库存已锁定，但支付被拒绝，释放库存 |
| 副作用结果未知，无法可靠查询 | 暂停并人工对账 | 退款请求超时，支付服务不支持查询和幂等键 |
| 补偿失败或动作不可逆 | 人工接管 | 已发送通知但后续业务被取消 |
| 超出重试次数/时间预算 | 停止自动处理 | 连续 429、长时间 5xx、后台运行超时 |

不要让模型自由决定是否继续扣款、取消订单或豁免业务规则。状态转换、重试上限和补偿条件应由工作流服务执行；Agent 负责解释原因、收集证据和提出建议。

## 一个可落地的失败恢复流程

1. 为任务和每个外部副作用分配 job_id、operation_id 与业务幂等键。
2. 将任务状态持久化；Thread/Turn 只作为对话记录，不作为唯一工作流状态。
3. 对每个工具定义输入 Schema、成功结果、业务拒绝、技术错误和查询操作状态的接口。
4. 对 408、409、429、5xx 和连接中断等瞬时故障，实施有限指数退避；尊重 Retry-After。
5. 对 400/422、401/403、404 和业务拒绝，先修正输入、凭证、权限或业务状态，不重复发送相同请求。
6. 对写操作使用稳定 operation_id；相同 ID/相同 payload 返回原结果，不同 payload 冲突。
7. 超时后进入 OUTCOME_UNKNOWN，先查询外部执行状态，再决定继续、补偿或人工核查。
8. 将已成功步骤、失败步骤和可用补偿动作写入 Saga 状态表；补偿也要幂等并可观测。
9. 到达总时间、最大尝试次数或人工审批边界时停止自动化，向用户展示具体状态和待处理证据。
10. 保存 request_id、run_id、Thread/Turn、Trace、tool_use、tool_result、operation_id、外部 transaction_id 和执行版本。
11. 对后台 Agent Run 和流式连接断开，使用 run_id/stream resume 恢复读取，不无条件重新 POST。
12. 为重复请求、响应丢失、外部服务超时、补偿失败、重复回调和应用重启建立故障注入测试。

## 场景分析

订单 O-82013 的退款金额为 12,800 日元。Agent 完成资格检查后，应用创建 operation_id，并将退款申请写入 Operation Store。支付服务收到请求并完成退款，但响应返回途中超时。

错误的处理方式是立刻重新发起一笔退款。正确流程是：
1. 将状态设为 OUTCOME_UNKNOWN；
2. 用同一个 operation_id 查询支付服务；
3. 如果返回已退款，保存 transaction_id，将状态推进到 CONFIRMED；
4. 如果返回处理中，持续查询或等待回调，不重复创建；
5. 如果确认服务从未受理，才可以用相同幂等键再次提交；
6. 如果外部服务无法确认状态，交由财务人工对账。

若退款成功后订单更新失败，应用不能假装整笔操作已回滚。它可以继续修复订单状态，或按业务政策发起补偿/人工核查。Agent 只负责把支付回执、订单状态和异常原因整理出来，不能把未经确认的退款结果告诉客户。

## 常见误区

- **把客户端超时当成服务端没有执行。** 请求可能已经提交，结果只是没有返回。
- **对所有错误做同样的重试。** 认证、权限、输入和业务拒绝通常需要修正或停止，而不是重复请求。
- **为所有 Agent Run 开启 SDK 自动重试。** SDK 对写请求要求显式 per-request retry policy；重放前必须评估副作用和业务幂等。
- **以为流式请求断开会自动续传。** SDK 默认不自动重试流式请求，中途断流要用 run resume 或应用侧事件持久化恢复。
- **用 Thread ID 作为业务幂等键。** 一个 Thread 可能有多个操作，同一个业务动作也可能跨多个 Thread；应使用稳定的业务 operation_id。
- **只在外部调用成功后才保存操作记录。** 应在执行前记录意图和幂等键，避免成功后、写回状态前崩溃。
- **把补偿当成数据库回滚。** 外部副作用不能统一事务回滚；补偿是新的业务操作，也可能失败。
- **让 Agent 自行决定是否继续重试或补偿。** 这类状态转换应由确定性工作流和授权规则控制。
- **只向用户显示“成功/失败”。** 需要区分执行中、结果未知、需要对账、已补偿和人工接管。

## 完成标准

- [ ] 能区分 Agent API、编排、工具和外部副作用四层故障。
- [ ] 能按错误类别判断重试、修正、查询状态或停止。
- [ ] 能说明 Cortex Agent SDK 对安全请求、写请求和流式请求的重试差异。
- [ ] 能设计 operation_id、payload_hash 和持久化操作状态。
- [ ] 能处理外部系统已完成操作、但客户端响应丢失的 OUTCOME_UNKNOWN 情况。
- [ ] 能说明 Saga 前向恢复和补偿事务的区别。
- [ ] 能为重试与补偿分别设计幂等键、状态查询和审计记录。
- [ ] 能定义超时、预算耗尽、补偿失败和结果不明时的人工接管条件。

## 自测

1. Cortex Agent SDK 收到 429，和收到 403 时，应该采用相同的重试策略吗？分别应检查什么？
2. SDK 对 GET 默认重试，但 Agent Run 是 POST。为什么不能直接把所有调用统一设为自动重试？
3. 退款请求超时，但支付服务可能已经执行。系统应先查状态还是创建一个新请求？需要哪个稳定标识？
4. 两次请求带相同 operation_id，但 payload_hash 不同。服务端应该返回什么结果？为什么不能覆盖之前请求？
5. 支付成功、物流创建失败。为什么数据库回滚无法撤销已经完成的支付？应考虑什么补偿动作？
6. Agent 流式输出中途断开。重新 POST 一遍相同用户消息和恢复原 run 有何区别？
7. 退款结果无法从外部系统确认，且服务不支持幂等键。为什么应进入人工对账，而不是让 Agent 无限重试？

## 参考资料

- [Cortex Agent SDK reference — errors and retries](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agent-sdk/sdk-reference)
- [Cortex Agents Run API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-run)
- [Cortex Agents overview and rate limits](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [AWS Prescriptive Guidance: Retry with backoff pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html)
- [AWS Prescriptive Guidance: Saga patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-patterns.html)
