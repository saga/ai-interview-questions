# 构建可靠的 ELT 数据管道：从文件接入到可验证的数据集

## 场景与目标

订单系统每天输出增量文件，营销系统持续投递客户事件。分析团队需要统一订单事实表和客户维度。真正的难点不是写出一条 COPY INTO，而是重复投递、坏文件、字段变化和任务失败后结果仍可解释、可恢复。

## 架构与数据流

~~~mermaid
flowchart TD
  A[上游文件] --> B[Stage / File Format]
  B --> C[装载校验]
  C --> D[(Raw)]
  D --> E[标准化与去重]
  E --> F[质量门禁 / 隔离]
  F --> G[(Curated)]
  G --> H[指标与消费者]
  I[调度 / 发布] --> B
  I --> E
  J[批次、行数、血缘、告警] -.观测.-> C
  J -.观测.-> G
~~~

## 实施步骤

1. 约定文件契约：格式、编码、时区、字段类型、业务主键、批次日期、空值规则、删除表达方式和 schema 变更流程。文件名不能替代记录级业务主键。
2. 建立 Stage、File Format 和存储集成，将凭证与加载角色分离，避免在脚本和个人工作站中散落长期密钥。
3. 批量文件使用 COPY INTO，持续到达的文件可评估 Snowpipe。配置错误处理和加载历史检查；文件加载成功不等于数据完整。
4. 保存文件名、源系统、批次、加载时间、源更新时间等装载元数据。关键批次记录预期文件数、行数、金额合计或校验和。
5. 标准化层显式处理类型、时区、编码、空值和非法值；基于业务主键和源更新时间定义去重，不要简单保留最后到达的一行。
6. 将主键唯一性、非空、引用完整性、枚举范围、金额对账和批次完整性作为发布检查。失败数据进入隔离区并保留原因。
7. 变更记录和事务边界清晰时评估 Streams + Tasks；声明式表依赖和刷新目标清晰时评估 Dynamic Tables；模型测试和环境管理可配合 dbt。
8. 支持按日期或批次重算。先在隔离目标验证，再更新正式数据集。模型、质量规则和部署脚本进入版本控制。

### 示例：确定性去重

假设 Raw 表保留订单业务键、源更新时间和加载批次：

~~~sql
CREATE OR REPLACE TABLE curated_orders AS
SELECT order_id, customer_id, order_status, amount, source_updated_at
FROM raw_orders
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY order_id
  ORDER BY source_updated_at DESC, ingest_batch_id DESC
) = 1;
~~~

这只解决“每个订单保留一个当前版本”。若需要完整变更历史，应保留事件序列或采用 SCD/事件建模；若源更新时间不可靠，还需制定版本冲突规则。

## 关键取舍

- COPY INTO 适合有明确批次和回补窗口的文件；Snowpipe 面向持续文件接入。两者都需要独立的数据完整性检查。
- Streams/Tasks 侧重变更消费和显式调度；Dynamic Tables 侧重声明式依赖与刷新目标。应比较失败恢复、延迟和维护成本。
- 增量处理节省资源，但必须定义更新、删除、迟到和重复事件语义；体量不大或逻辑复杂时，全量重算可能更稳妥。
- 严格质量门禁会延迟发布，宽松门禁会把错误传给下游。按数据集关键性区分阻断条件和告警条件。

## 验收清单

- 同一批文件重复投递不会产生重复业务记录。
- 坏文件、类型错误和 schema 漂移有可定位的隔离记录。
- 每个批次能对账文件数、记录数及关键业务指标。
- 迟到和历史修正数据可以按明确规则回补。
- 任务失败后可从安全边界恢复，模型和部署变更均有版本记录。

## 关联知识点

以下节点教程保持各自独立；本教程只提供工程流程上的关联入口。

- [snowflake-stages-file-formats](../articles/snowflake-stages-file-formats.md)
- [snowpipe-file-ingestion](../articles/snowpipe-file-ingestion.md)
- [copy-into-file-format-validation](../articles/copy-into-file-format-validation.md)
- [sql-transformations-basics](../articles/sql-transformations-basics.md)
- [incremental-pipeline-reliability](../articles/incremental-pipeline-reliability.md)
- [data-quality-testing](../articles/data-quality-testing.md)
- [snowflake-guide-dynamic-tables](../articles/snowflake-guide-dynamic-tables.md)
- [snowflake-coco-dbt-modeling](../articles/snowflake-coco-dbt-modeling.md)
- [sql-release-engineering](../articles/sql-release-engineering.md)
- [data-observability-lineage](../articles/data-observability-lineage.md)

## 参考资料

- [Data Loading Overview](https://docs.snowflake.com/en/user-guide/data-load-overview)
- [Dynamic Tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/overview)
- [Streams and Tasks](https://docs.snowflake.com/en/user-guide/data-pipelines-intro)

参考链接已登记为官方文档入口，来源状态保留为“待核验”，没有把链接登记等同于已逐项复核。
