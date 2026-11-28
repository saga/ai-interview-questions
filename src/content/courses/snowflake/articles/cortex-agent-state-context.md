# Agent 状态、上下文压缩与可恢复执行

## 本节要解决的问题

投资运营人员让 Agent 核对一笔交易：先查持仓和结算状态，再找对应的托管文件，确认差异后创建一条待复核记录。Agent 已完成数据查询，也调用了工单工具，但客户端连接断开，没有收到最终回答。

用户重新打开对话时，系统不能只问模型“刚才做到哪一步”，也不能盲目从头执行，否则可能再次创建待复核记录。要恢复执行，必须分清三类状态：

- **对话上下文**：用户说过什么、Agent 已经给出什么回答、当前追问属于哪一轮。
- **任务状态**：目标、输入快照、完成步骤、证据引用、审批状态和下一步动作。
- **外部副作用**：是否已经写入工单、创建案件、发出通知或修改业务数据。

Cortex Agent Thread 管理对话消息链；应用自己的业务状态表管理可恢复任务；外部系统的幂等键和操作记录防止重复副作用。三者不能互相代替。

## 核心知识

### Thread 保存对话历史，parent_message_id 决定从哪里继续

Cortex Agents REST API 使用 Thread 保存跨 Turn 的对话上下文。调用方先创建 Thread，再在 agent:run 请求中传入 thread_id 和 parent_message_id：

~~~http
POST /api/v2/cortex/threads
Content-Type: application/json
Authorization: Bearer <token>

{
  "origin_application": "portfolio-operations"
}
~~~

创建成功后会返回 thread_id。第一轮调用使用 parent_message_id = 0；后续请求使用上一次成功 Assistant 消息的 message_id：

~~~json
{
  "thread_id": 1234567890,
  "parent_message_id": 456,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "继续检查这笔结算差异，并说明证据。"
        }
      ]
    }
  ]
}
~~~

Agent Run 的响应会包含 User 和 Assistant 消息的 metadata event，其中 message_id 用来标识持久化消息。应用应记录最后一条成功的 Assistant message_id，而不是最后一条 User message_id。若客户端丢失了这个 ID，可以调用 Describe Thread 读取消息列表，再找到最新的成功 Assistant 消息。

Thread 也支持从较早的 Assistant message_id 继续，这会形成对话分支。例如用户想比较“按交易日期”和“按结算日期”两种分析路径，可以从共同的历史回答分出两个后续分支，而不覆盖另一条路径。**分支只改变消息链的续接位置，不会自动复制、撤销或回滚外部业务写入。**

### Thread 不等于业务任务数据库

Thread 保存对话内容、消息关系和请求标识，但它不替代业务系统的状态机。不要把“Agent 在上一轮说已经创建案件”当作案件实际存在的证据；也不要从对话摘要中推断某个 SQL 或外部 API 是否已经提交。

可恢复任务应该有独立记录，例如：

~~~sql
CREATE TABLE IF NOT EXISTS AGENT_TASK_STATE (
  TASK_ID            VARCHAR NOT NULL,
  THREAD_ID          NUMBER,
  LAST_MESSAGE_ID    NUMBER,
  TASK_TYPE          VARCHAR NOT NULL,
  BUSINESS_KEY       VARCHAR NOT NULL,
  INPUT_SNAPSHOT_ID  VARCHAR,
  STATUS             VARCHAR NOT NULL,
  STEP_NAME          VARCHAR,
  CHECKPOINT         VARIANT,
  EVIDENCE_REFS      ARRAY,
  IDEMPOTENCY_KEY    VARCHAR,
  EXTERNAL_RESULT_ID VARCHAR,
  STATE_VERSION      NUMBER NOT NULL,
  UPDATED_AT         TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP()
);
~~~

示例表用于说明状态字段，不代表 Snowflake 自动保证 TASK_ID 唯一或自动完成并发锁。生产实现要根据写入方式建立唯一性检查或受控 MERGE，并用事务、租约或版本号控制并发更新。

