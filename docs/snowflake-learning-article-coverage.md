# Snowflake 教材覆盖与建设复盘

更新日期：2026-11-28

## 现状核算

仓库当前 Snowflake 学习体系包含 **194 个 KnowledgeNode**，分布在 9 个主题：

| 主题 | 知识节点 | 教程主归属数 |
|---|---:|---:|
| 平台基础与对象模型 | 29 | 6 |
| PostgreSQL 数据库工程 | 20 | 8 |
| 企业数据架构与治理 | 22 | 2 |
| 现代数据工程与管道 | 27 | 6 |
| Iceberg / Lakehouse | 11 | 2 |
| DevOps、发布与可观测性 | 20 | 2 |
| 数据产品与应用交付 | 8 | 2 |
| Cortex GenAI 应用 | 21 | 3 |
| Cortex Agents、ML 与 CoCo | 36 | 6 |
| **合计** | **194** | **37** |

29 篇属于 Snowflake 主课程；8 篇 PostgreSQL 教程作为独立标识的数据库工程补充模块。部分跨主题文章会同时关联多个主题，因此教程主归属数与各主题实际可见文章数不同。

## 为什么旧实现只有 5 篇

1. **教材实现停留在 POC。** 旧的 `src/data/learning/snowflake.ts` 直接把正文写成 TypeScript 字符串，Overview.notes 明确说明“当前 POC 完成平台主干的五篇核心教材”。
2. **初始范围只覆盖 5 个 P0 主干点。** 5 篇文章恰好对应 `snowflake.json` 中最初定义的架构、Warehouse、数据摄取、Streams/Tasks 和 Dynamic Tables 五个节点。
3. **知识库扩张没有带动教材扩张。** 后续路线增加了 SQL、治理、DevOps、Iceberg、Cortex、CoCo、Notebooks、Developer Guides、COF-C03、资产管理和 PostgreSQL 等主题；新增内容主要落在 KnowledgeNode、题目和 Roadmap。
4. **内容目录没有真正建立。** `src/data/courses/` 只有占位文件；没有独立 Markdown 教材目录、文章索引或课程内容加载器。
5. **测试门槛只保护最初五篇。** 旧测试要求教材包数量大于等于 5，并且只验证五个初始 P0 节点。没有要求覆盖全部课程主题，也没有检测新增 KnowledgeNode 是否有教材。
6. **学习页面只读取一份静态文章数组。** 没有文章的节点只能显示摘要和“待建设”，不会自动继承同主题的课程教材。

这是课程内容生产和覆盖校验断层，不是课程本身只有五个合理章节。

## 本次修正

- 将原有 5 篇教程正文迁入独立 Markdown 文件。
- 新增 24 篇 Snowflake 教程，覆盖对象模型、半结构化数据、Time Travel、查询优化、SQL/Snowpark、管道质量、集成、建模、治理、DevOps、FinOps、Iceberg、数据产品、Cortex、Agent、ML、CoCo 和资产管理案例。
- 新增 8 篇 PostgreSQL 教程，覆盖 SQL、事务、索引、VACUUM、备份、高可用、连接管理和监控。
- 使用文章索引按主题关联 KnowledgeNode；新节点会自动获得所属主题的文章。
- 增加测试：教程数量、Markdown 内容、9 个主题、所有 Snowflake KnowledgeNode 教材覆盖和来源资料都必须有效。

## 维护规则

新增或扩展知识节点时，先确定其课程主题。该主题已有教程时，判断是否需要补充现有文章；若知识范围形成新的教学目标，再新增独立教程。新增节点不能再静默进入“教材待建设”状态。
