# Pipeline Auditor：用结构化证据检查 Snowflake 数据管道

## 本节要解决的问题

财务数据管道包含 Snowpipe 文件摄取、Dynamic Table 转换和 Task Graph 发布。每天 08:00 前，数据必须进入 NAV 和风险看板。某天看板延迟，运维人员需要判断：是 Task 没执行、Dynamic Table 没追上源数据、Pipe 仍有文件待处理，还是数据已经到达但质量检查失败？

逐个打开 Snowsight 页面检查对象，难以形成一致的排查结果。Pipeline Auditor 把数据库/Schema 发现、对象级检查、证据整理和报告生成组织成一次审计任务。它的价值不在于让 Agent “看起来懂运维”，而在于把分散的 History、对象状态和质量结果转换成可以复核的 findings。

## 审计对象和证据

### 每类管道对象都有自己的健康信号

Snowflake 的 Task、Dynamic Table、Pipe 和 Stream 并不共享一个统一的运行状态。检查器应根据对象类型调用对应的元数据接口：

| 对象 | 检查内容 | 主要证据 | 需要注意 |
|---|---|---|---|
| Task / Task Graph | 执行状态、错误、时长、计划是否跳过 | TASK_HISTORY、COMPLETE_TASK_GRAPHS、Query ID | 最近一次成功不代表之后没有失败 |
| Dynamic Table | 刷新状态、数据时间戳、刷新耗时 | DYNAMIC_TABLE_REFRESH_HISTORY | SUCCEEDED 不等于已达到业务截止时间 |
| Snowpipe | Pipe 是否启用、加载状态、待处理文件 | SYSTEM$PIPE_STATUS、COPY_HISTORY | RUNNING 不代表所有源文件均已加载 |
| Stream | 是否 stale、消费位置和剩余保留时间 | SHOW STREAMS、DESCRIBE STREAM | 没有变更时为空可能是正常状态 |
| Table / View | 元数据、行数、修改时间、对象是否存在 | INFORMATION_SCHEMA、SHOW 命令 | LAST_ALTERED 不是可靠的业务数据新鲜度 |
| Data Quality | 行数、空值、重复键、业务约束 | DMF、Expectation、Anomaly Detection | 单个指标正常不能证明整张表正确 |

一个 Task 显示 SUCCEEDED，只能证明那次执行正常结束；它不证明 Dynamic Table 已刷新到目标业务时间，也不证明 Snowpipe 已收齐来源文件。Pipeline Auditor 应先检查单个对象，再沿注册的上游/下游关系汇总端到端状态。

### 审计范围应由 Registry 或显式选择决定

Snowflake 的 Pipeline Auditor Developer Guide 示例允许用户选择一个 Database 或 Schema，并勾选要检查的对象类型，例如 tables、dynamic tables、tasks、views、streams、pipes 和 procedures。这个范围应当在服务端再次校验，不能直接信任浏览器提交的任意对象名。

生产环境可以维护一份 Pipeline Registry：

| 字段 | 示例 | 用途 |
|---|---|---|
| PIPELINE_ID | FINANCE_DAILY_CLOSE | 业务管道标识 |
| OBJECT_TYPE | TASK / DYNAMIC_TABLE / PIPE | 检查类型 |
| OBJECT_NAME | FINANCE_DB.OPS.LOAD_ORDERS | 完整对象名 |
| UPSTREAM_ID | ORDER_INGEST | 上游依赖 |
| EXPECTED_BY | 08:00 Asia/Tokyo | 业务截止时间 |
| OWNER_ROLE | FINANCE_PIPELINE_OWNER | 责任角色 |
| SEVERITY_POLICY | FINANCE_CRITICAL | 严重级别规则 |
| ENABLED | TRUE | 是否纳入检查 |

Registry 由数据平台 owner 维护。不要仅凭对象名称包含 TASK 或 PIPE 就把所有对象纳入生产审计，否则临时任务、测试对象和其他业务域可能被误判。权限不足也不能解释成对象不存在；应输出 UNKNOWN 或 PERMISSION_INSUFFICIENT。

### 新鲜度不能只用 LAST_ALTERED 判断

Developer Guide 的示例会检查 INFORMATION_SCHEMA.TABLES 的 ROW_COUNT 和 LAST_ALTERED，用于发现空表和长时间没有变更的对象。这是便于入门的粗筛，不适合直接作为所有表的数据新鲜度 SLO：

- LAST_ALTERED 反映对象最近修改时间，DDL、权限或其他对象操作可能改变它，不一定代表业务数据已到达。
- 行数不变不一定表示数据没有更新；更新现有记录时，行数可能保持不变。
- 新增一条测试记录也不代表上游业务批次已经完整。

