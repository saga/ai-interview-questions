# Snowflake 数据质量门禁：DMF 与批次对账

## 早上的批次为什么“加载成功”却少了三千行

凌晨订单文件交付 100,000 行。COPY INTO 执行成功，Raw 表里却只有 97,000 行。ETL 团队看到 SQL 状态是 SUCCESS，便继续刷新下游模型；财务早上发现订单金额少了一截，才追到有 3,000 行被拒绝或没有进入目标表。

这里有两种不同的检查：

- 表级质量检查：订单主键是否重复、客户 ID 是否为空、金额是否落在允许范围。
- 批次对账：源文件声明 100,000 行，这次到底加载了多少、拒绝多少、金额是否一致。

表级指标通过，不代表这次批次完整；批次行数一致，也不代表字段和业务规则正确。两类检查需要分别设计，最后共同决定数据是否能进入下游。

## 先把质量规则写成数据契约

规则应对应数据的业务粒度，而不是看到哪些列就给它们随便挂几个检查。

例如，订单事实表一行代表一笔订单，那么 ORDER_ID 应唯一且非空；AMOUNT 应符合币种精度和业务范围；CUSTOMER_ID 应能关联到有效客户；订单的最后更新时间不能落后于上游约定的窗口。每条规则都要明确检查对象、阈值、执行频率、失败动作和责任人。

规则的失败动作不应该全部是“阻断”。重复主键可能直接阻止发布；缺少非关键描述字段可以先隔离异常行；迟到订单可能要延迟结算，但不能直接丢弃。阈值需要业务 owner 确认，工程团队不应把“空值不超过 1%”当成天然合理的标准。

## DMF 给出测量值，Expectation 才定义是否通过

Snowflake 提供 300 多个系统 Data Metric Functions（DMF），覆盖 NULL、重复值、行数、时效性、分布变化等常见指标。也可以编写自定义 DMF 来表达特定业务测量。

一个 DMF 的返回值不一定是 pass/fail。例如 NULL_COUNT 返回缺失值数量；DUPLICATE_COUNT 返回重复值数量。Expectation 再把测量值与允许条件比较，才形成明确的通过或违规状态。

下面为订单表关联两条检查：

~~~sql
ALTER TABLE RAW.ORDERS
  ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT
    ON (ORDER_ID)
    EXPECTATION order_id_required (VALUE = 0);

ALTER TABLE RAW.ORDERS
  ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.DUPLICATE_COUNT
    ON (ORDER_ID)
    EXPECTATION order_id_unique (VALUE = 0);
~~~

这里的阈值适合订单主键，不一定适合所有字段。对可选说明字段，NULL_COUNT 大于零未必表示数据损坏。数据质量监控默认按小时调度，也可以按对象调整执行频率；频率越高，监控成本和数据扫描开销也会随之变化。Data Quality Monitoring 属于 Enterprise Edition 功能，部署前应核对账户版本。

## 发现异常之后，要能找到具体记录

DMF 的汇总结果可以说明有多少记录不符合规则，却不能代替故障定位。对部分系统 DMF，Snowflake 提供 SYSTEM$DATA_METRIC_SCAN，把指标结果还原成具体行。例如找出订单号为空的记录：

~~~sql
SELECT *
FROM TABLE(SYSTEM$DATA_METRIC_SCAN(
  REF_ENTITY_NAME => 'ANALYTICS.RAW.ORDERS',
  METRIC_NAME => 'snowflake.core.null_count',
  ARGUMENT_NAME => 'ORDER_ID'
));
~~~

这个函数只支持指定的一组系统 DMF，不支持用户自定义 DMF。它要求执行者有目标对象的 SELECT 权限和相应 DMF 的 USAGE；若对象受 Row Access Policy 或 Masking Policy 保护，返回结果还可能受当前 Role 影响。不要把它当成绕过权限的通用数据导出入口。

找出异常行之后，才决定隔离、修正、重放还是让业务 owner 豁免。修复过程也要留下记录：原始批次、问题原因、修复 SQL 或代码版本、重跑结果和批准人都应可追溯。

## 再做批次对账：不能只看表级 DMF

