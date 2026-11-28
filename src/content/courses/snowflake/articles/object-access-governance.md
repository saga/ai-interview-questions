# 对象权限、RBAC 与数据访问治理

## 本节要解决的问题

为人、应用、数据平台和外部消费者分配最小权限，确保权限既能支持业务操作，又能控制敏感字段和可见行。Snowflake 访问控制以 Role 和对象 Grants 为基础；Masking Policy 与 Row Access Policy 是查询时的数据保护机制，不能替代对象访问授权，也不能靠前端隐藏字段实现安全。

## 核心知识

### Role、Privilege、Ownership 与对象层级

权限授予给 Role，再将 Role 授予 User 或其他 Role；当前 Session 的 Primary Role 和已启用的 Secondary Roles 决定执行 SQL 时可使用的权限。角色层级向上继承权限，便于按业务职责组合访问能力。

对象位于 Database、Schema 和具体对象的层级中。访问一个表通常不仅需要目标表的 SELECT，还需要父级 Database 和 Schema 的 USAGE。创建对象还要有相应 CREATE privilege；Warehouse 的使用需要其 USAGE。对象 OWNERSHIP 是单对象的完整控制权，默认授予创建该对象时使用的 Role，但拥有 Role 本身并不意味着自动继承它所拥有的其他 Role 的权限。

普通 Schema 中对象 Owner 通常可以管理对象 Grants；Managed Access Schema 则把授权决策集中到 Schema Owner 或拥有 MANAGE GRANTS 的 Role。不要把对象 Owner、Role Owner 和账户管理权限混为一谈。

### Masking Policy 控制列值，Row Access Policy 控制行是否返回

Dynamic Data Masking 在查询执行时对指定列应用策略，可根据当前 Role、上下文或授权映射表决定返回原值、部分脱敏值或掩码值。它适合保护手机号、证件号、邮箱和薪酬等字段。

Row Access Policy 根据查询上下文决定某一行是否出现在结果中，适合按区域、部门、客户或业务归属进行行级过滤。策略表达式可以查询映射表，但要控制复杂度并管理映射表权限。Row Access Policy 不会阻止数据被 INSERT，也不会阻止用户更新或删除其本来可见的行；它主要控制读取结果和受策略约束的 DML 行可见性。

如果同一对象同时设置 Row Access Policy 和 Masking Policy，Snowflake 先评估 Row Access Policy，再评估 Masking Policy。相同列不能同时作为两类策略的签名输入列。

### 策略治理与查询权限是两层控制

Policy Owner/管理员需要 CREATE、APPLY、OWNERSHIP 等管理权限；普通消费者只应得到访问受保护对象所需的 SELECT 等权限。不能为了让某个查询通过，就授予该用户 APPLY MASKING POLICY 或 MANAGE GRANTS。

Enterprise Edition 或更高版本支持 Dynamic Data Masking 和 Row Access Policies。上线前需核对账户版本、策略引用、角色继承和政策表达式的执行成本。

## 工程实施步骤

1. **列出主体与数据对象。** 区分人员账户、服务身份、开发/运维角色、Database、Schema、Table/View、Stage 和 Warehouse。
2. **按业务职责建 Role。** 将只读分析、数据写入、数据建模、策略管理和账户管理分开；尽量用自定义业务 Role，而不是直接把对象权限散发给用户。
3. **按对象层级授予权限。** 核对 Database/Schema 的 USAGE、目标对象 SELECT/INSERT/UPDATE 等权限，以及 Warehouse USAGE；避免只授表权限而遗漏父对象访问。
4. **审查 Ownership。** 确定对象由哪个 Role 拥有；需要集中授权时使用 Managed Access Schema，并将 Grant 决策交给 Schema Owner 或 MANAGE GRANTS 角色。
5. **为敏感列设计 Masking Policy。** 明确哪些角色可见明文、哪些角色需要部分脱敏或 NULL；将策略管理权限与查询权限分离。
6. **为行级隔离设计 Row Access Policy。** 使用用户/角色上下文或集中映射表确定可见行；映射表需要与受保护对象保持一致的授权和数据维护责任。
7. **测试真实 Session。** 使用实际服务身份和消费者角色执行允许及拒绝路径；检查 CURRENT_ROLE、CURRENT_SECONDARY_ROLES，并验证角色继承不会意外放大访问范围。
8. **使用 POLICY_CONTEXT 做策略模拟。** 对预期 Role/Session Context 模拟 Masking Policy 与 Row Access Policy 结果，确认策略表达式覆盖正常和异常分支。
9. **审计策略引用和权限变化。** 使用 POLICY_REFERENCES、MASKING_POLICIES 等视图盘点策略附着位置；对 Role Grant、Ownership 转移和政策更新保留审批记录。
10. **定期复核。** 清理离职账号、临时角色、过期 Grant 和未使用的策略；将生产服务身份的权限收缩纳入变更流程。

