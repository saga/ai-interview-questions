# Cortex Search、检索与 RAG

## 本节要解决的问题

客服问：“客户在 11 月 12 日提交的银行卡退款申请，为什么还没有到账？”知识库里有通用退款政策、支付服务商说明、地区操作手册和客户争议档案。简单语义检索可能找到一篇旧政策，却漏掉适用于该支付方式的新流程；如果检索服务索引了全公司材料，还可能把客服无权访问的档案返回给模型。

Cortex Search 负责建立可查询的文本检索服务。RAG 应用还需要自己处理身份授权、业务事实查询、有效版本、上下文组装、引用核验和失败状态。检索排名高不代表文档适用，更不代表最终回答正确。

## 核心知识

### Source query 决定搜索服务能看到哪些行和字段

Cortex Search Service 基于一条 SQL 源查询构建索引。源查询至少要准备搜索文本、查询时要返回的字段，以及可能参与过滤的属性。建议把文档拆成可独立引用的 Chunk，并为每个 Chunk 分配稳定标识：

| 字段 | 示例 | 用途 |
|---|---|---|
| CHUNK_ID | refund-policy-jp-2026-v3-p04-c02 | 单个检索片段的稳定键 |
| DOCUMENT_ID | refund-policy-jp-2026-v3 | 文档版本标识 |
| SEARCH_TEXT | 退款政策某一章节的正文 | 搜索内容 |
| TITLE / SECTION / PAGE_NO | 文件标题、章节和页码 | 回答引用与原文定位 |
| PAYMENT_METHOD / REGION | CARD、JP | 业务过滤 |
| EFFECTIVE_FROM / EFFECTIVE_TO | 2026-10-01、9999-12-31 | 判断历史日期适用性 |
| ACCESS_DOMAIN | CUSTOMER_SUPPORT_JP | 授权域元数据 |
| PUBLICATION_STATUS | PUBLISHED / WITHDRAWN | 发布与撤销状态 |

创建服务时将主搜索列、Primary Key、过滤属性、Warehouse 和 TARGET_LAG 写清楚：

~~~sql
CREATE OR REPLACE CORTEX SEARCH SERVICE support_docs_search
  ON SEARCH_TEXT
  PRIMARY KEY (CHUNK_ID)
  ATTRIBUTES PAYMENT_METHOD, REGION, EFFECTIVE_FROM, EFFECTIVE_TO, ACCESS_DOMAIN
  WAREHOUSE = SEARCH_REFRESH_WH
  TARGET_LAG = '1 hour'
AS
SELECT
  CHUNK_ID,
  DOCUMENT_ID,
  SEARCH_TEXT,
  TITLE,
  SECTION,
  PAGE_NO,
  PAYMENT_METHOD,
  REGION,
  EFFECTIVE_FROM,
  EFFECTIVE_TO,
  ACCESS_DOMAIN
FROM ANALYTICS.KNOWLEDGE.APPROVED_SUPPORT_CHUNKS
WHERE PUBLICATION_STATUS = 'PUBLISHED';
~~~

Primary Key 是可选的，但如果要使用增量优化刷新或 Data Governance Policy Inheritance，就需要定义。主键列必须为 TEXT，组合值必须在源查询结果中唯一；重复的主键值不会作为多条独立记录保留在最终 Search Index 中。因此，不能把文件级 DOCUMENT_ID 直接作为多段 Chunk 的主键，除非源查询每个文件只输出一行。

源查询必须满足 Dynamic Table Incremental Refresh 的候选条件。不能随意把复杂窗口、非确定表达式或不支持的 SQL 结构放进源查询；需要复杂解析和版本选择时，先在上游物化成稳定的 Chunk 表，再由 Search Service 查询它。

### Chunk 粒度会影响召回和引用质量

Cortex Search 使用 Embedding Model 对搜索列进行向量化。搜索列超过所选模型的上下文窗口时，向量化输入会被截断；关键段落如果落在截断部分，就可能无法被语义检索准确召回。Snowflake 对一般场景建议将文本切分为不超过 512 tokens 的 Chunk；更长上下文模型存在，但不代表越长越好。

