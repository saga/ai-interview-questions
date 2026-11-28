# Cortex Search、检索与 RAG

## 本节要解决的问题

客服问：“客户在 11 月 12 日提交的退款申请，为什么还没有到账？”知识库里有退款政策、支付服务商说明、客服操作手册和客户订单事件。简单向量检索可能返回一篇讲“退款通常需要 3–5 个工作日”的旧政策，却漏掉适用于该支付方式的新流程；更严重的是，客服只能查看自己负责的客户，但 Search Service 可能索引了其他团队的受限文档。

Cortex Search 负责从文本和结构化属性中召回相关内容。它不是完整的 RAG 应用，也不会自动替你完成业务事实校验、用户级授权和答案引用检查。上线前要同时设计文档索引、查询过滤、权限边界、刷新策略和评测。

## 核心知识

### Search Service 的 source query 决定索引里有什么

Cortex Search Service 由一条源查询定义。源查询应准备检索文本、用于过滤的属性、返回引用所需的字段，以及稳定的文档标识。

例如，退款知识库可以将已批准的政策段落和元数据整理为：

| 字段 | 用途 |
|---|---|
| DOCUMENT_ID | 文档或段落稳定标识 |
| SEARCH_TEXT | 供向量与文本检索使用的正文 |
| TITLE / SECTION | 回答时展示的来源标题和章节 |
| PUBLISHED_AT / EFFECTIVE_FROM | 判断材料是否过期或尚未生效 |
| PAYMENT_METHOD | 按支付方式筛选 |
| REGION | 按适用地区筛选 |
| ACCESS_DOMAIN | 文档所属的授权域 |

创建服务时，指定主搜索列、过滤属性、刷新 Warehouse 和 Target Lag：

~~~sql
CREATE OR REPLACE CORTEX SEARCH SERVICE support_docs_search
  ON SEARCH_TEXT
  ATTRIBUTES PAYMENT_METHOD, REGION, ACCESS_DOMAIN, EFFECTIVE_FROM
  WAREHOUSE = SEARCH_REFRESH_WH
  TARGET_LAG = '1 hour'
  PRIMARY KEY (DOCUMENT_ID)
AS
SELECT
  DOCUMENT_ID,
  SEARCH_TEXT,
  TITLE,
  SECTION,
  PAYMENT_METHOD,
  REGION,
  ACCESS_DOMAIN,
  EFFECTIVE_FROM
FROM ANALYTICS.KNOWLEDGE.APPROVED_SUPPORT_CHUNKS
WHERE PUBLICATION_STATUS = 'PUBLISHED';
~~~

示例假设 DOCUMENT_ID 对每个索引行唯一，且 ACCESS_DOMAIN 已由文档治理流程确定。实际切分成多个 Chunk 时，主键应能唯一标识 Chunk，而不是所有段落共用一个文件 ID。关键文档撤销或新版本发布时，源查询应能体现其状态和新版本关系。

### ATTRIBUTES 让查询按元数据过滤，不是任意 SQL WHERE

Search Service 只能对创建服务时列入 ATTRIBUTES 的列进行过滤。过滤表达式支持等值、范围、数组包含和逻辑组合等操作。例如限定支付方式和地区：

~~~json
{
  "@and": [
    { "@eq": { "PAYMENT_METHOD": "CARD" } },
    { "@eq": { "REGION": "JP" } },
    { "@lte": { "EFFECTIVE_FROM": "2026-11-12" } }
  ]
}
~~~

DATE 和 TIMESTAMP 类型的过滤值有规定格式；如果省略时区，Timestamp 会按 UTC 解释。范围筛选也不能自动处理有效期结束时间，查询端还要加上 EFFECTIVE_TO 为空或大于业务日期的条件，前提是该列也加入 ATTRIBUTES。

过滤属性是业务检索的关键。只把正文作为搜索列，而不提供文档类型、发布日期、地区、支付方式和有效状态，模型就很难准确排除过期或不适用的材料。

### Search Service 使用 Owner’s Rights，底层表策略不会自动变成用户级检索授权

这是部署时必须处理的权限边界。