示例：对客户邮箱按当前 Role 动态脱敏。

~~~sql
CREATE MASKING POLICY SECURITY.MASK_EMAIL
AS (EMAIL STRING)
RETURNS STRING ->
  CASE
    WHEN IS_ROLE_IN_SESSION('CUSTOMER_PII_READER') THEN EMAIL
    ELSE REGEXP_REPLACE(EMAIL, '(^.).*(@.*$)', '\\1***\\2')
  END;

ALTER TABLE CRM.CUSTOMERS
  MODIFY COLUMN EMAIL
  SET MASKING POLICY SECURITY.MASK_EMAIL;
~~~

策略部署角色需要对应的创建和应用权限；消费者仍需对 CRM.CUSTOMERS 拥有 SELECT。示例中的 Role 名称需按账户角色层级调整。

## 场景分析

区域销售人员只能访问自己负责区域的客户，并可看到客户姓名与公司，但只能看到邮箱掩码；合规人员可以在授权审批后查看完整邮箱和所有区域记录。

先用业务 Role 表达“区域销售”“合规读取”和“策略管理员”，不要直接给销售账号 OWNERSHIP。Row Access Policy 根据授权映射表限制区域行；Masking Policy 根据当前 Role 控制 EMAIL 列。策略管理员负责创建和附着策略，普通销售角色只有查询所需权限。

验收使用三种身份分别查询：销售只返回所属区域，未授权区域被隐藏且邮箱掩码；合规人员在有授权时可见完整数据；策略管理员可以维护策略，但不因管理能力自动获得业务数据明文。还要测试用户切换 Primary/Secondary Role 后的结果。

## 常见误区

- **把 Role 授予用户就认为拥有所有对象权限。** Role 仍需获得目标对象及父级容器的具体 Privilege。
- **把 OWNERSHIP 当普通 SELECT/USAGE 权限。** Ownership 包含完整控制和授权责任，应限制持有者。
- **用 Masking Policy 代替 Row Access Policy。** 列脱敏与行过滤解决不同问题。
- **把 Row Access Policy 当写入拒绝机制。** 它主要控制行可见性，不阻止插入越权数据；写入还要有业务约束和授权检查。
- **在 Managed Access Schema 中让对象 Owner 决定全部 Grant。** Managed Access 会把授权决策集中到 Schema Owner 或 MANAGE GRANTS 角色。
- **为了测试策略而给普通用户 APPLY/OWNERSHIP。** 应使用专门管理角色和 POLICY_CONTEXT 模拟，避免扩大生产权限。

## 完成标准

- [ ] 能解释 Role、Privilege、Ownership 与角色继承关系。
- [ ] 能检查 Database、Schema、Object 与 Warehouse 的权限链。
- [ ] 能区分 Masking Policy 和 Row Access Policy 的作用。
- [ ] 能说明 Managed Access Schema 与普通 Schema 的授权差异。
- [ ] 能使用真实角色和 POLICY_CONTEXT 验证允许与拒绝路径。
- [ ] 能审计策略引用和角色权限变化。

## 自测

1. 用户有目标表 SELECT，但查询仍报权限错误，应该检查哪些父级对象权限？
2. 区域销售只能看本区域客户行且邮箱要脱敏，为什么需要 Row Access Policy 和 Masking Policy 两种机制？
3. Row Access Policy 是否会阻止用户向表插入其他区域的数据？还需要哪些写入约束？
4. Managed Access Schema 中对象 Owner 是否能自行决定向其他 Role 授予权限？授权决策由谁负责？
5. 为什么 Policy 管理权限不能默认授予所有普通查询用户？

## 参考资料

- [Overview of Access Control](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [Access control privileges](https://docs.snowflake.com/en/user-guide/security-access-control-privileges)
- [Understanding Dynamic Data Masking](https://docs.snowflake.com/en/user-guide/security-column-ddm-intro)
- [Using Dynamic Data Masking](https://docs.snowflake.com/en/user-guide/security-column-ddm-use)
- [Understanding Row Access Policies](https://docs.snowflake.com/en/user-guide/security-row-intro)
- [Using Row Access Policies](https://docs.snowflake.com/en/user-guide/security-row-using)
