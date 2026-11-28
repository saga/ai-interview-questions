export type LearningArticleKind = 'core' | 'deep-dive' | 'case-study';
export type LearningArticleLevel = 'foundation' | 'intermediate' | 'advanced';
export type LearningReferenceKind = 'official' | 'paper' | 'standard' | 'engineering' | 'case' | 'book';

export interface LearningArticle {
  id: string;
  title: string;
  kind: LearningArticleKind;
  level: LearningArticleLevel;
  estimatedMinutes: number;
  content: string;
}

export interface LearningReference {
  id: string;
  type: LearningReferenceKind;
  title: string;
  url: string;
  publisher: string;
  relevance: string;
  verifiedAt: string;
}

export interface KnowledgeLearningPack {
  nodeId: string;
  articles: LearningArticle[];
  references: LearningReference[];
}

export const SNOWFLAKE_LEARNING_OVERVIEW = {
  "introduction": "这门课程从 Snowflake 平台基础开始，逐步覆盖数据建模、数据摄取与转换、数据治理、生产运维、Lakehouse，以及 Cortex AI 与 Agent 应用。教材、案例和参考资料都关联到现有 KnowledgeNode 与题目。",
  "audience": "适合数据工程师、分析工程师、数据平台工程师和 Solution Architect。初学者先完成平台与数据工程主干；有经验的工程师可以直接进入治理、性能、Lakehouse 或 Cortex 专题。",
  "objectives": [
    "解释 Snowflake 存储、计算和 Cloud Services 的职责边界。",
    "根据工作负载、并发、数据延迟和成本选择平台能力。",
    "设计可监控、可恢复、可验证的数据摄取与转换管道。",
    "理解数据治理、访问控制、语义层和生产交付的关键约束。",
    "能够用官方资料和运行证据说明架构选择，而不只记忆产品名词。"
  ],
  "roadmap": [
    "平台基础：架构、核心对象、Warehouse、微分区和 Time Travel。",
    "数据工程：文件与行级摄取、SQL/Snowpark、Streams、Tasks 和 Dynamic Tables。",
    "企业数据架构：数据分层、维度建模、数据质量、访问治理与语义指标。",
    "生产交付：Git、CLI、CI/CD、监控、成本和故障恢复。",
    "扩展专题：Iceberg、数据产品、Cortex GenAI、Cortex Agents 和 CoCo。",
    "补充模块：PostgreSQL 数据库工程，单独标识其原生机制，不与 Snowflake 内部实现混淆。"
  ],
  "notes": "当前 POC 完成平台主干的五篇核心教材。知识树展示课程全部现有节点；未配置教材的节点仍可查看知识摘要并进入专项训练，后续逐步补齐教材和来源。"
} as const;

