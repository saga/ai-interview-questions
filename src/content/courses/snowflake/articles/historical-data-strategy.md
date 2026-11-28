# 长期业务历史、保留策略与数据回补

## 本节要解决的问题

风控团队要重算一只基金过去三年的集中度。当年的组合持仓没有变化，但证券分类供应商上周修正了发行人所属行业；财务人员还希望能回答：“在 2025 年 6 月 30 日出报告时，我们当时知道的行业分类是什么？”

这是两个不同问题：
- **业务有效时间**：某事实在业务世界里从什么时候开始、什么时候结束有效。
- **系统记录时间**：数据平台从什么时候开始知道这条事实、什么时候收到修正。

只有当前值和最后更新时间，无法同时回答“按今天修正后的知识重算历史”和“还原当时报告实际依据”。长期历史需要有明确的事实粒度、时间语义、版本和回补规则。

## 核心知识

### 先决定需要保留的是事件、状态变化还是周期快照

不同业务问题需要不同历史模型：

| 模型 | 保存什么 | 适用问题 |
|---|---|---|
| Append-only Event History | 每次业务事件及其来源 ID | 订单创建、成交、取消、退款和审批过程发生过什么 |
| SCD Type 2 | 实体属性每个有效版本及有效区间 | 某个历史日期客户等级、行业分类或组织归属是什么 |
| Periodic Snapshot | 某个固定业务时点的完整状态 | 月末持仓、每日库存、基金 NAV、风险敞口 |
| Transaction/Change History | 数据更正、冲正和状态变化的记录 | 谁在何时改了什么，原记录如何被修正 |
| Bitemporal History | 业务有效时间 + 系统记录时间 | 按当时已知信息还原旧报告，或用新知识重算过去 |

不要因为“需要历史”就把所有表改成 append-only，也不要把一张当前状态表复制一份当成长期审计。先问清楚审计人员或业务用户需要回答哪类时间问题，再选择数据模型。

### 事件时间、到达时间和有效时间不能混用

例如订单在 6 月 30 日 23:50 成交，消息在 7 月 1 日 00:20 才进入仓库，供应商在 7 月 3 日又修正了交易金额。

至少要区分：

- EVENT_TIME：交易实际发生时间；
- INGESTED_AT：仓库收到事件的时间；
- VALID_FROM / VALID_TO：该业务事实有效的时间范围；
- RECORDED_FROM / RECORDED_TO：该版本在系统中被视为当前知识的时间范围；
- SOURCE_VERSION：来源系统给出的事件/修订版本。

EVENT_TIME 不能用来替代 INGESTED_AT：迟到消息会让历史业务时间与数据可用时间不同。VALID_TIME 也不能用来替代 RECORDED_TIME：后到的修订可能声明一个较早的业务生效日。

### SCD Type 2 保存属性的有效历史

以证券行业分类变化为例，SCD Type 2 为每个版本保存有效期：

| INSTRUMENT_ID | SECTOR | VALID_FROM | VALID_TO | IS_CURRENT |
|---|---|---|---|---|
| I100 | Consumer | 2024-01-01 | 2025-07-01 | FALSE |
| I100 | Technology | 2025-07-01 | 9999-12-31 | TRUE |

历史估值日为 2025-06-30 时，应匹配 Consumer；2025-07-15 则匹配 Technology。按有效时间查询：

~~~sql
SELECT
  instrument_id,
  sector
FROM instrument_sector_history
WHERE instrument_id = 'I100'
  AND DATE '2025-06-30' >= valid_from
  AND DATE '2025-06-30' < valid_to;
~~~

VALID_TO 建议采用半开区间：开始时间包含，结束时间不包含。这样一条记录结束于 7 月 1 日，下一条从 7 月 1 日开始，不会在边界日期同时命中两行。

SCD2 解决“某个业务时点属性是什么”，但单独的 SCD2 不一定能解释“我们当时是否已经知道后来追溯生效的修正”。如果业务需要还原旧报告的知识状态，就要再保存系统记录时间。

### Bitemporal 同时保存业务有效时间和系统记录时间

假设供应商在 7 月 3 日通知：证券 I100 的行业其实从 6 月 15 日就应该是 Technology。6 月 30 日的报告在当时还使用 Consumer；现在重算历史时则应把 6 月 30 日归入 Technology。

双时态记录可以这样表达：

| INSTRUMENT_ID | SECTOR | VALID_FROM | VALID_TO | RECORDED_FROM | RECORDED_TO |
|---|---|---|---|---|---|
| I100 | Consumer | 2024-01-01 | 9999-12-31 | 2024-01-01 | 2026-07-03 |
| I100 | Consumer | 2024-01-01 | 2025-06-15 | 2026-07-03 | 9999-12-31 |
| I100 | Technology | 2025-06-15 | 9999-12-31 | 2026-07-03 | 9999-12-31 |

现在可以回答两个不同的问题：

**今天的知识视角下，2025-06-30 的行业是什么？**