Cortex Search Service 执行查询时使用服务所有者的权限。查询角色拥有 Search Service、Database 和 Schema 的 USAGE 后，可以检索服务索引的内容；它不需要对源查询引用的底层表拥有相同权限。特别是，底层表的 Row Access Policy 或 Masking Policy 不会自动按调用用户身份过滤 Search Service 已索引的行。

因此，如果一个服务所有者可以读全公司所有客户文档，而客服角色只有某个地区的源表访问权限，不能据此推断客服通过 Search Service 只会看到自己地区的文档。给 Query API 传入一个 REGION 过滤器，也不应被当成唯一的访问控制边界；如果调用者可以直接查询服务并修改过滤条件，就可能尝试扩大检索范围。

可行的设计是先按数据访问域划分索引和服务，再用对象权限控制哪些角色能够查询哪些服务。确实需要在一个应用层服务中共享搜索服务时，应由可信后端根据已认证身份构造过滤条件，并避免给终端用户直接查询受限 Search Service 的权限。对高敏感文档，使用按授权域拆分的独立索引/服务，通常比依赖客户端过滤更容易审计。

### Target Lag 是索引新鲜度目标，Primary Key 影响刷新路径

Cortex Search 的 TARGET_LAG 决定索引内容相对源数据的目标最大滞后时间。它不是固定 Cron 周期，也不是严格 SLA。刷新需要使用指定 Warehouse 执行源查询和索引维护；若索引刷新停滞，即使搜索服务仍可查询，返回的内容也可能是旧版本。

指定 Primary Key 后，服务可以采用优化刷新路径，只处理自上次刷新以来变化的行，而不是每次都重新 embedding 全部内容。Primary Key 列必须是 TEXT，且组合值应唯一；重复键会影响索引结果。主键变更要在后续源数据变化与刷新后才生效。

服务有独立的 Indexing 和 Serving 状态：
- Indexing 暂停时，Serving 仍可继续返回旧索引，但不会反映新的源数据。
- Serving 暂停时，Indexing 仍可以刷新；恢复 Serving 后才会对用户提供新索引。
- 重要政策刚更新时，可以使用手动 REFRESH 促使索引尽快检查并处理变化。

可通过 DESCRIBE CORTEX SEARCH SERVICE 或 SHOW CORTEX SEARCH SERVICES 检查 Target Lag、索引时间戳、Warehouse、Indexing/Serving 状态和错误信息。

### RAG 要分别评估检索、上下文和最终回答

检索返回正确文档，并不代表最终答案正确。应分开检查三个阶段：

1. **检索召回**：正确文档是否进入候选结果，过期文档是否被排除。
2. **上下文构建**：是否保留章节、页码、版本、适用地区和关键条件，有没有因截断丢掉例外条款。
3. **回答生成**：回答中的每项事实是否能被引用片段支持，是否把推测写成事实。

例如，政策说“银行卡退款一般在 3–5 个工作日到账”，但支付服务商对某些跨境交易要求 7–10 个工作日。若只检索到通用政策，回答就会遗漏支付渠道的例外。应把支付方式和地区作为结构化过滤条件，再核验引用的适用范围。

## 工程实施步骤

1. 定义检索内容的业务范围、授权域、文档类型、版本、发布日期、生效期和撤销状态。
2. 设计稳定 DOCUMENT_ID/CHUNK_ID，确认每条索引记录有唯一主键，并保留标题、章节、页码和原始链接。
3. 先通过源查询过滤已批准材料，再创建 Cortex Search Service；仅将真正需要过滤的列放入 ATTRIBUTES。
4. 按敏感级别和访问团队划分服务/索引，避免把不同授权域的文档混入同一个可由宽泛角色查询的服务。
5. 使用最小角色授予 Search Service、Database 和 Schema 的 USAGE；检查服务所有者对源表的读取范围和策略效果。
6. 如果由应用代为查询，服务端从认证上下文确定允许的服务和过滤条件，不信任用户提交任意 ACCESS_DOMAIN 或 REGION 值。
7. 为重要更新、文档撤销和政策生效设定 Target Lag；用 DESCRIBE/SHOW 检查 DATA_TIMESTAMP、Indexing/Serving 状态和错误。
8. 建立查询集，覆盖同义词、错误码、支付方式、地区、历史版本和过期政策；分别评估 Recall@K、Precision@K、排序和回答引用。
9. 对无权访问的文档做负向测试，确认用户无法通过直接调用 Search Service 或修改过滤条件取得其他授权域的内容。
10. 保存查询文本、服务版本/定义、过滤条件、文档 ID、Chunk ID、来源版本和最终答案引用，便于复核。
11. 重要文档更新后对照源表与索引数据时间戳，若索引未及时刷新，按流程触发 REFRESH 并验证新版本已可检索。
12. 将无法检索、无权限、索引过期和回答证据不足区分为不同状态，不把它们统一解释成“没有相关资料”。

