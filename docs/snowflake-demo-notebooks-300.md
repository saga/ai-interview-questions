# Snowflake Demo Notebooks：300 道初级/中级实践题

**整理日期：2026-10-24**  
**课程归属：** 独立 `courseId=snowflake`，不混入 AI 六大能力域。  
**题量：** 新增 300 道，不覆盖已有的 Snowflake Roadmap 300 题、CoCo 100 题、COF-C03 200 题或 Developer Guides 200 题。  
**难度：** 180 道初级（`easy`）、120 道中级（`medium`）；本批不新增 hard 题。  
**题型：** 每道题同时提供四选一单选和开放题参考答案，并附解释、常见误解和来源章节。

## 来源与整理方法

主要实践来源为 [Snowflake-Labs/snowflake-demo-notebooks](https://github.com/Snowflake-Labs/snowflake-demo-notebooks)。它是 Snowflake Notebooks 的教程和示例集合，覆盖 SQL/Python 同一开发工作流、Snowpark、数据工程、查询性能与成本监控、Feature Store/Model Registry、Cortex GenAI、Semantic Views、Agentic Analytics、Streamlit 和访问治理等主题。

本题库对示例所涉及的**知识机制与工程判断**进行重新设计，不复制 Notebook 原文或逐字改写示例。每个主题均围绕可解释的概念、选择/权衡、故障诊断与验收证据设计题目。产品行为以对应的 Snowflake 官方文档为准；示例仓库仅用于发现可实践的主题与工作流。

题目 ID 采用 `sf-demo-notebooks-300-<knowledge-id>-NN`。每个知识点十题，前六题为初级、后四题为中级。全部题目已放入应用自动加载的 `src/data/questions/` JSON 文件；本主题知识节点放入 `src/data/knowledge/snowflake-demo-notebooks-expansion.json`。节点 ID 与题目 `topic / subtopic / knowledgeId` 对应，用于课程内覆盖和薄弱项训练。

## 题量与覆盖矩阵

| # | Knowledge ID | 主题 | 课程主题 | 新增题量 | 题目 ID 范围 |
|---:|---|---|---|---:|---|
| 1 | `sf-demo-notebooks-workspace` | Snowflake Notebooks 工作区与交互执行 | snowflake | 10 | `sf-demo-notebooks-300-sf-demo-notebooks-workspace-01…10` |
| 2 | `sf-demo-sql-python-interop` | SQL 与 Python 的协同分析 | snowflake | 10 | `sf-demo-notebooks-300-sf-demo-sql-python-interop-01…10` |
| 3 | `sf-demo-snowpark-dataframe` | Snowpark DataFrame 转换与优化 | data-engineering | 10 | `sf-demo-notebooks-300-sf-demo-snowpark-dataframe-01…10` |
| 4 | `sf-demo-data-pipeline` | 端到端数据工程管道 | data-engineering | 10 | `sf-demo-notebooks-300-sf-demo-data-pipeline-01…10` |
| 5 | `sf-demo-pipeline-observability` | 数据管道可观测性与告警 | snowflake-devops | 10 | `sf-demo-notebooks-300-sf-demo-pipeline-observability-01…10` |
| 6 | `sf-demo-warehouse-utilization` | Warehouse 利用率、并发与容量 | snowflake | 10 | `sf-demo-notebooks-300-sf-demo-warehouse-utilization-01…10` |
| 7 | `sf-demo-query-profile` | Query Profile 与 SQL 性能诊断 | snowflake | 10 | `sf-demo-notebooks-300-sf-demo-query-profile-01…10` |
| 8 | `sf-demo-query-cost` | Query Cost Monitoring 与费用归因 | snowflake | 10 | `sf-demo-notebooks-300-sf-demo-query-cost-01…10` |
| 9 | `sf-demo-query-cache` | 查询缓存效果与性能验证 | snowflake | 10 | `sf-demo-notebooks-300-sf-demo-query-cache-01…10` |
| 10 | `sf-demo-feature-store` | Snowflake Feature Store 特征管理 | snowflake-agent-ml | 10 | `sf-demo-notebooks-300-sf-demo-feature-store-01…10` |
| 11 | `sf-demo-model-registry` | Snowflake Model Registry 与模型生命周期 | snowflake-agent-ml | 10 | `sf-demo-notebooks-300-sf-demo-model-registry-01…10` |
| 12 | `sf-demo-cortex-functions` | Cortex LLM 函数与任务选型 | snowflake-genai | 10 | `sf-demo-notebooks-300-sf-demo-cortex-functions-01…10` |
| 13 | `sf-demo-document-ai` | 文档解析与结构化抽取 | snowflake-genai | 10 | `sf-demo-notebooks-300-sf-demo-document-ai-01…10` |
| 14 | `sf-demo-cortex-search-rag` | Cortex Search、检索与 RAG | snowflake-genai | 10 | `sf-demo-notebooks-300-sf-demo-cortex-search-rag-01…10` |
| 15 | `sf-demo-semantic-analyst` | Semantic Views 与 Cortex Analyst | data-architecture | 10 | `sf-demo-notebooks-300-sf-demo-semantic-analyst-01…10` |
| 16 | `sf-demo-cortex-agents` | Cortex Agents 工具编排与边界 | snowflake-agent-ml | 10 | `sf-demo-notebooks-300-sf-demo-cortex-agents-01…10` |
| 17 | `sf-demo-agentic-analytics` | Agentic Analytics 端到端分析 | snowflake-agent-ml | 10 | `sf-demo-notebooks-300-sf-demo-agentic-analytics-01…10` |
| 18 | `sf-demo-streamlit-app` | Streamlit in Snowflake 数据应用 | snowflake-data-products | 10 | `sf-demo-notebooks-300-sf-demo-streamlit-app-01…10` |
| 19 | `sf-demo-data-sharing` | 数据共享与应用交付 | snowflake-data-products | 10 | `sf-demo-notebooks-300-sf-demo-data-sharing-01…10` |
| 20 | `sf-demo-role-auditing` | RBAC、MFA 审计与数据访问控制 | data-architecture | 10 | `sf-demo-notebooks-300-sf-demo-role-auditing-01…10` |
| 21 | `sf-demo-files-stages` | Stage、文件与数据摄取边界 | data-engineering | 10 | `sf-demo-notebooks-300-sf-demo-files-stages-01…10` |
| 22 | `sf-demo-external-access` | 外部访问集成与端点安全 | snowflake-devops | 10 | `sf-demo-notebooks-300-sf-demo-external-access-01…10` |
| 23 | `sf-demo-udf-procedure` | UDF、存储过程与语言运行时 | data-engineering | 10 | `sf-demo-notebooks-300-sf-demo-udf-procedure-01…10` |
| 24 | `sf-demo-git-workspaces` | Snowflake Workspaces 与 Git 协作 | snowflake-devops | 10 | `sf-demo-notebooks-300-sf-demo-git-workspaces-01…10` |
| 25 | `sf-demo-cicd-release` | Snowflake CLI、CI/CD 与发布门禁 | snowflake-devops | 10 | `sf-demo-notebooks-300-sf-demo-cicd-release-01…10` |
| 26 | `sf-demo-container-runtime` | Snowflake Container Runtime 与依赖管理 | snowflake-agent-ml | 10 | `sf-demo-notebooks-300-sf-demo-container-runtime-01…10` |
| 27 | `sf-demo-schema-change` | Schema Change Tracker 与兼容性 | data-engineering | 10 | `sf-demo-notebooks-300-sf-demo-schema-change-01…10` |
| 28 | `sf-demo-scheduled-query` | 定时查询、报告和告警调度 | snowflake-devops | 10 | `sf-demo-notebooks-300-sf-demo-scheduled-query-01…10` |
| 29 | `sf-demo-anomaly-detection` | 异常检测与 Cortex ML Functions | snowflake-agent-ml | 10 | `sf-demo-notebooks-300-sf-demo-anomaly-detection-01…10` |
| 30 | `sf-demo-eda-visualization` | EDA、可视化与数据故事 | snowflake | 10 | `sf-demo-notebooks-300-sf-demo-eda-visualization-01…10` |

合计 **30 个知识点 × 每点 10 道 = 300 道**。

## 题目批次

| 文件 | 题量 | 内容 |
|---|---:|---|
| [snowflake-demo-notebooks-300-a.json](../src/data/questions/snowflake-demo-notebooks-300-a.json) | 110 | Notebook 工作区、SQL/Python、Snowpark DataFrame、数据管道、管道可观测性、Warehouse 利用率、Query Profile、成本、缓存、Feature Store、Model Registry |
| [snowflake-demo-notebooks-300-b.json](../src/data/questions/snowflake-demo-notebooks-300-b.json) | 100 | Cortex LLM 函数、文档 AI、Cortex Search/RAG、Semantic Views/Analyst、Cortex Agents、Agentic Analytics、Streamlit、数据共享、RBAC/MFA 审计、Stage/文件 |
| [snowflake-demo-notebooks-300-c.json](../src/data/questions/snowflake-demo-notebooks-300-c.json) | 90 | 外部端点访问、UDF/存储过程、Git/Workspaces、CLI/CI/CD、Container Runtime、Schema 演进、定时查询、异常检测、EDA/可视化 |

## 官方文档入口

下列链接用于核对产品行为。具体功能是否可用仍需结合账户版本、地区、角色授权和目标运行环境验证。

### Notebook、数据工程与查询运维

- [Snowflake Notebooks](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks)
- [Snowpark Python API](https://docs.snowflake.com/en/developer-guide/snowpark/python/index)
- [Data Loading Overview](https://docs.snowflake.com/en/user-guide/data-load-overview)
- [Streams](https://docs.snowflake.com/en/user-guide/streams-intro) 与 [Tasks](https://docs.snowflake.com/en/user-guide/tasks-intro)
- [Virtual Warehouses](https://docs.snowflake.com/en/user-guide/warehouses)
- [Query Profile](https://docs.snowflake.com/en/user-guide/ui-query-profile)
- [Cost Controls](https://docs.snowflake.com/en/user-guide/cost-controlling-controls)
- [Access Control Overview](https://docs.snowflake.com/en/user-guide/security-access-control-overview)

### ML、Cortex 与语义分析

- [Feature Store Overview](https://docs.snowflake.com/en/developer-guide/snowflake-ml/feature-store/overview)
- [Model Registry Overview](https://docs.snowflake.com/en/developer-guide/snowflake-ml/model-registry/overview)
- [Cortex LLM Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/llm-functions)
- [Cortex Search](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [Cortex Analyst](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst)
- [Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Streamlit in Snowflake](https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit)

## 使用与维护建议

1. 先跑题库结构校验和覆盖率报告，确认新增节点能被课程主题正确识别。
2. 对 SQL、权限和产品 API 行为等版本敏感内容，以官方文档及目标账户实测复核；示例 Notebook 不等同于适用于所有账户的生产实现。
3. 将性能题的验收建立在可比工作负载、Query Profile、扫描量/延迟/费用与结果等价性之上；不能仅按代码行数或一次最快运行判断优化收益。
4. 将 Cortex/Agent 题按可验证证据、权限边界、失败处理和人工复核评估，而不把生成结果默认视作真值。
5. 新增或更新题目时继续使用独立 `courseId=snowflake`，并为题目设置 `angle`、知识节点 ID、来源和开放题参考答案；避免把 Snowflake 课程并入 AI taxonomy。