研究报告和退款政策不应简单按固定字符数切分。应尽可能沿标题、章节、条款、表格和段落切分，并保留：
- 文档版本、标题和章节层级；
- PDF 页码、表格标题、脚注与引用编号；
- 业务日期、地区、支付方式和生效区间；
- 原始文件 URI 和稳定 Chunk ID。

表格要把列标题、单位和适用期间带进文本，例如“退款金额｜币种：JPY｜处理时限：3–5 个工作日”，不能只把单元格值抽取出来。一个 Chunk 最好能独立表达一个条款或事实，同时保留理解它必需的前置条件。

### ATTRIBUTES 过滤的是已建索引的元数据，不是通用 SQL WHERE

查询只能过滤创建服务时声明在 ATTRIBUTES 中的列。支持的常见匹配包括：
- @eq：TEXT 或 NUMERIC 等值；
- @contains：ARRAY 包含；
- @gte / @lte：NUMERIC、DATE、TIMESTAMP 范围；
- @and、@or、@not：组合条件；
- @primarykey：按已配置的主键查找。

例如，查询 2026-11-12 时适用于日本地区银行卡的材料：

~~~json
{
  "@and": [
    { "@eq": { "PAYMENT_METHOD": "CARD" } },
    { "@eq": { "REGION": "JP" } },
    { "@lte": { "EFFECTIVE_FROM": "2026-11-12" } },
    { "@gte": { "EFFECTIVE_TO": "2026-11-12" } }
  ]
}
~~~

示例使用 9999-12-31 表示尚未结束的有效期，避免把 NULL 结束日期留给过滤表达式处理。DATE 过滤值使用 YYYY-MM-DD；TIMESTAMP 需要使用规定的时间格式，省略时区时按 UTC 解释。对于历史问题，检索过滤应使用问题对应的业务日期，而不是当前日期。

ACCESS_DOMAIN 作为 ATTRIBUTES 可以用于业务范围筛选，但过滤条件本身不是授权边界。如果客户端可以任意修改 ACCESS_DOMAIN，不能把它当作用户级安全策略。

### 默认 Owner’s Rights 的检索服务不会自动执行调用者的底表策略

默认情况下，Cortex Search Service 以服务所有者的权限构建并提供索引。拥有 Search Service、Database 和 Schema 的 USAGE 权限的调用角色，可以检索服务索引中的数据；调用角色不需要对源查询引用的底层表拥有同样权限。底表的 Row Access Policy 和 Masking Policy 默认不会在查询时按调用者身份重新执行。

因此，一个能读全公司档案的服务所有者创建了单一 Search Service，客服角色即使无法查询法务底表，也可能通过该 Search Service 得到已索引的法务内容。向查询请求添加 REGION = 'JP' 只能限制结果，不应单独作为安全控制。

生产环境可以选择两种方案：

1. **按授权域拆分服务。** 例如法务档案、客户支持手册和公开政策分别建立独立服务，再用对象 USAGE 权限限制谁能查询。
2. **评估 Data Governance Policy Inheritance（Preview）。** 启用后，Search Service 可继承底表 Row Access Policy 和 Masking Policy，使结果按调用会话的权限重新取回和过滤。

Data Governance Policy Inheritance 需要满足以下条件：
- INHERIT_DATA_GOVERNANCE_POLICIES = TRUE；
- Search Service 声明 Primary Key，供索引候选结果按主键回查底表；
- 服务 Owner Role 能读到所有应进入索引的源行；Row Access Policy 需要允许专用服务 Owner Role 读取完整索引范围；
- 查询必须使用 CORTEX_SEARCH_RETRIEVE 或 CORTEX_SEARCH_BATCH SQL 函数。启用该功能的服务不能通过 REST API、Python API 或 SEARCH_PREVIEW 查询。

配置示意：

~~~sql
CREATE CORTEX SEARCH SERVICE support_docs_governed
  ON SEARCH_TEXT
  PRIMARY KEY (CHUNK_ID)
  ATTRIBUTES PAYMENT_METHOD, REGION, ACCESS_DOMAIN
  WAREHOUSE = SEARCH_REFRESH_WH
  TARGET_LAG = '1 hour'
  INHERIT_DATA_GOVERNANCE_POLICIES = TRUE
