# 跨区域恢复与业务连续性：从复制到实际切换

## 本节要解决的问题

一家金融机构把交易数据、财务模型和日终任务部署在 AWS Tokyo Region。业务要求：东京区域不可用时，团队可以在大阪区域恢复关键查询和日终处理；恢复后，应用连接地址不需要逐个修改，用户权限、仓库、任务、密钥和外部网络连接也不能全部靠人工重新创建。

“有一个 Secondary Account”并不等于具备灾备能力。真正的恢复时间包括确认事故、决定是否切换、等待复制刷新完成、提升备用账号、恢复任务和连接、验证业务结果，以及把用户流量切过去。数据复制只覆盖其中一部分。

设计时先把业务 RPO（可接受的数据丢失窗口）和 RTO（从故障发生到业务可用的时间）转成可测量目标，再选择 Replication Group、Failover Group、RPO Assurance 和连接重定向方式。

## Replication Group 与 Failover Group 不同

### Replication Group 提供只读副本，Failover Group 才能提升为主

| 机制 | 目标账号状态 | 能否故障切换为可写主端 | 常见用途 |
|---|---|---|---|
| Database Replication | 指定数据库的只读副本 | 否 | 单库数据复制或下游消费 |
| Replication Group | 一组数据库/Share 等对象的只读副本 | 本身不能直接提升 | 跨账号分发与只读数据共享 |
| Failover Group | 一组数据库和账号级对象的只读副本 | 可以提升 | 跨区域业务连续性和账号级灾备 |

两类 Group 都按一致快照刷新副本。Failover Group 是可提升的复制组；灾难发生时，在目标账号将 Secondary Failover Group 提升为 Primary 后，原本只读的复制对象才变为可写。

账号级对象复制和 Failover Group 需要 Business Critical Edition 或更高版本；单纯数据库和 Share 复制可在更多版本中使用。若目标是完整账号级灾备，要同时确认主、备账号的版本、区域组合和复制对象支持范围。

### 2026 年的 Replication Group BCDR 有适用条件

Snowflake 已支持把符合条件的 Replication Groups 纳入 Failover Group，用于复制组级别的 BCDR。这个能力减少了切换后重新创建 Replication Group 的工作，但不是把所有 Replication Group 自动变成可提升的 Failover Group。

当前前提包括：
- Replication Group 只包含 DATABASES、SHARES，或两者；
- Replication Group 的目标账号与承载其 BCDR 的 Failover Group 目标账号不同；
- Failover Group 要包含 REPLICATION GROUPS，并将被引用的依赖对象一起纳入；
- 目标账号中的 Secondary Group 必须完成创建和验证。

在这种配置下，故障切换后可以在新主区域继续从新 Primary 刷新关联的 Replication Groups。若原有复制组引用的对象没有一起纳入，创建或修改 Failover Group 时可能因 dangling references 失败。应先把依赖关系理清，再决定是否采用该功能。

## 先定义 RPO、RTO 和真实恢复范围

### 复制间隔不等于实际 RPO

假设复制每 10 分钟运行一次，并不意味着实际 RPO 一定为 10 分钟：
- 上一次刷新可能运行超过 10 分钟；
- 新一次刷新会等待前一次完成，不会并行刷新同一个 Group；
- 某次刷新可能失败或被暂停；
- 故障可能发生在下一次刷新完成之前；
- 复制快照时，外部数据源和跨账号依赖不一定处于同一个时间点。

应监控实际 Replica Lag 和 Primary Snapshot Timestamp，而不是只看配置中的 REPLICATION_SCHEDULE。RPO 是切换时备用端与主端之间的数据时间差；如果业务还依赖外部数据库、对象存储、消息队列或第三方 API，其恢复点也需要独立测量。

### RPO Assurance 与定时复制不是一回事

普通 Failover Group 通过 REPLICATION_SCHEDULE 设置刷新间隔，实际副本新鲜度受刷新时长、失败和调度间隔影响，没有系统管理的 RPO SLA 保证。

