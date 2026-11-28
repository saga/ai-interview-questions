# 数据平台 RBAC、脱敏与行级治理

## 本节要解决的问题

财务分析师需要查看全部地区的销售汇总，但不能读取员工邮箱和电话号码；区域经理只能看自己负责的地区；审计人员可以查看完整记录，却不能修改业务数据。

如果只给财务角色 SELECT，再在 BI 报表里隐藏邮箱列，用户仍然可以通过其他 SQL 或视图读取敏感字段。真正的数据治理必须把三件事分开：角色决定谁能访问对象，Masking Policy 决定敏感列显示什么，Row Access Policy 决定哪些行能够进入查询结果。

## 核心知识

### RBAC 负责授予对象权限，不负责隐藏结果字段

Snowflake 的对象授权按层级组合。查询一张表通常需要 Database USAGE、Schema USAGE 和表 SELECT。角色通过继承获得权限；用户会话激活的主角色与次级角色也会影响实际可用权限。

例如给区域分析角色授予只读汇总视图权限：

~~~sql
GRANT USAGE ON DATABASE SALES TO ROLE regional_analyst;
GRANT USAGE ON SCHEMA SALES.REPORTING TO ROLE regional_analyst;
GRANT SELECT ON VIEW SALES.REPORTING.DAILY_REGION_SUMMARY
  TO ROLE regional_analyst;
~~~

如果用户还持有一个能读取明细表的其他角色，或者对象通过 PUBLIC、父角色和 Future Grants 间接授予权限，仅仅给 REPORTING View 授权并不能保证敏感明细不可见。需要检查完整角色继承与会话激活状态。更不要把报表隐藏列当成数据库权限控制。

### Masking Policy 控制列值，不会过滤记录

例如员工表有 EMAIL 和 PHONE。HR_FULL_ACCESS 可以看原始值，其他角色看到部分遮罩：

~~~sql
CREATE OR REPLACE MASKING POLICY mask_email
  AS (val VARCHAR)
  RETURNS VARCHAR ->
  CASE
    WHEN IS_ROLE_IN_SESSION('HR_FULL_ACCESS') THEN val
    WHEN val IS NULL THEN NULL
    ELSE REGEXP_REPLACE(val, '(^.).*(@.*$)', '\\\\1***\\\\2')
  END;
~~~

将策略绑定到列：

~~~sql
ALTER TABLE HR.EMPLOYEE
  MODIFY COLUMN EMAIL
  SET MASKING POLICY mask_email;
~~~

Masking Policy 在查询执行时处理列值。它不删除该行，也不会自动阻止用户通过其他非敏感字段推断出个人身份。遮罩规则需要结合数据类型和业务风险设计，例如邮箱、手机号、证件号和金额可能需要不同策略。

### Row Access Policy 决定一行是否出现在结果中

假设销售表包含 REGION。区域经理只能看到自己负责的区域；总部管理角色可以看全部区域：

~~~sql
CREATE OR REPLACE ROW ACCESS POLICY region_access
  AS (row_region VARCHAR)
  RETURNS BOOLEAN ->
    IS_ROLE_IN_SESSION('GLOBAL_SALES_ADMIN')
    OR EXISTS (
      SELECT 1
      FROM GOVERNANCE.ACCESS.REGION_ROLE_MAP m
      WHERE IS_ROLE_IN_SESSION(m.ROLE_NAME)
        AND m.REGION = row_region
    );
~~~

绑定策略：

~~~sql
ALTER TABLE SALES.MART.DAILY_SALES
  ADD ROW ACCESS POLICY region_access ON (REGION);
~~~

映射表记录角色和地区的授权关系。真实部署中要明确谁能维护这张表、谁能修改策略以及如何审计授权变更。这里用 IS_ROLE_IN_SESSION 检查当前会话激活的角色层级；若授权规则还依赖用户属性或次级角色启用状态，应在真实角色会话中回归验证。

Row Access Policy 会控制 SELECT 返回的行，也会影响 UPDATE、DELETE 和 MERGE 所选中的行。但它不是写入约束：它不会阻止用户 INSERT 新行，也不会阻止用户修改或删除对其可见的行。需要数据变更限制时，仍要用对象权限、任务身份和受控写入流程。

### 列脱敏和行过滤是两种不同的保护

| 需求 | 使用 | 查询结果 |
|---|---|---|
| 经理只能看到负责区域的订单 | Row Access Policy | 其他区域的行不出现在结果中 |
| 分析师能看到客户，但邮箱必须遮罩 | Masking Policy | 行仍存在，敏感列值被替换 |
| 分析师只能读取汇总视图 | View + RBAC | 通过对象授权限制可查询对象 |
| 大量表按数据分类自动应用同类遮罩 | Tag-based Masking Policy | 将策略绑定到 Tag，再由 Tag 继承到对象/列 |

行级策略和脱敏策略可以同时应用在一个对象上。Snowflake 先评估 Row Access Policy，再评估 Masking Policy。一个列不能同时作为 Row Access Policy 签名列和 Masking Policy 签名列，设计时要避免把同一个字段同时用作两种策略的输入。

Tag-based Masking Policy 适合把统一规则应用到许多列，甚至通过 Database/Schema Tag 继承到新增对象；该能力有 Edition 要求，当前 Snowflake 文档列为 Enterprise Edition 功能。启用之前应确认账户 Edition、Tag 权限和列类型匹配情况，不能假设打上任意 Tag 就会自动脱敏。

### 策略要用真实会话和 POLICY_CONTEXT 验证

