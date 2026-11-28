# 企业数据治理与访问控制：从数据库权限到数据消费契约

## 场景与目标

平台包含客户身份、订单、支付和运营指标。数据工程师需要排障，分析师需要查询，合作伙伴可能只应看到脱敏数据。治理要回答：谁因什么业务目的访问哪些数据、能看到什么粒度、访问是否被记录。

## 架构与数据流

~~~mermaid
flowchart TD
  ID[身份源 / SSO / 服务身份] --> ROLE[角色与职责]
  CLASS[数据分类与所有者] --> POLICY[访问策略]
  ROLE --> POLICY
  POLICY --> DB[数据库对象权限]
  POLICY --> MASK[列脱敏 / 行过滤]
  DB --> AUDIT[日志与审计]
  MASK --> AUDIT
  LINEAGE[血缘 / 质量 / 处理目的] --> CATALOG[目录与数据契约]
  AUDIT --> REVIEW[周期复核]
  CATALOG --> REVIEW
~~~

## 实施步骤

1. 分类公开、内部、机密和受监管数据，识别个人信息、支付信息、商业敏感信息和派生指标。分类应由数据所有者确认。
2. 将人员和服务身份映射到职责角色，再为角色授予最小权限。开发、测试和生产使用不同身份与边界。
3. 按职责划分权限：数据工程角色负责受控写入和维护；分析角色读取认证数据集；消费应用只访问所需视图或接口。
4. 对列级敏感值评估 masking policy 或安全视图；对行范围评估 row access policy、PostgreSQL RLS 或租户隔离。
5. PostgreSQL 使用 role、schema/table privilege、default privilege 和 RLS 等机制；Snowflake 使用 role hierarchy、grant、masking policy、row access policy 和标签。语义不能直接互换。
6. 发布数据产品前检查 owner、分类、刷新频率、质量阈值、血缘、使用目的、下游影响和访问角色。
7. 定期复核高权限角色、长期未用权限、外部共享、服务凭证、策略例外和访问异常；人员离职或用途变化应触发权限回收。



## 关键取舍

- 角色太少会导致权限过宽；角色太多会产生维护困难。按稳定职责和数据域设定边界。
- 脱敏可能影响连接、排序、聚合和分析结果。先定义业务场景，再验证策略作用范围。
- 数据库行级策略不能替代应用、缓存、导出和共享路径的安全设计。
- 语义层统一指标定义，但不能替代底层数据质量检查；自动化策略仍要给紧急例外设置负责人、期限和审计。

## 验收清单

- 敏感数据集有分类、owner、用途和保留策略。
- 服务身份与人员身份分开，生产访问遵循最小权限。
- 行列策略覆盖查询、视图、导出和共享等消费路径。
- 能解释某角色为何能访问某数据集，并追踪授权变更。
- 权限复核、离职回收和紧急访问均有审计记录。

## 关联知识点

以下节点教程保持各自独立；本教程只提供工程流程上的关联入口。

- [object-access-governance](../articles/object-access-governance.md)
- [data-governance-access-control](../articles/data-governance-access-control.md)
- [snowflake-guide-security](../articles/snowflake-guide-security.md)
- [snowflake-guide-least-privilege](../articles/snowflake-guide-least-privilege.md)
- [snowflake-authentication-methods](../articles/snowflake-authentication-methods.md)
- [snowflake-role-hierarchy-grants](../articles/snowflake-role-hierarchy-grants.md)
- [snowflake-masking-tagging-policies](../articles/snowflake-masking-tagging-policies.md)
- [semantic-metric-governance](../articles/semantic-metric-governance.md)
- [semantic-layer-design](../articles/semantic-layer-design.md)
- [postgresql-roles-privileges](../articles/postgresql-roles-privileges.md)

## 参考资料

- [Snowflake Access Control Overview](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [Snowflake Masking Policies](https://docs.snowflake.com/en/user-guide/security-column-intro)
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

参考链接已登记为官方文档入口，来源状态保留为“待核验”，没有把链接登记等同于已逐项复核。
