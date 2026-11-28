# ITD 端到端数据管道

## 本节要解决的问题

零售系统每天从门店、网站和物流服务接收订单、退款与发货事件。业务部门希望上午 8 点前看到昨天的完整销售报表；客服希望新订单几分钟内可查；财务还要求迟到的退款事件能够回补到原来的业务日期。

如果所有步骤只写在一个大 SQL 或一个 Notebook 里，任何一步失败都很难判断数据停在哪里。数据管道需要把接入、标准化、业务转换和消费发布拆开，并为每一段定义输入输出、质量检查、刷新目标和恢复方法。

## 核心知识

### 先划清 Raw、标准化和消费层的职责

一个常见的分层方式是：

| 层 | 主要任务 | 数据处理原则 | 谁来使用 |
|---|---|---|---|
| Raw / Bronze | 保留来源数据和接入记录 | 尽量保留原始字段、文件名、事件 ID、到达时间 | 数据工程、排障和重放 |
| Standardized / Silver | 统一类型、业务键、时间和重复规则 | 明确迟到、修订、删除和无效记录处理 | 下游模型和数据产品 |
| Curated / Gold | 按业务口径生成事实、维度和汇总 | 对账后发布，保留指标定义与 owner | BI、分析、语义模型和应用 |

这不是要求一定建立三套数据库。数据量小或团队规模有限时，可以先用同一 Schema 内的表和视图表达边界；关键是职责和发布条件要清楚。

以订单事件为例，Raw 保留 event_id、order_id、event_type、event_time、ingested_at 和原始 payload。Silver 负责把时间、金额、状态和业务键解析成稳定的数据类型，并根据事件版本去重。Gold 再产生订单当前状态、每日销售额和退款汇总。

### Dynamic Tables 适合以 SQL 描述结果的声明式流水线

如果每一阶段都是 SELECT、JOIN、聚合和窗口计算，可以考虑用 Dynamic Tables。开发者声明目标结果，Snowflake 负责依赖顺序、刷新和增量维护。

例如先从 Raw 生成标准化订单：

~~~sql
CREATE OR REPLACE DYNAMIC TABLE silver_orders
  TARGET_LAG = '10 minutes'
  WAREHOUSE = transform_wh
  REFRESH_MODE = INCREMENTAL
AS
SELECT
  order_id,
  customer_id,
  TRY_TO_TIMESTAMP_TZ(event_time) AS event_ts,
  TRY_TO_NUMBER(order_amount, 18, 2) AS order_amount,
  UPPER(order_status) AS order_status,
  source_event_id,
  ingested_at
FROM raw_order_events
WHERE event_type = 'ORDER_CREATED'
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY source_event_id
  ORDER BY ingested_at DESC
) = 1;
~~~

再从 Silver 建立面向业务消费的每日汇总：

~~~sql
CREATE OR REPLACE DYNAMIC TABLE gold_daily_sales
  TARGET_LAG = '10 minutes'
  WAREHOUSE = transform_wh
  REFRESH_MODE = INCREMENTAL
AS
SELECT
  TO_DATE(event_ts) AS business_date,
  customer_id,
  COUNT(*) AS order_count,
  SUM(order_amount) AS gross_sales
FROM silver_orders
WHERE order_status <> 'CANCELLED'
GROUP BY TO_DATE(event_ts), customer_id;
~~~

示例只用于说明分层与 SQL 依赖；真实订单模型还要处理订单创建、支付、取消和退款等不同事件，不能把所有 event_type 当成订单创建事件。若事件有业务版本，应使用源系统的版本号或事件序号决定最新记录，而不是把 ingested_at 随意当成业务先后。

TARGET_LAG = '10 minutes' 表示数据新鲜度目标，不是每 10 分钟准点刷新一次的 Cron 周期，也不是 SLA 保证。实际刷新可能因仓库容量、查询复杂度、上游变化和管道深度而超过目标。中间层通常可以用 TARGET_LAG = DOWNSTREAM，由下游消费者驱动刷新；叶子消费表则设置符合实际需求的目标。

