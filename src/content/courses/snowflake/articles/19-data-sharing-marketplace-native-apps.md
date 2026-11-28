# Secure Data Sharing、Marketplace 与 Native Apps

## 从内部数据表到可交付产品

数据产品不只是把表授权给另一个团队。它需要稳定的数据契约、责任人、更新频率、质量指标、文档、权限范围、版本变更和消费者支持方式。

Snowflake Secure Data Sharing 可以让 Provider 向 Consumer 分享选定对象，而不需要把数据文件复制到消费者账户。共享对象对消费者是只读的；消费者使用自己的计算资源查询共享数据。

## Provider 与 Consumer 的责任

Provider 负责数据定义、更新、授权范围、Schema 变更通知和撤销策略。Consumer 负责消费端权限、查询成本和内部使用控制。Share、Direct Share、Listing、Data Exchange 和 Clean Room 的使用场景不同，不要仅把它们看作不同名称的数据库连接。

## Marketplace Listing

Listing 可以把数据集和产品说明一起提供给一个或多个消费者。发布前至少准备数据字典、示例查询、更新 SLA、字段敏感级别、许可条件和支持渠道。Listing 发布成功并不代表数据已经满足消费者需求。

## Native Apps

Native App Framework 允许提供方分发应用包和相关业务逻辑，消费者在自己的 Snowflake 环境中安装。应用可以组合 SQL、Procedure、UDF、Streamlit 或支持的服务组件，但实际能力受框架版本、平台区域和安全限制影响。

应用包要有版本、安装脚本、消费者授权步骤、升级路径和卸载策略。外部访问和消费者数据访问需要显式配置，不能假设应用天然拥有账户全部数据权限。

## 上线前验收

- 数据契约：粒度、字段、更新频率、删除和历史语义。
- 安全：可分享对象、敏感列、访问角色和审计。
- 运行：可用性、刷新失败、消费者查询成本。
- 变更：向后兼容、版本管理和撤销。
- 商业：Listing、定价和支持方式（适用时）。

## 检查题

1. Secure Data Sharing 为什么不需要把完整数据复制到消费者账户？
2. Listing 与 Direct Share 的产品化差异是什么？
3. Native App 的安装和升级为什么需要消费者侧授权流程？
