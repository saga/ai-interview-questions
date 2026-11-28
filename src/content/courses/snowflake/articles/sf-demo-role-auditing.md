# RBAC、MFA 审计与数据访问控制

## 本节要解决的问题

审计发现一名分析师可以查询薪酬明细，但团队负责人认为他只应该看到汇总结果。检查用户资料时，这名分析师只有一个名为 ANALYST_READ 的角色；继续追查发现，ANALYST_READ 继承了 FINANCE_READ，而 FINANCE_READ 又继承了 PAYROLL_READ。

Snowflake 的授权不是简单地看用户直接拥有哪几个角色。权限可能来自角色继承、PUBLIC、当前激活的主角色和次级角色，也可能来自对象所有权。MFA 又是身份认证控制，不是数据库对象授权。审计要分别回答“用户如何登录”和“登录后能访问什么”。

## 核心知识

### 先还原用户可获得的角色层级

假设角色层级如下：

~~~sql
GRANT ROLE PAYROLL_READ TO ROLE FINANCE_READ;
GRANT ROLE FINANCE_READ TO ROLE ANALYST_READ;
GRANT ROLE ANALYST_READ TO USER analyst_a;
~~~

角色被授予另一个角色后，父角色可以继承子角色的权限。分析员只看到 ANALYST_READ，并不意味着他只有这个角色的权限。

可以展开用户的角色继承：

~~~sql
SHOW GRANTS TO USER analyst_a INCLUDE HIERARCHY;
~~~

INCLUDE HIERARCHY 会递归列出授予该用户角色及其继承层级中的授权。它适合做权限盘点，但不能单独代表某个具体会话当下启用了哪些角色。审计时还要检查用户会话：

~~~sql
SELECT
  CURRENT_USER() AS current_user,
  CURRENT_ROLE() AS primary_role,
  CURRENT_SECONDARY_ROLES() AS secondary_roles;
~~~

CURRENT_ROLE() 显示当前主角色；次级角色是否启用会影响当前会话能使用的权限。应在实际执行查询的会话中检查，不要把角色树中“可继承”的权限与当时已启用的权限混为一谈。

### 对象权限需要按数据库、Schema 和对象逐层检查

要查询某张表，通常需要具备数据库 USAGE、Schema USAGE 和表 SELECT 等必要权限。能看到数据库或 Schema，不表示一定能 SELECT 其中的表。

~~~sql
SHOW GRANTS ON DATABASE FINANCE;
SHOW GRANTS ON SCHEMA FINANCE.PAYROLL;
SHOW GRANTS ON TABLE FINANCE.PAYROLL.EMPLOYEE_COMPENSATION;
~~~

还要检查未来授权。对象创建以后自动获得的权限，可能来自 Schema 或 Database 的 Future Grants：

~~~sql
SHOW FUTURE GRANTS IN SCHEMA FINANCE.PAYROLL;
SHOW FUTURE GRANTS IN DATABASE FINANCE;
~~~

如果对象由 Managed Access Schema 管理，授权责任和普通 Schema 不同。不要只查某个用户直接获得的 GRANT，也要查对象拥有者、父角色和未来授权。

### 允许访问和拒绝访问都必须做真实测试

审计报告写着“用户只拥有只读权限”并不足够。应选取真实用户和角色，在对应会话中分别验证：

~~~sql
USE ROLE ANALYST_READ;
USE SECONDARY ROLES NONE;

SELECT COUNT(*)
FROM FINANCE.PAYROLL.EMPLOYEE_COMPENSATION;
~~~

若业务要求分析师不能读取明细，这条查询应被拒绝；而允许访问的汇总视图则应成功：

~~~sql
SELECT COUNT(*)
FROM FINANCE.REPORTING.PAYROLL_SUMMARY;
~~~

测试时要记录当前用户、主角色、次级角色、SQL、Query ID 和错误信息。不要用 ACCOUNTADMIN 做正向验证，因为它拥有的权限会掩盖普通业务角色的授权缺口。负向测试也要覆盖间接继承、PUBLIC、Future Grants 和对象所有权。

### MFA 策略约束认证方式，不替代 RBAC

MFA 面向人类用户的认证保护。Snowflake 对密码登录的 MFA 要求正在推进；对 SSO 用户，Snowflake 默认依赖身份提供商执行 MFA。如果组织希望 SSO 后再执行 Snowflake MFA，需要用 Authentication Policy 明确控制。

例如，下面的策略要求用户注册 MFA，并对外部认证方式执行 MFA。实际部署前应按组织使用的 PASSWORD、SAML/OIDC 方式和 Security Integration 填写允许列表：

~~~sql
CREATE AUTHENTICATION POLICY require_mfa
  CLIENT_TYPES = ('SNOWFLAKE_UI', 'SNOWFLAKE_CLI', 'SNOWSQL', 'DRIVERS')
  AUTHENTICATION_METHODS = ('PASSWORD', 'SAML')
  SECURITY_INTEGRATIONS = ('CORP_SAML')
  MFA_ENROLLMENT = 'REQUIRED'
  MFA_POLICY = (
    ENFORCE_MFA_ON_EXTERNAL_AUTHENTICATION = 'ALL'
  );
~~~

要将策略应用到整个账户：

~~~sql
ALTER ACCOUNT SET AUTHENTICATION POLICY require_mfa;
~~~