AS
SELECT
  CHUNK_ID,
  SEARCH_TEXT,
  PAYMENT_METHOD,
  REGION,
  ACCESS_DOMAIN
FROM ANALYTICS.KNOWLEDGE.APPROVED_SUPPORT_CHUNKS;
~~~

启用前要验证底表策略的 Owner Role 例外、Masking Policy 是否遮罩了搜索列或过滤列，以及调用用户实际激活的主/次级角色。若被 Masking 的列恰好参与搜索或过滤，匹配结果可能被丢弃，或查询直接被拒绝。该能力目前是 Preview；架构决策要将其成熟度和 API 限制纳入考虑。

### TARGET_LAG 是刷新目标，Primary Key 可优化索引更新

TARGET_LAG 描述 Search Index 相对源数据的目标新鲜度，不是固定 Cron，也不是严格 SLA。Search Service 会根据源查询的变化执行刷新；实际更新时间还受 Warehouse、源查询复杂度、变化量和服务规模影响。

定义 Primary Key 后，Search Service 可以使用优化的刷新路径，只处理有变化的行，降低重复 Embedding 的计算量。长期增量更新会产生分段索引，服务还会周期性执行全量索引重建以压缩索引段；FULL_INDEX_BUILD_INTERVAL_DAYS 是软目标，不应被当作精确的全量重建排期。

重要文档刚刚撤销或更新时，应先检查源表状态和 Search Service 的最后刷新信息；手动 REFRESH 不是“把任意旧版本立即删掉”的同步事务。需要验证新版本已可检索、旧版本已从源查询排除，并在应用端防止缓存旧引用。

### RAG 应分别评估召回、上下文和最终回答

检索返回正确 Chunk，不代表最终回答正确。至少分开检查三个环节：

1. **检索召回**：正确文档是否进入 Top-K，过期版本是否被排除；比较 Recall@K 和 Precision@K。
2. **上下文构建**：是否保留章节、页码、版本、支付方式、地区和例外条款；是否因 Token 限制截断关键信息。
3. **回答生成**：每项事实是否能由引用片段支持；是否把检索推测写成确定事实；是否说明未覆盖的证据。

例如，通用政策说银行卡退款通常需要 3–5 个工作日，但跨境退款需要 7–10 个工作日。只检索到通用政策时，不应回答客户的跨境退款已经超时。要先匹配支付方式、交易地区、退款提交日期和该政策的生效版本，再结合交易状态表判断资金是否实际到账。

## 工程实施步骤

1. 定义文档类型、业务范围、授权域、版本、发布日期、生效期和撤销状态。
2. 为每个 Chunk 建立稳定 CHUNK_ID，确保源查询结果中主键唯一且为 TEXT；保留 DOCUMENT_ID、标题、页码和原始 URI。
3. 先在上游表完成文档解析、Chunk 切分、条款版本整理和撤销处理，再创建 Search Service。
4. 设计 Search Column 和 ATTRIBUTES；不要把任意业务字段都放进过滤属性。
5. 为查询用户选择授权方案：按访问域拆分服务，或评估 Preview 的 Data Governance Policy Inheritance。
6. 使用专用、最小权限的 Service Owner Role；确认它能够索引所需数据，又不会将服务所有权交给普通业务用户。
7. 按目标新鲜度设置 TARGET_LAG，监控刷新时间、失败、Warehouse 消耗和源数据变化。
8. 建立查询集，覆盖同义词、地区、支付方式、政策变更、无效版本和边界日期；分别测量召回与排序。
9. 对直接查询服务、修改过滤条件、跨授权域访问和 Masking Policy 做负向测试。
10. 生成回答前核验引用中的文档版本、页码、适用范围和业务状态；无证据时明确输出“无法确认”。
11. 保存请求 ID、服务定义、查询过滤、Chunk ID、源版本和引用列表，支持事后回放。
12. 对索引停更、文档撤销和历史版本误召回建立专门的告警与恢复流程。

## 场景分析

客服 A 负责东京地区银行卡退款。知识库有通用退款政策、东京地区银行卡操作手册，以及只供法务查看的客户争议档案。