RPO Assurance 是 Failover Group 的 Business Critical 功能。开启后，Snowflake 管理持续刷新；对符合条件的区域对，Snowflake 按 SLA 提供 RPO 目标承诺。SLA 并不是所有区域组合默认都覆盖，也不是开启选项就自动获得财务保障。需要核对区域对是否在覆盖范围、目标 Lag 配置和 SLA eligibility。

Optimized Refresh 则是提高刷新效率的机制：通过增量元数据变化来降低刷新成本。它不等于 RPO Assurance。启用 Optimized Refresh 时，Failover Group 的 REPLICATION_SCHEDULE 需要不超过 6 小时。

### RTO 还要覆盖身份、计算、连接和业务验收

Failover Group 可复制的对象范围包括数据库、用户、角色、仓库、部分 Integrations、Network Policies、Resource Monitors 等，但不是所有 Snowflake 外部依赖都会自动恢复。至少需要梳理：

- **数据对象**：Database、Schema、Tables、Views、Stages、Pipes、Streams、Tasks、Dynamic Tables、DMFs。
- **账号配置**：Users、Roles、Warehouses、Resource Monitors、Security/Storage/Notification Integrations、Network Policies。
- **访问和认证**：OAuth/SAML、Programmatic Access Tokens、Key Pair、Secrets、外部身份提供方配置。
- **网络和外部服务**：PrivateLink、External Access、API endpoints、DNS、云角色、第三方服务白名单。
- **客户端入口**：应用连接 URL、驱动连接配置、Client Redirect 或 DNS CNAME。
- **业务运行**：Task Graph、数据新鲜度、批次对账、模型/语义对象、下游报表和权限验证。

例如，Tasks 会按条件复制到 Secondary Database，但备用端在 Failover 前不会调度它们；Root Task 和 Task Graph 的恢复还需要检查 Owner Role 和状态。切换后不能认为所有任务会瞬间按原计划正常运行。

## 创建 Failover Group 和 Secondary

### 先定义要复制的数据库与账号对象

以下示例从 Tokyo 主账号创建一个复制关键财务数据、用户、角色、仓库和指定集成的 Failover Group：

~~~sql
CREATE FAILOVER GROUP FINANCE_DR
  OBJECT_TYPES =
    DATABASES,
    USERS,
    ROLES,
    WAREHOUSES,
    RESOURCE MONITORS,
    INTEGRATIONS
  ALLOWED_DATABASES = FINANCE_DB, GOVERNANCE_DB
  ALLOWED_INTEGRATION_TYPES =
    STORAGE INTEGRATIONS,
    NOTIFICATION INTEGRATIONS
  ALLOWED_ACCOUNTS = MYORG.MYACCOUNT_OSAKA
  REPLICATION_SCHEDULE = '10 MINUTE';
~~~

该角色需要 Account 级 CREATE FAILOVER GROUP。要加入 Database，角色还需要相应数据库的 MONITOR；Integration 类型必须列入 ALLOWED_INTEGRATION_TYPES。示例不代表所有 Integration 类型都可复制，实际应根据文档中的对象和类型限制选取。

在大阪目标账号创建 Secondary：

~~~sql
CREATE FAILOVER GROUP FINANCE_DR
  AS REPLICA OF MYORG.MYACCOUNT_TOKYO.FINANCE_DR;
~~~

首次创建 Secondary 会触发初始刷新。后续自动刷新由 Primary 的 REPLICATION_SCHEDULE 控制。刷新以整组对象为单位，保证快照一致性；监控时要检查完成时间、失败、Replica Lag 和数据对象数量，而不是仅确认 Secondary Group 已存在。

若账户刚升级到 Business Critical，Failover 能力可能需要等待最多 12 小时才可用；应把这一点纳入首次部署排期，不要等到演练当天才发现功能尚未激活。

## 监控复制是否真的满足恢复目标

### 查看刷新进度和历史

可以通过 Snowsight Replication 页面或 Information Schema Table Functions 查看刷新历史：