对 Dynamic Table，应使用 DATA_TIMESTAMP 判断刷新包含的源数据时间；对 Snowpipe，应检查 Pipe 状态、COPY_HISTORY 和源文件清单；对普通表，则应使用业务事件时间、批次时间和数据质量控制数。Auditor 应明确区分“对象最近修改时间”和“业务数据覆盖到哪个时点”。

### Task History 能说明执行记录，但需要结合业务计划

可以查询 Information Schema 的 TASK_HISTORY：

~~~sql
SELECT
  name,
  state,
  scheduled_time,
  query_start_time,
  completed_time,
  error_code,
  error_message,
  query_id
FROM TABLE(FINANCE_DB.INFORMATION_SCHEMA.TASK_HISTORY(
  SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()),
  RESULT_LIMIT => 1000
))
ORDER BY scheduled_time DESC;
~~~

Auditor 应将实际记录与 Task 的预期调度及业务截止时间比较，留意：
- 最近一次失败及其错误信息；
- 是否有计划执行被跳过；
- 是否有 Task Graph 的子任务未完成；
- 执行时长是否明显偏离基线；
- Query ID 是否能进一步定位执行计划和扫描情况。

只取最后一个 SUCCEEDED 记录会隐藏其后的 FAILED 或 SKIPPED 计划。Account Usage 历史视图还可能存在数据延迟；需要实时排查时，应优先使用相应的 Information Schema 函数和 Snowsight。

### Dynamic Table 需要检查 DATA_TIMESTAMP，而不是只检查 STATE

Dynamic Table Refresh History 提供每次刷新状态、Query ID、DATA_TIMESTAMP 和开始/结束时间：

~~~sql
SELECT
  name,
  state,
  state_code,
  state_message,
  query_id,
  data_timestamp,
  refresh_start_time,
  refresh_end_time,
  completion_target
FROM TABLE(FINANCE_DB.INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY(
  NAME_PREFIX => 'FINANCE_DB.MART.',
  RESULT_LIMIT => 1000
))
ORDER BY data_timestamp DESC;
~~~

DATA_TIMESTAMP 表示本次刷新评估时包含的源数据时间。它比单独判断 STATE 更接近“这张表目前覆盖到哪个时点”。如果刷新成功但 DATA_TIMESTAMP 仍早于财务要求的截止时间，报告应指出数据落后，而不是给出健康结论。

TARGET_LAG 是刷新新鲜度目标，不是固定 Cron 或无条件 SLA。检查器可以用业务截止时间、TARGET_LAG 和实际 DATA_TIMESTAMP 计算风险，但应在报告中保留这些原始值，不把推断出来的阈值写成 Snowflake 的保证。

### Snowpipe 状态要与文件加载历史交叉核对

可以通过 SYSTEM$PIPE_STATUS 获取 Pipe 的运行状态信息：

~~~sql
SELECT SYSTEM$PIPE_STATUS('FINANCE_DB.INGEST.RAW_ORDERS_PIPE');
~~~

这个函数返回状态信息；审计报告应保留原始 JSON、查询时间和 Pipe 名称，不要把 JSON 文本里某一个字段单独等同于端到端成功。

再使用 COPY_HISTORY 查看最近文件加载：

~~~sql
SELECT
  file_name,
  last_load_time,
  row_count,
  row_parsed,
  status,
  first_error_message,
  error_count
FROM TABLE(FINANCE_DB.INFORMATION_SCHEMA.COPY_HISTORY(
  TABLE_NAME => 'FINANCE_DB.RAW.ORDERS',
  START_TIME => DATEADD('hour', -24, CURRENT_TIMESTAMP())
))
ORDER BY last_load_time DESC;
~~~

COPY_HISTORY 同时覆盖 COPY INTO 与 Snowpipe 加载，Information Schema 函数可查最近 14 天记录。若要长期审计，应结合 Account Usage 历史和对象存储文件清单。Pipe 为 RUNNING 不代表某个批次的所有文件都已加载；需要对照源文件总数、COPY_HISTORY 中的状态和业务行数/金额控制数。

### Stream 的空状态、未消费和 stale 要分开

Stream 为空，可能只是源表没有新变更；Stream 未消费时间较长，也不一定已经 stale。只有当业务预期应有变更、消费链路停顿，或 STALE_AFTER 已接近/超过，才应按策略升级。

Auditor 要获取 Stream 名称、源对象、STALE/STALE_AFTER、最后消费任务和相关 Task History。若 Stream 已 stale，不能建议只重启 Task 就恢复所有变更；应检查原始事件/批次归档，并按恢复流程重新构建目标。

### 结构化报告必须带证据，不能把推测写成根因

Snowflake Pipeline Auditor Guide 使用 AUDIT_REPORT_SCHEMA 约束报告 JSON。核心部分包括：
- pipeline_inventory：发现了哪些对象；
- findings：每条发现的 category、severity、object 和 message；
- summary：各严重级别数量和 overall_health。