由于 MFA_ENROLLMENT 要求用户先在 Snowsight 注册，CLIENT_TYPES 必须包含 SNOWFLAKE_UI；示例同时允许 CLI、SnowSQL 和驱动客户端。实际允许的认证方式与 Security Integration 必须和账户配置一致。如果仅要求密码用户使用 MFA，而 SSO MFA 由企业 IdP 管理，策略设置就不同。服务用户也不应照搬人类用户的密码和 MFA 流程；应按服务身份场景使用适当的程序化认证方式。

## 工程实施步骤

1. 从身份目录确定用户类型：人类用户、服务用户、自动化集成和紧急运维账号，分别定义认证方式。
2. 用 SHOW GRANTS TO USER ... INCLUDE HIERARCHY 展开用户继承角色，记录每个权限来自直接授权、子角色、PUBLIC 还是所有权。
3. 对敏感数据库、Schema、表和视图检查当前授权及 Future Grants；同时识别 Managed Access Schema。
4. 检查用户当前主角色和次级角色启用情况，避免把可继承角色误当成当前会话已生效的角色。
5. 在真实业务角色下执行允许与拒绝访问测试，分别验证明细表、汇总视图、受限列和敏感数据。
6. 检查 Authentication Policy 的 MFA_ENROLLMENT、MFA_POLICY、AUTHENTICATION_METHODS 和 SECURITY_INTEGRATIONS。
7. 对 SSO 用户确认 IdP MFA 策略；不要假定 Snowflake 默认会对所有 SSO 登录再要求一次 MFA。
8. 将审计发现映射到权限 owner、整改期限、复测用例和例外审批；临时权限必须有到期与回收安排。
9. 保存授权快照、策略定义、用户/角色测试结果、Query ID 和审批记录，供后续复核。

## 场景分析

分析师 A 可以查询 PAYROLL_SUMMARY，但不能读取 EMPLOYEE_COMPENSATION。审计人员在 Snowsight 中发现 A 的主角色是 ANALYST_READ，于是认为权限配置正确。

进一步展开角色层级后发现 ANALYST_READ 继承 FINANCE_READ，FINANCE_READ 又继承 PAYROLL_READ；PAYROLL_READ 对 EMPLOYEE_COMPENSATION 有 SELECT。A 在某些会话中启用了所有次级角色，因此可以读取明细表。

修复时先确认是否真的需要让 ANALYST_READ 继承 FINANCE_READ。如果只需要汇总视图，应拆分职责角色，移除不必要的明细权限，并在 USE SECONDARY ROLES NONE/ALL 两种会话条件下做回归。然后用普通分析师身份重测明细拒绝和汇总允许两条路径。

MFA 审计另行检查：如果分析师使用 SAML SSO，先确认 IdP 已强制 MFA；若公司要求 Snowflake 也执行 MFA，再配置适用的 Authentication Policy。不能通过给用户换一个更低权限的 Snowflake Role 来解决认证策略缺失。

## 常见误区

- **只检查用户直接授予的角色。** 权限还可能来自角色层级、PUBLIC、次级角色和对象所有权。
- **把角色树中可继承的权限等同于当前会话有效权限。** 还要检查主角色和次级角色启用状态。
- **认为能看到 Schema 就一定能查询表。** 数据库、Schema 和目标对象需要相应权限。
- **只做成功查询测试。** 必须同时做拒绝访问测试，确认敏感数据确实不可见。
- **认为 MFA 与 RBAC 是同一个控制。** MFA 保护认证过程，RBAC 决定认证后的数据访问。
- **认为 SSO 用户默认一定通过 Snowflake MFA。** Snowflake 默认依赖 IdP 的 MFA；若要额外强制，应设置 Authentication Policy。
- **用 ACCOUNTADMIN 验证业务权限。** 高权限角色会掩盖普通用户的授权缺失。

## 完成标准

- [ ] 能通过 INCLUDE HIERARCHY 还原用户的角色继承路径。
- [ ] 能区分潜在继承权限与当前会话启用的主/次级角色。
- [ ] 能检查数据库、Schema、对象和 Future Grants。
- [ ] 能设计实际业务角色的允许与拒绝访问测试。
- [ ] 能解释 Authentication Policy 如何要求人类用户注册 MFA。
- [ ] 能区分密码、SSO 和服务用户的认证治理方式。

## 自测

1. analyst_a 只被直接授予 ANALYST_READ，但该角色继承 FINANCE_READ，后者继承 PAYROLL_READ。怎样找出这条间接授权路径？
2. SHOW GRANTS TO USER 展示了继承权限，但当前会话禁用了次级角色。为什么仍要在真实会话里测试访问结果？
3. 用户可以访问 FINANCE Schema，却无法 SELECT 某张表。应检查哪些层级的权限？
4. 企业通过 SAML SSO 登录 Snowflake。若希望 Snowflake 额外要求 MFA，应配置哪类策略？与要求密码用户 MFA 有何不同？
5. 为什么不能用 ACCOUNTADMIN 的查询结果证明 ANALYST_READ 已经符合最小权限要求？

## 参考资料

- [Overview of Access Control](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [SHOW GRANTS](https://docs.snowflake.com/en/sql-reference/sql/show-grants)
- [Authentication policies](https://docs.snowflake.com/en/user-guide/authentication-policies)
- [Multi-factor authentication (MFA)](https://docs.snowflake.com/en/user-guide/security-mfa)