一条任务记录可以保存：
- TASK_ID 和 BUSINESS_KEY：标识一次业务任务及其对应对象；
- INPUT_SNAPSHOT_ID：锁定当时使用的源数据快照或业务日期；
- STATUS、STEP_NAME：当前状态和正在执行的阶段；
- CHECKPOINT：已完成步骤和必要的中间结果；
- EVIDENCE_REFS：Query ID、文档 ID、页码或来源文件等证据引用；
- IDEMPOTENCY_KEY、EXTERNAL_RESULT_ID：外部副作用的幂等键和确认结果；
- STATE_VERSION：状态版本，避免旧执行覆盖新状态。

敏感数据不要无差别复制到 Thread、CHECKPOINT 或日志。保存必要的标识、摘要和受控引用即可，原始业务数据仍由授权的数据源提供。

### 将任务步骤设计成可检查的状态转换

例如一笔对账调查任务可以采用以下状态：

| 状态 | 进入条件 | 必须留下的证据 |
|---|---|---|
| CREATED | 用户提交任务 | 任务 ID、业务键、输入范围 |
| DATA_FETCHED | 持仓与结算查询完成 | Query ID、估值日、返回记录数 |
| EVIDENCE_COLLECTED | 托管文件与条款检索完成 | 文件 ID、文档版本、页码 |
| ANALYSIS_READY | 差异计算和规则检查完成 | 计算版本、差异金额、待复核原因 |
| REVIEW_PENDING | 已创建待复核事项 | 工单 ID、幂等键、创建结果 |
| COMPLETED | 所需结果已持久化并完成确认 | 最终结果 ID、消息 ID、完成时间 |

状态迁移应由应用服务端根据工具结果和业务校验决定，不应仅凭模型在自然语言里声称“已完成”就改变状态。比如 Agent 生成了一段工单 JSON，不代表工单已经创建；必须收到工单系统成功响应并保存其 ID，才可以进入 REVIEW_PENDING。

失败状态也要具体化。查询无权限、源数据缺失、搜索服务不可用、外部系统超时和业务规则冲突不是同一种错误，恢复动作不同。对无法确认外部调用结果的情况，状态应进入 UNKNOWN 或 RECONCILIATION_REQUIRED，而不是直接重试或标记失败。

### 上下文压缩是对话历史摘要，不是业务状态备份

对话越来越长时，后续请求会消耗更多 Token，也可能接近模型 Context Window。Cortex Agents 提供 agent:compact REST API（Preview）压缩 Thread 上下文。

该 API 有两种模式：

| 模式 | 输入 | 输出与持久化 |
|---|---|---|
| Inline | model + messages 完整消息数组 | 返回 summary，不写入 Thread；客户端自己把摘要放进下一次请求 |
| Thread | model + thread_id，可选 end_message_id | 将摘要写为 Thread 中的 COMPACTION 消息，返回 summary 和 end_message_id |

Thread 模式可按特定 end_message_id 压缩到某个边界，之后的消息留在压缩范围之外。继续对话时，将返回的 end_message_id 作为下一次 agent:run 的 parent_message_id，Orchestrator 会自动将已保存的摘要纳入上下文。COMPACTION 消息对调用方是 opaque，不需要自行解析其内部结构。

压缩不会删除原始对话消息；Thread API 仍能读取原始记录。后续 Agent Run 使用最新的压缩摘要作为上下文，而不是每次重新把全部旧对话送给模型。再次压缩会追加新的 COMPACTION 消息，后续运行采用最新的压缩消息。

压缩摘要质量取决于所用模型。Snowflake 建议尽量用与该 Thread agent:run 相同的模型进行压缩。Compact API 不支持流式响应；每次调用按模型 Token 使用量计费，记录在 CORTEX_AGENT_USAGE_HISTORY 中，origin application 标记为 compaction。

### 摘要应保留决策依据，不能只保留聊天主题

如果应用依赖自动生成的 Summary，应验证摘要是否保留：
- 当前业务对象、日期、币种和范围；
- 用户确认过的关键约束；
- 已完成与未完成的步骤；
- Query ID、文件 ID、文档版本等证据引用；
- 未解决的矛盾和不确定事项；
- 已执行的外部副作用及返回 ID；
- 下一步需要谁确认或执行什么。

