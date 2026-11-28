# 构建企业 AI 数据应用：RAG、Text-to-SQL 与 Agent 的组合架构

## 场景与目标

员工希望用自然语言查询经营指标、查阅政策文档并生成摘要。结构化数据需要正确指标语义和查询约束；非结构化资料需要检索、引用和版本管理。Agent 可以协调工具，但不应绕过权限，也不能把生成结果当成已验证事实。

## 架构与数据流

~~~mermaid
flowchart TD
  User[员工 / 应用] --> Gateway[身份、会话和策略]
  Gateway --> Router{问题类型}
  Router -->|指标问题| Analyst[Cortex Analyst / Semantic View]
  Router -->|文档问题| Search[Cortex Search / RAG]
  Analyst --> Guard[SQL 角色、范围和限制]
  Guard --> Warehouse[(受控数据集)]
  Search --> Docs[(有权限的文档索引)]
  Analyst --> Evidence[查询结果与证据]
  Search --> Evidence
  Evidence --> Agent[Agent 工具编排]
  Agent --> Eval[引用、正确性、权限、成本评测]
  Eval --> User
  Agent -.高风险动作.-> Approval[人工确认]
~~~

## 实施步骤

1. 区分指标查询、文档问答、跨源分析和业务操作，为每类问题明确数据源、权限范围、正确答案标准和失败响应方式。
2. 为关键指标建立 Semantic View 或受控语义模型，定义粒度、关系、过滤条件、公式和权限。Text-to-SQL 不应直接面对无边界生产 Schema。
3. 建立文档解析、切分、元数据、版本、权限标签和索引刷新流程。检索结果携带文档标识和可定位引用；过期文档和权限变化要同步。
4. 让 Analyst 负责结构化查询、Search 负责非结构化检索、Agent 负责工具选择和证据组织。工具输入输出应有 schema 并遵循最小能力原则。
5. SQL 使用只读身份、允许的数据集、超时、行数上限、成本阈值和审计。DDL、DML、导出和外部副作用默认拒绝。
6. 传递用户权限。验证身份映射、行列策略、文档 ACL、缓存隔离和应用日志，避免服务身份扩大用户权限。
7. 建立覆盖正确答案、无答案、歧义、越权、过期文档、SQL 失败、指标口径冲突和提示注入的评测集。
8. Agent 可规划、调用只读工具和汇总证据；付款、客户状态修改、权限调整或外部通知等高风险动作应走独立审批。
9. 记录用户、路由、检索文档、生成 SQL、执行参数、工具结果、模型版本和最终回答；敏感数据按策略脱敏。



## 关键取舍

- RAG 适合非结构化知识，指标问答需要语义模型和可执行查询；两者不能互相替代。
- 固定步骤优先使用确定性工作流；只有需要根据上下文选择工具和处理分支时才引入 Agent。
- 回答应区分原文、数据库查询结果和模型推断；没有证据时说明无法确认。
- 检索索引、生成缓存和工具结果都可能泄露数据；缓存键和索引过滤必须包含授权上下文。
- 只读分析风险较低；有副作用的操作需要独立授权、幂等键、审计和人工确认。

## 验收清单

- 结构化指标由受治理语义模型定义，并通过黄金问题集验证。
- 文档答案可追溯到有权限的文档片段和版本。
- SQL 使用只读最小权限身份，并有超时、范围和成本保护。
- 不同用户和租户之间不存在检索、结果或缓存越权。
- 评测包含无答案、歧义、提示注入和越权，高风险操作不会仅凭模型输出执行。
- 可以从 Trace 还原请求、工具调用、数据证据和最终回答。

## 关联知识点

以下节点教程保持各自独立；本教程只提供工程流程上的关联入口。

- [cortex-search-rag](../articles/cortex-search-rag.md)
- [cortex-analyst-semantic-sql](../articles/cortex-analyst-semantic-sql.md)
- [cortex-llm-functions](../articles/cortex-llm-functions.md)
- [cortex-document-functions](../articles/cortex-document-functions.md)
- [semantic-view-basics](../articles/semantic-view-basics.md)
- [cortex-sql-generation-guardrails](../articles/cortex-sql-generation-guardrails.md)
- [cortex-embedding-model-evaluation](../articles/cortex-embedding-model-evaluation.md)
- [cortex-analyst-test-suite](../articles/cortex-analyst-test-suite.md)
- [cortex-agent-orchestration](../articles/cortex-agent-orchestration.md)
- [cortex-agent-permission-boundary](../articles/cortex-agent-permission-boundary.md)
- [cortex-agent-evaluation](../articles/cortex-agent-evaluation.md)
- [cortex-agent-observability-mcp](../articles/cortex-agent-observability-mcp.md)

## 参考资料

- [Cortex Search](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [Cortex Analyst](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst)
- [Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)

参考链接已登记为官方文档入口，来源状态保留为“待核验”，没有把链接登记等同于已逐项复核。
