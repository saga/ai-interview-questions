# Semantic Views、Cortex Analyst 与 Text-to-SQL

## 语义层解决的是业务定义问题

自然语言问题里的“收入”“活跃客户”“本月订单”需要明确公式、时间范围、过滤条件、业务粒度和关系路径。Semantic View 将这些规则显式定义为维度、度量、实体关系和语义信息，使自然语言分析不必每次猜表名和 Join。

语义模型的价值不是让 SQL 生成看起来更聪明，而是让业务含义可检查、可复用和可回归。

## 先定义粒度和关系

Join 路径必须匹配事实表粒度。若一个订单头连接多条订单明细，再对订单头金额求和，就会产生重复值。关系定义应说明主键、外键、基数和允许的连接路径。

## Verified Queries 与金标准测试

把业务常问问题和经过验证的 SQL 一起管理。每次修改 Semantic View 后，运行固定问题集，比较 SQL、结果行数、指标数值和过滤语义。Verified Queries 不应该只是示例，而应成为模型行为的回归样本。

## Cortex Analyst 的产品边界

Cortex Analyst 面向结构化数据的自然语言分析。Snowflake 在 2026 年 8 月发布了从独立 Cortex Analyst 调用迁移到 Cortex Agents 的建议；Semantic Views 和 Verified Queries 可以继续复用，Agents 可将 Analyst 作为结构化数据工具，并与 Search 等能力协同。新应用设计应核对当前产品建议和 API 支持，而不要只沿用旧版独立端点架构。

## 上线门禁

业务负责人确认指标口径和名称；数据工程师验证 Schema、Join 和结果粒度；用 Golden Queries 验证 SQL 与结果；检查 Role、敏感列和行访问范围；记录模型、语义定义和测试集版本。

## 检查题

1. Semantic View 如何减少 Text-to-SQL 的业务歧义？
2. Join 基数错误如何造成指标重复？
3. 为什么需要把 Verified Queries 纳入回归测试？
