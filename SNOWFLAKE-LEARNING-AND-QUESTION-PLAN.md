# Snowflake 学习路径与题库建设计划

**日期：** 2026-10-19  
**目标仓库：** [saga/ai-interview-questions](https://github.com/saga/ai-interview-questions)  
**基线：** `main`，审查时最新提交 `09b4a5c354ba37a8de24409c0ec8b5eb2a012de0`

## 1. 目标与范围

在现有学习训练器中新增 Snowflake 独立课程，而不是将其归类为 AI 的一个能力域。进入训练前先选择 AI、Snowflake 或未来登记的其他知识体系；选定后，课程主题、知识节点、题目池、推荐、覆盖分析和进度历史均在该体系内运行。保持题目 JSON 契约与通用训练引擎，不引入数据库或新的题库加载层。

本次以 8 门公开 Coursera 课程的章节主题作为教学路线，并以 Snowflake 官方文档核验产品行为。知识骨架分为八个 Snowflake 课程主题：平台基础与对象模型、企业数据架构与治理、现代数据工程与管道、Apache Iceberg/Lakehouse、DevOps/发布/可观测性、数据产品与应用交付、Cortex GenAI 应用、Cortex Agents/ML/CoCo。为每个新知识点配置可追溯的双形态题目，并提供专用 curriculum authoring skill。

明确不在本次范围：批量清理历史 `temp/` / `analysis/` 资产、重写前端或学习算法、引入新的第三方运行时依赖、重构整个题库治理工具链。

## 2. 当前代码库审查结论

### 2.1 已确认的结构事实

- 题目由 `src/data/questions/*.json` 经 `import.meta.glob` 自动加载；知识节点由 `src/data/knowledge/*.json` 加载。
- 题目字段 `topic` 必须指向一个现有 KnowledgeNode 的 `id`；`category` 对应 taxonomy 的二级 topic slug。仅添加题目 JSON 会因知识节点缺失而无法通过验证。
- 题目契约由 Zod 定义，并受 `question:add`、`validate:questions`、长度偏差 lint、题目身份和 variant 检查约束。
- 当前 main 已建立独立 Snowflake 课程文件与来源标记；本轮在现有 15 个知识点/题目基础上扩展题目与知识骨架，不向 AI 六大能力域 taxonomy 增加 Snowflake 主题。
- AI 原有六个能力域由 `TAXONOMY` 维护；`data-platform` 仅作为 Snowflake 知识节点的兼容性 area 元数据，不能把 Snowflake 主题注册为 AI taxonomy 域。
- README 和架构文档仍记载“82 个题目文件、1357 题”，与当前目录状态及测试注释中的题目数量不一致，属于文档计数漂移；实施时应更新可确定的文件数，不在未重算全库数据前猜测题量。
- 当前有 98 个被跟踪的 `temp/` 文件。它们可能承载尚未整理的题库生成和审查结果；本次只记录为维护性问题，不未经确认删除。
- GitHub 返回的最新 `main` Actions 工作流运行结论为 failure，但当前连接器没有返回其 job 明细。后续验证必须重新运行可用的本地检查/CI，不能把部署状态当作测试通过。

### 2.2 架构分类决策（已修订）

Snowflake 是完整的数据平台课程，涵盖数仓架构、数据建模、治理、SQL 交付和数据运维，与 AI/LLM 课程没有内容归属关系。初版曾把它作为第七个能力域添加到 AI taxonomy；该设计现已纠正为顶层学习体系边界。

**采用独立 `courseId=snowflake` 学习体系**，与 AI 六大能力域并列，包含八个课程主题：
- `snowflake`：平台基础与对象模型；
- `data-architecture`：企业数据架构与治理；
- `data-engineering`：现代数据工程与管道；
- `snowflake-lakehouse`：Apache Iceberg 与 Lakehouse；
- `snowflake-devops`：DevOps、发布与可观测性；
- `snowflake-data-products`：数据产品与应用交付；
- `snowflake-genai`：Cortex GenAI 应用；
- `snowflake-agent-ml`：Cortex Agents、ML 与 CoCo。

AI 继续使用原有六个能力域。进入训练前通过 `/learn` 选择学习体系，课程筛选、推荐、进度和历史均不跨体系混合。新增其他知识体系通过课程注册表扩展，而不是向 AI taxonomy 追加非 AI 领域。
## 3. 已实施变更

| 文件/目录 | 已实施内容 |
| --- | --- |
| `src/data/learningTracks.ts` | Snowflake 独立课程的 8 个主题、标签和描述 |
| `src/data/knowledge/snowflake-extended.json` | 新增 24 个知识节点；原 15 个节点继续保留 |
| `src/data/questions/snowflake-course-extension.json` | 新增 26 道双形态题：24 道支撑新节点，另加 2 道端到端综合题 |
| `src/schemas/question.ts` | 为题目来源增加 `relatedMaterials`，连接课程章节与官方文档 |
| `docs/snowflake-course-roadmap.md` | 8 门课程、模块摘要、官方文档索引、知识映射、依赖图和毕业实践 |
| `skills/snowflake-curriculum/SKILL.md` | 专用内容建设 prompt/skill，约束课程归属、来源溯源与题目质量 |
| `docs/snowflake-learning-path.md`、README、CHANGELOG | 指向完整 roadmap 并记录内容扩展 |
## 4. 内容设计与学习顺序

1. **基础机制**：云服务层、持久化存储、虚拟仓库与独立计算、微分区/查询执行的职责边界。
2. **数据接入与转换**：`COPY INTO`、Snowpipe、Snowpipe Streaming 的场景差异；Streams/Tasks 与 Dynamic Tables 的选择；刷新目标、延迟监控和重放语义。
3. **数据架构**：Raw/Conformed/Curated 分层、源系统解耦、事实与维度建模、迟到数据、历史快照、重算与回补。
4. **安全与治理**：RBAC、最小权限、动态脱敏、行访问策略、审计和职责分离。
5. **语义层与 SQL 工程**：语义视图的业务指标/维度表达；SQL 的测试、代码审查、迁移、版本化和可观察性。
6. **生产案例**：批量供应商文件落地、近实时变更捕获、跨环境 SQL 发布、账务/订单历史回补、查询性能与成本排障。

Snowflake 功能行为应以官方文档为证据来源；涉及版本、版本等级、预览状态或性能边界的内容应谨慎表述，并避免把目标延迟说成硬性 SLA。

## 5. 验收标准

- 新知识节点通过 KnowledgeNode schema，全部新题的 `topic` 都存在于知识节点集合中。
- 所有新题 ID 全局唯一，题干无规范化重复；选择题答案索引合法、选项不重复。
- 每个新增题目批次通过 `npm run question:add -- --file <draft.json> --check` 的门禁；多选题占比不低于 2/3，选项长度比不超过 1.8。
- 通过 `npm run typecheck`、`npm run test`、`npm run validate:questions`、`npm run lint:bias`、`npm run lint:length -- --changed`、`npm run question:identity -- --gate`、`npm run question:validate-variants` 与 `npm run build`（若可在当前环境执行）。
- `npm run question:coverage` 能展示新知识点的题目覆盖。
- README/架构文档不再声称当前题库仍只有 82 个 JSON 文件；架构与变更记录同步。
- 最终报告区分“实际运行通过”“未能运行”和“已有失败但未能定位”，不以静态检查代替真实测试。

## 6. 当前状态（截至 2026-10-19）

- [x] AI taxonomy 保持原有六个能力域；Snowflake 作为独立 `courseId=snowflake` 课程。
- [x] Snowflake 独立课程包含八个注册主题，沿用 8 门公开 Coursera 课程的学习路线。
- [x] 累计 60 个 Snowflake 知识节点：原有 39 个节点保留，并新增 21 个细分节点。
- [x] 累计 341 道 Snowflake 题目：原有 41 道保留，新增 300 道；每个 60 个知识节点都有 5 道本轮新增题。
- [x] 新题全部记录主课程 ID、公开模块主题和 Snowflake 官方文档 ID；逐题矩阵见 `docs/snowflake-question-coverage-300.md`。
- [x] 补足 Iceberg Catalog/manifest/并发迁移、Cortex 模型与 SQL 防护、Search/Analyst 评测、Agent 权限与恢复，以及 CoCo 开发治理知识点。
- [ ] 未运行 TypeScript、Vitest、题库 CLI 门禁、全库重复检查或 build；本轮结果只经过生成后静态预检，不能标记测试/CI 通过。

## 7. 官方技术依据

- [Key concepts and architecture](https://docs.snowflake.com/en/user-guide/intro-key-concepts)
- [Virtual warehouses](https://docs.snowflake.com/en/user-guide/warehouses)
- [Data loading overview](https://docs.snowflake.com/en/user-guide/data-load-overview)
- [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Snowpipe Streaming](https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview)
- [Streams and Tasks](https://docs.snowflake.com/en/user-guide/data-pipelines-intro)
- [Dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/overview)
- [Time Travel](https://docs.snowflake.com/en/user-guide/data-time-travel)
- [Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg)
- [Iceberg table maintenance](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
- [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/index)
- [Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/creating)
- [Access control](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [Cortex AI functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/llm-functions)
- [Cortex Search](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [Cortex Analyst](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst)
- [Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Query Profile](https://docs.snowflake.com/en/user-guide/ui-query-profile)
- [CoCo documentation search](https://docs.snowflake.com/en/search?q=CoCo)


## 8. 2026-10-19 内容扩展记录

本轮新增 300 道题和 21 个知识点，不替换原题；题目按 8 门课程分配为 40/45/40/35/35/40/35/30。每个知识节点覆盖机制、设计、诊断、取舍、Runbook/验收证据五类评估视角，所有题均有选择题、开放题参考答案及课程/官方文档溯源。

详见 [逐题覆盖矩阵](docs/snowflake-question-coverage-300.md) 和 [课程 Roadmap](docs/snowflake-course-roadmap.md#8-新增-300-道课程来源可追溯题-2026-10-19)。


## 9. 简单/中等题目扩展记录（2026-10-19）

新增 200 道直白的入门/中级问题：120 道简单题、80 道中等题，不新增困难题；40 个知识点各 5 题，按 8 门课程各 25 道分配。新增 19 个知识点，另为 21 个既有知识点增加基础题。

本批重点覆盖 Stage/File Format、微分区、加载校验、SQL 基础转换、Query History、Snowflake CLI、Iceberg 管理/刷新/Schema 演进、Cortex 文本处理与 Prompt、Semantic View、Search 服务、Agent 线程与工具选择、CoCo 数据探索和 SQL 审查。

逐题追溯矩阵见 [docs/snowflake-question-coverage-200.md](docs/snowflake-question-coverage-200.md)。


## 10. SnowPro Core COF-C03 认证考点题库（2026-10-19）

新增 200 道简单/中等题，以官方 COF-C03 Study Guide 的五个 Domain 权重为题量蓝图（62/40/36/42/20），并使用公开练习题列表作为覆盖点交叉参考。题目为原创内容，不复制第三方题库原文。

- 新增 18 个知识点，累计知识点 97 个。
- 新增 200 道题，累计 Snowflake 题目 741 道。
- 难度：120 道简单、80 道中等。
- 逐题来源、Coursera 模块、考试 Objective 和官方文档映射见 [覆盖矩阵](docs/snowflake-certification-cof-c03-coverage-200.md)。

未运行 schema、CLI 门禁、测试、全库重复检查或 build。
