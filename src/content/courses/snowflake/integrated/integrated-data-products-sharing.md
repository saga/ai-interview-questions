# 把数据做成产品：语义指标、共享、应用和消费契约

## 场景与目标

数据团队已有订单、客户和财务主题数据。其他部门和合作伙伴需要复用；若每个消费者自行复制数据、重写指标和管理权限，就会出现指标口径不一致、数据延迟不同和权限难以回收的问题。

## 架构与数据流

~~~mermaid
flowchart TD
  Raw[(Raw / Standardized)] --> Curated[(Curated Data Product)]
  Curated --> Semantic[Semantic View / Metric Contract]
  Semantic --> BI[内部 BI / 分析]
  Curated --> Share[Secure Data Sharing]
  Share --> External[合作方 / 其他账户]
  Curated --> App[Streamlit / Native App / API]
  App --> Users[业务用户]
  Contract[Owner、质量、刷新、权限、版本] -.-> Curated
  Contract -.-> Semantic
~~~

## 实施步骤

1. 明确消费者和业务决策，定义数据粒度、业务实体、包含/排除范围、更新频率、保留期和 owner。
2. 为收入、活跃客户、订单完成率说明公式、时间窗口、过滤条件、币种、时区、粒度和空值行为；通过语义层提供统一定义。
3. 发布前检查主键、引用完整性、覆盖率、延迟、金额对账和异常变化。关键数据产品应定义质量 SLI/SLO。
4. 内部 BI 可通过语义层和受控视图消费；跨账户消费评估 Secure Data Sharing；需要交互界面或分发逻辑时才评估 Streamlit/Native Apps。
5. 分离生产者、消费者、应用运行身份和外部账户的权限，只授予必要对象和操作权限。
6. 字段重命名、指标修改、粒度变化和删除都可能破坏消费者；用版本、弃用通知和迁移窗口管理。
7. 监控刷新失败、质量告警、消费者查询、成本和访问异常，明确联系人、事件响应和维护窗口。
8. 统计消费方、访问量、查询失败、延迟、质量问题和重复建设；长期无人使用或成本高于收益的产品应调整或下线。



## 关键取舍

- 原始表共享灵活，但把业务解释和使用风险交给消费者；语义产品更稳定，但需要额外建模和维护。
- 只需要数据访问时不必开发应用；需要业务交互、流程封装或分发逻辑时再做应用。
- 更低刷新延迟带来持续计算和运维成本，应先定义业务允许的数据延迟。
- 生产者可内部重构，但外部契约要有版本和弃用期，避免悄悄改变消费者语义。

## 验收清单

- 产品有明确 owner、消费者、用途、粒度和字段说明。
- 指标公式在不同消费入口中保持一致。
- 刷新频率、质量阈值和故障通知方式明确。
- 内部角色、外部账户和应用身份都经过最小权限验证。
- 破坏性变更有版本、通知和迁移安排，并能统计使用情况与成本。

## 关联知识点

以下节点教程保持各自独立；本教程只提供工程流程上的关联入口。

- [snowflake-data-products](../articles/snowflake-data-products.md)
- [snowflake-data-sharing-reader-accounts](../articles/snowflake-data-sharing-reader-accounts.md)
- [snowflake-marketplace-native-apps](../articles/snowflake-marketplace-native-apps.md)
- [snowflake-guide-streamlit-runtime](../articles/snowflake-guide-streamlit-runtime.md)
- [snowflake-guide-interactive-bi](../articles/snowflake-guide-interactive-bi.md)
- [semantic-view-basics](../articles/semantic-view-basics.md)
- [semantic-metric-governance](../articles/semantic-metric-governance.md)
- [semantic-layer-design](../articles/semantic-layer-design.md)
- [snowflake-declarative-change-management](../articles/snowflake-declarative-change-management.md)
- [data-observability-lineage](../articles/data-observability-lineage.md)

## 参考资料

- [Secure Data Sharing](https://docs.snowflake.com/en/user-guide/data-sharing-intro)
- [Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic)
- [Snowflake Native Apps](https://docs.snowflake.com/en/developer-guide/native-apps/about-native-apps)

参考链接已登记为官方文档入口，来源状态保留为“待核验”，没有把链接登记等同于已逐项复核。
