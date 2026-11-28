# Dynamic Tables 与刷新新鲜度目标

## 先问清楚十分钟指什么

运营看板要求订单数据“十分钟内更新”。团队建立了一组 Dynamic Tables，并为每张表设置 TARGET_LAG = '10 minutes'。上线后有人发现，某次刷新用了十几分钟，于是认为 Snowflake 没有遵守配置。

这里混淆了两个概念：十分钟是数据允许陈旧的目标，不是每十分钟准点启动一次刷新，也不是对每次刷新耗时的承诺。实际 lag 可能超过目标，必须监控和处理。

## TARGET_LAG 描述数据新鲜度，不是调度周期

Dynamic Tables 用声明式 SQL 描述持续转换关系。Snowflake 根据目标新鲜度、上游变化和刷新情况安排执行，而不是简单地按固定 Cron 间隔运行。

如果某次刷新尚未完成，调度器不会为了赶上下一次计划而并发启动同一张表的另一次刷新。刷新持续时间、数据量、SQL 复杂度、Warehouse 资源和依赖链都会影响最终 lag。把 TARGET_LAG 从 10 分钟改成 1 分钟，并不会自动让慢查询变快。

持续刷新目标的最小值为 60 秒。小于这一范围的设置会在校验时失败。设置目标时，应从消费者真正需要的数据新鲜度出发，而不是把数值越小当成越好。

## 多层链路要看最终消费者，而不只是中间表

假设订单数据经过三步：

1. Raw 层保留摄取结果；
2. Curated 层完成清洗和统一口径；
3. Mart 层按天、地区汇总，供看板使用。

如果每一层都独立追求极短的刷新目标，可能造成不必要的刷新和成本。对于中间层，可以评估 TARGET_LAG = DOWNSTREAM，让它在下游消费者需要新数据时参与刷新，而不是维护一套不必要的独立目标。最终消费层仍应显式定义业务需要的新鲜度。

目标 lag 与依赖关系有关。多层表的调度需要按上游到下游的依赖顺序完成；判断看板是否新鲜，不能只看最后一张表是否刚刚刷新。

## Refresh Mode 决定刷新工作怎样完成

Dynamic Tables 支持 Snowflake 管理的 ADAPTIVE、FULL、INCREMENTAL 和 AUTO 等模式；高级场景还有 CUSTOM_INCREMENTAL。不同模式的成本并不固定：

- Incremental 尝试只处理变化部分，适合变化量和转换形态支持增量维护的场景。
- Full 重新计算结果。数据变化比例很大或增量维护成本过高时，完整刷新未必更差。
- Adaptive 可以根据内部判断在增量维护与重新初始化之间调整。
- Auto 会根据查询和平台判断解析模式，生产环境应检查最终选择的 refresh_mode 与原因。

不要只凭 SQL 看起来简单就假定 Incremental 一定可用，也不要把 AUTO 当成无需验证的保证。创建后要检查实际模式，并使用代表性数据和变化规模验证。

## 一个可运行的例子

下面将 Raw 订单按日期和地区汇总。实际字段类型、目标新鲜度和 Warehouse 名称应按环境替换。

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

DDL 创建成功只代表定义被接受，不表示之后的刷新一定持续满足十分钟目标。上线后要看调度状态、刷新模式、实际 lag 和刷新耗时。

## 怎样判断链路是否达标

先用 SHOW DYNAMIC TABLES 查看当前状态。需要观察整个账户中动态表的 lag 时，可以使用 Information Schema 的动态表函数：

~~~sql
SELECT
  NAME,
  SCHEDULING_STATE,
  LAST_COMPLETED_REFRESH_STATE,
  TARGET_LAG_SEC,
  TIME_WITHIN_TARGET_LAG_RATIO,
  MAXIMUM_LAG_SEC
FROM TABLE(INFORMATION_SCHEMA.DYNAMIC_TABLES())
ORDER BY NAME;
~~~

TIME_WITHIN_TARGET_LAG_RATIO 能帮助判断表在观察窗口内有多大比例的时间满足目标。出现 lag 超标时，再用 DYNAMIC_TABLE_REFRESH_HISTORY 查看刷新状态、错误、持续时间和触发方式，并结合依赖图定位上游瓶颈。

如果刷新耗时已经超过目标，调整数字并不能解决根因。需要检查 SQL、数据变化比例、Refresh Mode、Warehouse 资源和依赖链长度，然后用一段稳定观察窗口验证调整结果。

## Dynamic Tables 与 Tasks 应该怎样分工

Dynamic Tables 更适合声明式的 SQL 转换。若还需要条件分支、写入非动态目标、执行存储过程或调用外部系统，通常应让 Task 承担这些过程动作。

两者可以组合：Dynamic Table 完成数据转换，Stream 暴露变化，Triggered Task 在有变化时执行后续副作用。不要为了让所有步骤都“自动刷新”而把外部调用硬塞进声明式查询。

## 目标 lag 容易失守的情形

- 单次刷新时间长于业务允许的陈旧窗口。
- 上游数据增长或 SQL 复杂度改变，增量刷新成本明显上升。
- 依赖链过长，中间表的目标设置不合理。
- 仓库资源不足，或者刷新失败后持续重试。
- 只看最后一次成功，没有观察一段时间内的实际 lag。

## 自测

1. 设置 TARGET_LAG = '10 minutes' 后，为什么实际数据仍可能超过十分钟没有更新？
2. Curated 是 Mart 的中间层，为什么可以评估 TARGET_LAG = DOWNSTREAM？什么情况下不适合这么做？
3. 一条链路需要在数据更新后调用外部服务。为什么应该考虑 Task，而不是把调用逻辑放进 Dynamic Table？

## 参考资料

- [Set the target lag for a dynamic table](https://docs.snowflake.com/en/user-guide/dynamic-tables/target-lag)
- [Monitor dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/monitoring)
- [Quick-start best practices for dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/best-practices)
- [Create a dynamic table](https://docs.snowflake.com/en/user-guide/dynamic-tables/create)
