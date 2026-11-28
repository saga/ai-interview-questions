# 从业务系统到分析平台：企业数据平台端到端架构

## 场景与目标

订单系统运行在 PostgreSQL，CRM 和支付服务提供 API，其他数据以批量文件到达。管理层需要统一经营分析，运营团队关注订单状态，审计团队要求能追溯来源、回补数据并控制访问。目标不是把所有系统搬进一个数据库，而是建立职责清楚、可恢复、可治理的数据链路。

## 架构与数据流

~~~mermaid
flowchart LR
  subgraph Sources[业务数据源]
    PG[(PostgreSQL OLTP)]
    SaaS[SaaS / API]
    Files[批量文件]
  end
  subgraph Ingest[接入层]
    CDC[CDC Connector]
    Batch[Batch Load]
    Landing[(Object Storage)]
  end
  subgraph Platform[分析平台]
    Raw[(Raw)]
    Std[(Standardized)]
    Curated[(Curated / Marts)]
    Sem[Semantic Views]
  end
  Users[BI / 数据产品 / AI]
  Gov[身份、权限、质量、血缘、审计]
  PG --> CDC --> Raw
  SaaS --> Batch --> Raw
  Files --> Landing --> Raw
  Raw --> Std --> Curated --> Sem --> Users
  Gov -.贯穿.-> Ingest
  Gov -.贯穿.-> Platform
~~~

## 实施步骤

1. 先盘点消费者、业务问题、数据范围、更新频率、敏感等级和负责人。订单明细与经营日报的延迟要求不同，不必走同一条链路。
2. 确认源端约束。PostgreSQL 要检查主键、事务量、逻辑复制能力、WAL 保留和高峰时段；SaaS/API 要检查分页、速率限制、增量游标和删除语义。
3. 按延迟选择接入方式。日批文件可采用对象存储加批量加载；持续同步的表可评估 CDC。不要仅凭“实时”二字引入持续运行组件。
4. 保留接入证据。尽可能保存源主键、源更新时间、接入时间、批次或事件标识；文件记录文件名、行数和校验和，CDC 记录源位置与 offset。
5. 先定义事实表的业务粒度，再确定维度、历史策略和去重规则。不能在粒度未定时直接做汇总。
6. 明确 Raw、Standardized、Curated 的进入条件和责任。Raw 负责可追溯，标准化层负责结构一致，Curated 负责业务分析语义。
7. 把数据质量、血缘、权限和运行监控纳入发布流程，而不是等消费者发现问题后补充。
8. 为每个数据集发布字段、指标、刷新频率、允许延迟、质量阈值、访问角色和弃用流程。



## 关键取舍

- 源系统与分析平台分离：事务和在线写入由业务数据库负责，复杂分析由分析平台承担；回写和业务决策仍由专门服务负责。
- Raw 历史保留便于重放和审计，但增加存储与隐私义务。按法规、恢复目标和业务价值决定保留窗口。
- 批量接入简单、容易回补；CDC 延迟低，但必须管理 offset、schema 变化、删除事件、复制槽积压和源端负载。
- 统一治理不等于统一存储。PostgreSQL 的 MVCC/WAL/索引与 Snowflake 的虚拟仓库/微分区是不同机制，不能混用运维手册。

## 验收清单

- 每个数据集有明确 owner、用途、消费者和业务粒度。
- 能从 Curated 数据追溯到源系统、批次或 CDC 记录。
- 重复投递不会造成重复业务结果；失败后有重试、回补和对账方法。
- 权限按角色和敏感等级授予，生产数据访问可以审计。
- 能演示一次源端中断、恢复接入和结果对账。

## 关联知识点

以下节点教程保持各自独立；本教程只提供工程流程上的关联入口。

- [snowflake-architecture](../articles/snowflake-architecture.md)
- [snowflake-core-objects](../articles/snowflake-core-objects.md)
- [enterprise-data-zones](../articles/enterprise-data-zones.md)
- [dimensional-modeling](../articles/dimensional-modeling.md)
- [snowflake-data-loading](../articles/snowflake-data-loading.md)
- [postgresql-basics-connection](../articles/postgresql-basics-connection.md)
- [postgresql-wal-replication-ha](../articles/postgresql-wal-replication-ha.md)
- [data-observability-lineage](../articles/data-observability-lineage.md)
- [object-access-governance](../articles/object-access-governance.md)

## 参考资料

- [Snowflake 架构与核心概念](https://docs.snowflake.com/en/user-guide/intro-key-concepts)
- [PostgreSQL 逻辑复制](https://www.postgresql.org/docs/current/logical-replication.html)
- [Snowflake 数据管道概览](https://docs.snowflake.com/en/user-guide/data-pipelines-intro)

参考链接已登记为官方文档入口，来源状态保留为“待核验”，没有把链接登记等同于已逐项复核。
