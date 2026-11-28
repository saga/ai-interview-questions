# Cortex Search 新鲜度、刷新诊断与租户权限

## 本节要解决的问题

企业知识库每小时接收新的支持文档。东京客服只能搜索日本地区的客户资料，法务团队可以搜索争议档案。某天政策在 09:00 更新，10:00 客服仍然搜到旧版本；另一名客服又通过 Search Service 得到了自己无权读取的法务材料。

这其实是两个不同的故障：
- **新鲜度问题**：源表已更新，但当前可查询索引尚未包含新数据；
- **授权问题**：Search Service 的索引和查询身份不一定沿用底层表的行级策略。

Cortex Search 的 TARGET_LAG、Indexing、Serving、刷新历史和 Owner’s Rights 分别控制不同环节。只看服务是否 RUNNING，无法判断数据是否新鲜，也不能证明用户只看到了自己有权访问的文档。

## 从源数据到检索可见有多个时间点

### DATA_TIMESTAMP 表示当前索引已评估到哪个源数据时间

需要区分四个时间：
- SOURCE_COMMIT_TIME：业务数据写入源表的时间；
- REFRESH_START/END_TIME：Search 刷新开始和结束的时间；
- DATA_TIMESTAMP：本次刷新评估源数据时的事务时间，表示该时间点之前已到达的源数据包含在当前索引中；
- QUERY_TIME：用户发起搜索的时间。

如果源表在 09:05 提交新政策，而当前 Search Service 的 DATA_TIMESTAMP 是 08:58，用户在 09:30 仍搜不到新政策，并不一定是检索排序问题；索引还没有覆盖到那笔提交。

反过来，DATA_TIMESTAMP 已经超过 09:05，也不代表用户一定能在 Top 10 里看到该政策。还要确认源查询是否将它纳入、Chunk 是否有效、属性过滤是否匹配、索引是否 Serving，以及查询文本能否召回该内容。

### TARGET_LAG 是新鲜度目标，不是准点刷新 SLA

创建 Search Service 时可以设置 TARGET_LAG，例如 5 分钟或 1 小时。它表示索引相对源数据的目标滞后，不是固定 Cron，也不是无条件 SLA。

实际刷新还受以下因素影响：
- 源表变更量与源查询复杂度；
- 刷新 Warehouse 是否可用、是否排队；
- Indexing 是否处于 RUNNING；
- 上一次刷新是否正在执行；
- 索引规模和 Embedding 处理量；
- 目标数据是否已达到本次刷新可观察的事务时间。

因此，生产监控应记录 DATA_TIMESTAMP、刷新状态和业务源表提交时间的差值，而不是只记录 TARGET_LAG 配置值。

## Indexing 和 Serving 是两个独立状态

### 服务可以仍能查询，但索引已经停止更新

Cortex Search 有两个独立的目标状态：
- **INDEXING**：负责观察源表变化、执行源查询、维护物化数据和索引；
- **SERVING**：负责对外提供搜索查询。

两者可以分别 RUNNING 或 SUSPENDED：

| Indexing | Serving | 对用户的影响 |
|---|---|---|
| RUNNING | RUNNING | 正常刷新并提供查询 |
| SUSPENDED | RUNNING | 仍能查询旧索引，但源数据变化不会反映到检索结果 |
| RUNNING | SUSPENDED | 后台继续刷新，用户暂时不能查询 |
| SUSPENDED | SUSPENDED | 不刷新，也不提供查询 |

当 Indexing 暂停时，TARGET_LAG 不会让索引自动追上源数据。即使 Serving 仍是 RUNNING，返回的也可能是旧内容。相反，Serving 暂停不会阻止索引继续刷新；恢复 Serving 后，用户可以查询到暂停期间最新一次成功刷新形成的索引。

若 Indexing 暂停超过源表数据保留期，Search 服务可能无法再检测到全部历史变化，恢复时可能需要重建服务。因此，长时间暂停不能只当成节省 Serving 费用的开关。

### 用 DESCRIBE 查看服务定义和当前状态

~~~sql
DESC CORTEX SEARCH SERVICE
  KNOWLEDGE_DB.SEARCH.POLICY_SEARCH;
~~~

重点检查：
- TARGET_LAG 与 Warehouse；
- SEARCH_COLUMN 和 ATTRIBUTE_COLUMNS；
- DATA_TIMESTAMP；
- INDEXING_STATE 和 INDEXING_ERROR；
- SERVING_STATE；
- SOURCE_DATA_NUM_ROWS；
- PRIMARY_KEY_COLUMNS；
- FULL_INDEX_BUILD_INTERVAL_DAYS。