~~~sql
SELECT sector
FROM instrument_sector_bitemporal
WHERE instrument_id = 'I100'
  AND DATE '2025-06-30' >= valid_from
  AND DATE '2025-06-30' < valid_to
  AND CURRENT_TIMESTAMP() >= recorded_from
  AND CURRENT_TIMESTAMP() < recorded_to;
~~~

**在 2025-06-30 当时，系统记录的行业是什么？**

~~~sql
SELECT sector
FROM instrument_sector_bitemporal
WHERE instrument_id = 'I100'
  AND DATE '2025-06-30' >= valid_from
  AND DATE '2025-06-30' < valid_to
  AND TIMESTAMP_TZ '2025-06-30 23:59:59 +00:00' >= recorded_from
  AND TIMESTAMP_TZ '2025-06-30 23:59:59 +00:00' < recorded_to;
~~~

双时态模型会增加存储和查询复杂度。只有监管审计、历史绩效重算、追溯更正或争议调查确实需要“当时有效”和“当时已知”两个时间维度时，才值得引入。简单维度表只需 SCD2 时，不必一开始就做全套双时态设计。

### 周期快照应保留当时的关键输入，而不是依赖今天的维度重算

基金月末 NAV、每日组合持仓、信用风险敞口、指数权重和汇率都可能在后续发生更正。如果业务要求复现当时发布的数字，快照需要保留：
- 估值/业务日期和精确时点；
- 输入数据版本及来源系统；
- 证券/发行人映射版本；
- 价格、汇率、利率和公司行动口径；
- 计算逻辑版本和运行 Query ID；
- 人工调整、审批和发布状态。

只保存最后计算出的 NAV 总数，不足以复现计算过程；只保存当前持仓和当前价格，也不能说明历史报告为何得出某个值。对关键财务与监管报表，最好保存可追溯的输入快照或可重建的事件/版本来源。

### Time Travel、Fail-safe 和 Zero-copy Clone 解决的是平台恢复与开发副本

Snowflake Time Travel 用于在保留窗口内查询、Clone 或恢复被修改/删除的数据。默认保留期为 1 天；Standard Edition 的对象保留期可以设为 0 或默认 1 天；Enterprise Edition 及以上，永久对象可配置 0 到 90 天。它适合误删、错误更新、短期回退和恢复检查，不是多年业务历史方案。

Time Travel 之后，永久表还可能进入 7 天 Fail-safe。Fail-safe 是 Snowflake 在极端故障时提供的 best-effort 恢复服务，不是用户查询历史数据的第二个窗口，也不是可自助执行的长期归档。Temporary/Transient 表没有 Fail-safe；Transient 对象的历史数据超过 Time Travel 保留期后，不能再依赖 Snowflake 恢复。

Zero-copy Clone 可以在某个时间点创建逻辑副本，常用于测试修复、验证迁移或构建隔离分析环境。Clone 不会把源对象变成永久审计档案，也不能替代独立备份、异地保留或版本化业务历史。Clone 还会有后续写时存储成本，长期保留大量副本也需要治理。

### Stream 的 Change Tracking 也有保留边界

Stream 依赖源对象的 Change Tracking 历史。若 Stream offset 超出源表可用的历史保留窗口，Stream 会变成 stale，未消费变更不再可读，必须重新创建并通过其他方式补回变更。

Snowflake 可以基于 DATA_RETENTION_TIME_IN_DAYS 和 MAX_DATA_EXTENSION_TIME_IN_DAYS 临时延长未消费 Stream 的源表历史保留。SHOW STREAMS 或 DESCRIBE STREAM 中的 STALE_AFTER 可用于检查预计何时过期。不能把 Stream 当成永久事件队列；如果需要多年保留事件，应在消费时将变更写入独立、持久化的 Event History 表或外部归档。

### 回补需要业务键、有效时间、来源版本和可对账范围

回补不是简单重跑历史日期的 INSERT。至少要说明：
- 回补的业务日期/时间范围；
- 哪些源系统文件或事件包含在范围内；
- 业务键、事件 ID 和源版本如何识别重复与更正；
- 迟到记录是新增历史版本、修正当前状态还是重算快照；
- 回补后哪些汇总、指标、语义模型或报告需要重新计算；
- 如何检查金额、行数、唯一键和关键分布。

对当前状态表，可以使用按业务键和来源版本排序的 MERGE；对事件历史表，要保留原始事件及修订关系；对周期快照，应生成一个新的计算版本并保留旧版本，除非业务明确规定要替换旧快照。不要用一个 UPDATE 抹掉全部更正痕迹。

## 工程实施步骤

