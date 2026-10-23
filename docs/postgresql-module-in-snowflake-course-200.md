# Snowflake course 下的 PostgreSQL 原生数据库工程模块：200 道题

日期：2026-10-23

## 1. 模块边界

来源：[Snowflake-Labs/postgres-full-day-training](https://github.com/Snowflake-Labs/postgres-full-day-training)。README 将该仓库定义为面向 PostgreSQL 的六到八小时培训，内容按六个小时覆盖 PostgreSQL 入门、SQL、DBA 基础、故障诊断、配置/性能和查询调优。仓库以 PostgreSQL 18 为主要目标，并注明与 PostgreSQL 14+ 兼容。其 SQL 文件和 Markdown 课件覆盖真实 PostgreSQL 机制，例如 psql、Schemas、JSONB、MVCC、WAL、流复制、逻辑复制、PgBouncer、VACUUM、系统目录、work_mem、EXPLAIN、索引类型和全文/向量/空间扩展。

本批是**PostgreSQL 原生知识**，不是将 PostgreSQL 机制改写成 Snowflake 特性。为满足课程入口要求，问题的 `courseId` 和 `category` 设为 `snowflake`，但所有题目与知识节点通过 `postgresql` 主题单独标识。课程 UI 中将其显示为 “PostgreSQL 数据库工程”，便于清楚区分两种数据库。此前已有的 Snowflake 语义改写题集保持独立，不与本批混合。

## 2. 文件、题量和题型

- 题目 001–050：[`postgresql-module-200-a.json`](../src/data/questions/postgresql-module-200-a.json)
- 题目 051–100：[`postgresql-module-200-b.json`](../src/data/questions/postgresql-module-200-b.json)
- 题目 101–150：[`postgresql-module-200-c.json`](../src/data/questions/postgresql-module-200-c.json)
- 题目 151–200：[`postgresql-module-200-d.json`](../src/data/questions/postgresql-module-200-d.json)
- 知识节点：[`postgresql-module.json`](../src/data/knowledge/postgresql-module.json)

共 200 道题、20 个知识节点（每个节点 10 道题）。难度为 100 道 easy 和 100 道 medium；选择题类型为 59 道单选、141 道多选，多选占 70.5%。每道题提供四个选项、正确答案解释、常见误解映射和开放题参考答案，并记录训练章节与官方文档引用。

## 3. 课程主题与 Question ID 覆盖矩阵

| Question IDs | Knowledge ID | 主题 | 难度 |
|---|---|---|---|
| `sf-pg-001`–`sf-pg-010` | `postgresql-basics-connection` | PostgreSQL 架构、连接 URI、psql 与环境核验 | 5 简单 + 5 中级 |
| `sf-pg-011`–`sf-pg-020` | `postgresql-schemas-search-path` | Schema、对象限定名、search_path 与名称解析 | 5 简单 + 5 中级 |
| `sf-pg-021`–`sf-pg-030` | `postgresql-types-constraints` | 数据类型、TIMESTAMPTZ、NUMERIC、约束与唯一性 | 5 简单 + 5 中级 |
| `sf-pg-031`–`sf-pg-040` | `postgresql-roles-privileges` | Role、LOGIN、CONNECT、对象授权和默认权限 | 5 简单 + 5 中级 |
| `sf-pg-041`–`sf-pg-050` | `postgresql-crud-upsert` | CRUD、RETURNING、ON CONFLICT、幂等与行数核验 | 5 简单 + 5 中级 |
| `sf-pg-051`–`sf-pg-060` | `postgresql-joins-aggregation` | JOIN、聚合粒度、fanout、NULL、NOT IN | 5 简单 + 5 中级 |
| `sf-pg-061`–`sf-pg-070` | `postgresql-arrays-jsonb` | 数组、JSON/JSONB、GIN、类型/Schema 漂移 | 5 简单 + 5 中级 |
| `sf-pg-071`–`sf-pg-080` | `postgresql-window-ctes-plpgsql` | 窗口函数、排序、CTE 与 PL/pgSQL | 5 简单 + 5 中级 |
| `sf-pg-081`–`sf-pg-090` | `postgresql-transactions-mvcc` | 事务、MVCC、隔离级别、SAVEPOINT 与幂等写入 | 5 简单 + 5 中级 |
| `sf-pg-091`–`sf-pg-100` | `postgresql-locks-concurrency` | 锁等待、死锁、idle-in-transaction、SKIP LOCKED | 5 简单 + 5 中级 |
| `sf-pg-101`–`sf-pg-110` | `postgresql-backup-restore-pitr` | pg_dump/pg_restore、pg_basebackup、WAL 与 PITR | 5 简单 + 5 中级 |
| `sf-pg-111`–`sf-pg-120` | `postgresql-wal-replication-ha` | WAL、物理/逻辑复制、复制槽、故障切换 | 5 简单 + 5 中级 |
| `sf-pg-121`–`sf-pg-130` | `postgresql-connection-pooling` | PgBouncer、连接池模式、会话状态与池容量 | 5 简单 + 5 中级 |
| `sf-pg-131`–`sf-pg-140` | `postgresql-vacuum-bloat` | VACUUM、Autovacuum、dead tuples、膨胀与 XID 回卷 | 5 简单 + 5 中级 |
| `sf-pg-141`–`sf-pg-150` | `postgresql-partitioning` | RANGE/LIST/HASH 分区、裁剪、约束与生命周期 | 5 简单 + 5 中级 |
| `sf-pg-151`–`sf-pg-160` | `postgresql-catalogs-logging-monitoring` | pg_catalog、pg_stat_*、日志、运行时排错和指标 | 5 简单 + 5 中级 |
| `sf-pg-161`–`sf-pg-170` | `postgresql-memory-parallelism` | shared_buffers、effective_cache_size、work_mem、检查点与并行度 | 5 简单 + 5 中级 |
| `sf-pg-171`–`sf-pg-180` | `postgresql-explain-plans-statistics` | EXPLAIN/ANALYZE、计划估算、BUFFERS、扫描/连接节点 | 5 简单 + 5 中级 |
| `sf-pg-181`–`sf-pg-190` | `postgresql-index-strategies` | B-tree、GIN、GiST、BRIN、复合/部分/表达式索引 | 5 简单 + 5 中级 |
| `sf-pg-191`–`sf-pg-200` | `postgresql-query-patterns-extensions` | N+1、SELECT *、分页、全文搜索、PostGIS、pgvector 与扩展运维 | 5 简单 + 5 中级 |

## 4. 官方资料

题目引用的 `source.relatedMaterials` 采用以下稳定 ID；URL 具体版本固定为 PostgreSQL 18 文档，扩展使用其官方项目/文档网站。培训仓库的主题和代码示例是出题起点，产品行为以对应文档为准。

- [PostgreSQL Tutorial](https://www.postgresql.org/docs/18/tutorial.html) — `pg-doc-tutorial`
- [Installation and setup](https://www.postgresql.org/docs/18/installation.html) — `pg-doc-setup`
- [psql](https://www.postgresql.org/docs/18/app-psql.html) — `pg-doc-psql`
- [Schemas](https://www.postgresql.org/docs/18/ddl-schemas.html) — `pg-doc-ddl-schema`
- [Privileges](https://www.postgresql.org/docs/18/ddl-priv.html) — `pg-doc-privileges`
- [SQL commands](https://www.postgresql.org/docs/18/sql.html) — `pg-doc-sql`
- [Data types](https://www.postgresql.org/docs/18/datatype.html) — `pg-doc-data-types`
- [Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) — `pg-doc-constraints`
- [Data definition](https://www.postgresql.org/docs/18/ddl.html) — `pg-doc-ddl`
- [Client authentication](https://www.postgresql.org/docs/18/client-authentication.html) — `pg-doc-client-auth`
- [Database roles](https://www.postgresql.org/docs/18/user-manag.html) — `pg-doc-security`
- [Data manipulation](https://www.postgresql.org/docs/18/dml.html) — `pg-doc-dml`
- [Queries](https://www.postgresql.org/docs/18/queries.html) — `pg-doc-queries`
- [Joins and table expressions](https://www.postgresql.org/docs/18/queries-table-expressions.html) — `pg-doc-joins`
- [Aggregate functions](https://www.postgresql.org/docs/18/functions-aggregate.html) — `pg-doc-aggregates`
- [Arrays](https://www.postgresql.org/docs/18/arrays.html) — `pg-doc-arrays`
- [JSON functions](https://www.postgresql.org/docs/18/functions-json.html) — `pg-doc-json`
- [Indexes](https://www.postgresql.org/docs/18/indexes.html) — `pg-doc-indexes`
- [Window functions](https://www.postgresql.org/docs/18/functions-window.html) — `pg-doc-window`
- [PL/pgSQL](https://www.postgresql.org/docs/18/plpgsql.html) — `pg-doc-plpgsql`
- [Transactions tutorial](https://www.postgresql.org/docs/18/tutorial-transactions.html) — `pg-doc-transactions`
- [MVCC introduction](https://www.postgresql.org/docs/18/mvcc-intro.html) — `pg-doc-mvcc`
- [Transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html) — `pg-doc-isolation`
- [Explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html) — `pg-doc-locks`
- [Monitoring statistics](https://www.postgresql.org/docs/18/monitoring-stats.html) — `pg-doc-monitoring`
- [Statistics views and counters](https://www.postgresql.org/docs/18/monitoring-stats.html) — `pg-doc-statistics`
- [Routine vacuuming](https://www.postgresql.org/docs/18/routine-vacuuming.html) — `pg-doc-vacuum`
- [WAL](https://www.postgresql.org/docs/18/wal.html) — `pg-doc-wal`
- [Backup and restore](https://www.postgresql.org/docs/18/backup.html) — `pg-doc-backup`
- [High availability](https://www.postgresql.org/docs/18/high-availability.html) — `pg-doc-ha`
- [Logical replication](https://www.postgresql.org/docs/18/logical-replication.html) — `pg-doc-logical-replication`
- [Connection settings](https://www.postgresql.org/docs/18/runtime-config-connection.html) — `pg-doc-connections`
- [PgBouncer configuration](https://www.pgbouncer.org/config.html) — `pg-doc-pgbouncer`
- [Partitioning](https://www.postgresql.org/docs/18/ddl-partitioning.html) — `pg-doc-partitioning`
- [Logging configuration](https://www.postgresql.org/docs/18/runtime-config-logging.html) — `pg-doc-logging`
- [Resource configuration](https://www.postgresql.org/docs/18/runtime-config-resource.html) — `pg-doc-config`
- [Parallel query](https://www.postgresql.org/docs/18/parallel-query.html) — `pg-doc-parallel`
- [Performance tips](https://www.postgresql.org/docs/18/performance-tips.html) — `pg-doc-performance`
- [EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html) — `pg-doc-explain`
- [Full-text search](https://www.postgresql.org/docs/18/textsearch.html) — `pg-doc-textsearch`
- [Extending PostgreSQL](https://www.postgresql.org/docs/18/extend.html) — `pg-doc-extensions`
- [PostGIS](https://postgis.net/documentation/) — `pg-doc-postgis`
- [pgvector](https://github.com/pgvector/pgvector) — `pg-doc-pgvector`

## 5. 版本与质量注意事项

题目以训练仓库和 PostgreSQL 18 文档为主要依据。涉及版本差异的能力应按目标环境核验；例如 `UNIQUE NULLS NOT DISTINCT` 自 PostgreSQL 15 起可用，并非 PostgreSQL 18 才新增。PgBouncer、PostGIS 和 pgvector 是独立工具/扩展，需要另行核查安装状态、版本、索引和托管服务支持。PostgreSQL 数据库能力不等同于 Snowflake 能力；本模块同属 Snowflake 学习入口只是课程组织方式。

## 6. 静态预检与未执行事项

新增题目编号连续且唯一：`sf-pg-001`–`sf-pg-200`；200 道题均有选择/开放两种形式、四个选项、有效答案索引、正确答案对应的 misconceptionMap 为 null；20 个知识节点均能通过 topic/knowledgeId 引用。难度为 100 easy、100 medium，题型 59 单选 / 141 多选。每题都记录来源课程章节与已登记的官方文档 ID。

尚未运行 TypeScript、Vitest、`npm run validate:questions`、全库 question identity/语义去重、typecheck 或 Vite build；静态 JSON 检查不等于项目运行时 Schema 和构建已通过。