生产实现还应为每条 finding 增加 observed_at、check_version、query_id、evidence_ref、expected_by、data_timestamp、owner_role 和 remediation_status。这样报告不只是一段自然语言摘要，还能回到具体的 History 或数据检查结果。

严重级别可以采用 critical、warning、info，再增加 unknown：
- critical：超过业务截止时间、关键对象持续失败、Stream 已 stale 或关键数据缺失；
- warning：接近截止时间、执行时长偏离基线、出现可恢复错误；
- info：对象存在但不属于当前审计范围，或仅用于提示；
- unknown：权限不足、History 尚不可见或无法取得足够证据。

没有证据时，不得让模型自动补齐根因。比如“Dynamic Table 的 DATA_TIMESTAMP 落后 42 分钟”是事实；“上游文件没到齐”只有在文件清单和 COPY_HISTORY 支持时才可作为根因。

## Agent 应做什么，不应做什么

### 把数据库检查和自然语言解释分成两层

Developer Guide 使用 Cortex Agent SDK 创建 coding agent session，并通过 sql_execute 工具读取 Snowflake 元数据。系统提示按检查范围组合，Agent 负责调用相应查询并将结果整理为结构化 JSON。

一个更容易测试的实现是：
1. 应用服务端验证 database、schema 和 scope；
2. 确定性查询层读取 History、对象元数据和 DMF 结果；
3. 将有来源标识的检查结果传给 Agent；
4. Agent 生成有证据引用的说明和调查建议；
5. 应用校验 JSON schema、finding 必填字段和引用是否存在。

这比让模型自由扫描整个数据库并自行判断什么对象重要更容易审计，也能把无权访问与对象不存在分开。

### 审计权限和修复权限必须隔离

Developer Guide 的示例使用 permissionPolicy: always_allow 调用 coding agent 工具，并建议将部署应用的 Snowflake Role 限制为只读，以此限制 agent 能执行的 SQL 能力。这个设计说明：工具层允许调用，不等于数据库 Role 本身拥有写权限。

对生产审计，更稳妥的边界是：
- Audit Runtime Role 只读访问被批准的对象和元数据；
- Fix Agent 只生成 SQL 建议和原因，不自动执行；
- 如果确有自动修复需求，必须使用单独的执行身份、限定 SQL 类型和对象范围，并要求用户确认；
- 对 ALTER、RESUME、REFRESH、DROP、重载数据等操作记录审批人、执行 Query ID 和回滚方案。

不要因为审计发现 critical 就让 Agent 自动重启 Task、刷新 Pipe 或回补数据。这些动作可能触发重复加载、资源成本和下游数据变化。报告和修复是两种不同的权限域。

### 长时间审计任务需要可恢复的进度管理

Developer Guide 的示例采用后台 Job + Polling：
- POST 接收 database、schema 和 scope，创建 jobId 后立即返回；
- 审计任务在后台运行，工具调用和报告作为事件追加；
- 前端按 cursor 轮询进度；
- 任务结束后清理临时 Job。

教程示例用进程内 Map 保存事件，并在 30 分钟后清理。这个实现适合快速演示，但进程重启会丢失任务状态，也不适合多实例横向扩容。生产应用应使用持久化 Job Store，记录 job_id、请求人、审计范围、开始/结束时间、状态、事件游标、报告和错误；同一 job 的重试应可识别，避免重复启动扫描。

## 工程实施步骤

1. 建立数据库/Schema 发现和明确的审计范围选择；在服务端校验所有对象名和 scope。
2. 为 Task、Dynamic Table、Pipe、Stream、Table 和质量指标实现独立的检查器。
3. 按对象类型读取信息架构与 History；保留原始结果、Query ID 和检查时间。
4. 将每个检查规则定义为确定性的状态判断，LLM 不负责发明阈值。
5. 定义 AUDIT_REPORT_SCHEMA，要求每条 finding 有对象、严重级别、时间和证据引用。
6. 为没有足够证据、权限不足或 History 延迟的情况返回 UNKNOWN。
7. 用 Cortex Agent SDK 组合审计指令并调用受控的 SQL 工具；不把用户输入直接拼入 SQL。
8. 为 Audit Runtime Role 授予最小只读权限，并对跨库、跨 Schema 访问做负向测试。
9. 将修复建议放到单独会话；默认只生成 SQL 和理由，不开放自动写入权限。
10. 如需自动执行修复，使用单独角色和显式审批，先做 dry-run/影响面检查，再执行并保存 Query ID。
11. 对超过几十秒的审计采用 jobId + cursor polling；生产环境用持久化 Job Store，而不是只用进程内 Map。
12. 用健康、失败、过期、缺权、对象不存在、History 延迟和混合状态构建回归数据集，检查 severity 和证据引用。