但不能把摘要当作唯一状态。即使摘要正确，也要从任务表、Thread 消息、Query History 和外部系统记录重新验证关键事实。摘要丢失引用或错误压缩了一条约束时，应从原始消息和证据表恢复。

### 恢复要先对账副作用，再决定从哪个步骤继续

客户端超时并不等于 Agent Run 没有执行。可能发生的情况包括：
- 请求没有到达 Snowflake；
- Agent 已执行查询但尚未写入外部系统；
- 外部工单已创建，但响应未返回到客户端；
- Agent 已完成并写入 Thread，客户端未收到最终 SSE 事件；
- Agent API 未能持久化 Assistant 消息，虽然上一轮 User 消息已经保存。

最后一种情况在 Snowflake 文档中有专门说明：如果响应中缺少 Assistant metadata，应忽略失败的 Turn，从最后一条成功的 Assistant message_id 继续，而不是从失败的 User message_id 续接。

恢复时按以下顺序处理：

1. 使用 request_id、thread_id 和 parent_message_id 查找是否已有对应 Turn。
2. 读取 Thread，确认最后成功的 Assistant message_id 和工具执行结果。
3. 查询应用任务表，确认 TASK_ID 当前状态、STATE_VERSION 和最后一个已提交步骤。
4. 对外部操作使用 IDEMPOTENCY_KEY 查询是否已经创建成功；若已成功，补记 EXTERNAL_RESULT_ID，而不是重新创建。
5. 如果结果仍不确定，将任务标记为 RECONCILIATION_REQUIRED，先通过外部系统查询确认。
6. 只从第一个未完成、且其前置条件已经验证的步骤继续执行。

对可写数据的 Custom Tool，最好在服务端把“检查幂等键、执行副作用、记录结果”做成一个受控操作。若外部服务支持 Idempotency-Key，应使用稳定的业务键；若不支持，则要用外部结果查询或人工对账处理不确定状态。

### 权限和数据保留边界不能因恢复流程而放宽

Thread API 需要适用的 Cortex Agent 数据库角色；读取和压缩 Thread 还要满足该 Thread 的用户访问控制。应用自己的任务表、证据表和外部结果表，也应按用户/Role 做最小权限。

恢复时可能跨越 Agent Version、工具版本、政策版本或数据快照。不能仅使用旧 Thread 的文本继续执行当前任务，而不检查当前权限和业务规则。若任务创建后用户权限被撤销，恢复服务也不能借 Thread 继续读取当前已禁止访问的数据。

## 工程实施步骤

1. 为需要跨轮或跨进程恢复的业务动作建立独立 TASK_ID 和 BUSINESS_KEY；普通闲聊不必创建业务任务记录。
2. 在创建 Thread 时记录 origin_application，并保存 thread_id；每次成功运行保存 User/Assistant message_id、request_id 和 Agent Version。
3. 每次 agent:run 只从最后成功的 Assistant message_id 继续；若客户端丢失游标，先 Describe Thread 读取消息链。
4. 为任务定义状态机、STATE_VERSION、已完成步骤、证据引用和未解决问题，避免把所有状态塞进 prompt。
5. 对写入型工具定义稳定 IDEMPOTENCY_KEY；外部响应返回后立即保存结果 ID 与任务状态。
6. 当 Thread 变长时评估 agent:compact；固定模型、压缩边界和压缩后的回归样本，验证关键约束和证据引用仍被保留。
7. 对使用 Thread 模式压缩的应用，保存返回的 end_message_id，并将其作为下一次 agent:run 的 parent_message_id。
8. 对 Inline 模式，由应用持久化摘要和原始消息边界，并在后续请求中按 Agent API 规定组成 messages；不要把摘要直接当普通用户发言。
9. 对超时或断线，先查询 Thread、任务状态和外部副作用，再决定续跑；未知状态不自动重做非幂等操作。
10. 恢复执行前重新校验用户授权、Agent/工具版本、源数据快照、政策版本和审批状态。
11. 定期测试断线、重复提交、写入成功但回包丢失、压缩失败和权限撤销场景。
12. 记录 Agent Run 与 Compact 的 Token/credit 使用、状态表更新和恢复结果，区分对话成本与业务任务成本。

