# 数据新鲜度、质量指标与血缘诊断

## 本节要解决的问题

早上 8 点，财务看板仍显示前一天的数据。Task History 显示所有任务均已成功，Dynamic Table 的状态也是 SUCCEEDED。团队先怀疑 Warehouse 资源不足，后来发现源文件虽然准时到达，但业务日期列被解析成 NULL，质量检查没有阻止数据发布。

这类问题需要不同的证据：
- Freshness 说明数据最近何时更新，是否达到业务时间要求；
- Data Quality 指标说明行数、唯一性、空值或业务约束是否异常；
- Query History/Profile 说明转换 SQL 实际怎样执行；
- Data Lineage 说明 Snowflake 对象之间的依赖和数据移动关系。

一个任务执行成功不能证明数据新鲜、数据正确或下游已使用最新数据。血缘图也不是完整的业务审计日志，必须与数据指标和运行记录一起使用。

## 核心知识

### 新鲜度必须定义“业务应该更新到哪个时点”

Freshness 不是简单地看表的最后修改时间。先明确业务对数据时间的定义：
- 业务事件时间：订单或交易实际发生的时间。
- 到达时间：文件或事件进入 Snowflake 的时间。
- 数据更新时间：目标表或 Dynamic Table 最近成功反映的源数据时间。
- 业务截止时间：例如财务报告要求涵盖到前一日 23:59:59。

如果今天 07:00 才到达一笔昨天 23:50 的交易，目标表的最新 EVENT_TIME 可能还是昨天；但数据本身可能已经包含该交易。如果目标表有新插入的一条今天 00:10 的测试记录，也不代表昨天的批次完整。

因此，SLO 应明确使用哪一种时间字段、时区和完整性截止条件。对于 Dynamic Tables，TARGET_LAG 是新鲜度目标，不是固定 Cron，也不是无条件 SLA；要检查实际刷新记录中的 DATA_TIMESTAMP、刷新开始/结束时间和依赖状态。

### 用 Data Metric Functions 监控可计算的数据质量属性

Snowflake Data Metric Functions（DMFs）可以计算对象上的质量指标。系统 DMF 包括 ROW_COUNT、NULL_COUNT、DUPLICATE_COUNT、FRESHNESS 等；也可以创建自定义 DMF 检查业务规则。

例如，订单表的 ORDER_ID 不应为空：

~~~sql
ALTER TABLE ANALYTICS.MART.FACT_ORDERS
  ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT
    ON (ORDER_ID)
  EXPECTATION no_null_order_id (VALUE = 0);
~~~

检查主键重复数量：

~~~sql
ALTER TABLE ANALYTICS.MART.FACT_ORDERS
  ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.DUPLICATE_COUNT
    ON (ORDER_ID)
  EXPECTATION no_duplicate_order_id (VALUE = 0);
~~~

Expectation 将 DMF 返回值与布尔表达式比较；表达式为 FALSE 时，记录一次 expectation violation。它不自动删除错误行，也不自动阻止所有下游查询。要让质量失败阻止数据发布，仍需让任务、发布流水线或应用检查 DMF 结果并执行相应门禁。

如果没有明确阈值，可以评估 Anomaly Detection。Snowflake 使用该 DMF 的历史结果训练异常检测器，再判断最新返回值是否超出预测范围。对较频繁执行的 DMF，开始检测前至少需要两周历史数据以建立周周期；最多使用约 60 天数据训练。异常检测适用于发现行数或新鲜度的异常波动，不代表自动识别所有业务错误，也不能替代契约约束和业务校验。Data Quality Monitoring 的 Expectations 和 Anomaly Detection 需要 Enterprise Edition 或更高版本。

### DMF 运行结果要和业务质量门禁分开管理

例如，昨天订单行数通常在 90 万到 110 万之间，今天只有 12 万行。ROW_COUNT 的 anomaly detection 可以提示变化异常；但需要进一步检查：
- 源文件是否全部到齐；
- COPY 是否只加载了一部分文件；
- 数据过滤条件是否被更改；
- 业务是否因节假日或系统故障真实减少；
- 日期解析是否失败，导致记录进入错误分区。

相反，即使行数仍为 100 万，重复订单增加、净金额错误或全部订单落在错误业务日期，也可能没有 ROW_COUNT 异常。因此 DMF 应按业务风险组合，而不是只部署一个 ROW_COUNT 就宣称完成质量监控。

