# Dynamic Tables 与刷新新鲜度目标

## 本节要解决的问题

使用声明式 SQL 构建可持续刷新的数据转换链路，并根据业务允许的数据陈旧程度设置 TARGET_LAG。Dynamic Tables 将依赖关系和刷新编排交给 Snowflake，但不会自动保证任意复杂链路都满足指定延迟或成本目标。

## 核心知识

### TARGET_LAG 表示新鲜度目标，不是固定刷新间隔

例如 \`TARGET_LAG = '10 minutes'\` 表示希望动态表中的数据相对其源数据保持在十分钟以内的陈旧程度，并不意味着系统每十分钟准时执行一次刷新。Snowflake 根据依赖变化、刷新耗时和资源情况安排刷新；实际 lag 可能超过目标。

对于多层 Dynamic Tables，调度会考虑依赖顺序。目标 lag 的含义与整条依赖链有关，不能只看某个中间节点的刷新时间来判断最终数据新鲜度。

### Refresh Mode 决定转换如何执行

Dynamic Table 支持 Incremental、Full 和 Auto 等刷新模式。Incremental 尝试只处理变化部分；Full 重新计算结果。具体 SQL 是否支持增量刷新、刷新成本和数据变化规模都会影响选择。

生产环境应明确评估并设置所需的 Refresh Mode，而不是只依赖自动推断。创建后检查实际解析出的 refresh_mode 和 refresh_mode_reason，避免查询逻辑或功能变化导致刷新模式与预期不同。

### Dynamic Tables 与 Tasks 的职责不同

Dynamic Tables 适合用声明式 SELECT 描述持续转换和依赖关系；Tasks 适合按时间或事件触发 SQL、过程逻辑及多步骤作业。需要副作用、条件分支、外部调用或明确的过程控制时，不应为了统一工具而强行使用 Dynamic Tables。

## 工程实施步骤

1. **定义业务新鲜度。** 确认消费端可接受的最大数据延迟、峰值到达速率和超出目标时的降级方式。将目标 lag 与业务 SLA 分开记录。
2. **划分转换层。** 明确源表、清洗层、中间动态表和面向消费者的输出表。每一层只保留实际需要的转换，避免过度拆分造成过长依赖链。
3. **选择刷新模式。** 检查 SELECT 语法、连接方式、聚合、数据变化比例和预计刷新成本；使用代表性数据验证 Incremental 是否适用。
4. **创建 Dynamic Table。** 明确目标 lag、Warehouse、Refresh Mode 和 owner role。配置应可复现并纳入版本管理。
5. **核对实际运行状态。** 使用 SHOW DYNAMIC TABLES 检查 scheduling_state、refresh_mode、refresh_mode_reason 和 target_lag；通过 Refresh History 查看刷新耗时、结果和 lag。
6. **观察链路而不是单表。** 对多层依赖检查上游是否失败、下游是否因依赖未更新而等待，以及各层刷新是否出现反复 full refresh。
7. **建立成本与延迟告警。** 将实际 lag、刷新成功率、刷新耗时、Warehouse credits 和目标表质量放在一起观察。
8. **演练暂停和恢复。** 模拟上游数据突增、仓库不可用、刷新失败和长期暂停，明确何时调整 lag、规格或刷新模式，何时需要重新初始化。

示例：

~~~sql
CREATE OR REPLACE DYNAMIC TABLE MART.ORDERS_10M
  TARGET_LAG = '10 minutes'
  WAREHOUSE = TRANSFORM_WH
  REFRESH_MODE = INCREMENTAL
AS
SELECT
  ORDER_DATE,
  REGION,
  COUNT(*) AS ORDER_COUNT,
  SUM(AMOUNT) AS TOTAL_AMOUNT
FROM RAW.ORDERS
GROUP BY ORDER_DATE, REGION;
~~~

创建后需要检查 SHOW DYNAMIC TABLES 的实际刷新模式和运行状态，而不能把 DDL 成功当作刷新已经按目标运行。

## 场景分析

订单数据进入 Raw 表后，需要依次清洗、汇总并供运营仪表板读取。业务方要求看板数据“最多十分钟延迟”。

先确定十分钟是业务新鲜度目标，而不是要求每十分钟启动一次刷新。然后测量数据到达速率、各层刷新时间和依赖深度。若单次刷新持续时间已超过目标，单纯缩短 TARGET_LAG 不会让链路变快；要检查刷新 SQL、Warehouse 容量、增量能力和依赖关系。

对于纯 SQL 的增量转换，可以使用 Dynamic Tables；如果还需要发送通知、调用外部服务或执行有条件的多步骤操作，则应由 Task 或其他编排组件完成。验收应检查一段观察窗口内的实际 lag 分布、刷新失败比例、查询结果质量和成本。

## 常见误区

- **把 TARGET_LAG 当作定时器。** 它是数据新鲜度目标，Snowflake 会据此安排刷新，但不能保证按固定间隔准时执行。
- **把目标 lag 当作 SLA 保证。** 资源不足、刷新耗时或依赖链过长都可能使实际 lag 超过目标。
- **只查看最后一次刷新成功。** 成功状态不能代表整个观察窗口持续满足新鲜度，需要检查实际 lag 和刷新历史。
- **认为 Incremental 总是比 Full 便宜。** 变化比例、查询形态和增量维护开销会影响成本，应以实际刷新结果为准。
- **用 Dynamic Tables 替代所有 Tasks。** 声明式数据转换与过程编排解决不同问题，可以组合使用。

## 完成标准

- [ ] 能准确解释 TARGET_LAG 的含义及其非保证性。
- [ ] 能根据查询逻辑和数据变化选择 Refresh Mode。
- [ ] 能通过 SHOW DYNAMIC TABLES 和 Refresh History 检查实际行为。
- [ ] 能判断依赖链、刷新耗时和 Warehouse 资源对 lag 的影响。
- [ ] 能说明 Dynamic Tables 与 Tasks 的职责边界。

## 自测

1. 设置 TARGET_LAG 为十分钟，为什么某次刷新仍可能超过十分钟？如何找到根因？
2. 一条动态表链路由三层表组成，应该只监控最末端的刷新状态吗？还需要检查什么？
3. 某个任务需要在数据更新后执行 SQL，再调用外部系统发通知；为什么不应把这两个动作都放进 Dynamic Table？

## 参考资料

- [Set the target lag for a dynamic table](https://docs.snowflake.com/en/user-guide/dynamic-tables/target-lag)
- [Monitor dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/monitoring)
- [Quick-start best practices for dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/best-practices)
- [Create a dynamic table](https://docs.snowflake.com/en/user-guide/dynamic-tables/create)