如果服务可查询但 DATA_TIMESTAMP 过旧，应沿 Indexing 和刷新历史继续排查；如果 Indexing 正常但 Serving 为 SUSPENDED，应处理 Serving 状态，而不是反复刷新源数据。

## 用 Refresh History 定位是调度延迟、源查询慢还是索引失败

### 查看最近的刷新记录和错误

Information Schema 提供 CORTEX_SEARCH_REFRESH_HISTORY：

~~~sql
SELECT
  data_timestamp,
  refresh_start_time,
  refresh_end_time,
  state,
  refresh_action,
  refresh_trigger,
  target_lag_sec,
  index_preprocessing_duration,
  indexing_duration,
  error
FROM TABLE(
  KNOWLEDGE_DB.INFORMATION_SCHEMA.CORTEX_SEARCH_REFRESH_HISTORY(
    NAME => 'POLICY_SEARCH',
    DATA_TIMESTAMP_START => DATEADD('DAY', -7, CURRENT_TIMESTAMP()),
    RESULT_LIMIT => 100
  )
)
ORDER BY data_timestamp DESC;
~~~

状态含义：
- EXECUTING：刷新仍在执行；
- SUCCEEDED：本次刷新成功；
- FAILED：执行失败；
- CANCELLED：刷新在执行前或过程中被取消。

REFRESH_ACTION 可以区分 NO_DATA、FULL 和 INCREMENTAL；REFRESH_TRIGGER 可以区分 CREATION、SCHEDULED 和 MANUAL。记录中还可以看到预处理阶段和索引阶段的耗时及 Query ID。

排查时按顺序看：
1. DATA_TIMESTAMP 是否已经越过目标源提交时间；
2. 最新刷新是否 SUCCEEDED，或仍然 EXECUTING；
3. 源查询预处理耗时是否异常；
4. Indexing 耗时和行变化量是否突然增加；
5. Warehouse 是否排队或失败；
6. 索引是否发生 FULL refresh，还是只做 INCREMENTAL；
7. 最后一次刷新是否因手动操作或服务暂停而偏离计划。

刷新成功也不代表上游文件全部到齐。要把 Search Refresh History 和源表加载批次、COPY_HISTORY/Snowpipe 状态、业务批次控制数结合起来检查。

### 手动 REFRESH 会立即检查源变化，但不是同步事务

在政策刚发布、业务需要尽快检索时，可以手动触发：

~~~sql
ALTER CORTEX SEARCH SERVICE
  KNOWLEDGE_DB.SEARCH.POLICY_SEARCH
  REFRESH;
~~~

该操作会立即检查源数据变化并更新索引，但不等于“提交命令后立即可见”。仍要等刷新完成，并检查 DATA_TIMESTAMP、刷新状态和 Serving 状态。若源查询已经排除旧版本但查询仍然返回旧内容，也要检查缓存、结果引用版本和查询过滤条件。

## Primary Key、增量刷新与完整重建

### 主键应唯一标识每个 Chunk

Cortex Search Service 的 Primary Key 是可选的；设置后可以启用优化的增量刷新路径，减少不变数据的重复处理。主键必须是 TEXT，且在源查询结果中唯一。对于一份文档拆成 20 个 Chunk 的情况，应使用逐 Chunk 唯一 ID，而不是所有 Chunk 共用 document_id。

若主键重复，索引不会把重复键记录当成多个独立业务行可靠保存；因此要先在源表保证唯一，并监控重复键。修改 Search Service 的 Primary Key 只影响后续刷新，不能假设 DDL 执行后现有索引立即按新主键重算。

### 增量刷新会积累索引段，完整构建用于整理

有 Primary Key 的服务可以使用增量路径处理变化行。长时间增量刷新会产生多个索引段，Snowflake 还会周期性执行完整索引重建来压缩索引段。FULL_INDEX_BUILD_INTERVAL_DAYS 是软目标，不是保证某天某时刻一定执行的排期。

监控时要关注：
- INCREMENTAL 与 FULL 的比例；
- 每次刷新处理的新增、删除和未变化记录数；
- 完整重建持续时间；
- 重建期间的查询延迟和成本；
- Source Query 是否引入昂贵 Join、计算列或不必要字段。

若使用了 Primary Key，但每次上游变更都引发巨大刷新，应检查键唯一性、源查询结构、数据更新模式以及是否发生了大范围重写。

## 默认 Owner’s Rights 不会自动应用调用者的底表策略