策略创建成功不代表策略逻辑正确。至少要用不同角色执行相同查询，验证行数、敏感值和拒绝情况：

~~~sql
USE ROLE REGIONAL_MANAGER_WEST;

SELECT REGION, SUM(SALES_AMOUNT)
FROM SALES.MART.DAILY_SALES
GROUP BY REGION;
~~~

结果只应包含该经理获准查看的地区。然后用 HR_FULL_ACCESS 检查 EMAIL 是否保持原值，用普通分析角色确认 EMAIL 是否被遮罩。

Snowflake 的 POLICY_CONTEXT 函数可以模拟特定用户、角色和上下文下的查询策略效果，便于测试 Masking Policy 和 Row Access Policy，而不必每次切换真实登录账号。模拟结果仍应与实际角色会话做抽样对照，尤其要检查角色继承、Mapping Table 权限和策略所有权。

## 工程实施步骤

1. 先分类数据字段和行范围：哪些用户可以访问对象、哪些列需脱敏、哪些行应按地区/部门/客户过滤。
2. 建立最小权限角色矩阵，区分对象 USAGE/SELECT、写入权限、策略管理权限和数据所有权。
3. 为行范围策略建立授权映射表，明确授权生效日期、责任人、审批和回收时间。
4. 为敏感列定义 Masking Policy，覆盖 NULL、空值、格式异常、受信角色和非受信角色。
5. 为受限数据表或视图绑定 Row Access Policy，检查同一列是否又被用作 Masking Policy 参数。
6. 对 Tag-based Masking Policy，确认 Enterprise Edition、Tag 继承范围、数据类型匹配和已有列级策略优先级。
7. 使用 POLICY_CONTEXT 模拟不同用户/角色的查询，再用真实业务角色做正向与负向测试。
8. 检查结果行数、敏感列值、聚合指标和跨视图查询，确认策略不会因 View、Join 或所有权链路而失效。
9. 将策略定义、映射表变更、测试身份、Query ID 和审批记录纳入治理审计。
10. 角色或组织结构变化后重新跑测试，避免“角色改名/继承变化”造成访问面意外扩大。

## 场景分析

区域经理 West 需要看每日销售额，普通分析师可以看全部地区的汇总，但不能看到客户邮箱。HR 可以查看员工邮箱原值，其他角色只能看到遮罩值。

实现时，先用 Row Access Policy 控制区域经理对销售明细的可见范围；财务汇总视图按业务口径聚合销售金额，再通过 RBAC 授权给普通分析师；员工表使用 Masking Policy 保护 EMAIL。三个控制分别处理“看哪几行”“看到列里的什么值”和“能不能查询这个对象”。

验收不能只查区域经理的查询成功。还要证明 West 无法看到 East 的数据、普通分析师无法通过员工表或其他 View 读取原始邮箱、HR 仍可看到正确邮箱，并且新建报表视图没有绕过已有的行策略和脱敏规则。

## 常见误区

- **用 BI 隐藏列代替数据库权限。** 用户仍可能通过 SQL、其他视图或导出访问原始字段。
- **认为 Masking Policy 会隐藏整行。** 它处理列值；行级过滤要用 Row Access Policy。
- **认为 Row Access Policy 可以阻止用户写入未授权行。** 它控制可见行和 DML 选中行，不是通用 INSERT 约束。
- **在同一列上同时绑定 Masking 和 Row Access Policy 参数。** Snowflake 不允许同一列同时出现在两类策略签名中。
- **只在策略管理员角色下测试。** 管理角色的结果不能代表业务角色；要做真实角色的允许和拒绝测试。
- **在映射表里只维护角色名，不维护审批和回收。** 区域调整、离职和组织变更会造成长期过度授权。
- **把 Tag-based Masking 当成免费通用能力。** 它有 Edition 和数据类型匹配条件，仍要检查 Tag 继承与现有列策略。

## 完成标准

- [ ] 能区分 RBAC、Masking Policy 和 Row Access Policy。
- [ ] 能为区域/部门访问设计映射表和行策略。
- [ ] 能为敏感列设计受信角色与非受信角色的脱敏规则。
- [ ] 能说明行策略不会阻止所有 INSERT/UPDATE/DELETE 操作。
- [ ] 能解释 Tag-based Masking 的 Edition 和继承条件。
- [ ] 能使用 POLICY_CONTEXT 与真实业务角色验证策略效果。

## 自测

1. 一个分析师可以看到客户记录，但不应看到邮箱。应使用 Masking Policy 还是 Row Access Policy？为什么？
2. 一个区域经理只能查询 West 区域。若使用 Row Access Policy，授权关系应该保存在什么位置？谁负责维护？
3. 为什么 Row Access Policy 不能替代阻止用户 INSERT 未授权区域记录的写入控制？
4. 同一列既想作为 Masking Policy 输入又想作为 Row Access Policy 输入，Snowflake 有什么限制？
5. 如何证明普通分析师无法通过另一张 View 绕过邮箱脱敏？需要哪些正向与负向测试？

## 参考资料

- [Understanding row access policies](https://docs.snowflake.com/en/user-guide/security-row-intro)
- [Use row access policies](https://docs.snowflake.com/en/user-guide/security-row-using)
- [CREATE ROW ACCESS POLICY](https://docs.snowflake.com/en/sql-reference/sql/create-row-access-policy)
- [Tag-based masking policies](https://docs.snowflake.com/en/user-guide/tag-based-masking-policies)
- [Attribute-based access control using tag-based policies](https://docs.snowflake.com/en/user-guide/tag-based-policies)