## 场景分析

运营人员要求 Agent 检查交易 T9001 的结算差异并创建待复核事项。Agent 查询内部持仓、检索托管文件后，调用 Custom Tool 创建复核记录。工单系统已经创建成功，但客户端在接收最终响应前断线。

应用重新启动后，不应重跑整个 Agent：
1. 按保存的 thread_id 和最后一个已知 message_id 读取 Thread；
2. 读取任务表，发现 CREATE_REVIEW 的状态是 IN_PROGRESS，具有一个确定的 idempotency_key；
3. 使用该幂等键向工单系统查询，而不是再创建一次；
4. 工单系统返回已经存在的案件 ID CASE-7821；
5. 应用把 EXTERNAL_RESULT_ID 更新为 CASE-7821，状态改为 REVIEW_PENDING；
6. 再从最后成功的 Assistant message_id 继续对话，向用户说明案件已创建，并附上已核验的 ID。

如果 Thread 变长，应用可以执行 Thread 模式 compact。原始消息保留在 Thread 中，COMPACTION 摘要被纳入后续上下文。即使摘要没有保留工单 ID，任务表和工单系统仍然可以提供确定事实。若应用只依赖摘要，就可能因为一次压缩遗漏而重复创建案件。

## 常见误区

- **把 Thread 当成任务状态数据库。** Thread 记录对话和消息关系，不保证业务步骤、审批或外部副作用已完成。
- **只保存 thread_id，不保存 message_id。** 续聊和分支需要正确的 parent_message_id；丢失游标时应从 Thread API 恢复。
- **用最后一条 User message_id 续聊。** Agent Run 需要上一条成功的 Assistant message_id 作为 parent。
- **把 compact 当成删除历史。** Thread 模式追加 COMPACTION 消息，原始消息仍然可读。
- **将压缩摘要当成业务事实或审批记录。** 关键数据和副作用结果仍应从权威表和外部系统确认。
- **断线后盲目从头重跑。** 写入型工具可能已成功执行，需先按幂等键对账。
- **只记录工具名称，不记录工具结果 ID。** 无法确认外部副作用是否已经提交。
- **恢复时不检查当前权限和政策版本。** 旧对话上下文不能赋予用户已被撤销的访问能力。
- **把 Compact 的成本当作普通免费上下文操作。** 它会消耗模型 Token，并出现在 Agent Usage History 中。

## 完成标准

- [ ] 能说明 Thread、message_id、parent_message_id 与 Agent Run 的关系。
- [ ] 能从最新 Assistant message_id 继续对话，并能从较早消息分叉。
- [ ] 能区分 Thread 对话上下文与应用持久化业务状态。
- [ ] 能使用任务状态、版本号和证据引用管理可恢复步骤。
- [ ] 能区分 Inline Compaction 与 Thread Compaction。
- [ ] 能解释 COMPACTION 消息、end_message_id 和原始消息保留行为。
- [ ] 能在断线后先对账外部副作用，再决定是否续跑。
- [ ] 能为写入型工具设计幂等键和未知状态人工对账流程。

## 自测

1. Agent Run 已完成数据库查询，但客户端断线。为什么不能仅凭客户端超时判断 Agent 没有执行？
2. 下一轮 agent:run 应使用哪个 message_id 作为 parent_message_id？如果应用只保存了 User message_id，应如何恢复？
3. 从 Thread 早期的一条 Assistant 消息继续会产生什么效果？它与覆盖原对话有什么不同？
4. Inline Compaction 与 Thread Compaction 分别将摘要保存在哪里？Thread 模式是否删除原始消息？
5. 外部工单已经创建成功，但应用没有收到响应。怎样避免恢复时重复创建？
6. 为什么业务任务的已完成步骤、证据引用和审批状态应保存在独立的任务记录中，而不是只保留在 Thread 或摘要里？

## 参考资料

- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Use threads with the Cortex Agent REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-threads)
- [Threads API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-threads-rest-api)
- [Cortex Agents Compact API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-compact)
- [Cortex Agent SDK conversations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agent-sdk/conversations)
