# MFA、SSO、OAuth 与 Key-pair 认证

## 本节要解决的问题

为交互用户、企业员工和自动化应用选择合适的 Snowflake 身份验证方式。认证负责证明“调用者是谁”；认证成功之后，活动 Role 和对象授权才决定“调用者能做什么”。认证机制与业务权限不能混为一谈。

## 核心知识

### MFA 强化用户交互登录

用户名/密码加多因素认证可用于交互式登录。第二因素可以是受支持的验证方式；MFA Token Caching 在符合配置条件时可减少短时间内重复登录的确认次数，但不应把缓存 token 当长期凭证或绕过认证策略的方式。

组织应通过身份策略和用户生命周期管理统一设置 MFA，定期检查登录历史与异常认证事件。MFA 并不替代 Role 授权，也不意味着用户登录后自动拥有数据访问权限。

### SSO 将用户身份验证委托给企业身份提供方

Snowsight SSO 通过第三方 IdP 验证员工身份，再由 IdP 向 Snowflake 提供可信证明。联邦认证可使用 SAML assertion 或 OIDC ID token，具体取决于组织的配置。

SSO 解决用户登录与统一身份生命周期，不负责自动创建用户的业务数据权限。用户映射、默认角色、角色继承和离职禁用仍需要明确管理。

### OAuth 与 Key-pair 面向程序化身份的不同需求

OAuth 通过受信任的授权服务器和 token 代表客户端或用户授予访问能力。服务到服务应用可以使用 Client Credentials Grant；交互应用可以使用 Authorization Code Grant。需要配置 OAuth Security Integration、issuer、audience、scope 和角色映射等边界。

Key-pair authentication 使用应用保管的私钥证明身份，Snowflake 用户对象关联公钥。它避免在请求中发送密码，但私钥是长期高价值凭证，必须放入安全密钥管理系统，控制文件权限、轮换公钥并审计使用情况。Snowflake 还支持其他程序化凭证（例如 PAT），应结合生命周期、适用客户端与组织策略选择。

## 工程实施步骤

1. **先区分主体。** 将人员交互、后台服务、CI/CD 作业和第三方应用分别列出，明确谁代表用户访问、谁代表应用自身访问。
2. **交互用户优先纳入企业身份体系。** 已有 IdP 的组织配置 SSO；需要密码登录的用户按策略启用 MFA。
3. **应用身份独立建模。** 为服务创建专用 Snowflake User 和 Role，不复用个人账户，不在配置文件或代码仓库中保存密码或私钥。
4. **按 OAuth 场景配置授权集成。** 明确 client type、grant type、issuer、audience、scope 和 role mapping，并验证 token 的签发者、受众和过期时间。
5. **按 Key-pair 场景配置公私钥。** 公钥关联用户对象，私钥保存在 Secret Manager 或受控密钥设备中；安排密钥轮换和吊销流程。
6. **认证后验证授权。** 使用 CURRENT_USER、CURRENT_ROLE、CURRENT_SECONDARY_ROLES 检查会话身份，再通过最小权限 SQL 验证目标对象可读/可写范围。
7. **记录并审查登录证据。** 查询 LOGIN_HISTORY，监控失败登录、认证因子、服务账户异常和凭证轮换状态。

## 场景分析

企业员工通过浏览器使用 Snowsight，ETL 服务则在云端按计划加载订单数据。员工应使用企业 SSO 并按要求启用 MFA；ETL 服务不应依赖某位员工的密码或 MFA 交互，可以使用受控 OAuth 服务身份或 Key-pair 等程序化认证方式。

两类主体分别映射到不同 Role。即使 ETL 认证成功，也只应能访问指定 Stage 和目标表；即使员工可以登录 Snowsight，也不代表其自动拥有生产订单表的 SELECT 权限。验收需覆盖员工登录、服务 token 或签名认证、权限拒绝、密钥轮换和离职停用。

## 常见误区

- **把 MFA 当作数据对象授权。** MFA 只强化身份验证，表和仓库权限由 Role 与 Grants 控制。
- **认为 SSO 会自动继承员工在所有应用中的数据库权限。** SSO 提供可信身份，Snowflake 仍按自身 User/Role 和对象授权规则执行。
- **把 OAuth、Key-pair 当作同一种凭证。** OAuth 使用受信任授权服务签发的 token；Key-pair 用私钥签名证明持有者身份。
- **把服务应用绑定到工程师个人密码。** 人员离职、密码轮换和 MFA 策略变化会破坏自动化，也扩大凭证泄露影响面。
- **认为私钥比密码安全就不需要轮换。** 私钥泄露仍会造成身份冒用，应进行安全存储、最小权限、轮换与审计。

## 完成标准

- [ ] 能区分 MFA、SSO、OAuth 和 Key-pair 解决的问题。
- [ ] 能为交互用户与后台应用选出合适的认证方式。
- [ ] 能说明 SAML/OIDC SSO 与 Snowflake Role 授权的边界。
- [ ] 能为程序化凭证设计存储、轮换和撤销流程。
- [ ] 能在认证成功后验证活动 Role 和对象权限。

## 自测

1. 员工通过 SSO 成功登录，但 SELECT 生产表失败，应该检查认证还是对象授权？
2. 后台服务需要无人值守访问 Snowflake，为什么不应使用员工的密码和 MFA 设备？
3. OAuth Client Credentials 和 Key-pair authentication 在身份信任来源上有什么区别？
4. 私钥轮换时，如何避免新旧密钥切换造成生产任务中断？

## 参考资料

- [Overview of Snowflake authentication](https://docs.snowflake.com/en/user-guide/security-authentication-overview)
- [Multi-factor authentication (MFA)](https://docs.snowflake.com/en/user-guide/security-mfa)
- [Federated authentication and SSO](https://docs.snowflake.com/en/user-guide/security-federation-overview)