~~~sql
SELECT
  PHASE_NAME,
  START_TIME,
  END_TIME,
  TOTAL_BYTES,
  OBJECT_COUNT
FROM TABLE(
  INFORMATION_SCHEMA.REPLICATION_GROUP_REFRESH_HISTORY('FINANCE_DR')
)
WHERE START_TIME >= CURRENT_DATE() - INTERVAL '7 DAYS'
ORDER BY START_TIME DESC;
~~~

查看最近一次刷新进行到哪个阶段：

~~~sql
SELECT
  PHASE_NAME,
  START_TIME,
  END_TIME,
  PROGRESS,
  DETAILS
FROM TABLE(
  INFORMATION_SCHEMA.REPLICATION_GROUP_REFRESH_PROGRESS('FINANCE_DR')
);
~~~

再看 Replica Lag 历史：

~~~sql
SELECT *
FROM TABLE(
  INFORMATION_SCHEMA.REPLICATION_GROUP_LAG_HISTORY(
    REPLICATION_GROUP_NAME => 'FINANCE_DR'
  )
);
~~~

监控报表至少要有最近刷新状态、完成时间、Primary Snapshot Timestamp、Replica Lag、传输字节和失败原因。Account Usage 的刷新历史视图可能有数据延迟；实时值应使用 Information Schema 对应函数。

### 不能只验证数据库能打开

恢复演练要运行真实工作负载：
- 用应用使用的 Role 查询关键表；
- 执行关键 Semantic View/Verified Queries；
- 检查 Row Access Policy、Masking Policy 和授权继承；
- 验证 Warehouse、Resource Monitor 和 Task Owner Role；
- 核对 External Stage、Storage Integration、Notification Integration 和网络访问；
- 校验最新业务日期、记录数、金额总额和关键批次；
- 检查 Streams、Tasks、Dynamic Tables 的可执行性和恢复状态。

特别注意 Stream：2026 年 11 月 20 日后，某些来源对象不支持复制的 Stream 不再阻止整个 Failover Group 刷新，而是以 unreadable stream 复制到 Secondary。对以下来源，切换后 Stream 可能无法读取：源对象不在同一个 Failover Group 中、来自其他账号的共享表/视图、External Tables 或 Event Tables。这些 Stream 在 failover 和 failback 后仍可能不可读，需要重新创建。刷新成功不等于所有 Stream 都可用。

Dynamic Tables 在 failover 后的首次刷新可能是 Full Refresh、Reinitialization 或 Incremental Refresh。如果发生 Reinitialization，系统会基于 Secondary 上当前可见的基础表重新计算；因复制延迟，结果可能与原 Primary 的最后状态略有差异。验收必须检查业务数据，而不是只看 Dynamic Table STATE。

## 故障切换与 Failback

### Failover 前先冻结写入并确认复制状态

推荐流程：
1. 触发灾备事件，判断主区域是否确实无法提供业务；
2. 暂停或隔离主区域的外部写入，防止双主写入；
3. 检查各 Failover Group 的最近刷新、Replica Lag 和进行中的 Refresh；
4. 如果刷新正在进行，默认等待其完成；若必须强制切换，先评估中断刷新造成的目标端一致性风险；
5. 用 DR 审批流程确认切换目标账号和本次切换范围；
6. 登录目标账号，将 Secondary Group 提升为 Primary。

在目标账号执行：

~~~sql
ALTER FAILOVER GROUP FINANCE_DR PRIMARY;
~~~

Failover 不应在刷新仍执行时强行提升。Snowflake 会阻止正在刷新中的 Secondary Group 提升为 Primary。可以先 SUSPEND 后等待刷新结束；SUSPEND IMMEDIATE 取消当前调度刷新时要格外谨慎，因为在 SECONDARY_DOWNLOADING_METADATA 或 SECONDARY_DOWNLOADING_DATA 阶段中断可能使目标端状态不一致。

### 提升后恢复任务、连接和业务流量

