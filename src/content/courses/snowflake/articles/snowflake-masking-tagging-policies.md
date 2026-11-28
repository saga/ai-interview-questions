# 标签分类与 Tag-based Masking Policy

## 新增一张客户表，为什么敏感列没有自动脱敏

数据平台为 Email 列创建了 Masking Policy，又在另一张表上手工绑定一次。半年后有十几张表使用同一列名，策略逐渐不一致。问题在于标签只用于分类，还是被真正连接到掩码策略；两者不是一回事。

Tag-based Masking Policy 将对象标签与 Dynamic Data Masking 关联。列或其父级对象带有相应标签、且数据类型匹配时，策略可以自动应用到该列。它适合统一保护一类数据，但不能替代分类审核、策略测试和权限治理。

## 先统一敏感级别，再建立标签

例如组织定义三类标签：PUBLIC、INTERNAL 和 SENSITIVE。标签值是分类元数据，不是访问权限本身。真正的查询返回结果仍由 Masking Policy、Role、条件函数和对象授权决定。

Tag-based Masking Policies 需要 Enterprise Edition。部署前应确认账户版本，并由治理角色拥有创建 Tag、Masking Policy、关联策略以及给目标对象赋标签所需权限。

## 一个基于字符串类型的策略例子

先创建标签和 Masking Policy：

~~~sql
CREATE TAG GOVERNANCE.CLASSIFICATION.SENSITIVITY
  COMMENT = 'Column sensitivity classification';

CREATE MASKING POLICY GOVERNANCE.POLICIES.MASK_SENSITIVE_STRING
AS (VAL STRING)
RETURNS STRING ->
  CASE
    WHEN IS_ROLE_IN_SESSION('PII_READER') THEN VAL
    ELSE '***'
  END;

ALTER TAG GOVERNANCE.CLASSIFICATION.SENSITIVITY
  SET MASKING POLICY GOVERNANCE.POLICIES.MASK_SENSITIVE_STRING;
~~~

之后可以在列上标记分类：

~~~sql
ALTER TABLE ANALYTICS.CUSTOMERS
  MODIFY COLUMN EMAIL
  SET TAG GOVERNANCE.CLASSIFICATION.SENSITIVITY = 'SENSITIVE';
~~~

示例只保护 STRING 类型的列。若同一标签还要保护 NUMBER 或 DATE，需要分别创建匹配类型签名的 Masking Policy。一个标签对每种数据类型只能关联一条 Masking Policy；不能给同一标签配置两条 STRING policy 再期望它们都执行。

Tag-based policy 也可以附加到 Database、Schema 或 Table。将标签放到父级对象会扩大继承/应用范围，必须先评估同一容器里是否存在不应该被保护或不同数据类型的列。

## 直接策略、标签策略与条件参数的优先关系

如果某列已经直接绑定 Masking Policy，而标签又关联了 Tag-based Policy，直接绑定的列级策略优先。不能仅凭在表上打了标签就断定该列正在使用标签策略。

Conditional Masking Policy 还会要求辅助列满足命名和类型匹配。策略签名中的 secondary argument 与目标表列不匹配时，策略可能处于未生效或冲突状态。通过 Account Usage 的 TAG_REFERENCES 和 POLICY_REFERENCES 检查实际标签与策略引用，比只看 DDL 更可靠。

Row Access Policy 控制行是否可见，Masking Policy 控制列值如何返回。两者都能用来表达数据保护，但必须在同一数据集上组合测试，尤其是按租户隔离与按列脱敏同时存在时。不要把列脱敏当成行级授权。

## 对标签策略做完整验收

部署后应至少检查：

1. Tag 是否附着到预期列或父级对象。
2. 列数据类型是否与 Masking Policy 参数一致。
3. 是否存在直接绑定策略覆盖 Tag-based Policy。
4. PII_READER 和普通分析角色看到的值是否符合预期。
5. 新增列或新建表是否按分类流程补齐标签。
6. 角色继承变化后，IS_ROLE_IN_SESSION 的判断是否符合访问模型。

如果策略被挂到 Tag 上，Tag 或 Masking Policy 在解除关联前不能随意删除；相关父级 Schema/Database 也可能受约束。标签治理需要作为 Schema 变更流程的一部分，而不是临时加一条 ALTER TABLE。

## 常见错误

- 只创建标签，没有将 Masking Policy 关联到标签。
- 把字符串策略用于 NUMBER/DATE 列，忽略签名的数据类型限制。
- 同一个标签给相同数据类型挂多条 Masking Policy。
- 忽略直接列策略优先级，误判标签策略已经生效。
- 将 Tag 分类当成访问控制本身。
- 未分别测试行级过滤与列级脱敏的组合结果。

## 自测

1. 为什么把 SENSITIVE 标签附加到 Table 后，不一定能保护所有列？
2. 一个标签已经关联 STRING Masking Policy，为什么不能再给它关联第二条 STRING Policy？
3. 列直接设置 Masking Policy 后，Tag-based Policy 的执行优先级如何？
4. 如何验证标签策略是否真的应用到新建列？
5. Row Access Policy 与 Masking Policy 分别解决什么问题？

## 参考资料

- [Tag-based masking policies](https://docs.snowflake.com/en/user-guide/tag-based-masking-policies)
- [Work with object tags](https://docs.snowflake.com/en/user-guide/object-tagging/introduction)
- [Tag inheritance](https://docs.snowflake.com/en/user-guide/object-tagging/inheritance)
- [Access control privileges](https://docs.snowflake.com/en/user-guide/security-access-control-privileges)
