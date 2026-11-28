# Cortex Agents：工具设计与任务编排

## Agent 与单次模型调用不同

Agent 面向需要多步查询、工具调用和结果整理的任务。它接收用户目标，选择可用工具，查看结果，再决定下一步或结束。系统能力来自工具边界、提示规则、身份权限和执行反馈，而不是仅靠更长的 System Prompt。

## 工具职责要清晰

常见工具包括 Cortex Analyst（结构化业务数据）、Cortex Search（非结构化资料）、Custom Tools（受控业务逻辑）、MCP Connectors（外部工具服务）、Code Execution 和 Data to Chart。每个工具应定义输入和输出 Schema、权限、失败语义、超时和审计信息。不要向 Agent 暴露一个能任意执行 SQL 或访问整个账户的万能工具。

## Orchestration Instructions

明确任务边界、工具适用场景、必需证据、禁止操作、错误处理和停止条件。能用一次 SQL 查询完成的任务，不必编排多个 Agent 步骤；涉及审批、资金变更、生产发布等操作时，应要求明确授权和人工确认。

## 端到端流程

~~~mermaid
flowchart TD
  U[User Request] --> P[Classify task]
  P --> A[Plan evidence needed]
  A --> T[Select Analyst / Search / Custom Tool]
  T --> V[Validate tool output]
  V --> D{Sufficient evidence?}
  D -->|No| A
  D -->|Yes| R[Return answer with sources]
~~~

## 评测

记录工具选择、参数、返回状态、执行时间和最终答案。分别评估任务成功率、工具正确率、来源引用、SQL 结果、越权拒绝和成本。只测最终文本会掩盖中间工具误调用。

## 检查题

1. 哪些任务需要 Agent 编排，哪些一次 SQL 就够？
2. 为什么工具 Schema 和权限设计比工具数量更重要？
3. 怎样防止 Agent 在证据不足时继续猜测？
