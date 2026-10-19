# SnowPro Core COF-C03 考点映射与新增 200 道题

**整理日期：** 2026-10-19  
**目的：** 参考 Snowflake 官方 COF-C03 考试指南与公开的 “Free Snowflake Certification Practice Questions” 目录结构，结合现有 8 门 Coursera 课程和 Snowflake 官方文档，补足简明的认证基础题。  
**题目版权边界：** 本批题目为自行编写的中文练习题。第三方练习题仅用来识别覆盖的考试领域与知识点，不复制其题干、选项或答案。

## 1. 来源与考试权重

- 官方考试指南（版本日期 2026-07-08）：[SnowPro Core COF-C03 Exam Study Guide](https://publish-p93462-e887935.adobeaemcloud.com/content/dam/snowpro-sg/SnowProCoreStudyGuideC03.pdf)
- 公开练习题参考：[Free Snowflake SnowPro Core Certification (COF-C03) Sample Questions — CertSafari](https://www.certsafari.com/snowflake/snowpro-core-certification-c03/practice-questions)。页面说明其公开样题覆盖五个考试 Domain，并将题库与官方 Study Guide 对齐；它不是 Snowflake 官方试题来源。
- 官方学习路径：[Snowflake Northstar Education Program](https://www.snowflake.com/en/developers/northstar/)，用于理解架构、数据管道、治理和协作的课程方向。

官方 COF-C03 指南列出的领域权重为 Domain 1：31%，Domain 2：20%，Domain 3：18%，Domain 4：21%，Domain 5：10%。本批 200 道题按精确比例分配为 62/40/36/42/20。

| 官方考试 Domain | 官方权重 | 本批题量 | 占本批比例 |
|---|---:|---:|---:|
| 1. Snowflake AI Data Cloud Features and Architecture | 31% | 62 | 31% |
| 2. Account Management and Data Governance | 20% | 40 | 20% |
| 3. Data Loading, Unloading, and Connectivity | 18% | 36 | 18% |
| 4. Performance Optimization, Querying, and Transformation | 21% | 42 | 21% |
| 5. Data Collaboration | 10% | 20 | 10% |
| **合计** | **100%** | **200** | **100%** |

难度分布：**120 道简单题、80 道中等题、0 道困难题**。题目主要考查基础定义、功能用途、概念区分、常见配置和第一步排查，不刻意设置绕弯的多步骤推理。

## 2. 与 8 门 Coursera 课程的关系

本批仍使用独立 `courseId=snowflake`。每道题都有一个主要 Coursera 模块来源，并通过官方考试 Domain/Objective 标签定位到 COF-C03；Snowflake 产品行为以官方文档为准。课程与考点有交集的地方用于建立学习路径，不意味着课程中的每个产品都一定是该考试明确列出的考点。

特别说明：Snowflake CoCo 是第八门课程的学习主题，但官方 COF-C03 指南没有单独列出 CoCo 产品。本批与 CoCo 相关的内容仅作为应用开发/工具实践补充，已在矩阵中明确标识为“课程补充”，不要将其解释成指南确认会考的独立目标。

## 3. 每道题的内容与覆盖映射

每个知识点通常包含 5 道直白题，少数基础点因权重分配是 4 道，另有 3 个重点考点补足到 6 道。所有题均为单选题，同时具备开放题参考答案、误解映射、课程模块引用、官方 Domain/Objective 标记及官方文档引用。

| Domain | 官方 Objective | Coursera 课程 | 课程模块/主题 | Knowledge ID | 知识点 | Question IDs | 官方文档 ID |
|---:|---|---|---|---|---|---|---|
| 1 | 1.1 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Core objects and architecture | `snowflake-architecture` | Snowflake 平台架构 | `sf-cof-c03-200-snowflake-architecture-01`, `sf-cof-c03-200-snowflake-architecture-02`, `sf-cof-c03-200-snowflake-architecture-03`, `sf-cof-c03-200-snowflake-architecture-04`, `sf-cof-c03-200-snowflake-architecture-05` | `docs-snowflake-architecture` |
| 1 | 1.3 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Core objects and architecture | `snowflake-core-objects` | Snowflake 对象层级与对象用途 | `sf-cof-c03-200-snowflake-core-objects-01`, `sf-cof-c03-200-snowflake-core-objects-02`, `sf-cof-c03-200-snowflake-core-objects-03`, `sf-cof-c03-200-snowflake-core-objects-04`, `sf-cof-c03-200-snowflake-core-objects-05` | `docs-snowflake-architecture`, `docs-access-control` |
| 1 | 1.2 | Advanced Data Engineering with Snowflake | DevOps with Snowflake | `snowflake-cli-deploy-basics` | Snowsight、Snowflake CLI 与 IDE 工具 | `sf-cof-c03-200-snowflake-cli-deploy-basics-01`, `sf-cof-c03-200-snowflake-cli-deploy-basics-02`, `sf-cof-c03-200-snowflake-cli-deploy-basics-03`, `sf-cof-c03-200-snowflake-cli-deploy-basics-04`, `sf-cof-c03-200-snowflake-cli-deploy-basics-05` | `docs-cli` |
| 1 | 1.1 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Core objects and architecture | `snowflake-editions-basics` | Snowflake Edition 与功能可用性 | `sf-cof-c03-200-snowflake-editions-basics-01`, `sf-cof-c03-200-snowflake-editions-basics-02`, `sf-cof-c03-200-snowflake-editions-basics-03`, `sf-cof-c03-200-snowflake-editions-basics-04` | `docs-snowflake-editions` |
| 1 | 1.4 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Core objects and architecture | `virtual-warehouse` | 虚拟仓库与计算资源 | `sf-cof-c03-200-virtual-warehouse-01`, `sf-cof-c03-200-virtual-warehouse-02`, `sf-cof-c03-200-virtual-warehouse-03`, `sf-cof-c03-200-virtual-warehouse-04`, `sf-cof-c03-200-virtual-warehouse-05` | `docs-warehouses` |
| 1 | 1.4 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Core objects and architecture | `snowflake-warehouse-configurations` | 仓库规模、扩缩容与自动暂停 | `sf-cof-c03-200-snowflake-warehouse-configurations-02`, `sf-cof-c03-200-snowflake-warehouse-configurations-03`, `sf-cof-c03-200-snowflake-warehouse-configurations-04`, `sf-cof-c03-200-snowflake-warehouse-configurations-05` | `docs-warehouses`, `docs-warehouses-cost` |
| 1 | 1.5 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Querying and storage basics | `snowflake-micro-partitions` | 微分区与数据聚簇基础 | `sf-cof-c03-200-snowflake-micro-partitions-01`, `sf-cof-c03-200-snowflake-micro-partitions-02`, `sf-cof-c03-200-snowflake-micro-partitions-03`, `sf-cof-c03-200-snowflake-micro-partitions-04`, `sf-cof-c03-200-snowflake-micro-partitions-05` | `docs-snowflake-architecture`, `docs-clustering` |
| 1 | 1.5 | Apache Iceberg: From Zero to Production Data Lakehouse | Apache Iceberg fundamentals | `snowflake-table-types` | Permanent、Temporary、Transient 与 Iceberg 表 | `sf-cof-c03-200-snowflake-table-types-01`, `sf-cof-c03-200-snowflake-table-types-02`, `sf-cof-c03-200-snowflake-table-types-03`, `sf-cof-c03-200-snowflake-table-types-04`, `sf-cof-c03-200-snowflake-table-types-05` | `docs-table-types`, `docs-iceberg` |
| 1 | 1.5 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Advanced data objects and recovery | `snowflake-view-types` | Standard、Secure 与 Materialized View | `sf-cof-c03-200-snowflake-view-types-01`, `sf-cof-c03-200-snowflake-view-types-02`, `sf-cof-c03-200-snowflake-view-types-03`, `sf-cof-c03-200-snowflake-view-types-04`, `sf-cof-c03-200-snowflake-view-types-05` | `docs-view-types`, `docs-materialized-views` |
| 1 | 1.3 | Advanced Data Engineering with Snowflake | Database change management and declarative object management | `snowflake-session-context-parameters` | Session、Context 与参数优先级 | `sf-cof-c03-200-snowflake-session-context-parameters-01`, `sf-cof-c03-200-snowflake-session-context-parameters-02`, `sf-cof-c03-200-snowflake-session-context-parameters-03`, `sf-cof-c03-200-snowflake-session-context-parameters-05` | `docs-session-parameters` |
| 1 | 1.6 | Introduction to Generative AI with Snowflake | Cortex LLM functions and model selection | `snowflake-application-ai-features` | Snowpark、Notebooks、Streamlit、Cortex 与 ML | `sf-cof-c03-200-snowflake-application-ai-features-01`, `sf-cof-c03-200-snowflake-application-ai-features-02`, `sf-cof-c03-200-snowflake-application-ai-features-03`, `sf-cof-c03-200-snowflake-application-ai-features-04`, `sf-cof-c03-200-snowflake-application-ai-features-05` | `docs-snowpark`, `docs-notebooks`, `docs-streamlit`, `docs-cortex-functions`, `docs-cortex-search`, `docs-cortex-analyst`, `docs-snowflake-ml` |
| 1 | 1.3 | Introduction to Modern Data Engineering with Snowflake | Transforming data with SQL and Snowpark | `snowflake-object-functions-procedures-pipes` | UDF、Stored Procedure 与 Pipe 的用途 | `sf-cof-c03-200-snowflake-object-functions-procedures-pipes-01`, `sf-cof-c03-200-snowflake-object-functions-procedures-pipes-02`, `sf-cof-c03-200-snowflake-object-functions-procedures-pipes-03`, `sf-cof-c03-200-snowflake-object-functions-procedures-pipes-04`, `sf-cof-c03-200-snowflake-object-functions-procedures-pipes-05` | `docs-user-defined-functions`, `docs-stored-procedures`, `docs-snowpipe` |
| 1 | 1.6-adjacent（课程补充） | Snowflake CoCo Essentials | Building with Snowflake CoCo | `snowflake-coco-development-assistance` | CoCo 辅助开发的基本工作流 | `sf-cof-c03-200-snowflake-coco-development-assistance-01`, `sf-cof-c03-200-snowflake-coco-development-assistance-02`, `sf-cof-c03-200-snowflake-coco-development-assistance-03`, `sf-cof-c03-200-snowflake-coco-development-assistance-04`, `sf-cof-c03-200-snowflake-coco-development-assistance-05` | `docs-coco`, `docs-query-profile` |
| 2 | 2.1 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Core objects and access governance | `object-access-governance` | 对象权限与 RBAC 基础 | `sf-cof-c03-200-object-access-governance-01`, `sf-cof-c03-200-object-access-governance-02`, `sf-cof-c03-200-object-access-governance-03`, `sf-cof-c03-200-object-access-governance-04`, `sf-cof-c03-200-object-access-governance-05` | `docs-access-control` |
| 2 | 2.2 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Core objects and access governance | `data-governance-access-control` | 数据访问治理：行级、列级与掩码 | `sf-cof-c03-200-data-governance-access-control-01`, `sf-cof-c03-200-data-governance-access-control-02`, `sf-cof-c03-200-data-governance-access-control-03`, `sf-cof-c03-200-data-governance-access-control-04`, `sf-cof-c03-200-data-governance-access-control-05` | `docs-masking-policies`, `docs-row-policies` |
| 2 | 2.3 | Advanced Data Engineering with Snowflake | Core architecture and warehouse workload isolation | `warehouse-cost-optimization` | 仓库用量与成本基础 | `sf-cof-c03-200-warehouse-cost-optimization-01`, `sf-cof-c03-200-warehouse-cost-optimization-02`, `sf-cof-c03-200-warehouse-cost-optimization-03`, `sf-cof-c03-200-warehouse-cost-optimization-04`, `sf-cof-c03-200-warehouse-cost-optimization-05` | `docs-warehouses`, `docs-warehouses-cost` |
| 2 | 2.2 | Advanced Data Engineering with Snowflake | Observability with Snowflake | `data-observability-lineage` | 数据血缘、日志与运行记录 | `sf-cof-c03-200-data-observability-lineage-01`, `sf-cof-c03-200-data-observability-lineage-02`, `sf-cof-c03-200-data-observability-lineage-03`, `sf-cof-c03-200-data-observability-lineage-04`, `sf-cof-c03-200-data-observability-lineage-05` | `docs-lineage`, `docs-account-usage` |
| 2 | 2.1 | Building AI Agents with Snowflake | Agent monitoring and Model Context Protocol | `snowflake-authentication-methods` | MFA、SSO、OAuth 与 Key-pair 认证 | `sf-cof-c03-200-snowflake-authentication-methods-01`, `sf-cof-c03-200-snowflake-authentication-methods-02`, `sf-cof-c03-200-snowflake-authentication-methods-03`, `sf-cof-c03-200-snowflake-authentication-methods-04`, `sf-cof-c03-200-snowflake-authentication-methods-05` | `docs-authentication`, `docs-network-policies` |
| 2 | 2.1 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Core objects and access governance | `snowflake-role-hierarchy-grants` | 系统角色、自定义角色与授权层级 | `sf-cof-c03-200-snowflake-role-hierarchy-grants-01`, `sf-cof-c03-200-snowflake-role-hierarchy-grants-02`, `sf-cof-c03-200-snowflake-role-hierarchy-grants-03`, `sf-cof-c03-200-snowflake-role-hierarchy-grants-04`, `sf-cof-c03-200-snowflake-role-hierarchy-grants-05` | `docs-access-control` |
| 2 | 2.2 | Advanced Data Engineering with Snowflake | Data governance and monitoring | `snowflake-masking-tagging-policies` | 掩码策略、对象标签与数据分类 | `sf-cof-c03-200-snowflake-masking-tagging-policies-01`, `sf-cof-c03-200-snowflake-masking-tagging-policies-02`, `sf-cof-c03-200-snowflake-masking-tagging-policies-03`, `sf-cof-c03-200-snowflake-masking-tagging-policies-04`, `sf-cof-c03-200-snowflake-masking-tagging-policies-05` | `docs-masking-policies`, `docs-tagging`, `docs-row-policies` |
| 2 | 2.3 | Advanced Data Engineering with Snowflake | Observability with Snowflake | `snowflake-resource-monitoring-account-usage` | Resource Monitor 与 ACCOUNT_USAGE | `sf-cof-c03-200-snowflake-resource-monitoring-account-usage-01`, `sf-cof-c03-200-snowflake-resource-monitoring-account-usage-02`, `sf-cof-c03-200-snowflake-resource-monitoring-account-usage-03`, `sf-cof-c03-200-snowflake-resource-monitoring-account-usage-04`, `sf-cof-c03-200-snowflake-resource-monitoring-account-usage-05` | `docs-resource-monitors`, `docs-account-usage`, `docs-warehouses-cost` |
| 3 | 3.1 | Introduction to Modern Data Engineering with Snowflake | Ingesting data at scale | `snowflake-data-loading` | COPY INTO 批量加载 | `sf-cof-c03-200-snowflake-data-loading-01`, `sf-cof-c03-200-snowflake-data-loading-02`, `sf-cof-c03-200-snowflake-data-loading-03`, `sf-cof-c03-200-snowflake-data-loading-04`, `sf-cof-c03-200-snowflake-data-loading-05` | `docs-data-loading`, `docs-copy-into` |
| 3 | 3.1 | Introduction to Modern Data Engineering with Snowflake | Ingesting data at scale | `snowflake-stages-file-formats` | Internal/External Stage 与 File Format | `sf-cof-c03-200-snowflake-stages-file-formats-01`, `sf-cof-c03-200-snowflake-stages-file-formats-02`, `sf-cof-c03-200-snowflake-stages-file-formats-03`, `sf-cof-c03-200-snowflake-stages-file-formats-04`, `sf-cof-c03-200-snowflake-stages-file-formats-05` | `docs-data-loading` |
| 3 | 3.2 | Introduction to Modern Data Engineering with Snowflake | Ingestion options and continuous pipelines | `snowpipe-streaming` | Snowpipe Streaming 行级摄取 | `sf-cof-c03-200-snowpipe-streaming-01`, `sf-cof-c03-200-snowpipe-streaming-02`, `sf-cof-c03-200-snowpipe-streaming-03`, `sf-cof-c03-200-snowpipe-streaming-04`, `sf-cof-c03-200-snowpipe-streaming-05` | `docs-snowpipe-streaming` |
| 3 | 3.2 | Introduction to Modern Data Engineering with Snowflake | Ingestion options and continuous pipelines | `snowpipe-file-ingestion` | Snowpipe 文件自动摄取 | `sf-cof-c03-200-snowpipe-file-ingestion-01`, `sf-cof-c03-200-snowpipe-file-ingestion-02`, `sf-cof-c03-200-snowpipe-file-ingestion-03`, `sf-cof-c03-200-snowpipe-file-ingestion-04`, `sf-cof-c03-200-snowpipe-file-ingestion-05` | `docs-snowpipe`, `docs-data-loading` |
| 3 | 3.1 | Introduction to Modern Data Engineering with Snowflake | Ingesting data at scale | `copy-into-file-format-validation` | COPY INTO 错误处理与数据验证 | `sf-cof-c03-200-copy-into-file-format-validation-01`, `sf-cof-c03-200-copy-into-file-format-validation-02`, `sf-cof-c03-200-copy-into-file-format-validation-03`, `sf-cof-c03-200-copy-into-file-format-validation-04`, `sf-cof-c03-200-copy-into-file-format-validation-05`, `sf-cof-c03-200-copy-into-file-format-validation-06` | `docs-copy-into`, `docs-data-loading` |
| 3 | 3.3 | Advanced Data Engineering with Snowflake | DevOps with Snowflake | `snowflake-connectors-integrations` | Snowflake 驱动、Connector 与 Integration | `sf-cof-c03-200-snowflake-connectors-integrations-01`, `sf-cof-c03-200-snowflake-connectors-integrations-02`, `sf-cof-c03-200-snowflake-connectors-integrations-03`, `sf-cof-c03-200-snowflake-connectors-integrations-04`, `sf-cof-c03-200-snowflake-connectors-integrations-05` | `docs-connectors`, `docs-storage-integration`, `docs-api-integration` |
| 3 | 3.1 | Introduction to Modern Data Engineering with Snowflake | Delivering data products | `snowflake-data-unloading` | COPY INTO 导出与数据卸载 | `sf-cof-c03-200-snowflake-data-unloading-01`, `sf-cof-c03-200-snowflake-data-unloading-02`, `sf-cof-c03-200-snowflake-data-unloading-03`, `sf-cof-c03-200-snowflake-data-unloading-04`, `sf-cof-c03-200-snowflake-data-unloading-05` | `docs-unload` |
| 4 | 4.4 | Introduction to Modern Data Engineering with Snowflake | Transforming data with SQL and Snowpark | `semi-structured-data` | VARIANT 与半结构化数据 | `sf-cof-c03-200-semi-structured-data-01`, `sf-cof-c03-200-semi-structured-data-02`, `sf-cof-c03-200-semi-structured-data-03`, `sf-cof-c03-200-semi-structured-data-04`, `sf-cof-c03-200-semi-structured-data-05` | `docs-semi-structured` |
| 4 | 4.4 | Introduction to Modern Data Engineering with Snowflake | Transforming data with SQL and Snowpark | `sql-transformations-basics` | 过滤、Join、聚合与基础 SQL 转换 | `sf-cof-c03-200-sql-transformations-basics-01`, `sf-cof-c03-200-sql-transformations-basics-02`, `sf-cof-c03-200-sql-transformations-basics-03`, `sf-cof-c03-200-sql-transformations-basics-04`, `sf-cof-c03-200-sql-transformations-basics-05` | `docs-snowflake-architecture` |
| 4 | 4.4 | Introduction to Modern Data Engineering with Snowflake | Transforming data with SQL and Snowpark | `dynamic-tables` | Dynamic Tables 与刷新新鲜度 | `sf-cof-c03-200-dynamic-tables-01`, `sf-cof-c03-200-dynamic-tables-02`, `sf-cof-c03-200-dynamic-tables-03`, `sf-cof-c03-200-dynamic-tables-04`, `sf-cof-c03-200-dynamic-tables-05` | `docs-dynamic-tables`, `docs-dynamic-tables-decision` |
| 4 | 4.1 | Advanced Data Engineering with Snowflake | Pipeline health and performance monitoring | `warehouse-query-diagnostics` | Query Profile 基础诊断 | `sf-cof-c03-200-warehouse-query-diagnostics-01`, `sf-cof-c03-200-warehouse-query-diagnostics-02`, `sf-cof-c03-200-warehouse-query-diagnostics-03`, `sf-cof-c03-200-warehouse-query-diagnostics-04`, `sf-cof-c03-200-warehouse-query-diagnostics-05` | `docs-query-profile`, `docs-warehouses` |
| 4 | 4.1 | Advanced Data Engineering with Snowflake | Observability with Snowflake | `snowflake-query-history` | Query History 与 ACCOUNT_USAGE 查询记录 | `sf-cof-c03-200-snowflake-query-history-01`, `sf-cof-c03-200-snowflake-query-history-02`, `sf-cof-c03-200-snowflake-query-history-03`, `sf-cof-c03-200-snowflake-query-history-04`, `sf-cof-c03-200-snowflake-query-history-05` | `docs-query-history`, `docs-account-usage` |
| 4 | 4.4 | Building Generative AI Apps to Talk to Your Data | Semantic model and Cortex Analyst | `dimensional-modeling` | 聚合、窗口函数与连接粒度 | `sf-cof-c03-200-dimensional-modeling-01`, `sf-cof-c03-200-dimensional-modeling-02`, `sf-cof-c03-200-dimensional-modeling-03`, `sf-cof-c03-200-dimensional-modeling-04`, `sf-cof-c03-200-dimensional-modeling-05` | `docs-window-functions`, `docs-semantic-views` |
| 4 | 4.3 | Advanced Data Engineering with Snowflake | Pipeline health and performance monitoring | `snowflake-caching` | Query Result、Metadata 与 Warehouse Cache | `sf-cof-c03-200-snowflake-caching-01`, `sf-cof-c03-200-snowflake-caching-02`, `sf-cof-c03-200-snowflake-caching-03`, `sf-cof-c03-200-snowflake-caching-04`, `sf-cof-c03-200-snowflake-caching-05`, `sf-cof-c03-200-snowflake-caching-06` | `docs-result-cache`, `docs-caching` |
| 4 | 4.2 | Advanced Data Engineering with Snowflake | Pipeline health and performance monitoring | `snowflake-query-optimization-services` | Clustering、Search Optimization、Query Acceleration 与 Materialized View | `sf-cof-c03-200-snowflake-query-optimization-services-01`, `sf-cof-c03-200-snowflake-query-optimization-services-02`, `sf-cof-c03-200-snowflake-query-optimization-services-03`, `sf-cof-c03-200-snowflake-query-optimization-services-04`, `sf-cof-c03-200-snowflake-query-optimization-services-05`, `sf-cof-c03-200-snowflake-query-optimization-services-06` | `docs-clustering`, `docs-search-optimization`, `docs-query-acceleration`, `docs-materialized-views` |
| 5 | 5.1 | Intro to Snowflake for Devs, Data Scientists, Data Engineers | Advanced data objects and recovery | `time-travel-cloning` | Time Travel、Zero-Copy Cloning 与 Fail-safe | `sf-cof-c03-200-time-travel-cloning-01`, `sf-cof-c03-200-time-travel-cloning-02`, `sf-cof-c03-200-time-travel-cloning-03`, `sf-cof-c03-200-time-travel-cloning-04`, `sf-cof-c03-200-time-travel-cloning-05` | `docs-time-travel`, `docs-cloning`, `docs-failsafe` |
| 5 | 5.2 | Introduction to Modern Data Engineering with Snowflake | Delivering data products | `snowflake-data-products` | 数据共享与数据产品交付 | `sf-cof-c03-200-snowflake-data-products-01`, `sf-cof-c03-200-snowflake-data-products-02`, `sf-cof-c03-200-snowflake-data-products-03`, `sf-cof-c03-200-snowflake-data-products-04`, `sf-cof-c03-200-snowflake-data-products-05` | `docs-data-sharing`, `docs-marketplace` |
| 5 | 5.2 | Introduction to Modern Data Engineering with Snowflake | Delivering data products | `snowflake-data-sharing-reader-accounts` | Provider、Consumer、Share 与 Reader Account | `sf-cof-c03-200-snowflake-data-sharing-reader-accounts-01`, `sf-cof-c03-200-snowflake-data-sharing-reader-accounts-02`, `sf-cof-c03-200-snowflake-data-sharing-reader-accounts-03`, `sf-cof-c03-200-snowflake-data-sharing-reader-accounts-04`, `sf-cof-c03-200-snowflake-data-sharing-reader-accounts-05` | `docs-data-sharing`, `docs-reader-accounts` |
| 5 | 5.3 | Introduction to Modern Data Engineering with Snowflake | Delivering data products | `snowflake-marketplace-native-apps` | Marketplace Listing、Clean Rooms 与 Native Apps | `sf-cof-c03-200-snowflake-marketplace-native-apps-01`, `sf-cof-c03-200-snowflake-marketplace-native-apps-02`, `sf-cof-c03-200-snowflake-marketplace-native-apps-03`, `sf-cof-c03-200-snowflake-marketplace-native-apps-04`, `sf-cof-c03-200-snowflake-marketplace-native-apps-05` | `docs-marketplace`, `docs-clean-rooms`, `docs-native-apps` |

## 4. 文档与参考源目录

| Source ID | 参考链接 | 来源性质 |
|---|---|---|
| `docs-snowflake-architecture` | [Snowflake 核心概念与架构](https://docs.snowflake.com/en/user-guide/intro-key-concepts) | 官方来源/官方文档 |
| `exam-snowpro-core-cof-c03` | [SnowPro Core COF-C03 官方考试指南（2026-07-08）](https://publish-p93462-e887935.adobeaemcloud.com/content/dam/snowpro-sg/SnowProCoreStudyGuideC03.pdf) | 官方来源/官方文档 |
| `practice-certsafari-cof-c03` | [CertSafari：Free Snowflake SnowPro Core COF-C03 Practice Questions](https://www.certsafari.com/snowflake/snowpro-core-certification-c03/practice-questions) | 第三方练习题考点参考，不是官方试题 |
| `docs-access-control` | [访问控制概览](https://docs.snowflake.com/en/user-guide/security-access-control-overview) | 官方来源/官方文档 |
| `docs-cli` | [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/index) | 官方来源/官方文档 |
| `docs-snowflake-editions` | [Snowflake editions](https://docs.snowflake.com/en/user-guide/intro-editions) | 官方来源/官方文档 |
| `docs-warehouses` | [虚拟仓库](https://docs.snowflake.com/en/user-guide/warehouses) | 官方来源/官方文档 |
| `docs-warehouses-cost` | [成本控制](https://docs.snowflake.com/en/user-guide/cost-controlling-controls) | 官方来源/官方文档 |
| `docs-clustering` | [Clustering keys](https://docs.snowflake.com/en/user-guide/tables-clustering-keys) | 官方来源/官方文档 |
| `docs-table-types` | [Temporary and transient tables](https://docs.snowflake.com/en/user-guide/tables-temp-transient) | 官方来源/官方文档 |
| `docs-iceberg` | [Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg) | 官方来源/官方文档 |
| `docs-view-types` | [Views](https://docs.snowflake.com/en/user-guide/views-introduction) | 官方来源/官方文档 |
| `docs-materialized-views` | [Materialized views](https://docs.snowflake.com/en/user-guide/views-materialized) | 官方来源/官方文档 |
| `docs-session-parameters` | [Session and account parameters](https://docs.snowflake.com/en/sql-reference/parameters) | 官方来源/官方文档 |
| `docs-snowpark` | [Snowpark](https://docs.snowflake.com/en/developer-guide/snowpark/index) | 官方来源/官方文档 |
| `docs-notebooks` | [Snowsight Notebooks](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks) | 官方来源/官方文档 |
| `docs-streamlit` | [Streamlit in Snowflake](https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit) | 官方来源/官方文档 |
| `docs-cortex-functions` | [Cortex LLM functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/llm-functions) | 官方来源/官方文档 |
| `docs-cortex-search` | [Cortex Search](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview) | 官方来源/官方文档 |
| `docs-cortex-analyst` | [Cortex Analyst](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst) | 官方来源/官方文档 |
| `docs-snowflake-ml` | [Snowflake ML](https://docs.snowflake.com/en/developer-guide/snowpark-ml/index) | 官方来源/官方文档 |
| `docs-user-defined-functions` | [User-defined functions](https://docs.snowflake.com/en/developer-guide/udf/intro) | 官方来源/官方文档 |
| `docs-stored-procedures` | [Stored procedures](https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-overview) | 官方来源/官方文档 |
| `docs-snowpipe` | [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro) | 官方来源/官方文档 |
| `docs-coco` | [Snowflake CoCo 文档入口](https://docs.snowflake.com/en/search?q=CoCo) | 官方来源/官方文档 |
| `docs-query-profile` | [Query Profile](https://docs.snowflake.com/en/user-guide/ui-query-profile) | 官方来源/官方文档 |
| `docs-masking-policies` | [动态数据脱敏](https://docs.snowflake.com/en/user-guide/security-column-ddm-intro) | 官方来源/官方文档 |
| `docs-row-policies` | [Row access policies](https://docs.snowflake.com/en/user-guide/security-row-intro) | 官方来源/官方文档 |
| `docs-lineage` | [数据血缘与访问历史](https://docs.snowflake.com/en/user-guide/ui-snowsight-lineage) | 官方来源/官方文档 |
| `docs-account-usage` | [ACCOUNT_USAGE schema](https://docs.snowflake.com/en/sql-reference/account-usage) | 官方来源/官方文档 |
| `docs-authentication` | [多因素认证](https://docs.snowflake.com/en/user-guide/security-mfa) | 官方来源/官方文档 |
| `docs-network-policies` | [Network policies](https://docs.snowflake.com/en/user-guide/network-policies) | 官方来源/官方文档 |
| `docs-tagging` | [对象标记](https://docs.snowflake.com/en/user-guide/object-tagging) | 官方来源/官方文档 |
| `docs-resource-monitors` | [Resource monitors](https://docs.snowflake.com/en/user-guide/resource-monitors) | 官方来源/官方文档 |
| `docs-data-loading` | [数据加载概览](https://docs.snowflake.com/en/user-guide/data-load-overview) | 官方来源/官方文档 |
| `docs-copy-into` | [COPY INTO table](https://docs.snowflake.com/en/sql-reference/sql/copy-into-table) | 官方来源/官方文档 |
| `docs-snowpipe-streaming` | [Snowpipe Streaming](https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview) | 官方来源/官方文档 |
| `docs-connectors` | [Snowflake drivers and connectors](https://docs.snowflake.com/en/developer-guide/drivers) | 官方来源/官方文档 |
| `docs-storage-integration` | [Storage integration](https://docs.snowflake.com/en/sql-reference/sql/create-storage-integration) | 官方来源/官方文档 |
| `docs-api-integration` | [API integration](https://docs.snowflake.com/en/sql-reference/sql/create-api-integration) | 官方来源/官方文档 |
| `docs-unload` | [数据卸载概览](https://docs.snowflake.com/en/user-guide/data-unload-overview) | 官方来源/官方文档 |
| `docs-semi-structured` | [Semi-structured data](https://docs.snowflake.com/en/user-guide/semistructured-concepts) | 官方来源/官方文档 |
| `docs-dynamic-tables` | [Dynamic Tables 概览](https://docs.snowflake.com/en/user-guide/dynamic-tables/overview) | 官方来源/官方文档 |
| `docs-dynamic-tables-decision` | [Dynamic Tables 选择指南](https://docs.snowflake.com/en/user-guide/dynamic-tables/decision-guide) | 官方来源/官方文档 |
| `docs-query-history` | [Query history](https://docs.snowflake.com/en/user-guide/ui-query-history) | 官方来源/官方文档 |
| `docs-window-functions` | [Window functions](https://docs.snowflake.com/en/sql-reference/functions-analytic) | 官方来源/官方文档 |
| `docs-semantic-views` | [Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/creating) | 官方来源/官方文档 |
| `docs-result-cache` | [Persisted query results](https://docs.snowflake.com/en/user-guide/querying-persisted-results) | 官方来源/官方文档 |
| `docs-caching` | [Warehouse cache](https://docs.snowflake.com/en/user-guide/performance-query-warehouse-cache) | 官方来源/官方文档 |
| `docs-search-optimization` | [Search Optimization Service](https://docs.snowflake.com/en/user-guide/search-optimization-service) | 官方来源/官方文档 |
| `docs-query-acceleration` | [Query Acceleration Service](https://docs.snowflake.com/en/user-guide/query-acceleration-service) | 官方来源/官方文档 |
| `docs-time-travel` | [Time Travel](https://docs.snowflake.com/en/user-guide/data-time-travel) | 官方来源/官方文档 |
| `docs-cloning` | [对象克隆](https://docs.snowflake.com/en/user-guide/object-clone) | 官方来源/官方文档 |
| `docs-failsafe` | [Fail-safe](https://docs.snowflake.com/en/user-guide/data-failsafe) | 官方来源/官方文档 |
| `docs-data-sharing` | [Secure Data Sharing](https://docs.snowflake.com/en/user-guide/data-sharing-intro) | 官方来源/官方文档 |
| `docs-marketplace` | [Provider listings and Marketplace](https://docs.snowflake.com/en/collaboration/provider-listings-about) | 官方来源/官方文档 |
| `docs-reader-accounts` | [Reader accounts](https://docs.snowflake.com/en/user-guide/data-sharing-reader-create) | 官方来源/官方文档 |
| `docs-clean-rooms` | [Snowflake Data Clean Rooms](https://docs.snowflake.com/en/user-guide/cleanrooms-intro) | 官方来源/官方文档 |
| `docs-native-apps` | [Native Apps 概览](https://docs.snowflake.com/en/developer-guide/native-apps/native-apps-about) | 官方来源/官方文档 |

## 5. 文件位置

- 新增题目：`src/data/questions/snowflake-cof-c03-200.json`
- 新增知识点：`src/data/knowledge/snowflake-cof-c03-expansion.json`
- 逐题与考试 Domain 映射：`docs/snowflake-certification-cof-c03-coverage-200.md`

此矩阵用于定位学习内容和覆盖差距，不声称复现实际考试题目或保证官方考试命中率。
