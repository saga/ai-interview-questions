# Snowflake Agentic AI for Asset Management：100 道初级/中级题

**整理日期：2026-10-24**  
**课程归属：** 独立 `courseId=snowflake`，沿用仓库既有 Snowflake 学习体系，不归入 AI 六大能力域。  
**题量：** 新增 100 道独立题目；不覆盖先前的 Snowflake Roadmap、CoCo、Developer Guides 或 Demo Notebooks 题库。  
**难度：** 60 道初级（`easy`）、40 道中级（`medium`）。  
**题型：** 每道题同时提供单选题、开放题参考答案、解析、常见误解及可追溯来源。

## 来源与范围

主要来源是 [Snowflake-Labs/sfguide-agentic-ai-for-asset-management](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management)。该示例以虚构的 Simulated Asset Management（SAM）机构演示 Snowflake CoWork、Cortex Agents、Cortex Analyst、Cortex Search、语义视图、Snowflake ML 和数据工作流在资产管理中的集成。

题目重点基于示例公开的架构、数据模型、Agent 职责、Skill 工作流与语义视图设计重新编写，测试基础机制、工具选择、数据口径、结果核验和生产边界，不复制示例中的逐字问答。演示中的合成投资组合、客户、政策或文档应与真实市场/SEC 来源数据区分。示例政策阈值和运营 SLA 是演示配置，不应当作所有金融机构通用的行业标准。

主要参考文件：
- [项目概览与 Agent 清单](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/README.md)
- [数据模型](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/docs/data_model.md)
- [数据血缘](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/docs/data_lineage.md)
- [Portfolio Semantic View](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/python/ai/semantic_view_definitions/SAM_PORTFOLIO_VIEW.yaml)
- [Attribution Semantic View](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/python/ai/semantic_view_definitions/SAM_ATTRIBUTION_VIEW.yaml)
- [Portfolio Management Agent](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/python/ai/agents/pm_cockpit.py)
- [Research Agent](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/python/ai/agents/research_copilot.py)
- [Risk & Compliance Agent](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/python/ai/agents/risk_compliance.py)
- [Middle Office Agent](https://github.com/Snowflake-Labs/sfguide-agentic-ai-for-asset-management/blob/main/python/ai/agents/middle_office_copilot.py)

## 覆盖矩阵

| # | Knowledge ID | 主题 | 课程主题分类 | 新增题量 | 题目 ID 范围 |
|---:|---|---|---|---:|---|
| 1 | `sf-am-agent-architecture` | 资产管理多 Agent 架构与工具选型 | snowflake-agent-ml | 10 | `sf-asset-agentic-100-sf-am-agent-architecture-01…10` |
| 2 | `sf-am-semantic-lineage` | 资产管理语义视图、数据模型与血缘 | data-architecture | 10 | `sf-asset-agentic-100-sf-am-semantic-lineage-01…10` |
| 3 | `sf-am-portfolio-analytics` | 持仓、估值、基准与组合表现 | snowflake | 10 | `sf-asset-agentic-100-sf-am-portfolio-analytics-01…10` |
| 4 | `sf-am-attribution-factors` | 绩效归因、因子暴露与市场状态 | data-architecture | 10 | `sf-asset-agentic-100-sf-am-attribution-factors-01…10` |
| 5 | `sf-am-research-rag` | 研究 Copilot、Cortex Search 与投资备忘录 | snowflake-genai | 10 | `sf-asset-agentic-100-sf-am-research-rag-01…10` |
| 6 | `sf-am-risk-compliance` | 风险、合规、ESG 与政策驱动检查 | data-architecture | 10 | `sf-asset-agentic-100-sf-am-risk-compliance-01…10` |
| 7 | `sf-am-middle-office` | 中后台运营：NAV、结算与对账 | data-engineering | 10 | `sf-asset-agentic-100-sf-am-middle-office-01…10` |
| 8 | `sf-am-portfolio-modelling` | 组合构建、优化、回测与压力测试 | snowflake-agent-ml | 10 | `sf-asset-agentic-100-sf-am-portfolio-modelling-01…10` |
| 9 | `sf-am-credit-private-markets` | 私募信贷、私募股权与信用风险分析 | snowflake-agent-ml | 10 | `sf-asset-agentic-100-sf-am-credit-private-markets-01…10` |
| 10 | `sf-am-agent-governance` | Agent 评测、审计、权限与生产治理 | snowflake-agent-ml | 10 | `sf-asset-agentic-100-sf-am-agent-governance-01…10` |

合计 **10 个知识点 × 每点 10 道 = 100 道**。

## 文件

- 题库 JSON：[snowflake-asset-management-agentic-100.json](../src/data/questions/snowflake-asset-management-agentic-100.json)
- 知识节点 JSON：[snowflake-asset-management-agentic.json](../src/data/knowledge/snowflake-asset-management-agentic.json)

题目 ID 使用 `sf-asset-agentic-100-<knowledge-id>-NN`。每个知识点的前 6 题为初级，后 4 题为中级。所有题目归属 `courseId=snowflake`，且 `topic / subtopic / knowledgeId` 均对应新增知识节点。

## 关键工程教训

1. **工具选择依赖数据语义。** 组合持仓、归因和财务指标通常应由结构化分析/语义视图查询；内部政策、券商报告、电话会和监管文本通常需要受控文档检索。
2. **时间口径必须明确。** 持仓日期、价格日期、财务期间、文档发布日期和监管生效日期不可混用。多月绩效归因应按对应的 linked period 数据口径查询，不应简单相加月度归因。
3. **生成式 Agent 必须区分事实与意见。** 财务数据、SEC 披露、管理层陈述、券商意见和模型推断应按来源类型表达，冲突时先核对日期、实体和指标定义。
4. **业务阈值来自适用政策。** 先查适用政策，再关联实际持仓/风险事实；示例中的集中度与运营阈值仅是演示设置。
5. **Agent 的执行和写操作要受控。** 使用职责明确的工具、最小权限和可审计轨迹；保存长期投资 Thesis、改变组合或执行高影响动作必须遵守显式授权与业务审批。
6. **模型结果不是确定事实。** PD、SHAP、因子暴露、回测和 Monte Carlo 都需要说明定义、时间窗口、输入假设与限制，并且不得替代正式审批。

## 维护与验证

新增题目应继续保留来源章节及相关文件路径；更新示例相关知识时，应重新核对对应 Skill、Agent 指令、Semantic View 和数据模型，尤其是时间窗口、数字单位、政策阈值和工具职责。题目验证不应仅检查 JSON 语法，还应检查唯一 ID、知识节点引用、选择题答案索引、选项映射、难度分布和题目近重复。