常见的质量指标包括：
- ROW_COUNT：表/视图记录量；
- NULL_COUNT：关键列空值数量；
- DUPLICATE_COUNT：关键键重复数量；
- FRESHNESS：时间戳距离当前时刻的最大陈旧时间；
- 自定义 DMF：业务规则、金额范围、状态组合或跨字段不变量。

每个检查要定义对象、列、调度频率、期望值、责任人和失败动作。高风险指标要有人工复核、失败阻断和重新发布机制。

### Data Lineage 展示对象依赖和数据移动，不是所有业务来源的完整图谱

Snowsight Data Lineage 可以显示表、Dynamic Table、External Table、Iceberg Table、View、Materialized View 和 Semantic View 等对象的依赖关系；Stage 与 Storage Integration 也能参与部分外部数据路径。对支持的对象，还可以查看 Column Lineage，追踪写入操作中来源列与目标列的数据流。

例如：
- STAGE → External Table：追踪外部文件路径依赖；
- RAW_ORDERS → SILVER_ORDERS：查看标准化表来源；
- SILVER_ORDERS → GOLD_DAILY_SALES：追踪汇总对象依赖；
- GOLD_DAILY_SALES → Semantic View：了解语义查询对象依赖。

但 Column Lineage 当前不支持 Semantic View。血缘也不一定包含只用于过滤或 Join、但没有发生数据移动的表；因此不能仅凭图上没有连线就断言某个表没有参与查询逻辑。对外部 ETL、人工上传文件和业务审批，还要结合外部编排日志、文件清单、元数据和 Query History 补足证据。

### Query History 和 Query Profile 说明一次转换具体做了什么

当 Dynamic Table 刷新变慢或数据不完整时，先查看刷新历史，再定位对应 Query ID。Query Profile 可以查看：
- TableScan 扫描的微分区和字节数；
- Join 的输入/输出行数；
- Filter 与 Aggregate 的执行位置；
- Sort、Window 和聚合算子的耗时；
- Local/Remote Spill；
- Warehouse 排队和执行阶段。

血缘图告诉你对象之间可能存在什么依赖，Query Profile 告诉你某次执行实际访问了什么、产生多少行、花费多少资源。两者不是替代关系。

### 访问审计和血缘也不是同一件事

Access History 记录查询访问了哪些对象，并可提供写入操作的列级来源信息。它适合回答“某个查询读取了哪张表、写入了哪些对象”；Data Lineage 更适合回答“对象之间的依赖和数据流向是什么”。

它们都不能自动证明某项业务指标的口径正确。例如，血缘图能说明 GOLD_NAV 依赖 POSITION 和 MARKET_PRICE，但它不能证明 PRICE_TYPE 过滤正确或 FX_RATE 使用了该基金的估值时点。指标定义、SQL、输入快照和对账结果仍然需要单独保留。

## 工程实施步骤

1. 为每张关键表明确业务日期、事件时间、到达时间和数据更新时间，注明时区和预期完整时间。
2. 为高风险对象添加适当的系统 DMF 和自定义 DMF；选择实际能检测到的质量风险，而不是为了覆盖率堆指标。
3. 为每项 DMF 定义 Expectation 或 Anomaly Detection；确认账户 Edition、调度频率和历史训练数据要求。
4. 建立质量失败处理：谁收到告警、是否阻止 Gold 发布、如何隔离异常行、如何重新计算。
5. 对 Dynamic Table 记录 Refresh History、DATA_TIMESTAMP、运行时长和失败信息；对 Tasks 记录 TASK_HISTORY、Query ID 和执行状态。
6. 打开 Data Lineage 检查关键表、视图、Dynamic Table、Stage 和 Semantic View 的依赖。
7. 对关键写入查询打开 Query Profile，检查过滤、Join 基数、扫描、聚合和 Spill。
8. 用 Access History 核对实际查询访问的对象和列级写入来源；对外部数据源补充 ETL/对象存储的来源记录。
9. 通过源系统行数、批次金额、唯一键和日期范围对账，验证异常究竟是数据缺失、重复、解析错误还是合法业务变化。
10. 将 DMF 结果、Query ID、刷新记录、源批次 ID、数据版本和责任人关联保存，支持故障回放。

