# Pipeline Auditor 与结构化健康检查

## 本节要解决的问题

财务数据管道包含 Snowpipe 文件摄取、Dynamic Table 转换和 Task Graph 发布。每天 08:00 前，系统要将完整数据发布到 NAV 和风险看板。某天看板延迟，团队需要回答：哪一段没有推进？源批次是否齐全？是不是只发生了数据质量异常？能否给出可复核的证据？

Pipeline Auditor 是一个只读检查流程，不是自动修复 Agent。它按照明确的检查范围读取对象状态、刷新历史、加载历史、数据质量指标和查询执行记录，再输出带证据的调查结果。它不应通过模型猜测根因，也不应因为发现异常就自动修改 Task、重启 Pipe 或更新业务数据。

## 核心知识

### 每类管道对象需要不同的检查证据

Task、Dynamic Table、Pipe 和 Stream 的状态含义不同，不能只查一个统一的“运行成功”标志：

| 对象 | 主要检查 | 可用证据 | 常见异常 |
|---|---|---|---|
| Task / Task Graph | 最近计划、执行状态、错误、耗时 | TASK_HISTORY、COMPLETE_TASK_GRAPHS、Query ID | FAILED、跳过计划、执行耗时异常 |
| Dynamic Table | 刷新状态、刷新数据时间戳、刷新时长 | DYNAMIC_TABLE_REFRESH_HISTORY、DATA_TIMESTAMP | 刷新失败、数据时间落后、重复全量刷新 |
| Snowpipe | Pipe 是否启用、待处理文件、最近加载结果 | SYSTEM$PIPE_STATUS、COPY_HISTORY、LOAD_HISTORY | 停滞、文件漏载、持续错误 |
| Stream | 是否 stale、上次消费和积压情况 | SHOW STREAMS、DESCRIBE STREAM、STALE_AFTER | Stream stale、长时间未消费 |
| Data Quality | 行数、空值、重复键、新鲜度、业务约束 | DMF、Expectation、Anomaly Detection | 质量阈值失败、异常波动 |

一个 Task 显示 SUCCEEDED，只能证明该次执行返回成功；它不证明 Dynamic Table 已经刷新到目标业务时间，也不证明 Snowpipe 已收齐全部来源文件。Auditor 必须根据管道拓扑检查整个链路，而不是把单个对象状态当作端到端结论。

### 检查范围必须先由业务清单定义

不要让 Auditor 在账户里任意发现并扫描所有对象。维护一份经过批准的 Pipeline Registry，至少包含：

| 字段 | 示例 | 用途 |
|---|---|---|
| PIPELINE_ID | FINANCE_DAILY_CLOSE | 业务管道标识 |
| OBJECT_TYPE | TASK / DYNAMIC_TABLE / PIPE / STREAM | 检查类型 |
| OBJECT_NAME | FINANCE_DB.OPS.LOAD_ORDERS | 完整对象名 |
| UPSTREAM_ID | ORDER_INGEST | 上游依赖 |
| EXPECTED_BY | 08:00 Asia/Tokyo | 业务截止时间 |
| OWNER_ROLE | FINANCE_PIPELINE_OWNER | 责任角色 |
| SEVERITY_POLICY | FINANCE_CRITICAL | 严重级别规则 |
| ENABLED | TRUE | 是否纳入检查 |

Registry 由数据平台 owner 审批和维护。不要仅凭名字包含 PIPE、TASK 或 DYNAMIC 就自动把对象纳入生产审计，否则会扫描临时任务、测试对象或其他业务域。

检查角色只授予读取 Registry、对象元数据和相关 History/DMF 结果所需的最小权限。ACCOUNTADMIN 不应作为日常 Auditor 运行身份；可见性不足时应报告 PERMISSION_INSUFFICIENT，而不是把查不到元数据理解为对象不存在。

### 为不同检查定义可计算的状态和阈值

状态应来自实际证据，而不是语言模型自行分类：

- **HEALTHY**：对象运行状态正常，且数据时间和质量指标满足策略。
- **WARNING**：尚未违反业务截止时间，但新鲜度或运行时长接近阈值，或出现可恢复的非关键异常。
- **CRITICAL**：超过业务截止时间、Task/Dynamic Table 持续失败、关键 Stream stale，或必要输入数据缺失。
- **UNKNOWN**：没有足够证据判断，例如 History 延迟、权限不足、查询失败或对象清单不完整。
- **NOT_APPLICABLE**：该管道没有此类对象，或本次检查不适用。

