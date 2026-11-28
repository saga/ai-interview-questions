# Snowflake 身份、RBAC 与数据治理策略

## 从身份到数据对象的授权链

Snowflake 的授权以 Role 和对象 Privilege 为核心。User 获得一个或多个 Role；Role 可以继承其他 Role；Privilege 授予 Role 后，用户通过激活相应 Role 获得操作能力。Warehouse、Database、Schema 和具体对象需要分别检查权限。

推荐按工作职责建立角色，而不是按单个用户建立授权。业务角色可以组合读取、数据工程、开发和安全职责；高权限角色应限制人员和使用场景。

## Role hierarchy 与 Managed Access

普通 Schema 中，对象 Owner 通常可以管理对象授权；Managed Access Schema 把授权决策集中到 Schema Owner 或具备 MANAGE GRANTS 的角色。它有助于集中治理，但也改变了开发团队自行授权的流程。

角色设计应考虑职责分离、继承路径、所有权转移、服务账号和紧急操作。避免把 ACCOUNTADMIN 作为日常应用角色。

## 身份认证方式

常见方式包括 MFA、SSO、OAuth 和 Key-pair Authentication。交互用户、自动化 CI/CD、应用服务和外部 Connector 的身份需求不同。服务身份应使用可轮换凭据，权限范围与调用目的匹配，并通过审计日志追踪调用者。

## 数据保护策略

| 控制 | 作用 |
|---|---|
| Masking Policy | 根据角色或上下文控制列值呈现 |
| Row Access Policy | 限制用户可见的行 |
| Tag-based Masking | 通过标签把分类与策略绑定 |
| Network Policy | 限定允许的网络访问来源 |
| Secure View | 控制共享查询接口和定义可见性 |
| Access History | 分析对象访问证据 |

策略需要测试正常角色、受限角色、数据管理员和服务身份。仅仅成功创建 Policy，不代表它已绑定到所有敏感字段。

## 审计与变更治理

定期检查 Role Grants、对象 Owner、未使用权限、共享对象、服务身份和外部集成。对敏感字段建立数据分类、策略责任人和审批流程。权限变更应进入 Git 或变更记录，并在非生产环境测试继承效果。

## 检查题

1. Role、Privilege、User 和 Ownership 的关系是什么？
2. Managed Access Schema 改变了谁的授权责任？
3. 为什么仅配置 Masking Policy 不等于完成数据保护？
