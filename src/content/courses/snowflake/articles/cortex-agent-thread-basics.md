# Agent 对话线程与上下文

## 本节要解决的问题

让 Cortex Agent 在多轮对话中理解“继续刚才的问题”“把结果按另一种方式展示”等上下文，同时避免应用把对话历史、业务状态和运行审计混为一谈。Thread 保存的是对话上下文；业务订单、审批状态和外部系统结果仍应保存在各自的业务系统中。

## 核心知识

### Thread 持久化跨轮对话，Run 处理单次请求

Cortex Agent 的 Thread 表示一段持续对话，包含用户和 Agent 消息；Run 表示一次向 Agent 提交的请求。Agent API 可创建 Thread、向 Thread 追加消息并启动 Run。一个 Thread 可以有多个 Turn；一次 Turn 会生成一次 Trace，Trace 内包含规划、工具调用、SQL 执行和最终响应等 Span。

Snowflake 可以替客户端保存 Thread 历史，应用不必每次把所有历史文本重新拼接为 Prompt。客户端仍需要保存 thread_id，并在下一轮请求中引用它。Thread 不是数据库事务，也不代表某项外部操作已经提交。

### parent_message_id 决定从哪条历史继续

REST API 继续对话时，需要提供目标 Thread 和上一条成功的 Assistant Message ID 作为 parent_message_id，并提交新的 User Message。不能把上一条 User Message ID 当作 parent_message_id。

如果应用只保存 thread_id 而丢失最新 assistant message ID，可以调用 Describe Thread 查询消息列表，恢复最新成功的 Assistant Message ID。若从较早的 Assistant Message ID 继续，则相当于从历史节点 Fork 一条新分支；应用应明确用户是在继续主线，还是从某个旧回答派生新问题。

### Thread 上下文不等于永久业务记忆

Thread 是对话上下文，不是长期业务状态库。用户在 Thread 中说“订单已退款”，并不代表订单系统已经完成退款；Agent 的文本输出也不自动成为已批准决策。

应用应把业务状态写入权威系统，并在需要时通过受控工具读取。会话恢复需要考虑 Thread 历史是否存在、用户是否仍有权访问相关数据、当前 Role 是否改变，以及 Thread 内容是否包含已过期的业务信息。

Thread 和 Trace 也承担不同责任：Thread 方便恢复对话；Trace 记录单次请求的执行证据。排查某一轮工具失败时，应按 trace_id 查 Span，而不是只读取整个 Thread 的最终文本。

## 工程实施步骤

1. 为每个用户会话建立应用侧 session_id 与 Cortex thread_id 的映射；不要使用用户输入内容作为唯一标识。
2. 启动 Thread 后保存返回的 thread_id 和消息 ID；后续请求保存最新成功的 Assistant Message ID。
3. 发送下一轮消息时使用正确的 parent_message_id，并把新 User Message 放入对应 Thread。
4. 在消息提交成功后再推进应用侧会话游标；若请求失败或超时，先查 Thread 消息状态，避免重复追加。
5. 对“继续之前的话题”和“从旧答案分叉”提供明确的会话操作，Fork 时记录来源 Assistant Message ID。
6. 会话恢复时重新验证用户身份、当前 Role、数据授权和工具可访问性；不能因为用户持有 thread_id 就直接授予旧权限。
7. 将订单、审批、付款、工单等业务状态保存在业务数据库；Thread 仅保存对话和解释材料。
8. 使用 Thread ID 关联用户反馈，使用 Trace ID 关联单次运行；将两者写入可审计的应用日志。
9. 测试并发提交、客户端断线、重复请求、消息 ID 丢失、Thread 不存在和权限变化等场景。
10. 为历史对话制定保留与清理策略；删除对话记录前，确认业务审计或合规留存要求不会受影响。

REST 请求概念示例：

~~~json
{
  "thread_id": 1234,
  "parent_message_id": 456,
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "把刚才的结果按地区拆分"}
      ]
    }
  ]
}
~~~

## 场景分析

客服 Agent 已经分析了某笔退款，用户接着问“那如果是部分退款呢？”。应用应继续同一 Thread，将最新成功的 Assistant Message ID 作为 parent_message_id，Agent 才能沿用上一轮上下文。

如果客服人员关闭浏览器后由另一位有权限的人员接手，应用不能只凭 thread_id 继续展示历史。应重新验证接手人员是否属于该客户/工单的授权范围。Agent 可能记得上一轮的退款建议，但退款状态仍需从订单系统读取。实际执行退款时，要通过独立的业务工具、授权和幂等键完成。

验收包含正常多轮、从旧消息 Fork、断线恢复、丢失消息 ID、用户权限变更和重复请求；检查对话连续性、业务状态真实性和执行记录是否分别正确。

## 常见误区

- **把 Thread 当作业务数据库。** Thread 是对话历史，不是订单、审批或工单状态的权威来源。
- **只保存 thread_id。** 继续对话还需要正确的 parent_message_id；丢失时需查询 Thread 消息。
- **把 User Message ID 当 parent_message_id。** 后续对话应从上一条成功的 Assistant Message 继续。
- **认为每个 Thread 只有一条执行轨迹。** 多轮对话有多个 Turn/Trace；诊断某一轮时需要 trace_id。
- **认为有 thread_id 就可以跨用户恢复会话。** 仍要重新验证用户、Role 和业务对象权限。
- **请求超时就直接重发消息。** 先确认上一请求是否已经写入 Thread，避免消息重复。

## 完成标准

- [ ] 能区分 Thread、Message、Turn、Run 和 Trace。
- [ ] 能解释 parent_message_id 如何继续或 Fork 历史。
- [ ] 能设计 thread_id 与最新 Assistant Message ID 的持久化。
- [ ] 能区分对话上下文和业务状态。
- [ ] 能为断线、重复提交和权限变化设计恢复流程。

## 自测

1. Cortex Agent REST API 继续同一段对话时，为什么要传入上一条 Assistant Message ID？
2. 应用只保存了 thread_id，丢失最新消息 ID，如何恢复继续对话？
3. 从历史较早的 Assistant Message ID 继续请求，与从最新消息继续有什么不同？
4. Thread 中显示“退款已成功”，能否据此判断支付系统已经完成退款？为什么？
5. 一个 Thread 有五轮对话，调查第三轮调用 Search 失败时，应该查 Thread ID 还是 Trace ID？

## 参考资料

- [Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Use threads with the Cortex Agent REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-threads)
- [Monitor Cortex Agent requests](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-monitor)