### Search Service 的 Owner Role 决定默认索引权限

默认 Cortex Search Service 以服务 Owner 的权限构建并提供索引。拥有 Search Service、Database 和 Schema USAGE 的调用者可以查询索引；底层表的 Row Access Policy 和 Masking Policy 默认不会在 Search 查询时按调用用户身份重新执行。

例如，SEARCH_OWNER_ROLE 可以读取所有地区和所有部门的客户档案，而客服 Role 只能读取日本地区记录。若所有文档都进入一个由 SEARCH_OWNER_ROLE 创建的服务，客服用户可能通过 Search 获得其在底层表中无法 SELECT 的内容。

属性过滤不是用户授权。让客户端传入 REGION='JP' 或 ACCESS_DOMAIN='SUPPORT'，不能构成安全边界，因为调用者可能直接调用服务或修改过滤条件。

### 两种主要隔离方式

1. **按授权域拆分服务**：法务、客服、公开资料和区域敏感文档使用不同 Search Service，再用对象 USAGE 权限限制可以查询哪些服务。
2. **使用 Data Governance Policy Inheritance（Preview）**：Search Service 重新取回候选行时，按调用者会话执行底表 Row Access Policy 和 Masking Policy。

启用继承时需要：
- INHERIT_DATA_GOVERNANCE_POLICIES = TRUE；
- 声明 TEXT Primary Key；
- Service Owner Role 能看到所有应该被索引的源行；若底表 Row Access Policy 限制 Owner，需要有受控 Owner Role 例外；
- 查询改用 CORTEX_SEARCH_RETRIEVE 或 CORTEX_SEARCH_BATCH SQL 函数。

该服务不能再通过 REST API、Python API 或 SEARCH_PREVIEW 查询。若应用必须走 REST/Python，应该采用服务拆分或受控后端代理，而不是假设 Policy Inheritance 对这些接口同样有效。

### Policy Inheritance 会增加查询成本，并有 Masking 约束

启用继承后，查询服务会将 Search 结果按 Primary Key 回连源查询，以便应用调用者的策略。因此，源查询复杂度会进入每一次检索的成本和延迟。尽量使用简单源查询，并根据基础表行数和查询延迟选择足够的 Warehouse。

如果搜索列或过滤列对用户被 Masking，Search 可能丢弃命中结果或拒绝查询。Primary Key 列不能设置 Masking Policy。还要注意：
- 若 Row Access Policy 在索引构建时也限制了 Owner Role，未被 Owner 看到的行不会进入索引，即使查询者本身有权访问也无法找回；
- 过滤表达式中的操作符和列名必须在查询里明确写出，不能让每行动态决定列名；
- 被 Masking 的列不能用于源查询的行筛选；
- 因为候选召回先发生、授权过滤后发生，最终返回条数可能少于普通 Search Service。

该 Preview 功能应先在目标 Role 下做正向、负向、Masking 和延迟测试，再决定是否承载高敏感数据。

## 用真实业务数据验证刷新与权限

假设政策文档表有以下字段：
- chunk_id：每个 Chunk 唯一 ID；
- region：适用地区；
- access_domain：法务/客服/公开等授权域；
- effective_from / effective_to：生效范围；
- version：政策版本；
- body：可搜索内容。

需要准备测试：
1. 新版本文档提交后，测量源提交时间到 DATA_TIMESTAMP 的滞后；
2. Indexing 暂停但 Serving 继续时，确认应用显示旧数据状态；
3. Serving 暂停时，确认用户不能查询；
4. 东京客服 Role 只能检索授权的日本客服政策；
5. 法务 Role 能查询法务服务，客服 Role 不能；
6. 若启用 Policy Inheritance，分别测试允许、拒绝、Masking 和被遮罩列搜索；
7. 版本切换时确认旧政策不再被用于当前日期问题；
8. 手动 REFRESH 后确认新版本已进入成功索引并且可被引用。

检索测试需要和源数据对账。对于每个问题，保存预期 document_id、version、页码、有效期和查询过滤。Recall@K 只说明相关文档是否被召回，不证明用户有权读它，也不证明它在业务日期内有效。

## 工程实施步骤

