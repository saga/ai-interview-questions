# Snowflake CoCo Skills 专项题：100 道题与知识点覆盖

**整理日期：** 2026-10-20  
**内容来源：** [Snowflake-Labs/coco-skills](https://github.com/Snowflake-Labs/coco-skills) 中的 Skill 文档、流程说明及配套示例。题目为重新组织的工程场景题，不复制 Skill 原文，也不把某一个示例的参数当作普遍 SLA。

## 题量与质量口径

| 项目 | 数量 |
| --- | ---: |
| 新增原创题目 | 100 |
| 新增知识节点 | 10 |
| 简单 | 60 |
| 中等 | 40 |
| 困难 | 0 |
| 多选题（每题恰好两个正确项） | 68 |
| 单选题 | 32 |

每道题同时提供选择题与开放题参考答案，归属独立 `courseId=snowflake` 课程。题库按项目现有 JSON 契约写入，`topic` 与 `knowledgeId` 均绑定新增知识节点；所有题目具备 `angle`、`assessment`、来源标识和误解映射。新批次的多选题比例高于三分之二。

## 知识点与题目索引

| Knowledge ID | 知识点 | 来源 Skill | 题目 ID 前缀 | 数量 |
| --- | --- | --- | --- | ---: |
| `snowflake-coco-semantic-patterns` | Semantic View 高级建模与诊断 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/semantic-view-patterns) | `sf-coco-skills-100-semantic-patterns-`（01–10） | 10 |
| `snowflake-coco-analyst-chat` | Cortex Analyst 与数据问答应用 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/streamlit-add-chat-page) | `sf-coco-skills-100-analyst-chat-`（01–10） | 10 |
| `snowflake-coco-ontology-stack` | Ontology-on-Snowflake 分层设计 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/ontology-stack-builder) | `sf-coco-skills-100-ontology-stack-`（01–10） | 10 |
| `snowflake-coco-dynamic-tables` | Dynamic Tables 生产选型与诊断 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/dynamic-tables-guidance) | `sf-coco-skills-100-dynamic-tables-`（01–10） | 10 |
| `snowflake-coco-dbt-modeling` | dbt 自动化建模与验证 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/dbt-model-generator) | `sf-coco-skills-100-dbt-modeling-`（01–10） | 10 |
| `snowflake-coco-rbac` | Snowflake RBAC 分层与最小权限 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/rbac) | `sf-coco-skills-100-rbac-`（01–10） | 10 |
| `snowflake-coco-snowpipe-bcdr` | Snowpipe 业务连续性与灾难恢复 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/snowpipe-bcdr) | `sf-coco-skills-100-snowpipe-bcdr-`（01–10） | 10 |
| `snowflake-coco-openflow-private-link` | OpenFlow on SPCS 的私网连接 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/openflow-spcs-privatelink) | `sf-coco-skills-100-openflow-private-link-`（01–10） | 10 |
| `snowflake-coco-sap-bdc` | SAP BDC Zero-Copy Connector 生命周期 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/manage-zerocopy-sapbdc) | `sf-coco-skills-100-sap-bdc-`（01–10） | 10 |
| `snowflake-coco-model-availability` | Cortex 模型可用性与 CoCo 技能执行边界 | [打开 Skill](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/check-model-availability) | `sf-coco-skills-100-model-availability-`（01–10） | 10 |

## 重点工程结论

1. **Semantic View 首先要正确表达粒度与关系基数。** 多事实表、时态维度、快照指标和派生指标都需要验证聚合路径；`SYSTEM$EXPLAIN_SEMANTIC_QUERY` 展示生成 SQL，但不会执行它，也不保证结果正确。
2. **自然语言问数需要独立的语义控制与证据。** 结构化指标优先使用语义视图和 Cortex Analyst；文档问答采用 Cortex Search 检索与引用；一对多关系、具名指标、业务同义词和黄金查询是不同层面的控制。
3. **Ontology 是按需引入的分层设计，而不是每个项目的必选项。** 先确定业务问题与数据路径，评估直接表视图和知识图谱路径，逐层部署并验证；每个阶段的审批门禁不能因 Skill 委派而跳过。
4. **数据管道工具不能只按熟悉程度选择。** Dynamic Tables、Materialized Views、Streams/Tasks 与 dbt 的刷新语义、过程能力和测试/可移植性不同。实际延迟、刷新模式、数据契约和成本应纳入验收。
5. **RBAC 和私网连接都应按边界验证。** 访问角色集中承载对象授权；OpenFlow PrivateLink 则横跨 AWS 与 Snowflake 配置，需要分别证明目标组健康、NLB 活跃、端点可用和 EAI 已关联。
6. **BCDR 必须验证恢复而不只是切换。** RPO/RTO、单写者/去重、通知集成重建、历史加载记录与补数时间边界共同决定恢复结果是否完整。
7. **Zero-copy 并不等于免治理。** SAP BDC 的消费、发布与断开连接属于不同生命周期动作，需检查连接状态、专属权限、Catalog-Linked Databases 和 share-back。
8. **模型可用性由实际调用面决定。** Cortex base mode 与 CoCo agentic mode 是独立门禁；账户、区域、模型名称和跨区域配置都可能影响结果。公开文档及模型列表需与目标环境中的真实探测交叉验证。
9. **Skill 是可执行工作流，不应被视为无副作用的提示词。** 安装和执行前应审查来源、许可证、脚本、目标对象与权限；对 `CREATE OR REPLACE` 等操作，要先验证差异和依赖并遵守审批要求。

## 来源 Skill

- [Semantic View Patterns](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/semantic-view-patterns)
- [Streamlit Analyst / Cortex Search chat](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/streamlit-add-chat-page)
- [Ontology Stack Builder](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/ontology-stack-builder)
- [Dynamic Tables Guidance](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/dynamic-tables-guidance)
- [dbt Model Generator](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/dbt-model-generator)
- [RBAC](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/rbac)
- [Snowpipe BCDR](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/snowpipe-bcdr)
- [OpenFlow PrivateLink](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/openflow-spcs-privatelink)
- [SAP BDC Zero-Copy Connector](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/manage-zerocopy-sapbdc)
- [Cortex model availability](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/check-model-availability)

## 官方文档核验入口

- [Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/sql)
- [Querying a Semantic View](https://docs.snowflake.com/en/user-guide/views-semantic/querying)
- [Dynamic Tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/about)
- [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Access Control Overview](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [External Access Integrations](https://docs.snowflake.com/en/developer-guide/external-network-access/creating-using-external-network-access)
- [Cortex Code](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code)

## 验证说明

当前批次已执行静态预检：题数、知识节点数、唯一 ID、题目与知识节点绑定、多选答案数量、答案索引、误解映射、选项重复与长度偏差、简单/中等分布。该预检不等同于运行仓库中的 TypeScript/Vitest/CLI 验证，也不代表已连接 Snowflake 账户执行了全部 Skill 实例。后续应在仓库环境运行 `npm run validate:questions`、`npm run question:audit` 和 `npm run build`，并人工抽检题干、答案及官方文档的时效边界。