### Streams 和 Tasks 适合过程逻辑、MERGE 和自定义编排

若管道需要显式 MERGE、存储过程、复杂重试、外部 API 或严格的任务依赖，Streams 和 Tasks 更合适。

Stream 记录基础表的变更数据（CDC delta），供下游读取。Task 负责运行 SQL 或存储过程，可以按计划运行，也可以用 WHEN SYSTEM$STREAM_HAS_DATA(...) 在有变化时触发。

例如，Raw 事件表有新行时，将变更合并到当前订单状态表：

~~~sql
CREATE OR REPLACE STREAM raw_order_stream
  ON TABLE raw_order_events;

CREATE OR REPLACE TASK merge_order_changes
  WAREHOUSE = transform_wh
  SCHEDULE = '1 MINUTE'
  WHEN SYSTEM$STREAM_HAS_DATA('raw_order_stream')
AS
MERGE INTO silver_order_state AS target
USING (
  SELECT
    order_id,
    event_type,
    event_time,
    event_version,
    order_amount
  FROM raw_order_stream
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY order_id
    ORDER BY event_version DESC
  ) = 1
) AS source
ON target.order_id = source.order_id
WHEN MATCHED AND source.event_version > target.event_version
  THEN UPDATE SET
    target.event_type = source.event_type,
    target.event_time = source.event_time,
    target.event_version = source.event_version,
    target.order_amount = source.order_amount
WHEN NOT MATCHED THEN INSERT (
  order_id, event_type, event_time, event_version, order_amount
) VALUES (
  source.order_id, source.event_type, source.event_time,
  source.event_version, source.order_amount
);
~~~

创建 Task 后还需要显式启用：

~~~sql
ALTER TASK merge_order_changes RESUME;
~~~

Task 会在满足调度和 WHEN 条件时执行。Stream 的消费位置与事务提交相关；如果任务事务提交，Stream offset 会随之推进。设计时必须让写入逻辑具备幂等性，并明确重试失败、重复事件、迟到事件和源版本冲突的处理规则。event_version 应来自业务系统，不能用随机 ID 或到达时间替代。

### 选型取决于转换逻辑，而不是团队偏好

| 需求 | 优先考虑 | 原因 |
|---|---|---|
| 多阶段 SQL、JOIN、聚合和窗口计算 | Dynamic Tables | 以 SELECT 声明结果，系统管理刷新依赖 |
| 需要 MERGE、DML 或过程分支 | Streams + Tasks | 可以消费 CDC 并执行过程逻辑 |
| 外部 API、复杂重试或自定义调度 | Tasks + Stored Procedure / 外部编排 | 需要显式控制调用、状态和失败恢复 |
| 单表固定查询加速 | Materialized View | 解决重复查询，不是多阶段管道 |

Dynamic Tables 是 SQL 型转换流水线的优先选项，但它们是只读结果，不能对输出表直接 INSERT/UPDATE/DELETE；不能在定义中调用 Stored Procedure 或 External Function；最小 TARGET_LAG 为 1 分钟。若需要更短延迟、DML 或自定义步骤，应考虑 Streams/Tasks 或其他事件处理架构。

## 工程实施步骤

1. 为每个来源记录业务键、事件 ID、事件时间、到达时间、版本号、交付方式和数据 owner。
2. 明确每个层级的一行代表什么，区分订单、订单事件、退款事件和每日汇总的粒度。
3. 在 Raw 层保留可追溯的源数据、文件/消息标识、加载时间和拒绝原因。
4. 对类型转换、必填字段、业务键、重复事件、迟到数据和 Schema Drift 建立 Silver 层规则。
5. 根据转换类型选 Dynamic Tables 或 Streams/Tasks；不要仅因为现有项目用了 Task 就把所有 SQL 都写成过程任务。
6. 为 Dynamic Tables 设置符合消费需求的 TARGET_LAG，监控实际 lag、刷新时长、失败和 Warehouse 消耗。
7. 为 Streams/Tasks 监控 Stream 是否有积压、任务执行历史、失败次数、提交状态和消费位置。
8. 为每批数据保存输入行数、插入/更新/拒绝数量及金额等控制总额，确保接入成功不等于业务正确。
9. 处理迟到、修订和回补时，按业务事件时间和版本号更新历史/当前状态，并验证重放不会重复累计。
10. 只有上游质量检查通过后，才刷新或发布 Gold 表和 Semantic View；将数据更新时间和质量状态提供给下游消费者。

