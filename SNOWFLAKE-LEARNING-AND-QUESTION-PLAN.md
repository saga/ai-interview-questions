# Snowflake 学习路径与题库建设计划

**日期：** 2026-10-19  
**目标仓库：** [saga/ai-interview-questions](https://github.com/saga/ai-interview-questions)  
**基线：** `main`，审查时最新提交 `09b4a5c354ba37a8de24409c0ec8b5eb2a012de0`

## 1. 目标与范围

在现有学习训练器中新增 Snowflake 独立课程，而不是将其归类为 AI 的一个能力域。进入训练前先选择 AI、Snowflake 或未来登记的其他知识体系；选定后，课程主题、知识节点、题目池、推荐、覆盖分析和进度历史均在该体系内运行。保持题目 JSON 契约与通用训练引擎，不引入数据库或新的题库加载层。

本次计划覆盖：
- Snowflake 平台基础与架构：存储/计算/Cloud Services、虚拟仓库隔离、并发扩缩、成本控制、数据加载、CDC、Dynamic Tables、语义层、安全与治理。
- 数据架构：分层建模、历史数据保留、源系统与分析平台边界、数据质量和业务语义。
- 数据工程实战：SQL 版本控制、Git/CI/CD、环境迁移、增量处理、幂等重跑、测试与可观测性。
- 通过仓库现有自动加载机制加入知识节点和问题集，并更新文档及验证结果。

明确不在本次范围：批量清理历史 `temp/` / `analysis/` 资产、重写前端或学习算法、引入新的第三方运行时依赖、重构整个题库治理工具链。

## 2. 当前代码库审查结论

### 2.1 已确认的结构事实

- 题目由 `src/data/questions/*.json` 经 `import.meta.glob` 自动加载；知识节点由 `src/data/knowledge/*.json` 加载。
- 题目字段 `topic` 必须指向一个现有 KnowledgeNode 的 `id`；`category` 对应 taxonomy 的二级 topic slug。仅添加题目 JSON 会因知识节点缺失而无法通过验证。
- 题目契约由 Zod 定义，并受 `question:add`、`validate:questions`、长度偏差 lint、题目身份和 variant 检查约束。
- 当前 `main` 包含 93 个题目 JSON、22 个知识点 JSON、95 个变体 JSON；仓库没有 Snowflake 命名的文件或现有 Snowflake 专属分类。
- AI 原有六个能力域由 `TAXONOMY` 维护；`data-platform` 仅作为 Snowflake 知识节点的兼容性 area 元数据，不能把 Snowflake 主题注册为 AI taxonomy 域。
- README 和架构文档仍记载“82 个题目文件、1357 题”，与当前目录状态及测试注释中的题目数量不一致，属于文档计数漂移；实施时应更新可确定的文件数，不在未重算全库数据前猜测题量。
- 当前有 98 个被跟踪的 `temp/` 文件。它们可能承载尚未整理的题库生成和审查结果；本次只记录为维护性问题，不未经确认删除。
- GitHub 返回的最新 `main` Actions 工作流运行结论为 failure，但当前连接器没有返回其 job 明细。后续验证必须重新运行可用的本地检查/CI，不能把部署状态当作测试通过。

### 2.2 架构分类决策（已修订）

Snowflake 是完整的数据平台课程，涵盖数仓架构、数据建模、治理、SQL 交付和数据运维，与 AI/LLM 课程没有内容归属关系。初版曾把它作为第七个能力域添加到 AI taxonomy；该设计现已纠正为顶层学习体系边界。

**采用独立 `courseId=snowflake` 学习体系**，其下设三个课程主题：
- `snowflake`：Snowflake 平台与 SQL/对象模型；
- `data-architecture`：企业数据架构与数据建模；
- `data-engineering`：摄取、转换、编排、测试、部署与运维。

AI 继续使用原有六个能力域。进入训练前通过 `/learn` 选择学习体系，课程筛选、推荐、进度和历史均不跨体系混合。新增其他知识体系通过课程注册表扩展，而不是向 AI taxonomy 追加非 AI 领域。
## 3. 拟实施变更

| 文件/目录 | 变更 |
| --- | --- |
| 根目录本文件 | 记录审查结论、设计决策、实施状态和验证结果 |
| `src/schemas/common.ts` | （仅批准新增能力域时）增加 `data-platform` 到 KnowledgeArea 枚举并更新注释 |
| `src/data/taxonomy.ts` | 添加数据平台分类骨架和学习主题说明 |
| `src/data/taxonomy.test.ts` | 若新增能力域，更新能力域数量断言；补充新 topic 映射测试 |
| `src/domain/knowledge/nodes.ts` | （仅新增能力域时）增加领域显示标签 |
| `src/data/knowledge/{snowflake,data-architecture,data-engineering}.json` | 按三个 topic 分组新增结构化知识节点 |
| `src/data/questions/snowflake.json` | 新增 Snowflake 平台问题，含场景、多选与开放题参考答案 |
| `src/data/questions/data-architecture.json` | 新增企业数据架构与建模实战题 |
| `src/data/questions/data-engineering.json` | 新增数据工程、CI/CD、质量控制和运行排障题 |
| `README.md`、`docs/ARCHITECTURE.md` | 更新题库文件数量、分类说明和扩展方法 |
| `docs/CHANGELOG.md` | 在顶部追加本次分类和内容变更记录 |

预计首批 15 道题，按三个主题各 5 道组织。每个批次以多选题为主（至少 4/5），同时提供清晰的开放题参考答案；题干自包含、选项长度平衡，避免产品名记忆题和无依据的性能承诺。

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

## 6. 当前状态

- [x] 检查仓库树、题目与知识点数据契约、taxonomy、题库验证脚本、CI workflow。
- [x] 初版把 Snowflake 放入 AI 第七能力域；根据课程边界复核，已纠正该设计。
- [x] AI taxonomy 恢复为原有六个能力域，Snowflake 使用独立课程注册表、主题目录与角度白名单。
- [x] 新增必经入口 `/learn`：进入训练前先选择 AI 或 Snowflake；为其他知识体系预留注册扩展方式。
- [x] 为 15 个 Snowflake 知识节点与 15 道题标记 `courseId=snowflake`，并保留原有选择/开放双形态。
- [x] 训练、组卷、自适应候选池、继续训练、进度与会话历史按所选课程隔离；旧的无 `courseId` 记录按知识节点映射兼容。
- [x] 更新 taxonomy 测试、课程主题标签、README、架构文档、ADR-091 与 CHANGELOG。
- [ ] 按用户本轮指示，本次只完成代码/文档功能修改，不等待或声称测试、CI、构建门禁已通过；需要后续在可运行环境补做回归。
## 7. 官方技术依据

- [Snowflake key concepts and architecture](https://docs.snowflake.com/en/user-guide/intro-key-concepts)
- [Overview of data loading](https://docs.snowflake.com/en/user-guide/data-load-overview)
- [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Introduction to streams](https://docs.snowflake.com/en/user-guide/streams-intro)
- [Introduction to tasks](https://docs.snowflake.com/en/user-guide/tasks-intro)
- [Dynamic table target lag](https://docs.snowflake.com/en/user-guide/dynamic-tables/target-lag)
- [Dynamic table refresh modes](https://docs.snowflake.com/en/user-guide/dynamic-tables/refresh-modes)
- [Creating semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/creating)
- [Overview of access control](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [Cost controls for warehouses](https://docs.snowflake.com/en/user-guide/cost-controlling-controls)
