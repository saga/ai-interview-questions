# Marketplace、数据共享与应用交付

## 本节要解决的问题

将受治理的数据能力发布为可复用产品，区分跨账户共享、应用分发与交互式 UI。数据产品要有清晰的消费者、契约、版本、权限与撤销机制，而不是把一条 SQL 或一个 Streamlit 页面直接当成可运营产品。

## 核心知识

### Secure Data Sharing 与 Listing 面向数据分发

Share 将 Provider 选定的数据库对象授权给消费者，消费者在自己的账户中创建共享数据库并查询数据。共享不复制底层数据，消费者使用自己的 Warehouse 执行查询。Listing 提供产品发现、说明和面向消费者的分发入口，实际访问仍受 Share 和对象 Grants 控制。

对公开或多消费者产品，应明确数据更新频率、Schema 兼容、区域限制、支持联系人、服务目标和撤销策略。敏感字段应在 Provider 端通过 Secure View、Masking Policy 或 Row Access Policy 控制，不应依赖消费者自行过滤。

### Streamlit 与 Native App 提供不同的交付形态

Streamlit in Snowflake 适合在 Snowflake 环境中提供数据应用 UI，应用执行身份和访问对象权限仍需正确配置。它可以作为数据产品的交互入口，但 UI 隐藏某个按钮不是数据安全边界。

Native App 将应用包、Setup Script、应用对象和 Application Roles 交付到消费者账户，适合需要在消费者账户中安装并管理的应用能力。消费者需要审查应用请求的权限和引用对象，Provider 则负责包版本、Patch、Release Channel 和升级兼容。

### 产品生命周期需要独立于实现工具

产品定义应包含唯一标识、owner、目标消费者、数据契约、版本、支持渠道、用量/成本口径、兼容承诺和弃用期限。发布时记录产品版本与底层模型版本；升级时检测消费者兼容性；撤销时确认消费者已迁移并完成访问关闭。

数据共享、Streamlit 与 Native App 可以组合。例如 Listing 发现数据产品，Share 提供数据访问，Streamlit 提供交互入口；若消费者需要安装应用代码，则使用 Native App。

## 工程实施步骤

1. 定义产品消费者、使用场景、数据对象、应用入口、owner 和支持责任。
2. 根据消费者需要读取数据、操作 UI 或安装代码选择 Share/Listing、Streamlit 或 Native App。
3. 为数据产品建立业务契约：字段、粒度、指标定义、刷新时效、质量门槛和 Schema 演进策略。
4. 在 Provider 侧定义 Share、Secure Views、数据库角色和消费者授权范围，使用最小权限暴露数据。
5. 对 Streamlit 应用验证应用运行身份、调用者授权和底层对象权限，避免仅依赖前端控件控制访问。
6. 对 Native App 定义 Package、Manifest、Setup Script、Application Roles、引用对象和版本通道。
7. 在消费者真实账户中测试产品安装/导入、读写边界、权限拒绝、升级、回滚和撤销。
8. 收集消费者实际查询、错误、数据质量和支持请求，持续检查产品 SLA 与成本。
9. 对版本弃用提前通知消费者，提供迁移窗口和兼容方案，并保留审计记录。

## 场景分析

数据团队准备把内部销售数据集提供给多个外部消费者。部分消费者只需要定期读取汇总数据，另一些消费者需要一个能筛选、导出和解释销售趋势的应用。

只读消费者可使用 Share/Listing，避免为简单读取维护应用包；需要交互界面时可以评估 Streamlit；如果要在消费者账户中安装完整应用和业务逻辑，则评估 Native App。三种产品形态需要不同的权限模型和升级方式，但都应共享统一的数据契约和指标定义。

验收时使用不同消费者身份检查可见对象、UI 操作授权、应用角色和撤销结果，并测量数据更新延迟、消费者查询失败和服务支持成本。

## 常见误区

- 把 Streamlit UI 当底层安全边界。后端对象权限和应用身份才决定数据是否能被访问。
- 认为 Marketplace Listing 自动完成数据授权。底层仍由 Share、Grants 或应用角色控制。
- 默认跨账户共享只能复制数据。Secure Data Sharing 可以直接授权访问而不复制底层数据。
- 只关注上线，不定义版本兼容和消费者支持责任。数据产品需要生命周期管理。
- 用 Native App 交付所有只读数据集。简单数据消费通常可由 Share/Listing 完成。
- 撤销产品时只删除 Listing 页面。还应撤销 Share、应用权限和消费者访问。

## 完成标准

- [ ] 能区分 Secure Data Sharing、Listing、Streamlit 和 Native App。
- [ ] 能根据消费者需求选择产品交付方式。
- [ ] 能说明数据契约、版本和消费者支持责任。
- [ ] 能设计 Provider/Consumer 的权限模型。
- [ ] 能验证安装、更新、撤销和消费者使用行为。

## 自测

1. 消费者只需要读取一个稳定数据集，为什么不一定需要 Streamlit 或 Native App？
2. Streamlit 页面隐藏导出按钮，是否足以阻止用户读取底层数据？应该检查什么？
3. Native App 与 Share 的权限授予和升级模式有哪些不同？
4. 一个指标的字段名称不变但计算口径改变，是否属于兼容性变更？

## 参考资料

- [About Secure Data Sharing](https://docs.snowflake.com/en/user-guide/data-sharing-intro)
- [Snowflake Marketplace](https://docs.snowflake.com/en/user-guide/data-marketplace-about)
- [Streamlit in Snowflake](https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit)
- [Native Apps](https://docs.snowflake.com/en/developer-guide/native-apps/introduction)