## 场景分析

FINANCE_DAILY_CLOSE 管道在 08:20 未发布 NAV。Auditor 收集到以下结果：

- 根 Task：08:15 启动，08:16 SUCCEEDED；
- Snowpipe：Pipe 已启用，但有 2 个文件仍处于待处理状态；
- Silver Dynamic Table：STATE 为 SUCCEEDED，DATA_TIMESTAMP 为 07:42；
- Gold NAV Dynamic Table：DATA_TIMESTAMP 为 07:40；
- ORDER_ID 的 NULL_COUNT 为 0，DUPLICATE_COUNT 为 0。

不能因为 Task 成功和关键键质量检查通过就判定管道健康。业务截止时间是 08:00，而 Silver/Gold 的 DATA_TIMESTAMP 仍落后，且 Pipe 有待处理文件，应将管道状态标记为 critical。下一步检查文件清单、云通知和 COPY_HISTORY，确认两份文件为什么未加载。

Auditor 不应自行执行 PIPE REFRESH、RESUME Task 或重载文件。它可以给出待处理文件路径、Pipe 状态、Dynamic Table 数据时间戳和证据 Query ID，由数据 owner 决定补载方式，并检查重复加载风险。

## 常见误区

- **用一个统一成功标志代表整条管道健康。** Task、Dynamic Table、Pipe、Stream 和业务质量分别有不同证据。
- **只看最后一次 Task SUCCEEDED。** 还要检查计划是否跳过、Graph Child 状态和业务截止时间。
- **把 Dynamic Table SUCCEEDED 当成新鲜度合格。** 必须比较 DATA_TIMESTAMP 与业务期望。
- **把 LAST_ALTERED 当成业务数据新鲜度。** DDL 或元数据变化并不意味着源业务数据已更新。
- **认为 Pipe 启用就代表文件全部加载。** 要核对 Pipe 状态、COPY_HISTORY 和源文件清单。
- **把 Stream 为空当故障。** 没有新变更时为空可能正常；应结合业务预期和 STALE_AFTER 判断。
- **只检查 ROW_COUNT。** 还要检查键唯一、空值、金额、业务状态和来源批次。
- **让 LLM 直接认定根因或执行修复。** Auditor 输出事实、证据和建议；修复需由 owner 审核并通过受控流程执行。
- **权限不足时把缺少的元数据当作对象不存在。** 应输出 UNKNOWN 或 PERMISSION_INSUFFICIENT。

## 完成标准

- [ ] 能为 Task、Dynamic Table、Pipe、Stream 和 DMF 选择相应检查证据。
- [ ] 能定义业务截止时间、新鲜度目标和严重级别规则。
- [ ] 能使用 Task History 和 Dynamic Table Refresh History 获取运行证据。
- [ ] 能结合 SYSTEM$PIPE_STATUS、COPY_HISTORY 和源文件清单检查文件接入。
- [ ] 能区分 Stream 空、Stream stale 和 Stream 未消费。
- [ ] 能保留 Query ID、Evidence Reference、检查规则版本和责任角色。
- [ ] 能将技术异常、数据质量异常和业务发布异常分开报告。
- [ ] 能说明 Audit Role 为什么应保持只读，修复应走独立审批流程。

## 自测

1. Task 已成功，但 Dynamic Table DATA_TIMESTAMP 落后业务截止时间 40 分钟。Auditor 应给出什么状态？还需要哪些上游证据？
2. Pipe 处于运行状态，但仍有 Pending Files。为什么不能直接认定文件已全部加载？
3. Stream 没有数据且 STALE_AFTER 还有 10 天。它一定是故障吗？需要什么业务预期？
4. ROW_COUNT 正常，但订单金额总额下降 40%。Auditor 还应检查哪些质量指标或业务控制总额？
5. Information Schema History 因权限不足查询失败。为什么不能将对象标记为不存在或 HEALTHY？
6. Auditor 发现文件漏载。为什么它不应自动执行 PIPE REFRESH 或重放文件？

## 参考资料

- [Building a Pipeline Auditor with the Cortex Agent SDK](https://www.snowflake.com/en/developers/guides/pipeline-auditor-with-cortex-agent-sdk/)
- [TASK_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/task_history)
- [COMPLETE_TASK_GRAPHS](https://docs.snowflake.com/en/sql-reference/functions/complete_task_graphs)
- [DYNAMIC_TABLE_REFRESH_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/dynamic_table_refresh_history)
- [SYSTEM$PIPE_STATUS](https://docs.snowflake.com/en/sql-reference/functions/system_pipe_status)
- [COPY_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/copy_history)
- [System data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-system-dmfs)