A 问：“客户 C123 在 11 月 12 日的银行卡退款为什么还没有到账？”

系统先从受权限控制的交易视图获取退款申请时间、支付方式、地区、当前状态和交易 ID；再从 Search Service 查找适用于该交易日期的退款政策与东京操作手册。检索出的材料必须带有版本、生效日期和页码。通用政策只作为背景，不能覆盖渠道专属例外。

法务争议档案要么位于独立 Search Service，要么在满足要求时使用 Data Governance Policy Inheritance。不能把一个 Owner Role 能读取全公司内容的 Search Service 直接共享给客服，再指望模型忽略无权材料。

如果 governed service 启用了 Preview 功能，调用链必须使用 CORTEX_SEARCH_RETRIEVE SQL 函数；原来通过 REST 或 Python Search API 的调用不能照搬。若应用必须使用 REST API，则采用服务隔离或可信后端方案，不要假设 Preview 功能对所有调用方式都有效。

## 常见误区

- **把 Search Service 当成完整 RAG 应用。** 它负责召回和排序，业务事实、证据核验和最终回答仍由应用负责。
- **只索引正文，不保存版本、页码和生效期。** 检索结果就无法判断材料是否适用于历史交易。
- **把 ACCESS_DOMAIN 过滤器当成用户授权。** 客户端可控过滤不构成安全边界。
- **忽略 Owner’s Rights。** 默认服务可能让调用人看到服务 Owner Role 可访问的全部索引数据。
- **认为底表 Row Access Policy 默认会作用于 Search Index 查询。** 默认不会；只有满足条件并启用 Preview 的 Data Governance Policy Inheritance 才能继承。
- **启用 Policy Inheritance 后仍调用 REST/Python API。** 该模式只允许通过 CORTEX_SEARCH_RETRIEVE / CORTEX_SEARCH_BATCH SQL 查询。
- **把 TARGET_LAG 当成刷新 SLA。** 需要查看实际数据时间戳与刷新状态。
- **把主键设成文件 ID。** 多个 Chunk 共享一个文件 ID 会破坏行标识；主键必须逐 Chunk 唯一且为 TEXT。
- **认为 Primary Key 的存在会自动修复重复数据。** 重复键记录可能被忽略，必须在源查询层保证唯一。
- **把相似度排名当成业务适用性。** 地区、支付方式、交易日期和政策版本必须由元数据过滤与业务校验共同确认。

## 完成标准

- [ ] 能设计 Search Service 的 source query、搜索列、属性列和稳定 Chunk 主键。
- [ ] 能解释 Chunk 粒度、Embedding Context Window 与引用质量之间的关系。
- [ ] 能正确构造 @eq、@gte、@lte 和逻辑组合过滤。
- [ ] 能解释默认 Owner’s Rights 对底表行/列策略的影响。
- [ ] 能说明 Data Governance Policy Inheritance 的 Preview 状态、Primary Key 要求和 SQL 查询限制。
- [ ] 能监控 TARGET_LAG、索引刷新和服务成本。
- [ ] 能分别评估检索召回、上下文保留和回答忠实度。

## 自测

1. 一份政策文档切成 20 个 Chunk。为什么 DOCUMENT_ID 不能直接作为唯一 Primary Key？主键列有什么数据类型要求？
2. 退款申请发生在 11 月 12 日，政策有 11 月 1 日和 12 月 1 日两个版本。怎样用 ATTRIBUTES 筛选历史上适用的版本？
3. 一个 Search Service 的 Owner Role 能读取所有地区文档，调用人只能访问东京源表。默认查询行为是什么？为什么传入 REGION='JP' 仍然不能单独作为安全保证？
4. Data Governance Policy Inheritance 启用后，为什么 REST API 和 Python API 不能继续使用？实时 RAG 和批量离线检索应分别使用什么 SQL 函数？
5. Search Service TARGET_LAG 为 5 分钟，但索引仍返回旧政策。应该检查哪些源查询、刷新与 Serving 证据？

## 参考资料

- [Cortex Search overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [Query a Cortex Search Service](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service)
- [Data governance policy inheritance for Cortex Search](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-data-governance-inheritance)
- [CREATE CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search)
- [ALTER CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/alter-cortex-search)
