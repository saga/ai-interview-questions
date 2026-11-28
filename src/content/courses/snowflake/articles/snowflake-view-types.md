# Standard、Secure 与 Materialized View

## 本节要解决的问题

根据查询复用、数据隐私和性能要求选择标准视图、安全视图或物化视图。三者不是简单的性能等级：Standard View 保存查询定义，Secure View 限制定义和底层数据细节暴露，Materialized View 保存并维护预计算结果，成本与适用条件不同。

## 核心知识

### Standard View 保存查询定义，不保存独立结果副本

标准视图通过 SELECT 定义逻辑数据访问。查询视图时，Snowflake 依据定义访问底层对象；视图本身不维护一份独立的物化结果。它适合统一复杂查询逻辑、隐藏重复 SQL 和提供稳定的逻辑接口。

标准视图的定义默认可能对具有相关权限的用户可见。视图也不会自动替代底层表的授权设计；应通过视图所有权和对象权限管理谁可以访问结果。

### Secure View 主要解决敏感信息和视图定义暴露

Secure View 采用安全语义，视图定义和结构细节仅对被授权的所有者角色可见，并避免某些普通视图优化路径可能导致底层数据被间接推断的风险。它适用于共享或暴露敏感数据时，需要限制底层结构与隐藏信息泄露的场景。

Secure View 可能比普通视图执行得慢，不应仅为了让 SQL 更短或更方便而全部设置成 Secure。安全视图仍需正确管理访问 Role、底层对象和数据策略。

### Materialized View 保存预计算数据并由平台维护

Materialized View 保存由查询定义生成的预计算结果，适合重复且计算昂贵、结果相对稳定、被频繁查询的工作负载。Snowflake 会在后台维护物化结果，并使查询读取到当前数据；维护过程会消耗 credits，也占用存储空间。

Materialized View 需要 Enterprise Edition 或更高版本。它只支持受限制的查询定义，并非所有标准视图都能直接物化。不能对 Materialized View 直接执行常规 INSERT、UPDATE、DELETE、MERGE 等 DML；维护发生在基表变化之后。

## 工程实施步骤

1. 明确目标是复用 SQL 逻辑、保护底层数据结构，还是加速重复的计算结果；不要只用“需要性能”作为选型理由。
2. 对 Standard View 检查视图定义、底层对象和授权；确认消费角色只拥有需要的视图访问权限。
3. 对敏感数据共享场景评估 Secure View，验证非授权角色是否无法读取定义和推断隐藏信息，并测量性能影响。
4. 对高频重复查询采集基线 SQL、查询频率、处理成本、基表更新频率和结果大小，评估 Materialized View 的维护成本。
5. 创建物化视图前检查 Edition、支持的 SQL 形态与限制；使用 EXPLAIN 或 Query Profile 验证优化器是否使用物化结果。
6. 对物化视图监控刷新与维护 credits、存储消耗和基表 DML 频率；不要把维护成本隐藏在普通查询耗时指标之外。
7. 对三种视图分别配置 Owner、SELECT Grants 和安全策略，并测试撤销权限、结构变更和查询结果正确性。
8. 定期比较查询性能、维护费用和数据更新频率，删除不再有足够复用价值的 Materialized View。

示例：

~~~
CREATE SECURE VIEW SHARE_DB.PUBLIC.CUSTOMER_SUMMARY AS
SELECT CUSTOMER_SEGMENT, COUNT(*) AS CUSTOMER_COUNT
FROM CORE.CUSTOMERS
GROUP BY CUSTOMER_SEGMENT;

CREATE MATERIALIZED VIEW MART.DAILY_SALES_MV AS
SELECT ORDER_DATE, REGION, SUM(AMOUNT) AS TOTAL_AMOUNT
FROM MART.ORDERS
GROUP BY ORDER_DATE, REGION;
~~~

## 场景分析

企业向外部合作方共享客户分群统计，不希望对方通过视图定义获知内部数据结构；内部 BI 则反复运行相同的日销售汇总，基表更新频率较低。

对外共享部分可以评估 Secure View，并验证合作方的角色权限和定义可见性；内部 BI 可以先比较普通视图执行成本，再评估 Materialized View 的性能收益与后台维护费用。两个场景的目标不同，不应把所有视图都改成 Materialized View 或 Secure View。

验收时分别检查合作方读取边界、视图定义可见性、BI 查询 Profile、物化维护 credits、存储成本和基表变更后的结果一致性。

## 常见误区

- **认为 Standard View 自动隐藏底层 SQL。** 普通视图定义通常对有权限的用户可见；需要数据隐私保护时评估 Secure View。
- **把 Secure View 当成普通视图的性能增强版。** Secure View 的重点是安全与隐私，可能存在性能代价。
- **把 Materialized View 当成普通视图的免费缓存。** 它保存预计算结果，持续维护会产生 credits 和存储成本。
- **认为所有 SELECT 都能创建物化视图。** Materialized View 有 Edition 与查询定义限制。
- **认为物化视图可以像普通表一样被 DML 更新。** 其结果由 Snowflake 基于基表变化维护，不支持常规直接写入。

## 完成标准

- [ ] 能说明 Standard View 的逻辑定义与数据读取方式。
- [ ] 能解释 Secure View 对定义可见性和隐私保护的作用。
- [ ] 能说明 Materialized View 的预计算、自动维护和费用。
- [ ] 能根据 Edition、查询形态和维护成本选择物化视图。
- [ ] 能分别验证视图权限、结果正确性和性能表现。

## 自测

1. 普通视图被授予给外部角色后，对方可能通过什么方式看到视图定义？需要什么机制保护？
2. 某个聚合查询每天被运行数千次，而基表仅低频更新，为什么可以评估 Materialized View？
3. 创建 Materialized View 后查询速度提高，但账户成本明显上涨，应检查哪些维护成本？
4. Secure View 可能比普通视图慢，为什么仍然可能值得采用？

## 参考资料

- [Overview of Views](https://docs.snowflake.com/en/user-guide/views-introduction)
- [Working with Secure Views](https://docs.snowflake.com/en/user-guide/views-secure)
- [Working with Materialized Views](https://docs.snowflake.com/en/user-guide/views-materialized)