建议区分技术状态和业务状态。例如 Task 成功但业务批次文件缺失时，技术状态可以是 HEALTHY，业务状态必须是 CRITICAL 或 UNKNOWN。若没有定义可验证的业务截止时间，就不能仅凭“最近一次更新时间较早”自动判定为故障。

### Task 检查要看最近执行和计划是否被跳过

可以使用 INFORMATION_SCHEMA.TASK_HISTORY 获取近期执行记录：

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

Auditor 应将实际开始/结束与业务计划时间比较，记录：
- 最近一次成功执行；
- 最近一次失败及错误信息；
- 计划时间与实际运行时间的差异；
- 是否因上一次运行未结束而跳过计划；
- Task Graph 是否有仍未完成的 Child Task。

只看最后一个 SUCCEEDED 记录会漏掉后续失败或跳过的计划。若使用 ACCOUNT_USAGE 历史视图，还应考虑其数据延迟；实时诊断优先使用 Information Schema Task History 和 Snowsight。

### Dynamic Table 检查要同时看状态和 DATA_TIMESTAMP

~~~sql
SELECT
  name,
  state,
  state_message,
  refresh_trigger,
  refresh_action,
  data_timestamp,
  refresh_start_time,
  refresh_end_time,
  DATEDIFF('second', refresh_start_time, refresh_end_time) AS duration_sec
FROM TABLE(FINANCE_DB.INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY(
  NAME_PREFIX => 'FINANCE_DB.MART'
))
ORDER BY data_timestamp DESC
LIMIT 100;
~~~

关键是 DATA_TIMESTAMP，而不是只看 STATE = SUCCEEDED。若业务要求发布前一日完整数据，Auditor 应将 DATA_TIMESTAMP 与相应业务截止时间比较，并检查上游刷新是否已完成。

Dynamic Table 的 TARGET_LAG 是新鲜度目标，不是严格 SLA。检查器应记录目标和实际刷新时间差；超过策略阈值时标记 WARNING/CRITICAL，不能宣称系统违反了某个保证性刷新时点。

### Pipe 和 Stream 检查必须回到文件和变更来源

Snowpipe Pipe 状态可以通过 SYSTEM$PIPE_STATUS 获取：

~~~sql
SELECT SYSTEM$PIPE_STATUS('FINANCE_DB.INGEST.RAW_ORDERS_PIPE');
~~~

该函数返回状态信息。Auditor 应保留原始返回值和检查时间，并结合 COPY_HISTORY、LOAD_HISTORY 与对象存储文件清单确认：
- Pipe 是否启用；
- 是否存在持续积压或长时间没有摄取；
- 是否有文件失败或被跳过；
- 来源文件数与目标加载文件数是否一致；
- 是否存在通知漏发或重建 Pipe 后的历史文件重放风险。

Stream 要检查 STALE、STALE_AFTER 和消费状态。Stream 没有被消费不一定立即代表故障：若业务源暂时没有变更，它可能正常为空。只有当预期应有变更、消费窗口将过期或已经 stale 时，才应按策略升级。

### Data Quality 指标要按业务键和数据产品组合

一个简单的订单质量检查可以包括：
- ROW_COUNT：当前批次数据规模；
- NULL_COUNT：关键业务键或日期字段是否为空；
- DUPLICATE_COUNT：订单/事件主键是否重复；
- FRESHNESS：最新业务数据距离当前时间的陈旧程度；
- 自定义 DMF：金额范围、状态组合、跨字段不变量和来源对账。

这些指标应来自 DMF/Expectation 结果或明确的验证 SQL。Auditor 不能仅凭一个 ROW_COUNT 正常，就判断数据正确；也不能把 Anomaly Detection 的异常分数当成确定性业务违规。每个检查必须绑定对象、列、业务时间范围、阈值、检查时间和来源 Query ID。

### 统一输出记录要保留原始证据，不只给一句根因摘要

建议将每个发现保存为结构化记录：

| 字段 | 含义 |
|---|---|
| pipeline_id / object_name | 所属管道和具体对象 |
| check_id / check_version | 检查项及规则版本 |
| observed_at | 观察时间 |
| expected_by / data_timestamp | 业务截止与数据时间 |
| status / severity | 技术状态、业务状态和严重级别 |
| evidence_query_id | 产生证据的 Query ID |
| evidence_ref | History 记录、文件清单、DMF 结果等引用 |
| summary | 事实描述，不直接写未经验证的根因 |
| recommended_action | 建议调查动作 |
| owner_role | 责任角色 |
| remediation_status | 是否已人工处理 |