1. 为源文档和 Chunk 保存稳定主键、版本、地区、授权域、生效时间和撤销状态。
2. 设计只包含必要字段的 Source Query，保持 Owner Role 对索引范围的权限明确。
3. 设定 TARGET_LAG，并记录业务源提交时间与 Search DATA_TIMESTAMP 的差值。
4. 通过 DESCRIBE 和 CORTEX_SEARCH_REFRESH_HISTORY 监控 Indexing/Serving、刷新阶段、错误和增量/全量构建。
5. 在源表及 Search Service 中验证 Primary Key 唯一性，评估增量刷新和 FULL_INDEX_BUILD_INTERVAL_DAYS。
6. 将 Indexing、Serving 暂停/恢复纳入 Runbook，避免服务长期查询旧索引。
7. 按授权域拆分 Search Service，或在验证 Preview 条件后启用 Data Governance Policy Inheritance。
8. 用实际调用 Role 测试跨地区/跨部门拒绝访问，以及 Masking 对搜索列和过滤列的影响。
9. 对每次刷新后的代表性问题执行召回、过滤、版本和引用回归。
10. 保存 Query ID、Refresh History、DATA_TIMESTAMP、文档版本、调用 Role 和引用信息，支持事故复盘。

## 常见误区

- **把 TARGET_LAG 当作实际新鲜度或 SLA。** 要检查 DATA_TIMESTAMP 和刷新历史。
- **只看 SERVING_STATE=RUNNING。** Indexing 可能已暂停，服务仍然返回旧索引。
- **认为手动 REFRESH 命令返回就代表新内容已可见。** 应等待成功刷新并检查实际查询结果。
- **把源表 Row Access Policy 当作默认 Search 权限。** 默认 Owner’s Rights 不会在检索时按调用者执行底表策略。
- **把客户端属性过滤当成安全边界。** 调用者可控制的过滤条件不能代替授权隔离。
- **启用 Policy Inheritance 后继续使用 REST/Python API。** 继承模式只允许 CORTEX_SEARCH_RETRIEVE/BATCH SQL 查询。
- **把文件级 DOCUMENT_ID 设成多 Chunk 主键。** 每个索引行都需要唯一 TEXT 主键。
- **只看刷新成功，不核对业务批次。** 新鲜度应与文件加载、源表完整性和有效版本一起验证。
- **用 Masking Policy 遮罩 Primary Key 或搜索列。** 这可能导致结果丢失或查询被拒绝。
- **将 Recall@K 当作授权和引用正确性的证明。** 召回、权限、适用日期和来源引用是不同验收项。

## 完成标准

- [ ] 能解释 TARGET_LAG、DATA_TIMESTAMP 和刷新完成时间的差别。
- [ ] 能通过 DESCRIBE 和 CORTEX_SEARCH_REFRESH_HISTORY 定位刷新失败与滞后。
- [ ] 能区分 Indexing 与 Serving 的独立状态及其用户可见结果。
- [ ] 能说明 Primary Key 对增量刷新和 Chunk 唯一性的作用。
- [ ] 能解释默认 Owner’s Rights 与底表 Row Access/Masking Policy 的边界。
- [ ] 能说明 Data Governance Policy Inheritance 的 Primary Key、Owner Role、SQL-only 和 Masking 约束。
- [ ] 能用不同业务 Role 测试跨租户拒绝访问、文档版本和引用正确性。
- [ ] 能将 Search 新鲜度监控与源批次对账、召回回归结合起来。

## 自测

1. 源表在 09:05 写入新政策，Search DATA_TIMESTAMP 仍为 08:58。09:30 搜不到新版本时，应先排查哪一层？
2. Indexing=SUSPENDED、Serving=RUNNING。用户能否查询？查询结果新鲜度如何？
3. Target Lag 设为 5 分钟，但刷新 History 显示最近一次成功的 DATA_TIMESTAMP 落后 40 分钟。能否宣称满足新鲜度目标？
4. 同一文档切分为 20 个 Chunk。为什么 DOCUMENT_ID 不能直接作为所有 Chunk 的 Primary Key？
5. Search Owner Role 能读取所有部门文档，但调用者只能看客服文档。默认 Owner’s Rights 会发生什么？有哪些隔离方案？
6. Data Governance Policy Inheritance 已启用。为什么 REST/Python Search API 不能继续使用？还要检查哪些 Masking 和 Owner Role 条件？
7. Search Recall@K 很高，但有一条引用属于未来生效的政策版本。为什么仍然不能算正确？要增加什么时间过滤？

## 参考资料

- [Cortex Search overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [DESCRIBE CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/desc-cortex-search)
- [CORTEX_SEARCH_REFRESH_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/cortex_search_refresh_history)
- [ALTER CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/alter-cortex-search)
- [Data governance policy inheritance for Cortex Search](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-data-governance-inheritance)
- [Cortex Search services Information Schema](https://docs.snowflake.com/en/sql-reference/info-schema/cortex_search)