export const SNOWFLAKE_LEARNING_CONTENT: KnowledgeLearningPack[] = [
  {
    "nodeId": "snowflake-architecture",
    "articles": [
      {
        "id": "snowflake-architecture-core",
        "title": "Snowflake 平台架构：存储、计算与 Cloud Services",
        "kind": "core",
        "level": "foundation",
        "estimatedMinutes": 15,
        "content": "# 学习目标\n\n学完本节，应该能说明 Snowflake 的三层架构分别负责什么，理解存储与计算分离带来的能力和边界，并能把一次 SQL 请求放回平台架构中解释。\n\n## 1. 为什么采用分层架构\n\n传统数据仓库通常把存储、计算和管理组件部署在同一套基础设施中。扩容、维护和工作负载隔离容易相互影响：分析查询可能争抢同一组计算资源，扩容也可能同时牵动存储和计算。\n\nSnowflake 将职责拆分为数据库存储、计算和 Cloud Services。基础设施由 Snowflake 管理，用户主要通过 SQL、平台对象和服务接口使用能力，而不是自行部署数据库节点和维护底层集群。\n\n## 2. 三个主要层次\n\n### Database Storage\n\n负责持久化数据。Snowflake 表的数据会被组织为压缩的列式存储，并自动划分为微分区。平台维护文件组织、元数据和统计信息，用户通常不需要手动分配数据文件或创建微分区。\n\n### Compute\n\n计算由 Virtual Warehouse 承担。Warehouse 是独立的计算集群，用于执行 SQL 查询，以及支持的 Snowpark 工作负载。不同 Warehouse 之间不共享计算资源，因此可以为 ETL、BI、数据科学和临时分析配置不同的计算边界。\n\n### Cloud Services\n\nCloud Services 协调平台活动，处理认证、访问控制、元数据管理、查询解析与优化、基础设施管理等工作。它不是用户 SQL 查询中负责扫描和计算数据的 Warehouse。\n\n## 3. 一次查询如何经过平台\n\n~~~mermaid\nflowchart TD\n  U[Client / BI / Application] --> C[Cloud Services]\n  C --> A[Authentication and Access Control]\n  A --> P[Parse and Optimize SQL]\n  P --> W[Virtual Warehouse]\n  W <--> S[Database Storage]\n  P --> R[Result Metadata and Coordination]\n  W --> R\n  R --> U\n~~~\n\n这是职责视图，不是内部组件的完整部署拓扑。实际查询还涉及缓存、元数据访问、调度和结果处理，不能将图中的箭头理解成严格的内部调用顺序。\n\n## 4. 存储与计算分离意味着什么\n\n- 同一份持久化数据可以由不同 Warehouse 按各自工作负载访问。\n- 可以为 BI 和数据加载设置不同 Warehouse，降低计算资源争用。\n- 暂停 Warehouse 不等于删除表数据；计算停止与数据持久化是两个不同生命周期。\n- 计算可以按需要扩缩，但这不意味着所有 SQL 都会自动变快。查询结构、扫描范围、并发和数据组织仍然重要。\n\n存储与计算分离也不是“完全没有共享资源”。Cloud Services 仍负责平台级协调，账户还会受到权限、服务能力、配额和区域可用性的约束。\n\n## 5. 工程场景：零售企业的多工作负载\n\n一家零售企业把订单、库存和客户数据集中到 Snowflake。数据加载任务使用 ETL Warehouse，BI 报表使用 BI Warehouse，临时分析使用受控的分析 Warehouse。\n\n这样做的目的不是简单地增加 Warehouse 数量，而是把不同工作负载的计算容量、并发、成本归属和运维责任分开。上线后仍要通过 Query History、Query Profile 和成本视图验证隔离是否真正解决问题。\n\n这是用于解释架构取舍的教学场景，不代表某家客户的公开案例或性能承诺。\n\n## 6. 常见误解\n\n- **Warehouse 保存着表数据。** 表数据由持久化存储层管理，Warehouse 提供计算资源。\n- **Cloud Services 执行全部 SQL 算子。** 它负责协调、元数据、认证和优化等平台服务，SQL 的主要计算由 Warehouse 承担。\n- **存储计算分离后就不需要性能治理。** 查询扫描、Join、聚合、并发和 Warehouse 尺寸仍然影响性能与费用。\n\n## 7. 架构判断\n\n遇到“是否应该给每个团队建立独立 Warehouse”的问题，不要只回答应该或不应该。先了解工作负载是否存在资源竞争、是否需要独立成本归属、权限是否需要隔离、并发峰值是否不同，再决定采用共享 Warehouse、独立 Warehouse 或多集群策略。\n\n## 本节检查\n\n1. Warehouse 暂停后，为什么表数据仍然存在？\n2. Cloud Services 与 Warehouse 在查询处理中的职责有什么区别？\n3. 哪些场景值得使用多个 Warehouse？如何用运行数据验证收益？"
      }
    ],
    "references": [
      {
        "id": "docs-snowflake-architecture",
        "type": "official",
        "title": "Snowflake key concepts and architecture",
        "url": "https://docs.snowflake.com/en/user-guide/intro-key-concepts",
        "publisher": "Snowflake Documentation",
        "relevance": "三层架构、存储格式、Warehouse 与 Cloud Services 的官方定义。",
        "verifiedAt": "2026-11-28"
      },
      {
        "id": "docs-warehouses",
        "type": "official",
        "title": "Virtual warehouses",
        "url": "https://docs.snowflake.com/en/user-guide/warehouses",
        "publisher": "Snowflake Documentation",
        "relevance": "Warehouse 的计算职责、配置和运行管理。",
        "verifiedAt": "2026-11-28"
      }
    ]
  },
  {
    "nodeId": "virtual-warehouse",
    "articles": [
      {
        "id": "virtual-warehouse-core",
        "title": "Virtual Warehouse：容量、并发与成本控制",
        "kind": "core",
        "level": "foundation",
        "estimatedMinutes": 18,
        "content": "# 学习目标\n\n理解 Virtual Warehouse 的计算职责，区分纵向扩容和横向扩展，能够根据查询性能、并发需求和成本约束设计 Warehouse。\n\n## 1. Warehouse 解决什么问题\n\nVirtual Warehouse 是 Snowflake 执行 SQL 和受支持计算工作负载的计算资源。它不负责长期保存表数据。Warehouse 的尺寸影响可用计算资源；运行、暂停、恢复和集群配置则共同影响性能、并发体验与成本。\n\n不要把 Warehouse 当作传统数据库服务器的简单映射。它是 Snowflake 管理的计算资源抽象，配置重点是工作负载与服务目标，而不是操作系统和数据库实例维护。\n\n## 2. Scale up 与 Scale out\n\n| 方式 | 解决的问题 | 典型用途 | 需要注意 |\n|---|---|---|---|\n| 调整 Warehouse Size | 增加单个集群的计算能力 | 大查询、复杂 Join、计算密集型转换 | 成本随尺寸增加，性能提升不是线性保证 |\n| Multi-cluster Warehouse | 增加集群以承接更多并发请求 | BI 用户并发、突发查询 | 主要解决并发容量，不等同于让单条查询更快 |\n\n~~~mermaid\nflowchart TD\n  A[Workload] --> B{Primary bottleneck?}\n  B -->|Single query is slow| C[Inspect Query Profile, then consider resize]\n  B -->|Queries queue under concurrency| D[Review workload isolation or multi-cluster]\n  B -->|Idle time costs too much| E[Review auto-suspend and auto-resume]\n  B -->|Different teams interfere| F[Separate warehouses and cost ownership]\n~~~\n\n## 3. 自动暂停和自动恢复\n\nAuto-suspend 可以在 Warehouse 一段时间没有活动后自动暂停，减少空闲计算消耗；Auto-resume 可以在收到新请求时自动恢复。\n\n参数不应该照抄一个固定值。需要结合请求间隔、交互延迟要求、恢复开销和账单规则评估。暂停策略需要考虑工作负载空闲间隙和恢复时的最低计费行为。\n\n对于长时间持续运行的 ETL，过短的 Auto-suspend 可能造成反复暂停和恢复；对于间歇性分析，关闭 Auto-suspend 又可能带来不必要的空闲费用。\n\n## 4. 工作负载隔离\n\n可以按照工作负载建立不同 Warehouse，例如：\n\n- LOAD_WH：数据加载与批处理转换。\n- BI_WH：仪表盘与分析查询。\n- DS_WH：数据科学和探索性分析。\n\n隔离的收益包括资源竞争减少、费用更容易归属、配置可以独立调整。但 Warehouse 过多也会增加监控、权限和配置维护成本。应以工作负载差异为依据，而不是每个用户、每张表都创建独立 Warehouse。\n\n## 5. 工程案例：BI 高峰期查询排队\n\n某零售企业每天 9:00 运行管理报表，许多业务人员同时打开仪表盘。观察到 Query History 中出现排队，单条查询运行时间并没有明显增长。\n\n合理的诊断顺序：\n\n1. 检查队列时间与执行时间，确认瓶颈是否来自并发。\n2. 查看 Warehouse 当前集群配置和负载情况。\n3. 评估 BI 是否应该使用独立 Warehouse，避免与 ETL 抢占资源。\n4. 在适用版本和账户条件下，测试 Multi-cluster Warehouse。\n5. 比较调整前后的排队时间、查询延迟和 Credits，而不是只比较吞吐量。\n\n如果实际问题是单条查询扫描量大或 Join 效率低，单纯增加集群通常不是正确的第一步。\n\n## 6. 监控与费用核算\n\n至少关注：\n\n- Query History：查询运行、排队、错误和耗时。\n- Query Profile：扫描、Join、聚合和数据交换等执行细节。\n- Warehouse Load：负载与并发。\n- Credit Usage：计算消耗以及资源使用归属。\n\nResource Monitor 可以用于管理部分 Warehouse 使用预算和阈值，但不能假设它覆盖账户内所有 Serverless 服务费用。应将 Warehouse、Serverless 和其他计费项目分别核算。\n\n## 7. 常见误解\n\n- **扩大 Warehouse 就能解决并发。** 扩大尺寸主要增加单集群能力；并发排队需要结合多集群或隔离设计。\n- **Multi-cluster 会让单条 SQL 自动变快。** 它主要解决并发容量。\n- **Auto-suspend 越短越省钱。** 过于频繁的暂停和恢复也可能造成额外成本和延迟。\n- **Resource Monitor 是全账户费用上限。** 它不等于对所有服务的统一硬性预算控制。\n\n## 本节检查\n\n1. 查询慢与查询排队，分别应该先检查什么？\n2. 什么时候考虑调整 Warehouse Size，什么时候考虑 Multi-cluster？\n3. 为什么不能直接把 Auto-suspend 设置为一个全公司的统一值？"
      }
    ],
    "references": [
      {
        "id": "docs-warehouses",
        "type": "official",
        "title": "Virtual warehouses",
        "url": "https://docs.snowflake.com/en/user-guide/warehouses",
        "publisher": "Snowflake Documentation",
        "relevance": "Warehouse 生命周期、尺寸和多集群能力。",
        "verifiedAt": "2026-11-28"
      },
      {
        "id": "docs-warehouse-considerations",
        "type": "official",
        "title": "Warehouse considerations",
        "url": "https://docs.snowflake.com/en/user-guide/warehouses-considerations",
        "publisher": "Snowflake Documentation",
        "relevance": "自动暂停、自动恢复、扩容与扩展的配置权衡。",
        "verifiedAt": "2026-11-28"
      },
      {
        "id": "docs-cost-controls",
        "type": "official",
        "title": "Cost controls for warehouses",
        "url": "https://docs.snowflake.com/en/user-guide/cost-controlling-controls",
        "publisher": "Snowflake Documentation",
        "relevance": "Warehouse 成本控制与使用监控。",
        "verifiedAt": "2026-11-28"
      }
    ]
  },
  {
    "nodeId": "snowflake-data-loading",
    "articles": [
      {
        "id": "snowflake-data-loading-core",
        "title": "Snowflake 数据摄取：COPY、Snowpipe 与 Snowpipe Streaming",
        "kind": "core",
        "level": "foundation",
        "estimatedMinutes": 20,
        "content": "# 学习目标\n\n能够根据输入形态、数据量、到达频率和延迟要求，选择适合的数据摄取方式，并设计加载校验与失败处理。\n\n## 1. 先区分输入形态\n\n| 方式 | 输入形态 | 典型使用方式 | 需要关注 |\n|---|---|---|---|\n| COPY INTO | 已准备好的文件 | 批量加载到表 | 文件清单、格式、错误行、重复加载 |\n| Snowpipe | Stage 中到达的文件 | 文件到达后自动加载 | 通知配置、延迟、Serverless 费用 |\n| Snowpipe Streaming | 连续到达的行数据 | SDK 或 REST API 写入 | 通道管理、顺序、吞吐与端到端延迟 |\n\n不能仅按“实时/非实时”二分。文件大小、文件产生频率、数据格式、上游系统能力、错误恢复方式和费用模型都会影响选型。\n\n## 2. 批量加载：COPY INTO\n\n文件已经在内部或外部 Stage 中，且可以按批次管理时，COPY INTO 是直接的加载方式。工程上通常需要维护：\n\n- Stage 路径和文件范围。\n- File Format 与字段映射。\n- 文件命名和批次标识。\n- ON_ERROR 等错误处理配置。\n- 加载结果与目标数据核对。\n\n~~~sql\nCOPY INTO RAW.ORDERS\nFROM @INGEST_STAGE/orders/\nFILE_FORMAT = (FORMAT_NAME = RAW.CSV_FORMAT)\nON_ERROR = 'ABORT_STATEMENT';\n~~~\n\n这是示意 SQL。真实执行前要根据文件格式、目标表结构、权限和错误处理要求完成配置。\n\n## 3. 文件持续到达：Snowpipe\n\nSnowpipe 处理 Stage 中新到达的文件。通常由云存储事件通知触发加载，计算资源由 Snowflake 管理，不需要用户预先配置一个持续运行的 Warehouse。\n\n适合文件持续生成、希望自动加载且不需要自行维护轮询服务的场景。需要监控文件通知、Pipe 状态、加载历史和实际端到端延迟。\n\nSnowpipe 不意味着文件到达后立即对所有消费者可见。端到端延迟仍受事件通知、服务处理和下游转换影响。\n\n## 4. 行级持续写入：Snowpipe Streaming\n\nSnowpipe Streaming 允许通过 SDK 或 REST API 将行数据直接写入 Snowflake 表，不要求先将数据组织成文件放入 Stage。\n\n它适合对加载延迟更敏感的事件流或应用事件数据。设计时需要考虑客户端重试、通道与偏移管理、重复数据处理、Schema 变化以及下游消费者如何验证数据完整性。\n\n## 5. 摄取后的质量检查\n\n加载成功不等于数据正确。建议至少建立以下校验：\n\n1. 文件级：文件是否被发现、处理或拒绝。\n2. 行级：拒绝行数量、解析错误和关键字段空值。\n3. 批次级：源文件记录数与目标表加载记录数是否对齐。\n4. 业务级：金额、数量、关键维度和业务日期是否符合预期。\n5. 重放级：相同文件或事件重试后是否产生重复业务记录。\n\n~~~mermaid\nflowchart TD\n  A[Source Files or Events] --> B{Input Pattern}\n  B -->|Batch Files| C[COPY INTO]\n  B -->|Continuous Files| D[Snowpipe]\n  B -->|Row Events| E[Snowpipe Streaming]\n  C --> F[Raw Tables]\n  D --> F\n  E --> F\n  F --> G[Quality Checks and Reconciliation]\n  G --> H[Quarantine / Retry]\n  G --> I[Curated Data]\n~~~\n\n## 6. 工程案例：订单数据从不同渠道进入平台\n\n电商订单来自三个系统：ERP 每晚导出批量 CSV，SaaS 系统每隔几分钟写出文件，网站交易服务持续产生订单事件。\n\n一种可行设计是：\n\n- ERP 批次使用 COPY INTO，保留批次 ID 和文件名。\n- SaaS 文件评估 Snowpipe，避免自行维护频繁轮询。\n- 网站事件评估 Snowpipe Streaming，并明确重复事件处理和端到端可见性要求。\n- 三条链路统一落入 Raw 层，再做模式校验、业务键去重、金额对账和异常隔离。\n\n这是教学设计案例。实际选型仍要结合数据量、账户能力、延迟目标、SDK 支持和成本测试。\n\n## 7. 常见误解\n\n- **Snowpipe 和 Snowpipe Streaming 是同一种方式。** 前者面向 Stage 文件，后者可以直接摄取行数据。\n- **加载成功就代表数据完整。** 还需要检查拒绝行、源目标数量和业务指标。\n- **所有数据都应该追求最低延迟。** 更低延迟可能带来更复杂的生产运维和费用，应从业务新鲜度要求出发。\n- **重复执行天然等于幂等。** 需要基于文件身份、批次、业务键或事件 ID 设计重放策略。\n\n## 本节检查\n\n1. 已有文件批量加载、持续文件加载和行事件摄取分别适合什么情况？\n2. 为什么 Snowpipe Streaming 不能简单理解成“更快的 COPY INTO”？\n3. 摄取完成后，如何证明数据既完整又符合业务口径？"
      }
    ],
    "references": [
      {
        "id": "docs-data-loading",
        "type": "official",
        "title": "Overview of data loading",
        "url": "https://docs.snowflake.com/en/user-guide/data-load-overview",
        "publisher": "Snowflake Documentation",
        "relevance": "批量加载、持续加载和摄取路径比较。",
        "verifiedAt": "2026-11-28"
      },
      {
        "id": "docs-snowpipe",
        "type": "official",
        "title": "Introduction to Snowpipe",
        "url": "https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro",
        "publisher": "Snowflake Documentation",
        "relevance": "文件到达后自动加载的工作方式。",
        "verifiedAt": "2026-11-28"
      },
      {
        "id": "docs-snowpipe-streaming",
        "type": "official",
        "title": "Snowpipe Streaming overview",
        "url": "https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview",
        "publisher": "Snowflake Documentation",
        "relevance": "面向行级数据的持续摄取 API。",
        "verifiedAt": "2026-11-28"
      }
    ]
  },
  {
    "nodeId": "change-capture-processing",
    "articles": [
      {
        "id": "streams-tasks-core",
        "title": "Streams 与 Tasks：在 Snowflake 中构建 CDC 管道",
        "kind": "core",
        "level": "intermediate",
        "estimatedMinutes": 22,
        "content": "# 学习目标\n\n理解 Stream 保存的是什么、Stream Offset 何时推进，以及 Task 如何触发和编排数据处理。能够设计可恢复的增量处理流程。\n\n## 1. Stream 是什么\n\nSnowflake Stream 用于读取源对象在两个事务时间点之间发生的变更。它提供 CDC 记录，并附带描述变更操作的元数据列。\n\n关键点：Stream 本身并不保存一份完整的源表数据副本。它维护一个 Offset，并依赖源对象的变更跟踪信息返回增量记录。可以把它理解为源表版本时间线上的书签。\n\n## 2. Offset 什么时候推进\n\n单纯 SELECT Stream 不会推进 Offset。Stream 被 DML 事务消费并成功提交后，Offset 才会推进到相应版本。\n\n如果一个任务读取 Stream 后写入目标表，必须关注读写是否处在预期事务边界内。事务失败时，不应错误地假设变更已被永久消费；任务重试也必须考虑目标侧幂等性。\n\n对于 UPDATE，Stream 可能返回 DELETE 和 INSERT 两条记录，并通过 METADATA$ISUPDATE 表示它们属于更新操作。下游不能只按行数或单一操作类型判断业务含义。\n\n## 3. Task 是什么\n\nTask 用于自动运行 SQL 或存储过程。它可以按固定时间计划运行，也可以在 Stream 有数据时触发。复杂流程可以组织成 Task Graph，表达依赖和执行顺序。\n\nTask 的计算方式可以使用用户管理的 Warehouse，也可以在适用场景中使用 Serverless Task。选型要结合任务数量、运行时间、并发、资源可预测性和成本。\n\n## 4. 一个典型 CDC 流程\n\n~~~mermaid\nflowchart TD\n  A[Application or Source Table] --> B[Snowflake Table]\n  B --> C[Stream Offset]\n  C --> D{New Changes?}\n  D -->|Yes| E[Triggered Task]\n  E --> F[Transactional DML]\n  F --> G[MERGE into Target]\n  G --> H[Commit]\n  H --> I[Stream Offset Advances]\n  D -->|No| J[Wait for New Changes]\n  F -->|Failure| K[Retry and Reconcile]\n~~~\n\n图中省略了权限、任务所有者、错误处理和监控配置。生产实现必须补齐这些内容。\n\n## 5. SQL 结构示例\n\n~~~sql\nCREATE OR REPLACE STREAM ORDERS_STREAM\n  ON TABLE RAW.ORDERS;\n\nCREATE OR REPLACE TASK APPLY_ORDER_CHANGES\n  WAREHOUSE = TRANSFORM_WH\n  WHEN SYSTEM$STREAM_HAS_DATA('ORDERS_STREAM')\nAS\n  MERGE INTO CURATED.ORDERS T\n  USING (\n    SELECT ORDER_ID, CUSTOMER_ID, ORDER_STATUS, UPDATED_AT\n    FROM ORDERS_STREAM\n    QUALIFY ROW_NUMBER() OVER (\n      PARTITION BY ORDER_ID\n      ORDER BY UPDATED_AT DESC\n    ) = 1\n  ) S\n  ON T.ORDER_ID = S.ORDER_ID\n  WHEN MATCHED THEN UPDATE SET\n    T.CUSTOMER_ID = S.CUSTOMER_ID,\n    T.ORDER_STATUS = S.ORDER_STATUS,\n    T.UPDATED_AT = S.UPDATED_AT\n  WHEN NOT MATCHED THEN INSERT\n    (ORDER_ID, CUSTOMER_ID, ORDER_STATUS, UPDATED_AT)\n  VALUES\n    (S.ORDER_ID, S.CUSTOMER_ID, S.ORDER_STATUS, S.UPDATED_AT);\n~~~\n\n这是帮助理解对象关系的示例，不是适用于所有 CDC 业务的完整模板。尤其是删除事件、更新前后镜像、同一业务键多次变化和事件排序，都需要根据源数据契约明确处理。示例中的简化 MERGE 不能直接用于需要保留删除语义的场景。\n\nTask 创建后默认处于 Suspended 状态，需要显式恢复任务；应先手动测试，再启用自动调度或触发。\n\n## 6. 生产设计必须考虑什么\n\n- **多消费者：** 不同消费者通常应有独立 Stream，避免一个消费者推进 Offset 后让另一个消费者拿不到预期增量。\n- **长时间未消费：** 评估源表数据保留期限和 Stream Staleness 风险，建立监控和恢复方案。\n- **任务失败：** 监控 Task History、失败原因和重试情况；失败恢复不能只靠无界重试。\n- **目标幂等：** 使用业务键、事件 ID 或批次标识控制重复应用。\n- **Schema 变化：** Stream 读取历史变更时要考虑源对象 Schema 演进带来的兼容性。\n- **数据对账：** 比较源端变化、消费数量、目标表变化及关键业务指标。\n\n## 7. 工程案例：订单状态增量同步\n\n订单系统每分钟更新订单状态，下游分析表不需要每次全表重算。可以通过 Stream 获取源表增量，再由触发式 Task 将变化应用到目标表。\n\n设计验收应包含：插入、更新、删除、重复执行、任务中途失败、连续多次更新同一订单，以及多个消费者并行读取等测试。只验证一次正常执行并不足以证明 CDC 链路可靠。\n\n## 8. 常见误解\n\n- **Stream 是一张保存变更数据的普通表。** 它主要保存 Offset，变更记录依赖源对象的变更跟踪信息。\n- **SELECT 后 Offset 就前进。** Stream Offset 在成功提交的 DML 消费事务中推进。\n- **一个 Stream 可以随意供多个下游共享。** 消费者推进 Offset 后会改变后续消费者可读取的增量范围。\n- **Task 成功运行就说明下游数据正确。** 仍要验证目标表的幂等性、删除语义和业务对账。\n\n## 本节检查\n\n1. Stream 的 Offset 在什么条件下推进？\n2. 一个 Stream 为什么不适合多个独立消费者无协调地共享？\n3. CDC 链路应该如何测试重试、删除和重复事件？"
      }
    ],
    "references": [
      {
        "id": "docs-streams-intro",
        "type": "official",
        "title": "Introduction to streams",
        "url": "https://docs.snowflake.com/en/user-guide/streams-intro",
        "publisher": "Snowflake Documentation",
        "relevance": "Stream Offset、变更记录和 DML 消费事务语义。",
        "verifiedAt": "2026-11-28"
      },
      {
        "id": "docs-tasks-intro",
        "type": "official",
        "title": "Introduction to tasks",
        "url": "https://docs.snowflake.com/en/user-guide/tasks-intro",
        "publisher": "Snowflake Documentation",
        "relevance": "Task 调度、触发式任务、Task Graph 和计算模型。",
        "verifiedAt": "2026-11-28"
      }
    ]
  },
  {
    "nodeId": "dynamic-tables",
    "articles": [
      {
        "id": "dynamic-tables-core",
        "title": "Dynamic Tables：声明式数据转换与新鲜度目标",
        "kind": "core",
        "level": "intermediate",
        "estimatedMinutes": 18,
        "content": "# 学习目标\n\n理解 Dynamic Tables 的声明式模型，区分 TARGET_LAG 与固定调度周期，并能够在 Dynamic Tables、Streams/Tasks 和外部编排之间做初步选型。\n\n## 1. Dynamic Tables 解决什么问题\n\nDynamic Table 将一个 SELECT 查询定义为物化结果，并由 Snowflake 跟踪上游依赖、安排刷新，使结果保持在指定的新鲜度目标范围内。\n\n用户主要描述“结果应该是什么”和“数据需要多新”，而不是手工编写完整的增量调度步骤。多个 Dynamic Tables 可以形成依赖管道，平台根据查询定义识别依赖关系。\n\n## 2. TARGET_LAG 不是刷新间隔\n\nTARGET_LAG 表示对数据陈旧程度的目标，不是承诺每隔固定分钟执行一次刷新，也不是无条件 SLA。\n\n例如 TARGET_LAG = '10 minutes' 表达的是希望数据新鲜度保持在相应目标内。实际延迟可能因刷新耗时、Warehouse 容量、数据量、查询复杂度或管道深度而超过目标。生产系统需要监控实际延迟，并在超过业务阈值时采取措施。\n\n## 3. Refresh Mode\n\nDynamic Tables 支持不同刷新模式，常见包括：\n\n- INCREMENTAL：基于变化数据计算刷新。\n- FULL：重新计算完整结果。\n- AUTO：创建时由 Snowflake 根据定义选择适合的模式。\n- ADAPTIVE：在增量刷新基础上，根据内部启发式条件决定是否重新初始化。\n\n不能仅凭表大小决定模式。查询表达式、Join、聚合、变更比例和实际运行成本都可能影响刷新效率。应通过真实数据量测试，并查看刷新历史与运行指标。\n\n## 4. 一个简单示例\n\n~~~sql\nCREATE OR REPLACE DYNAMIC TABLE CURATED.DAILY_ORDER_SUMMARY\n  TARGET_LAG = '10 minutes'\n  WAREHOUSE = TRANSFORM_WH\n  REFRESH_MODE = INCREMENTAL\nAS\nSELECT\n  ORDER_DATE,\n  REGION,\n  COUNT(*) AS ORDER_COUNT,\n  SUM(ORDER_AMOUNT) AS TOTAL_AMOUNT\nFROM CURATED.ORDERS\nGROUP BY ORDER_DATE, REGION;\n~~~\n\n这是演示声明式定义的示例。正式环境需要验证增量刷新支持情况、聚合定义、上游数据质量、Warehouse 资源和实际延迟。\n\n## 5. 依赖管道\n\n~~~mermaid\nflowchart TD\n  A[RAW ORDERS] --> B[Dynamic Table: Clean Orders]\n  B --> C[Dynamic Table: Daily Summary]\n  D[DIM REGION] --> C\n  C --> E[BI Dashboard]\n  E --> F[Freshness and Refresh Monitoring]\n~~~\n\n平台从查询定义中推导依赖关系，并按依赖顺序协调刷新。中间层可以使用 TARGET_LAG = DOWNSTREAM，使其刷新需求跟随下游消费者。\n\n## 6. Dynamic Tables 与 Streams/Tasks 如何选\n\n| 需求 | 优先评估 | 原因 |\n|---|---|---|\n| 声明式 SQL 转换，平台管理刷新 | Dynamic Tables | 重点是结果定义和数据新鲜度 |\n| 需要显式读取 CDC 变化记录 | Streams | 明确控制变更数据与 Offset |\n| 需要自定义 DML、过程逻辑或事件触发 | Tasks + Streams | 控制触发条件和处理步骤 |\n| 复杂跨系统依赖和统一工作流治理 | 外部编排工具 | 需要 Snowflake 之外的依赖和运维控制 |\n\n这不是绝对边界。真实项目可以组合使用。例如，上游通过 Snowpipe 摄取，Streams/Tasks 处理需要显式 CDC 的部分，Dynamic Tables 管理适合声明式表达的下游转换。\n\n## 7. 工程案例：运营日报数据新鲜度\n\n运营部门希望每日订单汇总在数据变更后持续更新，业务可接受十分钟级的新鲜度，不要求每条订单事件都立即完成全链路处理。\n\n可以先评估 Dynamic Tables：定义清洗层和汇总层，按业务容忍度设置 TARGET_LAG，监控实际延迟、刷新耗时和 Warehouse 成本。如果某一步必须在接收特定事件后执行自定义动作，则再评估 Streams/Tasks。\n\n验收不只看表是否自动更新，还要验证延迟分布、结果正确性、失败恢复和成本。\n\n## 8. 常见误解\n\n- **TARGET_LAG 是固定执行间隔。** 它是新鲜度目标，不是 cron。\n- **设置十分钟就保证十分钟内更新。** 目标是 best-effort，实际延迟可能超过目标。\n- **Dynamic Tables 可以替代所有 Streams/Tasks。** 需要显式消费 CDC 或自定义过程时，Streams/Tasks 仍然有价值。\n- **INCREMENTAL 永远比 FULL 便宜。** 需要结合变更比例、查询形态和数据量测量。\n\n## 本节检查\n\n1. TARGET_LAG 表达什么，不表达什么？\n2. 什么时候优先考虑 Dynamic Tables，什么时候需要 Streams/Tasks？\n3. 如何证明一个管道满足业务新鲜度要求？"
      }
    ],
    "references": [
      {
        "id": "docs-dynamic-tables",
        "type": "official",
        "title": "Dynamic tables",
        "url": "https://docs.snowflake.com/en/user-guide/dynamic-tables/overview",
        "publisher": "Snowflake Documentation",
        "relevance": "声明式定义、依赖关系和刷新模型。",
        "verifiedAt": "2026-11-28"
      },
      {
        "id": "docs-dynamic-table-target-lag",
        "type": "official",
        "title": "Set the target lag for a dynamic table",
        "url": "https://docs.snowflake.com/en/user-guide/dynamic-tables/target-lag",
        "publisher": "Snowflake Documentation",
        "relevance": "TARGET_LAG 的准确语义、best-effort 约束和管道调度行为。",
        "verifiedAt": "2026-11-28"
      },
      {
        "id": "docs-dynamic-table-refresh-modes",
        "type": "official",
        "title": "Dynamic table refresh modes",
        "url": "https://docs.snowflake.com/en/user-guide/dynamic-tables/refresh-modes",
        "publisher": "Snowflake Documentation",
        "relevance": "FULL、INCREMENTAL、AUTO 和 ADAPTIVE 等刷新模式。",
        "verifiedAt": "2026-11-28"
      }
    ]
  }
];
