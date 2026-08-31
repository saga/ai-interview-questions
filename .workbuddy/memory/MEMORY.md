# 项目长期记忆（ai-interview-questions）

## 题库新增题目 / 知识节点的硬性约束（必读）
- `question.topic`（题侧）必须是 `src/data/knowledge/*.json` 里已有的**知识节点 id**（bank.test.ts 强制校验），不要写成 taxonomy 的 topic 或高层标签。
- 若需为全新子域**新建知识节点**：节点 `topic` 字段必须是 `src/data/taxonomy.ts` 骨架内合法的 topic id，且必须满足 `domainOfTopic(topic) === area`（taxonomy.test.ts 不变量）；节点 `id` 才是细粒度概念 slug。即「题侧 topic = 节点 id」「节点侧 topic = taxonomy 骨架 topic」两者不同，别把节点 topic 写成概念 id（会触发 taxonomy.test.ts 失败）。
- knowledge.test.ts 要求**每个知识节点至少有 1 道题**支撑（无悬空节点）；新建节点须同步配题。
- §4.2 格式门禁：一批 ≥3 道选择题时单选占比必须 ≤1/3，否则 `scripts/add-question.ts --check` 直接报错退出（应改写为多选，勿绕过）。少于 3 道小批量自动豁免。
- 选项长度平衡 ≤1.8×（中文按字符数，用 python `len()` 实测，勿手数估算）。
- angle 白名单 10 个：definition / fundamental / mechanism / comparison / calculation / tradeoff / scenario / debugging / system-design / design；不在白名单则改写。
- `scripts/question_analysis.py --semantic` 本仓不存在，语义去重只能人工复核（非阻断）。

## git 状态
- 截至 2026-08-31 第十六轮，全部改动（Prompt 分层重构 + AI 搜索 40 题 + 自我改进 Agent 7 题 + 多轮 taxonomy/App 修复）均**未 commit**，等用户指示。