建议将事实描述与解释分开。例如“Dynamic Table DATA_TIMESTAMP 落后 42 分钟”是事实；“上游文件未到齐”只有在文件清单或 COPY_HISTORY 证据支持时才能作为根因。LLM 可以生成调查摘要，但必须引用证据 ID，不能从缺失数据中编造根因。

## 工程实施步骤

1. 建立 Pipeline Registry，列出批准检查的 Task、Graph、Dynamic Table、Pipe、Stream、表和业务 owner。
2. 为每条管道定义业务截止时间、数据时间字段、质量阈值和严重级别规则。
3. 为 Auditor 建立只读 Role，授予读取 Registry、必要 History、DMF 和对象元数据的最小权限。
4. 为 Task、Dynamic Table、Pipe、Stream 和质量检查分别实现确定性的采证 SQL。
5. 将输出转换成统一的检查记录，保留状态、时间、Query ID、Evidence Reference 和规则版本。
6. 根据业务依赖图汇总端到端状态，区分技术状态、数据质量状态和业务发布状态。
7. 对 UNKNOWN、权限不足、历史视图延迟和证据缺失单独报告，不得默认标成 HEALTHY。
8. 让 LLM 只生成带证据引用的调查摘要和建议，不授予修改 Task、Pipe、表或数据的工具权限。
9. 由对象 owner 或值班人员确认根因和修复动作；所有修复都通过独立发布/运维流程审批。
10. 将 Auditor 自身的运行结果、规则版本、Query ID 和人工确认结果保留，用于检查器回归。

## 场景分析

FINANCE_DAILY_CLOSE 管道在 08:20 未发布 NAV。Auditor 收集到以下结果：

- 根 Task：08:15 启动，08:16 SUCCEEDED；
- Snowpipe：Pipe 已启用，但有 2 个文件仍处于待处理状态；
- Silver Dynamic Table：STATE 为 SUCCEEDED，DATA_TIMESTAMP 为 07:42；
- Gold NAV Dynamic Table：DATA_TIMESTAMP 为 07:40；
- ORDER_ID 的 NULL_COUNT 为 0，DUPLICATE_COUNT 为 0。

不能因为 Task 成功和质量键检查通过就判定管道健康。业务截止时间是 08:00，而 Silver/Gold 的 DATA_TIMESTAMP 仍落后，且 Pipe 有待处理文件，应将管道状态标记为 CRITICAL。下一步检查文件清单、云通知和 COPY_HISTORY，确认两份文件为什么未加载。

Auditor 不应自行执行 ALTER PIPE REFRESH、RESUME Task 或重新加载文件。它可以给出需要调查的文件路径、Pipe 状态和证据 Query ID，由数据 owner 决定是否补载及如何避免重复数据。

## 常见误区

- **用一个统一成功标志代表整条管道健康。** Task、Dynamic Table、Pipe、Stream 和业务质量分别有不同证据。
- **只看最后一次 Task SUCCEEDED。** 还要检查计划是否跳过、Graph Child 状态和数据截止时间。
- **把 Dynamic Table SUCCEEDED 当成新鲜度合格。** 必须比较 DATA_TIMESTAMP 与业务期望。
- **认为 Pipe 启用就代表文件全部加载。** 要核对 Pending Files、COPY_HISTORY 和源文件清单。
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
- [ ] 能说明 Auditor 为什么应保持只读，修复应走独立审批流程。

## 自测

1. Task 已成功，但 Dynamic Table DATA_TIMESTAMP 落后业务截止时间 40 分钟。Auditor 应给出什么状态？需要哪些上游证据？
2. Pipe 处于 RUNNING，但仍有 Pending Files。为什么不能直接认定文件已全部加载？
3. Stream 没有数据且 STALE_AFTER 还有 10 天。它一定是故障吗？需要什么业务预期？
4. ROW_COUNT 正常，但订单金额总额下降 40%。Auditor 还应检查哪些 DMF 或业务控制总额？
5. Information Schema History 因权限不足查询失败。为什么不能将对象标记为不存在或 HEALTHY？
6. Auditor 发现文件漏载。为什么它不应自动执行 PIPE REFRESH 或重放文件？

## 参考资料

- [TASK_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/task_history)
- [COMPLETE_TASK_GRAPHS](https://docs.snowflake.com/en/sql-reference/functions/complete_task_graphs)
- [DYNAMIC_TABLE_REFRESH_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/dynamic_table_refresh_history)
- [SYSTEM$PIPE_STATUS](https://docs.snowflake.com/en/sql-reference/functions/system_pipe_status)
- [COPY_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/copy_history)
- [System data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-system-dmfs)
- [Data Lineage](https://docs.snowflake.com/en/user-guide/ui-snowsight-lineage)