## 场景分析

财务看板要求 08:00 前发布昨天完整订单。08:20，Dashboard 仍显示旧数据。Task History 显示成功，Dynamic Table 状态也为 SUCCEEDED。

排查按证据分层：
1. 源文件清单显示所有文件 07:10 前到齐；
2. COPY_HISTORY 显示文件均已加载，但目标表 NULL_COUNT(ORDER_DATE) 从 0 增加到 78,000；
3. Data Lineage 确认 RAW_ORDERS 是 GOLD_DAILY_SALES 的上游，但它无法告诉你日期解析规则是否正确；
4. Query Profile 显示 Gold 汇总按 ORDER_DATE 分组，NULL 日期记录被排除在日报之外；
5. 源文件中日期从 2026/11/27 改为 27-11-2026，当前 File Format 没有按新格式解析。

这不是 Warehouse 资源不足，也不是 Dynamic Table 没运行。应先修正 File Format/转换规则，将错误行隔离并重载，然后重新执行下游刷新。恢复后用源批次订单数、金额、日期范围和 DMF 结果对账；确认 Gold 数据覆盖完整后再发布。

## 常见误区

- **把 Task 成功或 Dynamic Table SUCCEEDED 当成业务数据正确。** 还要检查 DATA_TIMESTAMP、源批次、DMF 和业务控制总额。
- **把最新记录时间当作批次完整性。** 一条新记录无法证明其他文件都已加载。
- **只用 ROW_COUNT 监控数据质量。** 行数稳定也可能存在重复键、空值、金额错误和日期错位。
- **把 Anomaly Detection 当成自动业务规则。** 它识别指标时间序列异常，需要历史训练数据，不能代替精确 Expectation。
- **认为 DMF 失败会自动阻止下游发布。** 需要在流水线中显式读取质量结果并决定是否放行。
- **把 Data Lineage 当成完整业务血缘。** 过滤 Join、外部 ETL、手工文件和 Semantic View Column Lineage 存在边界。
- **把 Access History 当成对象依赖图。** 它记录实际查询访问行为，与 Lineage 的问题不同。
- **只看 Query Profile，不对账业务结果。** 查询执行高效也可能算错业务口径。

## 完成标准

- [ ] 能为数据产品定义业务新鲜度和数据完整截止时间。
- [ ] 能使用 ROW_COUNT、NULL_COUNT、DUPLICATE_COUNT 和 FRESHNESS 等 DMF。
- [ ] 能解释 Expectation 与 Anomaly Detection 的不同。
- [ ] 能说明 Data Quality Monitoring 的 Edition 和历史训练数据要求。
- [ ] 能区分对象/列级 Data Lineage 与 Access History。
- [ ] 能用 Query Profile 定位扫描、Join、聚合和 Spill。
- [ ] 能将刷新、DMF、源批次和业务总额对账连成故障诊断流程。

## 自测

1. Task History 显示成功，Dynamic Table 也显示 SUCCEEDED，但 Dashboard 仍然少了部分订单。你会按什么顺序检查 Freshness、DMF、文件加载和查询计划？
2. ROW_COUNT 与历史均值一致，为什么仍可能存在大量重复订单或金额错误？需要增加哪类检查？
3. Anomaly Detection 发现 FRESHNESS 异常，是否能直接认定上游作业失败？还需要哪些业务证据？
4. Data Lineage 没有显示一张表，但查询中可能用它做了过滤。为什么不能据此断言这张表没有参与计算？
5. Semantic View 上的 Metric 列没有 Column Lineage。要审计其表达式还需要保存哪些定义和 SQL 证据？
6. Access History 和 Data Lineage 分别适合回答什么问题？

## 参考资料

- [Data Lineage](https://docs.snowflake.com/en/user-guide/ui-snowsight-lineage)
- [System data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-system-dmfs)
- [Use SQL to work with expectations](https://docs.snowflake.com/en/user-guide/data-quality-expectations)
- [Detecting anomalies in data quality](https://docs.snowflake.com/en/user-guide/data-quality-anomaly)
- [Sending notifications for data quality issues](https://docs.snowflake.com/en/user-guide/data-quality-notifications)
- [Access History](https://docs.snowflake.com/en/user-guide/access-history)
- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