Failover 后，原 Primary 变为 Secondary，新 Primary 才拥有写权限。新的 Secondary 上自动刷新计划会暂停；需要在各 Secondary 账号按计划执行 RESUME 才能恢复复制。

同时：
- 检查 Tasks/Task Graph 的 Root 是否恢复调度，Child 是否依赖有效 Owner Role；
- 恢复外部网络、Storage Integration、OAuth/SAML 和 Secrets；
- 如果使用 Client Redirect，将连接切换到新 Primary；
- 如果使用 PrivateLink，更新 DNS CNAME 或私网连接配置；
- 重新执行关键业务查询、批次对账和数据质量检查；
- 只有业务验收通过后，才允许恢复用户和上游系统写入。

### Failback 是另一次正式切换，不是把旧主账号直接打开

原区域恢复后，不应直接让旧 Primary 恢复写入。先确认新 Primary 的数据已复制回原区域，确认两边账号和连接的状态，再经审批将原账号提升回 Primary。若使用 Client Redirect，需在正确的账号执行 ALTER CONNECTION ... PRIMARY；私网连接时还要更新对应 DNS CNAME。

Failback 后重新验证复制计划、Task Graph、External Integration、用户认证和业务控制数。灾难演练要覆盖完整往返，不能只演练“提升备用账号”一个动作。

## 客户端连接和身份是恢复链路的一部分

Client Redirect 可以用稳定的 Connection URL 将客户端连接重定向到新的 Primary。配置 Connection 并启用允许故障切换的目标账号后，驱动可以继续使用同一个 Connection URL，而不必逐个修改应用连接串。

但认证方式仍有边界：
- 用户必须存在于目标账号；若用户/角色不在复制范围内，要单独 provision；
- SAML/OIDC/Security Integration 的可用性依赖复制与外部 IdP 配置；
- Snowflake OAuth Token 绑定具体账号，连接重定向到其他 Region 的账号后，客户端可能需要重新认证；
- 私有连接时，DNS CNAME 需要按切换后的目标更新。

不要把“客户端能连接”当成“业务能恢复”。应用还依赖数据库权限、仓库、外部服务、连接池和数据新鲜度。

## Runbook 和验收

每个恢复步骤都要记录执行人、审批人、开始/完成时间、账户/区域、Group Name、刷新时间、Query ID 和验收结果。建议按阶段准备：

| 阶段 | 验收内容 |
|---|---|
| 平时准备 | Failover Group 清单、对象依赖、Replication Schedule/RPO Assurance、账号角色、Client Redirect、私网入口、联系人 |
| 故障判断 | 事件范围、主区域可用性、数据写入状态、最近成功刷新、预估数据损失 |
| 切换审批 | 目标账号、允许写入的对象范围、双写风险、业务负责人批准 |
| Failover | Group 提升、连接重定向、Warehouse/Task/Integration 状态 |
| 业务恢复 | 登录、授权、数据对账、查询、任务、外部连接、用户验收 |
| Failback | 新主数据回传、旧账号重新提升、连接和任务再验证 |
| 演练复盘 | 实际 RPO/RTO、未覆盖对象、脚本错误、人工步骤和改进负责人 |

## 常见误区

- **把 Replication Group 当成可写备用账号。** 它提供只读副本；需要提升时应使用 Failover Group，或采用符合条件的 Replication Group BCDR 组合。
- **认为所有 Failover Group 功能在所有 Edition 都可用。** 账号级对象复制和 Failover Group 需要 Business Critical 或更高版本。
- **把 REPLICATION_SCHEDULE 的间隔当成 RPO SLA。** 刷新可能延迟、跳过或失败；RPO Assurance 有独立前提和区域 SLA 覆盖范围。
- **把 Optimized Refresh 和 RPO Assurance 当成同一功能。** 前者优化复制效率，后者对满足条件的 Failover Group 管理连续刷新并提供 RPO 目标。
- **只复制数据库，不复制身份、仓库和集成。** 备用端可能有数据但无权限、无计算资源或无法访问外部服务。
- **认为 Task 在 Secondary 中会自动运行。** 切换前 Secondary 中的 Task 不会调度；切换后还要检查 Root、Owner Role 和执行计划。
- **只看到 Group Refresh 成功就认为所有对象都可用。** 部分 Stream 可能作为 unreadable stream 复制，Dynamic Table 首次刷新也可能重新初始化。
- **Failover 时不检查正在运行的 Refresh。** 需要等待或按受控流程取消，避免 Secondary 端不一致。
- **只演练 Failover，不演练 Failback。** 旧主账号重新成为 Primary 前，必须先同步新主数据并通过验证。
- **把 DNS/Client Redirect 当成身份和依赖恢复的替代品。** 用户、OAuth、SAML、PrivateLink、仓库和任务仍需要单独验证。

