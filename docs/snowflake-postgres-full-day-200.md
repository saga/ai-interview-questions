# PostgreSQL Full-Day Training 主题适配：Snowflake 200 道题

日期：2026-10-23

## 范围与来源判断

参考来源为 [Snowflake-Labs/postgres-full-day-training](https://github.com/Snowflake-Labs/postgres-full-day-training)。这是一个以 PostgreSQL 为目标的全日培训仓库，内容包含 SQL 基础、JOIN/聚合、JSON 与窗口函数/CTE、DML、备份与复制、系统目录/日志/阻塞诊断、执行计划、查询性能和资源调优。本批借用其**课程主题与问题域**，不将 PostgreSQL 的产品机制当作 Snowflake 机制，也不复制其培训代码作为 Snowflake 方案。

题目独立归入现有 Snowflake 学习体系（`courseId: "snowflake"`），涵盖 20 个知识主题，每个主题 10 题，共 200 题：100 道简单题、100 道中级题。选择题 54 道单选、146 道多选；每题同时提供选择题和开放题参考答案，保留主教学来源模块及 Snowflake 官方交叉验证文档 ID。

## 文件清单

- 题目 001–100：[`snowflake-postgres-full-day-200-a.json`](../src/data/questions/snowflake-postgres-full-day-200-a.json)
- 题目 101–150：[`snowflake-postgres-full-day-200-b.json`](../src/data/questions/snowflake-postgres-full-day-200-b.json)
- 题目 151–200：[`snowflake-postgres-full-day-200-c.json`](../src/data/questions/snowflake-postgres-full-day-200-c.json)
- 新增知识节点：[`snowflake-postgres-full-day.json`](../src/data/knowledge/snowflake-postgres-full-day.json)

## 模块—知识点—题目覆盖矩阵

| Question IDs | Knowledge ID | 覆盖主题 | 难度 |
|---|---|---|---|
| `sf-pgtd-001`–`sf-pgtd-010` | `snowflake-sql-foundations` | NULL、类型转换、时间戳、对象上下文和约束边界 | 5 简单 + 5 中级 |
| `sf-pgtd-011`–`sf-pgtd-020` | `snowflake-query-joins-aggregation` | JOIN、NULL 过滤、聚合粒度、fanout 与指标正确性 | 5 简单 + 5 中级 |
| `sf-pgtd-021`–`sf-pgtd-030` | `snowflake-window-ctes` | 窗口函数、frame、排名、LAG/LEAD、CTE 与 QUALIFY | 5 简单 + 5 中级 |
| `sf-pgtd-031`–`sf-pgtd-040` | `semi-structured-data` | VARIANT、JSON 路径、FLATTEN、类型和 Schema Drift | 5 简单 + 5 中级 |
| `sf-pgtd-041`–`sf-pgtd-050` | `snowflake-dml-data-correctness` | DML/MERGE、键唯一性、幂等、批次对账与数据质量 | 5 简单 + 5 中级 |
| `sf-pgtd-051`–`sf-pgtd-060` | `snowflake-transactions-concurrency` | 事务提交/回滚、执行等待、重试、并发写入和幂等性 | 5 简单 + 5 中级 |
| `sf-pgtd-061`–`sf-pgtd-070` | `time-travel-cloning` | Time Travel、UNDROP、克隆、Fail-safe 与保留窗口 | 5 简单 + 5 中级 |
| `sf-pgtd-071`–`sf-pgtd-080` | `snowflake-data-loading` | COPY INTO、文件格式、加载历史、错误处理与重载边界 | 5 简单 + 5 中级 |
| `sf-pgtd-081`–`sf-pgtd-090` | `change-capture-processing` | Streams、Tasks、Dynamic Tables、CDC offset、重放和新鲜度 | 5 简单 + 5 中级 |
| `sf-pgtd-091`–`sf-pgtd-100` | `snowflake-guide-task-dag` | 任务依赖、失败恢复、运行记录与管道验收 | 5 简单 + 5 中级 |
| `sf-pgtd-101`–`sf-pgtd-110` | `warehouse-query-diagnostics` | 元数据可见性、会话上下文、角色和对象排错 | 5 简单 + 5 中级 |
| `sf-pgtd-111`–`sf-pgtd-120` | `snowflake-query-history` | Query History、Query Tag、历史窗口、排队和性能回归 | 5 简单 + 5 中级 |
| `sf-pgtd-121`–`sf-pgtd-130` | `snowflake-query-profile-troubleshooting` | 执行算子、扫描/溢写、队列时间、JOIN 基数和性能验收 | 5 简单 + 5 中级 |
| `sf-pgtd-131`–`sf-pgtd-140` | `virtual-warehouse` | 仓库职责、大小、多集群、隔离、暂停/恢复及成本 | 5 简单 + 5 中级 |
| `sf-pgtd-141`–`sf-pgtd-150` | `snowflake-caching` | Warehouse cache、持久化结果、基线条件和缓存偏差 | 5 简单 + 5 中级 |
| `sf-pgtd-151`–`sf-pgtd-160` | `snowflake-micro-partitions` | 微分区、裁剪、数据分布、聚簇键的适用条件 | 5 简单 + 5 中级 |
| `sf-pgtd-161`–`sf-pgtd-170` | `snowflake-query-optimization-services` | Search Optimization、Query Acceleration、物化视图与选型 | 5 简单 + 5 中级 |
| `sf-pgtd-171`–`sf-pgtd-180` | `snowflake-layout-performance-patterns` | SELECT *、分页、重复查询、逻辑粒度与发布前性能验证 | 5 简单 + 5 中级 |
| `sf-pgtd-181`–`sf-pgtd-190` | `snowflake-role-hierarchy-grants` | RBAC、角色继承、OWNERSHIP、脱敏与行访问策略 | 5 简单 + 5 中级 |
| `sf-pgtd-191`–`sf-pgtd-200` | `snowflake-resource-monitoring-account-usage` | Resource Monitor 范围、成本归因、预算告警和 FinOps | 5 简单 + 5 中级 |

## 来源与技术语义

所有题目的主教学来源字段使用 `source.materialId = "postgres-full-day-training"`，`source.section` 保存对应公开课程模块，`source.relatedMaterials` 引用可交叉核对的 Snowflake 官方文档 ID。官方文档 ID 和 URL 的映射列于 [Snowflake course roadmap](./snowflake-course-roadmap.md) 的第 13 节。

本次有意将 PostgreSQL 特定主题转换成平台原生问题，而不是做名词替换：

- WAL / 备份与复制主题改写为 Snowflake Time Travel、对象克隆、Streams/Tasks、Dynamic Tables 和可重放的摄取设计。
- 系统目录、锁/阻塞与日志排错改写为 Snowflake 元数据接口、Query History、Query Profile、角色/授权、查询排队和运行历史诊断。
- `shared_buffers`、`work_mem`、传统 B-tree 索引和 PostgreSQL 执行算子主题改写为虚拟仓库规模/并发、缓存行为、微分区裁剪、聚簇、Search Optimization、Query Acceleration 与物化视图的适用性判断。
- PostgreSQL 的 `pg_stat_*`、VACUUM 等命令不作为 Snowflake 正确答案，也不会声称两个数据库共享同一种物理执行机制。

## 预检结果与未执行项

对本次新增三份题目 JSON 和知识节点 JSON 做了静态预检：恰好 200 道，ID 从 `sf-pgtd-001` 连续到 `sf-pgtd-200` 且唯一；难度为 100 easy、100 medium；54 单选、146 多选；每道题有 4 个选项、答案索引有效，`misconceptionMap` 与选项长度一致且正确答案不映射误解；所有题目引用的 `topic/knowledgeId` 均能找到知识节点。

尚未运行本地 TypeScript、Vitest、完整 `npm run validate:questions`、题目身份/全库重复检查或 Vite build。静态预检不等于运行时 Schema 和完整 CI 已通过。
