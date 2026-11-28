# 分层数据质量门禁与批次对账

## 本节要解决的问题

在数据进入 Raw、Conformed 和 Curated 层时，建立能够阻止错误传播的质量检查。检查不应只验证 SQL 能运行，而要分别验证结构、完整性、业务规则、跨表关系、批次变化和消费者可见性，并明确失败数据如何隔离、重试和回补。

## 核心知识

### 数据质量检查必须对应数据契约

常见检查包括结构、完整性、业务规则、一致性和时效性。结构检查列名、类型、必填字段和 Schema 漂移；完整性检查行数、主键唯一、非空与引用关系；业务规则检查金额范围、状态转换、日期约束和跨字段不变量；一致性检查跨表引用、批次汇总与重复事件；时效性检查最后成功批次、数据新鲜度和迟到数据。

每项规则都应定义 owner、检查对象、测量口径、阈值、执行频率、失败动作和豁免期限。比如订单主键重复可以直接阻断发布；地址格式异常可能先隔离记录；迟到订单则可能需要延迟结算而不是丢弃。

### Snowflake Data Metric Functions 可把质量测量附着到对象

Snowflake Data Quality Monitoring 提供系统 DMF 和自定义 DMF。系统提供 300 多个 DMF，例如 ROW_COUNT、NULL_COUNT、DUPLICATE_COUNT 和 REFERENTIAL_CHECK；可以把多个 DMF 关联到表、视图或动态表，通过 DATA_METRIC_SCHEDULE 设置测量频率。

DMF 返回的是测量值，不一定直接表示通过/失败。Expectation 将测量值与阈值比较，例如 NULL_COUNT 必须等于 0；Anomaly Detection 可以基于历史测量范围识别异常。DMF 计划任务默认每小时执行，也可设定分钟周期或在符合条件的对象上使用 TRIGGER_ON_CHANGES。Data Quality Monitoring 属于 Enterprise Edition 功能，实际可用性和通知能力需核对账户版本。

### 质量通过与批次正确是两种证据

DMF 更适合持续测量对象属性；批次对账还需要业务侧控制总量与变化，例如源文件行数、成功加载行数、拒绝行、目标主键数、金额汇总、批次 ID 和事件时间范围。两种证据结合才能发现“单表指标通过、但漏了一整批数据”的问题。

质量门禁应把失败对象隔离，并保留可重放的原始输入。失败后不能简单删除检查记录再重跑；需要记录原因、修复版本、重新执行结果和最终放行人。

## 工程实施步骤

1. 为每个数据层定义数据契约：字段、类型、主键、关系、允许空值、业务规则、数据时效和责任人。
2. 将可测量的对象质量属性映射到系统或自定义 DMF；跨批次和跨系统规则则作为 SQL 断言或测试作业实现。
3. 用单独查询手工执行 DMF，确认输入列、返回值和实际测量口径符合预期，再把 DMF 绑定到目标表。
4. 根据数据更新频率设置 DATA_METRIC_SCHEDULE；评估小时调度、分钟调度和变更触发的资源成本及适用限制。
5. 对 DMF 配置 Expectation 阈值，按风险决定失败告警、隔离或发布阻断；对波动性指标再评估 Anomaly Detection。
6. 为每个批次保存 batch_id、source_count、loaded_count、rejected_count、target_count、关键金额汇总和时间范围。
7. 在 Raw 层先验证文件/事件完整性，在 Conformed 层验证实体映射和唯一性，在 Curated 层验证指标口径与业务对账。
8. 失败时保留原始数据和质量结果，阻断下游消费；修复后对原批次重放并重新执行相同断言。
9. 将质量结果、规则版本、执行身份、Query ID、异常样本和放行记录纳入审计，并定期清理失效规则。

示例：将系统 DMF 与 Expectation 绑定到订单表。

~~~sql
CREATE OR REPLACE TABLE RAW.ORDERS (
  ORDER_ID NUMBER,
  CUSTOMER_ID NUMBER,
  AMOUNT NUMBER(12,2)
)
WITH DATA METRIC FUNCTION (
  SNOWFLAKE.CORE.NULL_COUNT ON (ORDER_ID)
    EXPECTATION order_id_not_null (VALUE = 0),
  SNOWFLAKE.CORE.DUPLICATE_COUNT ON (ORDER_ID)
    EXPECTATION order_id_unique (VALUE = 0)
);

ALTER TABLE RAW.ORDERS
  SET DATA_METRIC_SCHEDULE = '5 MINUTE';
~~~

实际发布时还需检查对象类型、Edition、调度成本和质量结果视图，不要把 CREATE 成功当作规则已经被执行。

## 场景分析

供应商每天上传订单文件。偶尔出现重复订单号、客户号不存在、金额为空，以及整批文件漏传。只执行目标表的 NULL_COUNT 无法发现最后一种情况，也无法判断金额是否符合业务规则。

为订单表设置主键非空和重复 DMF；用 REFERENTIAL_CHECK 或自定义 SQL 检查客户引用；用金额规则检查业务范围。批次控制表保存文件清单、源行数和加载行数，文件到达缺失时由批次完整性检查告警。失败批次留在隔离区，修复后从原始文件重放，而不是从已经过滤后的目标表猜测缺失数据。

验收至少注入重复主键、空金额、无效客户号、漏传文件和迟到批次，验证对应规则能被触发、下游发布被正确阻断，且重放不会重复插入数据。

## 常见误区

- SQL 成功就表示数据质量通过。SQL 语法和执行成功不能证明主键、业务规则和批次完整。
- DMF 返回一个数字就等于通过/失败。需要通过 Expectation 或业务阈值解释测量结果。
- 只检查最终报表。问题可能在 Raw 摄取或 Conformed 标准化阶段已经扩散。
- 用异常检测代替确定性约束。主键唯一、金额非负等规则应使用明确断言。
- 发现坏数据就直接删除。应保留输入、隔离异常、修复并可重复回放。
- 每个对象都配置极短 DMF 周期。调度频率需要结合数据到达节奏、质量时效和计算成本。

## 完成标准

- [ ] 能区分结构、完整性、业务规则、跨表一致性和时效性检查。
- [ ] 能解释 DMF、Expectation 与 Anomaly Detection 的关系。
- [ ] 能为批次建立源记录数、加载数、拒绝数和业务汇总对账。
- [ ] 能设计错误数据隔离、重放和下游发布阻断。
- [ ] 能说明 Data Quality Monitoring 的 Edition 与调度成本限制。

## 自测

1. NULL_COUNT = 0，但源文件少传了一半记录，为什么质量仍然可能显示通过？还应增加什么对账？
2. DMF 返回 12 个 NULL，怎样通过 Expectation 定义可接受边界？
3. 哪类检查适合固定阈值，哪类检查适合 Anomaly Detection？
4. 一个失败批次修复后重放，怎样保证不会重复写入已经成功加载的记录？

## 参考资料

- [System data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-system-dmfs)
- [Use SQL to set up data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-working)
- [Use SQL to work with expectations](https://docs.snowflake.com/en/user-guide/data-quality-expectations)
- [Sending notifications for data quality issues](https://docs.snowflake.com/en/user-guide/data-quality-notifications)