## 场景分析

每天 07:00，门店系统上传昨日订单文件；网站订单则持续产生事件；物流系统有时会在订单创建两天后才发送签收事件。财务报表要求 08:00 前看到完整的订单收入，客服则希望新订单几分钟内可查询。

可以让门店文件进入 Raw，再通过 Dynamic Tables 完成标准化和每日汇总；网站事件进入 Raw 后，若只是 SQL 转换也可用 Dynamic Tables。若需要根据订单版本执行 MERGE、合并迟到状态、调用外部物流 API 或执行自定义补偿，则采用 Streams/Tasks 或外部工作流。

不能把 TARGET_LAG = '10 minutes' 当成“08:00 前一定完成”。财务报表应检查各来源的批次是否齐全、迟到数据是否进入结算窗口、实际刷新是否完成。若任一来源未到齐，报表应显示数据不完整或延迟状态，而不是悄悄发布一个看似完整的数字。

## 常见误区

- **把 Raw、Silver、Gold 理解为必须建立的三套数据库。** 它们是职责边界，可以先用同一 Schema 内的对象实现。
- **把 Dynamic Table 的 TARGET_LAG 当作定时刷新间隔或保证。** 它是新鲜度目标，实际刷新可能落后。
- **把所有管道都做成 Streams/Tasks。** 对纯 SQL 的多阶段转换，Dynamic Tables 可以减少手工编排。
- **把所有管道都改成 Dynamic Tables。** 需要 DML、MERGE、外部调用或复杂过程逻辑时，Streams/Tasks 更合适。
- **认为 Stream 保存业务全历史。** Stream 提供变更记录的消费视图，不是长期审计历史仓库；需要历史时应在消费时持久化事件或状态。
- **把任务成功当作数据完整。** 仍要对账来源批次、业务行数、拒绝数据、控制总额和实际新鲜度。
- **只用到达时间判断事件新旧。** 迟到和重放会让晚到的数据反而是旧业务版本，应使用源系统版本/序号。

## 完成标准

- [ ] 能划分 Raw、标准化和消费层的职责。
- [ ] 能根据 SQL 转换与过程逻辑选择 Dynamic Tables 或 Streams/Tasks。
- [ ] 能解释 TARGET_LAG 是新鲜度目标而非固定刷新计划。
- [ ] 能说明 Stream 的 CDC delta 与 Task 的执行/调度职责。
- [ ] 能为重复、迟到、修订和重放设计幂等策略。
- [ ] 能用批次完整性、实际 lag、质量检查和业务控制总额验收管道。

## 自测

1. 多阶段管道只有 SELECT、JOIN 和聚合，为什么可以优先考虑 Dynamic Tables，而不是手工建立一串 Task？
2. 管道需要 MERGE 和调用外部 API，Dynamic Tables 有哪些限制？应改用什么机制？
3. TARGET_LAG = '10 minutes' 是否代表每十分钟刷新一次且最多落后十分钟？实际监控要看什么？
4. 一个 Stream 中同一订单出现两个 event_version，应该按什么业务规则选择版本？为什么不能用 ingested_at 代替版本？
5. 财务要求早上 8 点前完整结算，但一份门店文件尚未到达。管道应如何向下游表达这次运行的状态？

## 参考资料

- [Decision guide for dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/decision-guide)
- [Set the target lag for a dynamic table](https://docs.snowflake.com/en/user-guide/dynamic-tables/target-lag)
- [Introduction to streams and tasks](https://docs.snowflake.com/en/user-guide/data-pipelines-intro)
- [SYSTEM$STREAM_HAS_DATA](https://docs.snowflake.com/en/sql-reference/functions/system_stream_has_data)
- [COPY_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/copy_history)