## 场景分析

客服 A 负责东京地区银行卡退款。知识库中有三份材料：通用退款政策、东京地区银行卡操作手册，以及只供法务查看的客户争议档案。

A 的问题是：“客户 C123 在 11 月 12 日的银行卡退款为什么还没有到账？”

系统应只在 A 有权使用的索引中检索，并通过结构化交易数据确认退款状态、金额和处理时间。Cortex Search 找到东京地区银行卡手册后，还要确认其有效版本；通用退款政策可以作为背景，不能覆盖渠道专属例外。法务争议档案不应仅因为语义相似就出现在 A 的结果中。

如果 A 直接调用同一个包含全公司文档的 Search Service，而该 Service 以拥有全量源表权限的角色运行，底层 Row Access Policy 并不能自动保护索引里的记录。应通过服务/索引授权域隔离，或者由受控后端代理检索。只有当访问边界经过负向测试，才可以把检索结果交给生成模型。

## 常见误区

- **把 Search Service 当成通用 RAG 应用。** 它负责检索服务，不负责业务事实校验、完整引用和人工审批。
- **只索引正文，不索引发布日期、版本、地区和文档类型。** 模型就难以区分当前规则与过期材料。
- **认为查询过滤等同于用户权限。** Cortex Search 使用 Owner’s Rights，底层行策略不会自动按调用用户执行。
- **让拥有全量权限的 Search Service 直接暴露给所有业务用户。** 应按授权域拆分服务或由可信后端控制服务访问和过滤。
- **把 Target Lag 当成准点刷新承诺。** 要检查实际 DATA_TIMESTAMP、Indexing 和 Serving 状态。
- **认为有 Primary Key 就一定刷新正确。** 主键必须唯一且为 TEXT；重复键会影响索引，定义变更要等待刷新生效。
- **检索命中就认为最终答案正确。** 仍需检查上下文、适用日期、引用片段和答案事实是否匹配。

## 完成标准

- [ ] 能从 source query 设计搜索正文、属性列和稳定主键。
- [ ] 能使用 ATTRIBUTES 构造地区、类型、发布日期等查询过滤条件。
- [ ] 能解释 Cortex Search Owner’s Rights 对源表 Row Access/Masking Policy 的影响。
- [ ] 能设计按授权域拆分索引/服务或可信后端代理检索。
- [ ] 能通过 Target Lag、DATA_TIMESTAMP 和 Indexing/Serving 状态监控新鲜度。
- [ ] 能分别评估检索召回、上下文构建和最终回答引用。

## 自测

1. Search Service 的 Owner Role 能读取所有地区文档，调用人只能读取东京地区源表。为什么不能假设 Search Service 也会自动只返回东京文档？
2. ATTRIBUTES 只能过滤创建服务时声明的列。若需要按地区、支付方式和政策生效日期筛选，创建服务时要准备什么？
3. Target Lag 设置为 5 分钟，是否保证用户看到的数据最多只落后 5 分钟？还要检查哪些状态？
4. 文档主键由 FILE_ID 改为 CHUNK_ID 后，为什么不能立即认为现有索引已经按新主键优化刷新？
5. 检索没有结果、检索服务无权限、索引未刷新和答案缺少引用，为什么要呈现为不同状态？

## 参考资料

- [CREATE CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search)
- [Query a Cortex Search Service](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service)
- [ALTER CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/alter-cortex-search)
- [DESCRIBE CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/desc-cortex-search)
