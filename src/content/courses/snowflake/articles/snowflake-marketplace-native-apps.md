# Marketplace Listing、Clean Rooms 与 Native Apps

## 本节要解决的问题

区分 Snowflake Marketplace Listing、Secure Data Sharing、Data Clean Rooms 和 Native Apps 的产品交付方式，并按消费者需要获得的是数据、受控联合分析还是应用能力来选型。尤其要注意 Clean Rooms 旧版 Provider/Consumer 流程已经进入退役期，不能继续按旧文档作为新项目默认方案。

## 核心知识

### Listing 是分发入口，不等于一种数据处理引擎

Marketplace Listing 用于发现和分发数据产品或应用。Listing 可以承载数据产品/Share，也可以承载 Native App application package。Private Listing 面向指定消费者，Public Listing 面向 Marketplace 的可发现用户；发布者需要满足相应的身份、内容、审核和产品要求。

真正的数据访问边界由底层 Share、数据库对象权限和消费者账户控制。Listing 页面可描述产品、计价、支持联系人和版本信息，但它本身不会自动让消费者取得发布者账户内所有数据的权限。

### Native App 将数据、业务逻辑和应用入口交付到消费者账户

Native App application package 包含数据内容、Manifest、Setup Script、版本和 Patch 信息。消费者从 Listing 安装应用，Setup Script 在安装或升级过程中创建应用内对象；Application Roles 负责将应用功能按权限开放给消费者账户内的角色。

发布者应最小化所需权限、声明资源需求和外部引用，消费者在安装时审核权限请求并决定是否授予。版本、Patch、Release Channel 和 Setup Script 应作为产品生命周期管理的一部分，升级不能只验证发布者开发账户。

### Data Clean Rooms 用于受控协作分析，旧版 Provider/Consumer API 正在退役

Data Clean Rooms 允许多个协作者在受控环境中定义可执行的分析模板、可连接/可投影列和隐私保护设置，避免直接暴露双方原始记录。它适合联合受众分析、重叠分析和受控数据协作，不等同于普通数据共享或通用应用分发。

截至 2026-11-28，旧版 Provider/Consumer Clean Rooms 已在 2026-10-01 起停止通过旧 Web UI 创建新 Clean Room；旧 UI 将在 2027-02-01 退役，旧 Provider/Consumer API 与 Clean Rooms 将在 2027-06-01 停止访问。新项目应采用 GA 的 Collaboration API，并对既有配置评估 Migration Tool 的支持范围。迁移工具会生成新配置，不会修改原 Clean Room；旧项目应在新协作验证通过后再清理旧资源。

## 工程实施步骤

1. 先确认消费者要获取的是数据副本/共享访问、受控联合分析，还是在自己账户安装运行的应用。
2. 数据产品分发评估 Share 与 Listing；需要发布业务逻辑或用户界面时评估 Native App；要控制双方数据的分析方式时评估 Data Clean Rooms。
3. 对 Listing 明确 Provider/Consumer、发现范围、产品说明、价格/计量、支持责任、版本和撤销流程。
4. 对 Native App 检查 application package、Manifest、Setup Script、Application Roles、引用对象、资源请求和版本升级。
5. 在消费者测试账户安装真实版本，逐项审查权限请求；验证最小权限、升级、卸载和外部引用行为。
6. 对 Clean Rooms 新项目使用 Collaboration API，审查 collaborator、data offering、analysis template、可连接/可输出列和结果激活权限。
7. 对旧 Provider/Consumer Clean Rooms 运行迁移前检查，确认配置是否受 Migration Tool 支持，执行 Plan、Review、Execute、Finalize 和 Validate。
8. 迁移完成后以模板数量、data offering、consumer/collaborator 状态和分析结果对账；确认业务流水已切换再安排旧资源下线。
9. 对生产数据产品保留消费者权限审查、版本升级通知、故障响应和撤销演练。

## 场景分析

零售商希望与广告合作伙伴分析活动触达和购买转化，但双方都不能直接看到对方原始客户明细；另一个团队希望把一套数据质量管理应用交给多个 Snowflake 客户使用。

前一个需求适合 Data Clean Rooms：双方通过 Collaboration 定义数据 offering 和可执行分析，限制可连接列、结果列和分析模板。后一个需求适合 Native App，通过 application package 和 Listing 分发应用对象、逻辑和界面。若只是把一份参考数据集分享给消费者，则 Secure Data Sharing/Listings 更直接。

若已有 Clean Room 仍运行在旧 Provider/Consumer 体系，必须把 2027-02-01 UI 退役和 2027-06-01 全面退役纳入迁移计划，而不是继续依赖旧 UI 新建流程。

## 常见误区

- **认为 Listing 本身就是数据权限。** 实际访问仍由 Share、对象 Grants、应用角色或 Clean Room 协作规则控制。
- **用 Native App 代替所有数据共享。** 若消费者只需读取数据，Share/Listing 可能更简单。
- **把 Clean Room 当作另一个普通数据库。** 其核心是受约束的联合分析与隐私控制，不应直接访问双方所有原始数据。
- **新建项目继续照抄旧 Provider/Consumer API 流程。** 旧界面和 API 已公布退役日期，应以 Collaboration API 为主。
- **发布 Native App 后只测试发布者账户。** 消费者安装、权限授予、引用绑定和升级路径可能暴露不同问题。
- **迁移旧 Clean Room 后马上删除原对象。** 应先验证新的协作状态、模板与结果一致性，再清理旧环境。

## 完成标准

- [ ] 能区分 Listing、Secure Data Sharing、Data Clean Rooms 与 Native Apps。
- [ ] 能根据“数据分发、受控联合分析、应用分发”选择产品形式。
- [ ] 能说明 Native App 的 Package、Manifest、Setup Script 和 Application Roles。
- [ ] 能说明旧版 Clean Rooms 的退役日期和 Collaboration API 迁移路线。
- [ ] 能设计消费者权限审查、安装、升级、迁移和回滚验收。

## 自测

1. 消费者只需查询发布者提供的一组数据，是否一定需要 Native App？为什么？
2. 两家机构需要联合分析但不允许直接交换原始客户明细，应该优先评估哪种方式？
3. 截至 2026-11-28，旧 Provider/Consumer Clean Rooms 的哪几个退役时间点会影响现有项目？
4. Native App 安装时要求访问消费者账户的特定对象，消费者应在哪个阶段审查并授予相关权限？

## 参考资料

- [Publish an app to consumers](https://docs.snowflake.com/en/developer-guide/native-apps/ui-provider-publishing-app-package)
- [Create and manage an application package](https://docs.snowflake.com/en/developer-guide/native-apps/creating-app-package)
- [Native App consumer workflow](https://docs.snowflake.com/en/developer-guide/native-apps/ui-consumer-about)
- [Data Clean Rooms Collaboration API](https://docs.snowflake.com/en/user-guide/cleanrooms/collaboration-api-reference)
- [End of life for legacy Provider and Consumer Data Clean Rooms](https://docs.snowflake.com/en/user-guide/cleanrooms/pc-eol)
- [Data Clean Room migration tool](https://docs.snowflake.com/en/user-guide/cleanrooms/migration-tool)
