# Cortex Search 服务基础配置

## 本节要解决的问题

为企业文档或文本数据建立可持续更新的检索服务，理解搜索列、属性过滤、主键、刷新目标和查询 API 之间的关系。创建服务只是部署索引；检索质量、权限过滤、索引新鲜度和来源追踪仍需要独立设计。

## 核心知识

### Search Column 决定检索的文本内容

CREATE CORTEX SEARCH SERVICE 指定一个搜索列作为主要检索内容。该列通常是经过文档解析和切块的文本，内容应包含标题、正文、章节和适当上下文。过大的 Chunk 会带入无关段落；过小则失去限定信息，因此需要用实际查询问题测试。

服务的源 SQL 定义索引需要的行。可将 document_id、chunk_id、source_uri、页码、更新时间、租户和文档类别等一起投影出来，以便检索结果返回后能够定位原始内容。

### ATTRIBUTES 定义可用于过滤的属性列

ATTRIBUTES 指定服务可过滤的结构化列，例如 tenant_id、document_type、region、department 或 effective_date。查询 API 的 filter 仅支持对服务定义中的属性列执行比较和逻辑组合；不能把任意未投影字段当作过滤条件。

属性过滤是检索候选集控制机制，但不应把用户传入的 tenant_id 当作身份凭证。真正的访问范围应由服务端根据已验证用户和授权系统生成过滤条件，避免用户修改请求过滤器跨租户读取。

### PRIMARY KEY 和 TARGET_LAG 影响索引维护

Cortex Search Service 可为源行指定 Primary Key，帮助服务识别更新和增量维护；没有稳定唯一键时，更新和删除可能更难准确追踪，也可能导致完整重建或不理想的刷新行为。Primary Key 应在业务上稳定、唯一，不应使用每次刷新都变化的随机值。

TARGET_LAG 表达索引内容相对源数据的目标滞后，不是固定定时器，也不是保证每次在该时间内完成刷新。服务创建后可通过 DESCRIBE CORTEX SEARCH SERVICE 查看 target_lag、warehouse、search_column、attribute_columns、indexing_state、serving_state 和 data_timestamp。

### 查询 API 与服务状态需要一起监控

Cortex Search 支持 Python API、REST API 和 SQL SEARCH_PREVIEW。查询请求可指定 query、返回 columns、filter、limit 和其他选项。Filter 支持等值、数组包含、数值/日期范围和逻辑组合。服务还存在索引状态与 Serving 状态：索引停止或 Serving 暂停时，查询结果可能不可用，即使源表本身正常。

## 工程实施步骤

1. 定义检索场景、文档来源、租户边界、更新频率、响应延迟和查询问题集。
2. 将文件解析为带来源定位的 Chunk，保留 document_id、chunk_id、source_uri、页码/章节、更新时间和权限标签。
3. 设计稳定主键，保证 Chunk 更新和删除时能识别同一来源记录；避免将随机生成的每次刷新 ID 当稳定主键。
4. 创建 Cortex Search Service，明确搜索列、ATTRIBUTES、Warehouse、TARGET_LAG 和可选 Embedding Model。
5. 确保源 SQL 投影出所有查询返回列与过滤属性，并检查源 SQL 的唯一性和数据量。
6. 调用 API 时由服务端根据已认证用户构造 Filter；验证租户、地区、文档类型和生效日期的访问边界。
7. 建立检索评测集，检查 Recall@K、Precision@K、排序、引用定位和过滤正确性；对专有名词与短查询单独评估。
8. 使用 DESCRIBE 检查索引与 Serving 状态、data_timestamp 和最后刷新情况，监控实际索引滞后。
9. 对文档新增、更新和删除进行端到端测试，确认新 Chunk 能被检索，旧 Chunk 不再返回。
10. 将检索结果的来源信息和分数交给下游 RAG；答案必须能回到实际文档片段，无法支持的问题应拒答。

示例：

~~~sql
CREATE CORTEX SEARCH SERVICE DOC_SEARCH
  ON CHUNK_TEXT
  ATTRIBUTES TENANT_ID, DOC_TYPE, REGION
  WAREHOUSE = CORTEX_SEARCH_WH
  TARGET_LAG = '10 minutes'
AS
SELECT
  CHUNK_ID,
  DOCUMENT_ID,
  CHUNK_TEXT,
  TENANT_ID,
  DOC_TYPE,
  REGION,
  SOURCE_URI
FROM MART.DOCUMENT_CHUNKS;
~~~

如果服务定义支持 Primary Key，应把稳定的 CHUNK_ID 显式声明为服务主键；具体 DDL 以目标账户当前版本的 CREATE CORTEX SEARCH SERVICE 语法为准。

## 场景分析

客服政策文档按日本和新加坡区域维护。普通员工只能检索所在区域的现行政策，主管可以查看历史版本。创建 Cortex Search 时，团队把 REGION 和 EFFECTIVE_DATE 投影为属性，但查询 API 直接使用浏览器传入的 region 过滤值。

这种做法并不安全。后端必须从已验证用户身份得到允许区域和角色，再生成 Filter；主管的历史检索能力也应由服务端授权。检索结果需要返回文件名、章节和生效日期，供回答显示来源。政策更新后，应检查 data_timestamp 和索引滞后，直到服务确认更新再将新政策标记为可检索。

验收覆盖员工跨区请求、主管历史查询、未授权文档、文档更新、删除和索引暂停等情况，分别检查过滤正确率、检索召回、索引延迟与引用准确率。

## 常见误区

- **认为 Search Column 包含全文就不需要 Chunk 设计。** 文本粒度仍影响召回和上下文完整性。
- **把 ATTRIBUTES 当独立权限系统。** 它提供查询过滤能力，授权决策必须来自可信身份。
- **认为 TARGET_LAG 是刷新周期或 SLA。** 应查看实际 data_timestamp 与索引状态。
- **用不稳定的主键标识 Chunk。** 会增加更新/删除定位难度，破坏增量维护。
- **只检查创建成功。** 索引状态、Serving 状态和数据时间戳也要验证。
- **检索有结果就说明 RAG 正确。** 仍需评估引用、答案支持度、过滤和拒答。

## 完成标准

- [ ] 能说明 Search Column 与 ATTRIBUTES 的区别。
- [ ] 能设计稳定的文档 Chunk 主键和来源字段。
- [ ] 能解释 TARGET_LAG、indexing_state、serving_state 和 data_timestamp。
- [ ] 能通过服务端身份计算安全 Filter。
- [ ] 能使用 Python/REST/SQL API 查询并评估检索结果。
- [ ] 能验证文档更新、删除和暂停后的索引状态。

## 自测

1. tenant_id 被定义为 ATTRIBUTES 后，是否就能防止用户跨租户查询？授权逻辑应放在哪里？
2. 文档更新后 Cortex Search 仍返回旧文本，应该检查哪些索引状态和时间字段？
3. 一个 Chunk 每次重建都会产生新 ID，会对索引维护造成什么影响？
4. 服务创建成功但 serving_state 为 SUSPENDED，客户端查询应如何处理？
5. 为什么需要将 Recall@K、引用定位和访问过滤分别评测？

## 参考资料

- [Cortex Search overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [CREATE CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search)
- [Query a Cortex Search Service](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service)
- [DESCRIBE CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/desc-cortex-search)