1. 从审计、监管、绩效和运营需求确认要回答“业务当时有效”还是“系统当时已知”。
2. 为事件、状态、快照和维度分别定义一行粒度、业务键、时间字段及来源版本。
3. 简单属性历史使用 SCD Type 2；需要追溯知识状态时，再设计双时态记录。
4. 对关键估值/报表建立周期快照，并保存输入版本、计算逻辑、Query ID、人工调整和审批。
5. 配置永久/Transient/Temporary 对象的 Time Travel 保留策略，并估算历史存储成本；不要将 Fail-safe 作为日常查询恢复方案。
6. 为 Stream 监控 STALE_AFTER 和消费频率；将重要事件持久化到独立历史表，避免把 Stream 当作归档。
7. 为每种回补定义固定批次范围、业务键、SOURCE_VERSION、重复规则、更新/新增规则和下游重算清单。
8. 回补前建立源记录和目标快照；回补后核对新增/更新/拒绝行、金额控制总额和重复键。
9. 对历史更正同时保留原始值、修订值、接收时间和修订原因。
10. 对长期审计数据采用符合保留要求的永久对象/外部归档与访问控制，并定期测试历史查询和恢复流程。

## 场景分析

风险团队要重算 F01 基金 2025-06-30 的发行人集中度。2026-07-03，数据供应商才通知某只证券从 2025-06-15 起应归类为 Technology，而不是 Consumer。

若模型只保存当前证券行业分类，2025-06-30 的历史报告会被今天的分类覆盖，无法还原当时已知结果。若只保存 SCD2 的业务有效时间，则可以按今天的修正重算 2025-06-30，但仍无法说明 2025-06-30 当日的报告为什么使用 Consumer。

如果监管部门要求复现原报告，应查询 RECORDED_TIME 视角；若投资团队要求按最新知识重新测算，则查询最新记录时间视角。两份结果都应保留自己的计算版本和报告目的，不能简单地把一份覆盖另一份。

Time Travel 可以帮助恢复近期误改的表，Zero-copy Clone 可以建立隔离环境验证回补 SQL，Stream 可以捕获短期变更；多年审计所需的事件、属性和估值历史仍应保存在有版本和时间语义的业务数据模型中。

## 常见误区

- **把 Time Travel 当永久历史库。** 它只有对象级保留窗口，默认 1 天；扩展到 90 天需要 Enterprise 及以上永久对象配置。
- **把 Fail-safe 当作用户可查询的历史版本。** 它是 Snowflake 在极端故障场景中的 best-effort 恢复机制，不是长期审计接口。
- **把 Zero-copy Clone 当备份归档。** Clone 是逻辑副本，适合测试和恢复检查，不能替代独立长期历史。
- **把 Event Time 当作数据可用时间。** 迟到事件必须同时记录业务发生时间和系统接收时间。
- **只用 SCD2 就声称能复现当时已知信息。** 需要还原历史知识状态时，要保存记录时间维度或不可变更的报告输入快照。
- **把 Stream 当作无限期 CDC 队列。** Source retention 超过窗口后 Stream 会 stale，未消费记录可能丢失。
- **回补时直接覆盖历史记录。** 应保留旧值、修订版本、来源和接收时间，并对下游输出重新对账。
- **回补后只看 SQL 成功。** 还要验证业务键、有效时间、金额和重算结果。

## 完成标准

- [ ] 能根据业务问题选择 Event History、SCD2、周期快照或双时态模型。
- [ ] 能区分 EVENT_TIME、INGESTED_AT、VALID_TIME 和 RECORDED_TIME。
- [ ] 能用有效期查询还原某个业务日期的属性值。
- [ ] 能说明双时态数据如何分别回答“今天看来”和“当时已知”。
- [ ] 能说明 Time Travel、Fail-safe、Zero-copy Clone 与长期历史保留的区别。
- [ ] 能识别 Stream stale 风险并监控 STALE_AFTER。
- [ ] 能设计有来源版本、幂等规则和对账条件的数据回补。

## 自测

1. 某证券的行业分类在 2026-07-03 被追溯修正为 2025-06-15 生效。要还原 2025-06-30 当时的报告，单独使用 SCD2 的 VALID_FROM/VALID_TO 是否足够？还需要什么时间维度？
2. Time Travel 默认保留多久？Standard 与 Enterprise 及以上的永久对象配置范围有什么不同？
3. Fail-safe 能否作为普通用户查询 30 天前表状态的方式？为什么？
4. Stream 超过源表可用历史窗口仍未消费会发生什么？应该监控哪个字段？
5. 一个订单的业务 EVENT_TIME 是 6 月 30 日，但 7 月 1 日才被加载。只保存 EVENT_TIME 会产生什么审计缺口？
6. 使用 Zero-copy Clone 建立测试副本，为什么仍不能把它当成长期业务归档？

## 参考资料

- [Understanding and using Time Travel](https://docs.snowflake.com/en/user-guide/data-time-travel)
- [Understanding and viewing Fail-safe](https://docs.snowflake.com/en/user-guide/data-failsafe)
- [Storage costs for Time Travel and Fail-safe](https://docs.snowflake.com/en/user-guide/data-cdp-storage-costs)
- [Working with temporary and transient tables](https://docs.snowflake.com/en/user-guide/tables-temp-transient)
- [Introduction to streams](https://docs.snowflake.com/en/user-guide/streams-intro)
- [Manage streams](https://docs.snowflake.com/en/user-guide/streams-manage)