## 完成标准

- [ ] 能解释 Replication Group 与 Failover Group 的读写和提升差异。
- [ ] 能区分普通复制计划、Optimized Refresh 和 RPO Assurance。
- [ ] 能根据 Edition 和对象清单判断 Failover Group 是否适用。
- [ ] 能使用 REPLICATION_GROUP_REFRESH_HISTORY、PROGRESS 和 LAG_HISTORY 监控真实复制状态。
- [ ] 能说明 2026 年 Replication Group BCDR 的适用条件和依赖要求。
- [ ] 能按停止刷新、审批、提升 Primary、恢复连接/任务和业务验收执行 Failover。
- [ ] 能说明 Stream、Dynamic Table、Task、Integration 和身份在恢复过程中的边界。
- [ ] 能设计 Failback、Client Redirect 和完整恢复演练 Runbook。

## 自测

1. 业务要求 RPO 5 分钟，Failover Group 每 10 分钟刷新一次。能否据此承诺 RPO 5 分钟？还要评估哪些复制能力和 SLA 覆盖条件？
2. 一个 Replication Group 包含 Database 和 Share。为什么它本身仍然是只读副本？怎样把符合条件的 Replication Group 纳入 BCDR？
3. Task 已随数据库复制到 Secondary，并显示为 RESUMED。为什么 Failover 前仍不会自动调度？
4. Secondary 的 Dynamic Table 在 Failover 后首次刷新发生 Reinitialization。为什么结果可能和原 Primary 的最后状态不同？
5. Failover Group 正在执行 Refresh。为什么不能直接 ALTER FAILOVER GROUP ... PRIMARY？强制取消有哪些风险？
6. 复制刷新成功，但一个 Stream 变成 unreadable。可能是什么源对象不支持复制？如何处理？
7. Failover 成功，应用仍然无法登录。应检查哪些 Client Redirect、OAuth/SAML、用户和 PrivateLink 设置？
8. 为什么灾备验收必须包括 Failback，而不仅是成功提升备用账号？

## 参考资料

- [Introduction to replication and failover across multiple accounts](https://docs.snowflake.com/en/user-guide/account-replication-intro)
- [Create failover groups](https://docs.snowflake.com/en/sql-reference/sql/create-failover-group)
- [Failing over account objects](https://docs.snowflake.com/en/user-guide/account-replication-failover-failback)
- [Optimized Refresh and RPO Assurance](https://docs.snowflake.com/en/user-guide/account-replication-optimized-refresh)
- [Replication Group support in BCDR](https://docs.snowflake.com/en/user-guide/account-replication-replication-groups)
- [Monitoring replication and failover](https://docs.snowflake.com/en/user-guide/account-replication-monitor)
- [Replication considerations, including Tasks](https://docs.snowflake.com/en/user-guide/account-replication-considerations)
- [Dynamic Table replication and failover behavior](https://docs.snowflake.com/en/user-guide/dynamic-tables/replication)
- [Redirecting client connections](https://docs.snowflake.com/en/user-guide/client-redirect)
- [Nov 20, 2026: Unreadable streams with unsupported source objects](https://docs.snowflake.com/en/release-notes/2026/other/2026-11-20-stream-replication-unsupported-source-objects)
