# Streamlit in Snowflake 与数据应用交付

## 应用架构不只是 UI

Streamlit in Snowflake 适合将 Python 数据应用部署在 Snowflake 平台内，让应用在受控身份和计算环境中读取平台数据。设计时要明确运行时、Warehouse 或 Container Runtime、包依赖、缓存、并发、权限和外部网络访问。

应用访问数据的权限由其执行上下文和授权配置决定。不要把“用户能打开页面”理解成“应用只会读取用户有权访问的数据”。要验证 owner-rights / caller-rights 相关行为和应用实际支持的权限模型。

## Warehouse Runtime 与 Container Runtime

不同运行时在包生态、资源隔离、计算方式和适用工作负载上有区别。Warehouse Runtime 更贴近 SQL 与常规数据分析应用；Container Runtime 适合需要更完整依赖或计算能力的场景，但会带来容器资源、启动、网络和运维边界。应按官方当前支持范围选型，而不是只比较语言包数量。

## 应用交付清单

1. 把业务逻辑和 UI 分离，避免在页面渲染中重复执行昂贵查询。
2. 为常用查询设置合理缓存，但要理解缓存与用户权限的关系。
3. 管理依赖版本和构建来源。
4. 使用受控的 Secret 与 External Access Integration 访问外部服务。
5. 对数据下载、导出和共享行为做权限限制。
6. 记录查询耗时、异常和资源使用，监控应用体验。

## Native App 交付

若应用要分发给外部消费者，Native App 需要应用包、安装脚本、版本和消费者授权。应用升级应考虑兼容性，不能假设消费者账户与开发账户具有相同对象、角色和外部集成。

## 检查题

1. Warehouse Runtime 与 Container Runtime 应按哪些因素选型？
2. 应用缓存为什么需要考虑身份和权限？
3. 将内部 Streamlit 应用转成 Native App，需要补充哪些交付工作？
