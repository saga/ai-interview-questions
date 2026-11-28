# 构建 CDC 实时数据链路：PostgreSQL 到 Snowflake

## 场景与目标

订单系统运行在 PostgreSQL，运营看板希望在几分钟内看到订单状态和支付变化。全量抽取带来延迟和重复扫描。CDC 降低抽取延迟，但也引入复制槽、offset、事件顺序、schema 变化、重复投递和积压治理问题。

## 架构与数据流

~~~mermaid
flowchart LR
  PG[(PostgreSQL)] --> WAL[WAL / Logical Replication]
  WAL --> Connector[CDC Connector]
  Connector --> Buffer[可选 Buffer / Landing]
  Buffer --> Ingest[流式或微批摄取]
  Ingest --> Raw[(Raw Events)]
  Raw --> Apply[去重、排序、状态合并]
  Apply --> Target[(Current / History)]
  Monitor[LSN、offset、lag、错误率、对账]
  Monitor -.-> WAL
  Monitor -.-> Connector
  Monitor -.-> Target
~~~

## 实施步骤

1. 只同步有明确消费需求的表，检查主键、更新频率、事务大小、DDL 变化和删除语义。没有稳定键的表要先设计事件标识。
2. 在 PostgreSQL 源端配置逻辑复制能力，创建最小范围 publication 和复制槽；评估 WAL 产生速度、slot 保留、磁盘告警、长事务和副本延迟。
3. 配置 CDC Connector，明确 snapshot 与增量切换、offset 持久化、重试、schema 变更策略、秘密管理和网络边界。
4. 按事件速率、延迟、连接器支持和运维能力选择目标端流式或微批处理。Snowpipe Streaming 是目标摄取能力，不替代 PostgreSQL CDC 读取器。
5. Raw 事件尽可能保留源表、主键、操作类型、源事务/位置标识、源时间、摄取时间和 schema 版本，不要只保存合并后的最终行。
6. 使用稳定事件键或源端位置去重；同一主键按源端顺序处理。迟到、重复和乱序事件要有显式策略。
7. 确保 DELETE 能影响目标状态；新增列、类型变化和表重命名要有兼容策略。无法安全自动应用的变更应隔离并告警。
8. 模拟连接器停止、目标不可用、网络中断和复制槽积压，验证 offset 恢复、回补窗口、源库磁盘增长和最终对账。



## 关键取舍

- 消费者长期停滞会导致 WAL 堆积和磁盘耗尽，需要复制槽 lag/保留监控和有界恢复计划。
- 秒级链路需要持续运行组件、告警、容量和故障演练；业务只要求小时级或日级时，微批处理往往更划算。
- Raw 事件适合审计和重放，Current 表服务查询。两者应明确保留和修正规则。
- 各组件有自己的 offset 和事务边界。通过稳定事件键、目标端幂等和对账构建业务正确性，不能把某一组件的保证外推到全链路。

## 验收清单

- PostgreSQL slot lag、WAL 保留量和磁盘使用有告警。
- 连接器 offset 持久化，故障恢复不会静默丢失变更。
- 同一事件重复交付后目标状态不变，UPDATE/DELETE/schema 变化有测试。
- 可比较源端与目标端相同边界上的行数、主键集合或业务汇总。
- 目标端中断后能恢复，并能证明积压已消化。

## 关联知识点

以下节点教程保持各自独立；本教程只提供工程流程上的关联入口。

- [postgresql-wal-replication-ha](../articles/postgresql-wal-replication-ha.md)
- [postgresql-transactions-mvcc](../articles/postgresql-transactions-mvcc.md)
- [postgresql-locks-concurrency](../articles/postgresql-locks-concurrency.md)
- [change-capture-processing](../articles/change-capture-processing.md)
- [snowpipe-streaming](../articles/snowpipe-streaming.md)
- [snowflake-connectors-integrations](../articles/snowflake-connectors-integrations.md)
- [incremental-pipeline-reliability](../articles/incremental-pipeline-reliability.md)
- [snowflake-guide-reliability](../articles/snowflake-guide-reliability.md)
- [snowflake-resource-monitoring-account-usage](../articles/snowflake-resource-monitoring-account-usage.md)

## 参考资料

- [PostgreSQL Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)
- [Snowpipe Streaming Overview](https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview)
- [Dynamic Tables Decision Guide](https://docs.snowflake.com/en/user-guide/dynamic-tables/decision-guide)

参考链接已登记为官方文档入口，来源状态保留为“待核验”，没有把链接登记等同于已逐项复核。