订单表上的 ROW_COUNT 可以测量表总行数，但生产作业通常需要按批次、文件或业务日期核对。为每次摄取保存 manifest，记录 batch_id、源文件、预期行数和预期金额；Raw 表也保存相同的 batch_id。

下面用一条查询比较源清单和实际落地情况：

~~~sql
WITH landed AS (
  SELECT
    LOAD_BATCH_ID,
    COUNT(*) AS landed_rows,
    COUNT_IF(ORDER_ID IS NULL) AS missing_order_ids,
    COUNT(DISTINCT ORDER_ID) AS distinct_order_ids,
    SUM(AMOUNT) AS landed_amount
  FROM RAW.ORDERS
  WHERE LOAD_BATCH_ID = '2026-11-28-ORDERS-001'
  GROUP BY LOAD_BATCH_ID
)
SELECT
  m.BATCH_ID,
  m.EXPECTED_ROWS,
  COALESCE(l.landed_rows, 0) AS landed_rows,
  m.EXPECTED_AMOUNT,
  COALESCE(l.landed_amount, 0) AS landed_amount,
  COALESCE(l.missing_order_ids, 0) AS missing_order_ids,
  COALESCE(l.landed_rows, 0) - COALESCE(l.distinct_order_ids, 0) AS duplicate_rows
FROM OPS.LOAD_BATCH_MANIFEST m
LEFT JOIN landed l
  ON l.LOAD_BATCH_ID = m.BATCH_ID
WHERE m.BATCH_ID = '2026-11-28-ORDERS-001';
~~~

这条查询用于展示对账维度。实际项目还应考虑金额精度、退款和冲正口径、文件拆分、同一批次多文件以及重复投递。若批次允许部分成功，manifest 需要记录哪些文件成功、哪些失败，而不只是一个总行数。

也不要把 COUNT(DISTINCT ORDER_ID) 当成所有场景的去重方案。它能发现订单号重复，却不能告诉你应该保留哪个版本，也不能替代业务主键和幂等写入规则。

## 质量失败时，管道应该停在哪里

如果 Raw 层发现主键缺失或批次行数不符，通常应保留原始输入和加载记录，阻止错误传播到 Curated/Mart。修复后对同一 batch_id 重跑，并验证重跑不会插入重复数据。若每次重跑都生成新批次 ID，反而会让对账系统失去识别重复投递的依据。

并不是所有质量检查都需要在摄取时完成。结构和关键键完整性适合靠近 Raw 层；跨表业务规则可能需要在 Conformed 层；指标口径和分析用途的合理性通常在 Mart 或语义层验证。检查越靠后，修复成本越高，但把所有规则都塞进首次加载也会延迟摄取。应按错误传播的代价安排门禁位置。

## 常见误判

- COPY INTO 成功只说明加载语句完成，不等于源批次完整。
- DMF 返回测量值，不等于已经定义了通过阈值。
- 表级 ROW_COUNT 无法单独证明某个批次没有丢行。
- Duplicate Count 能发现重复，不会替你选择应该保留的业务版本。
- SYSTEM$DATA_METRIC_SCAN 有支持范围和权限限制，不是任意 DMF 的明细查询工具。
- 失败后直接删除检查记录再重跑，会破坏审计和幂等证据。

## 自测

1. 一个批次预期 100,000 行，Raw 表只有 97,000 行，但 NULL_COUNT 和 DUPLICATE_COUNT 都为零。数据能否发布？还缺哪类证据？
2. NULL_COUNT 返回 8，为什么不能仅凭这个数字判断数据质量失败？
3. 为什么 SYSTEM$DATA_METRIC_SCAN 返回明细前仍然需要检查当前 Role 和对象策略？
4. 同一批文件重跑时，为什么应保留稳定的 batch_id，而不是每次创建新批次？
5. 哪些规则适合放在 Raw 层，哪些更适合在 Conformed 或 Mart 层检查？

## 参考资料

- [System data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-system-dmfs)
- [Use SQL to set up data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-working)
- [Use SQL to work with expectations](https://docs.snowflake.com/en/user-guide/data-quality-expectations)
- [SYSTEM$DATA_METRIC_SCAN](https://docs.snowflake.com/en/sql-reference/functions/system_data_metric_scan)
- [Sending notifications for data quality issues](https://docs.snowflake.com/en/user-guide/data-quality-notifications)
