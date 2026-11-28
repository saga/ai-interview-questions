# Cortex Search、混合检索与 RAG 质量

## 本节要解决的问题

为企业文档建立可运维的检索服务，并让生成式答案受检索证据约束。RAG 的质量不仅取决于 embedding 模型，还取决于文档切分、字段设计、过滤权限、索引更新延迟、检索相关性和最终答案引用。

## 核心知识

### Cortex Search Service 将文本检索与服务维护托管化

Cortex Search Service 从一个 SQL 源查询构建索引。创建时指定搜索列、可返回的属性列、Warehouse、TARGET_LAG 和可选 Embedding Model。服务根据源表变化更新索引，TARGET_LAG 表示服务内容与源数据变化之间允许的最大滞后目标，不是严格的定时器或数据新鲜度 SLA。

ATTRIBUTES 列可以用于查询过滤，必须出现在源查询投影中。可将 tenant_id、document_type、region、department 和 effective_date 等字段作为过滤属性，但只有通过调用时的访问控制校验，才能确保不会跨租户泄漏数据。

### 检索结果需要文本、属性和业务键共同定位

文档管道应先提取文本，再按章节、标题或语义边界切分。每个 Chunk 至少关联 document_id、chunk_id、source_uri、page/section、更新时间、tenant_id 和权限标签。Chunk 过大容易混入无关上下文，过小则丢失限定条件；需要用真实查询样本评估。

Cortex Search 支持文本/向量检索能力，也可结合属性过滤。搜索列、属性列、Embedding Model 和索引刷新策略是服务定义的一部分。源数据变化要能定位到具体文档和 Chunk，删除文档时也要验证索引内容被正确清理。

### RAG 必须评估检索和生成两个阶段

检索质量可用 Recall@K、Precision@K、MRR 或人工相关性评估；生成质量要检查答案是否由证据支持、引用定位是否有效、问题无法回答时是否拒答，以及过滤条件是否与用户身份一致。只检查答案是否流畅不能证明有 grounding。

检索结果应携带可展示的来源信息，答案中每个关键事实都应能映射到检索片段或页码。对敏感资料，先实施行级/文档级授权过滤，再调用检索服务；不能依赖 LLM 自己决定用户是否能看到某个文档。

## 工程实施步骤

1. 划定知识源、文档权限、租户、更新频率和问答场景，确认是否适合全文搜索还是结构化 SQL。
2. 使用受控 Stage 接入原始文件；通过 AI_PARSE_DOCUMENT 或其他解析器生成文本、章节和页码定位。
3. 将文档切分为 Chunk，保留 document_id、chunk_id、source_uri、页码/标题、tenant_id、权限标签和更新时间。
4. 创建 Cortex Search Service，明确 search_column、ATTRIBUTES、Warehouse、TARGET_LAG 和 Embedding Model。
5. 选择稳定的主键列标识源查询行，评估主键对增量刷新路径的影响；检查服务创建和首次索引构建耗时。
6. 调用检索服务时传入身份对应的过滤条件，验证用户只能检索已授权租户和文档；服务本身的 USAGE 和底层源对象权限也应按官方规则配置。
7. 用独立问题集评估 Recall@K、Precision@K、排序质量和过滤正确性；对低召回问题调整分块、搜索列、属性或查询参数。
8. 将 Top-K 片段、来源定位和检索分数提供给生成模型，要求答案区分证据、推断和未知信息。
9. 用人工标注样本评估引用准确率、unsupported claim、拒答率、延迟、刷新延迟和成本。
10. 更新/删除文档后观察 TARGET_LAG、服务刷新状态和查询结果，确保知识库变更能及时反映。

示例：

~~~sql
CREATE OR REPLACE CORTEX SEARCH SERVICE DOC_SEARCH
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
    REGION
  FROM MART.DOCUMENT_CHUNKS;
~~~

实际服务应基于查询身份构造安全过滤条件，并按当前 Cortex Search Query API 的请求格式调用；不要把任意用户传入的 tenant_id 当作可信授权凭证。

## 场景分析

客服团队要查询订单政策和退款规则。文档分属日本和新加坡业务，部分政策仅限内部主管访问。普通员工不能检索主管政策，即使他知道文件标题也不应得到内容。

在索引行中保留区域、文档类别和访问标签；检索前由后端根据已验证的用户身份计算过滤条件，不能由浏览器任意指定。答案返回时保留文档标题、章节和更新时间。若知识政策刚更新，要观察服务实际 lag；在索引更新完成前，应明确提示可能存在短暂延迟或切换到已验证版本。

验收使用员工、主管、跨区域用户和匿名用户四组身份测试检索过滤，再用一组无法回答的问题检查模型是否拒答。对引用逐条核对原文，防止模型引用了相似但不支持答案的片段。

## 常见误区

- 认为创建 Search Service 就自动完成整个 RAG。还需要解析、切块、权限、生成、引用和质量评估。
- 把 TARGET_LAG 当作每十分钟必定刷新。它是最大滞后目标，不是硬性的刷新调度承诺。
- 只用 embedding 相似度衡量检索。需要测试关键字、专有名词、过滤字段和混合查询效果。
- 把 tenant_id 过滤交给用户自由输入。必须由可信服务端身份和授权策略决定。
- 只测生成答案是否通顺。检索召回、引用正确性、拒答和 unsupported claim 都要独立评测。
- 文档删除后不验证索引。应确认服务刷新后旧 Chunk 不再可被检索。

## 完成标准

- [ ] 能说明 Cortex Search Service 的 search_column、ATTRIBUTES、TARGET_LAG 和 Warehouse。
- [ ] 能设计保留来源定位和权限字段的 Chunk 数据模型。
- [ ] 能区分检索召回、过滤正确性和生成 groundedness。
- [ ] 能设计用户身份驱动的服务端访问过滤。
- [ ] 能对文档更新、删除、引用和拒答建立可重复评估。

## 自测

1. TARGET_LAG 设置为十分钟，为什么仍需要监控索引实际刷新情况？
2. tenant_id 被放在 ATTRIBUTES 中是否就等于实现了租户隔离？还缺少什么安全控制？
3. 检索召回正确，但模型在答案中引用了不支持结论的片段，应在哪个阶段发现并治理？
4. 删除某文档后，怎样验证旧 Chunk 不再返回给消费者？

## 参考资料

- [Cortex Search overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [CREATE CORTEX SEARCH SERVICE](https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search)
- [SHOW CORTEX SEARCH SERVICES](https://docs.snowflake.com/en/sql-reference/sql/show-cortex-search)
- [Parsing documents with AI_PARSE_DOCUMENT](https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document)
