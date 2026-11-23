# RSI 200 道初级 / 中级题覆盖矩阵

完整阅读路线见 [rsi-learning-path.md](./rsi-learning-path.md)。

## 题目分布
- 总量：200 道开放式面试题。
- 初级（`easy`）：120 道；中级（`medium`）：80 道。
- 知识点：16 个；前 8 个节点各 13 道（8 初级、5 中级），后 8 个节点各 12 道（7 初级、5 中级）。
- 每道题都提供参考答案、解释、Knowledge ID、考察角度、误解项和来源链接。

## 逐知识点映射

| Knowledge ID | 知识点 | 题目 ID | 初级 | 中级 | 核心覆盖 |
|---|---|---|---:|---:|---|
| `rsi-definitions-evidence` | RSI 定义、边界与证据层级 | `rsi-001–013` | 8 | 5 | Self-refinement 只改善当前输出，不必产生跨任务保留的状态变化；Persistent self-improvement 将变化写入权重、记忆、技能、Prompt、Harness 或代码并影响后续任务；Recursive self-improvement 要证明产生更新的机制本身也因更新而变得更有效 |
| `rsi-loop-design` | 反馈闭环与改进流程设计 | `rsi-014–026` | 8 | 5 | 闭环至少包含执行、反馈、诊断、候选生成、验证、保留和监控；反馈需结构化并关联任务、上下文、动作、结果和软件版本；候选变更应先在隔离环境评估，再决定是否晋级到生产版本 |
| `rsi-self-training-reward` | 自训练、自奖励与 AI 反馈 | `rsi-027–039` | 8 | 5 | Self-training 使用模型生成或筛选的数据继续训练模型；RLAIF 使用 AI 反馈构造偏好或奖励信号，不等于完全没有外部约束；Self-rewarding 让模型参与生成答案和评估答案，需校准评判质量 |
| `rsi-synthetic-data-distillation` | 合成数据、自蒸馏与模型坍塌 | `rsi-040–052` | 8 | 5 | 合成数据应标记生成模型、提示、过滤过程和版本；过滤可结合规则、执行验证、模型评判和人工抽样；多样性、难度和长尾覆盖不能只用样本数量替代 |
| `rsi-self-play-curriculum` | 自博弈、挑战者与课程自演化 | `rsi-053–065` | 8 | 5 | Self-play 通过策略间交互或自生成偏好形成学习信号；Challenger 负责提出有挑战但可验证的任务，Solver 负责解决；课程难度应围绕当前能力边界动态调整 |
| `rsi-prompt-program-optimization` | Prompt、程序与优化器演化 | `rsi-066–078` | 8 | 5 | OPRO 根据历史候选及其分数提出新候选；Promptbreeder 还会演化生成变异提示的元提示；TextGrad 使用文本反馈指导复合系统中的变量更新 |
| `rsi-memory-context-evolution` | 记忆与上下文演化 | `rsi-079–091` | 8 | 5 | 经验记忆应从任务轨迹中提炼可复用规则，而非无差别存储全部对话；记忆需要检索、冲突处理、时效和来源信息；上下文演化可以更新结构化策略手册或上下文工件 |
| `rsi-skill-harness-evolution` | Skill、子 Agent 与 Harness 演化 | `rsi-092–104` | 8 | 5 | Harness 包括 Prompt、工具定义、工作流、记忆、执行策略和子 Agent 结构；Skill 应沉淀可迁移过程性知识，并带有适用条件和验证证据；成功轨迹可抽象成可复用子 Agent 或工具，但需要验证任务边界 |
| `rsi-verification-evaluation` | 自验证、评测与独立监督 | `rsi-105–116` | 7 | 5 | Self-Refine 和 Chain-of-Verification 提供迭代反馈或核验流程，但不保证事实正确；工具交互和可执行测试可提供模型之外的验证证据；过程奖励模型检查中间步骤，结果奖励关注最终结果 |
| `rsi-coding-agent-modification` | 自修改 Coding Agent | `rsi-117–128` | 7 | 5 | Agent 读取并修改自身代码或执行脚手架，形成候选版本；候选补丁应在隔离环境中构建、测试和评测；基准任务需要避免答案泄漏、测试污染和环境不一致 |
| `rsi-automated-ai-rd` | 自动化 AI 研发与 AI-for-AI | `rsi-129–140` | 7 | 5 | 研发流程包括假设、实验设计、实现、执行、分析、复核和下一轮计划；实验环境应可执行、可复现并记录代码、数据、模型和配置版本；代理指标和最终研究目标必须区分 |
| `rsi-multi-agent-coevolution` | 多智能体协同与共演化 | `rsi-141–152` | 7 | 5 | Proposer、Solver、Critic 和 Verifier 等角色可以形成互补闭环；群体共演化可以更新个体策略、协作方式和团队结构；保留个体上下文和共享全局状态之间需要权衡 |
| `rsi-embodied-adaptation` | 具身智能与物理环境自改进 | `rsi-153–164` | 7 | 5 | 环境反馈来自真实物理状态，而不只是模型生成的文本评价；仿真可以降低探索成本，但存在 sim-to-real 差距；失败恢复轨迹可成为技能和策略更新的数据来源 |
| `rsi-evolutionary-search` | 进化搜索、开放式演化与候选档案 | `rsi-165–176` | 7 | 5 | Mutation 生成候选变体，Crossover 组合已有候选特征；Selection 根据适应度或约束选择后续候选；Archive 保留历史有效候选和其证据 |
| `rsi-safety-governance` | RSI 安全、目标保持与治理 | `rsi-177–188` | 7 | 5 | 目标漂移可能由环境反馈、奖励投机或长期记忆更新引起；评估器漂移会使系统逐步优化错误或变化的标准；Reward Tampering 是系统操纵奖励生成或评估过程 |
| `rsi-introspection-self-modeling` | 内省、自我模型与能力校准 | `rsi-189–200` | 7 | 5 | 自我解释可能是事后生成的合理化文本，不等于真实内部访问；能力校准关注模型能否识别何时知道或不知道；自我预测应与实际行为和其他预测者对照 |

## 知识点与外部资料对应

### RSI 定义、边界与证据层级

- Knowledge ID：`rsi-definitions-evidence`
- Awesome RSI 分类：Scope & Terminology / Fundamentals & Getting Started
- 关键材料：[2507.21046](https://arxiv.org/abs/2507.21046)、[2607.07663](https://arxiv.org/abs/2607.07663)、[2609.13406](https://arxiv.org/abs/2609.13406)、[1805.06610](https://arxiv.org/abs/1805.06610)
- 验收重点：Self-refinement 只改善当前输出，不必产生跨任务保留的状态变化；Persistent self-improvement 将变化写入权重、记忆、技能、Prompt、Harness 或代码并影响后续任务；Recursive self-improvement 要证明产生更新的机制本身也因更新而变得更有效

### 反馈闭环与改进流程设计

- Knowledge ID：`rsi-loop-design`
- Awesome RSI 分类：Harness-level RSI / Self-Evolving Agent Frameworks
- 关键材料：[2510.04618](https://arxiv.org/abs/2510.04618)、[2510.16079](https://arxiv.org/abs/2510.16079)、[2603.19461](https://arxiv.org/abs/2603.19461)、[EvolveR](https://github.com/KnowledgeXLab/EvolveR)
- 验收重点：闭环至少包含执行、反馈、诊断、候选生成、验证、保留和监控；反馈需结构化并关联任务、上下文、动作、结果和软件版本；候选变更应先在隔离环境评估，再决定是否晋级到生产版本

### 自训练、自奖励与 AI 反馈

- Knowledge ID：`rsi-self-training-reward`
- Awesome RSI 分类：Model-level RSI / Self-Training & Self-Reward
- 关键材料：[2401.10020](https://arxiv.org/abs/2401.10020)、[2309.00267](https://arxiv.org/abs/2309.00267)、[2401.01335](https://arxiv.org/abs/2401.01335)、[2608.24231](https://arxiv.org/abs/2608.24231)
- 验收重点：Self-training 使用模型生成或筛选的数据继续训练模型；RLAIF 使用 AI 反馈构造偏好或奖励信号，不等于完全没有外部约束；Self-rewarding 让模型参与生成答案和评估答案，需校准评判质量

### 合成数据、自蒸馏与模型坍塌

- Knowledge ID：`rsi-synthetic-data-distillation`
- Awesome RSI 分类：Model-level RSI / Synthetic Data & Self-Distillation
- 关键材料：[2212.10560](https://arxiv.org/abs/2212.10560)、[2312.06585](https://arxiv.org/abs/2312.06585)、[2609.39306](https://arxiv.org/abs/2609.39306)、[2510.16657](https://arxiv.org/abs/2510.16657)
- 验收重点：合成数据应标记生成模型、提示、过滤过程和版本；过滤可结合规则、执行验证、模型评判和人工抽样；多样性、难度和长尾覆盖不能只用样本数量替代

### 自博弈、挑战者与课程自演化

- Knowledge ID：`rsi-self-play-curriculum`
- Awesome RSI 分类：Model-level RSI / Self-Play & Iterative Fine-tuning / Multi-Agent Co-Evolution
- 关键材料：[2508.05004](https://arxiv.org/abs/2508.05004)、[2203.14465](https://arxiv.org/abs/2203.14465)、[2511.16043](https://arxiv.org/abs/2511.16043)、[2602.04837](https://arxiv.org/abs/2602.04837)
- 验收重点：Self-play 通过策略间交互或自生成偏好形成学习信号；Challenger 负责提出有挑战但可验证的任务，Solver 负责解决；课程难度应围绕当前能力边界动态调整

### Prompt、程序与优化器演化

- Knowledge ID：`rsi-prompt-program-optimization`
- Awesome RSI 分类：Harness-level RSI / Prompt & Program Optimization
- 关键材料：[2309.03409](https://arxiv.org/abs/2309.03409)、[2309.16797](https://arxiv.org/abs/2309.16797)、[2406.07496](https://arxiv.org/abs/2406.07496)、[2310.02304](https://arxiv.org/abs/2310.02304)、[2310.03714](https://arxiv.org/abs/2310.03714)
- 验收重点：OPRO 根据历史候选及其分数提出新候选；Promptbreeder 还会演化生成变异提示的元提示；TextGrad 使用文本反馈指导复合系统中的变量更新

### 记忆与上下文演化

- Knowledge ID：`rsi-memory-context-evolution`
- Awesome RSI 分类：Harness-level RSI / Context & Memory Evolution
- 关键材料：[2510.04618](https://arxiv.org/abs/2510.04618)、[2308.10144](https://arxiv.org/abs/2308.10144)、[2502.12110](https://arxiv.org/abs/2502.12110)、[2602.07755](https://arxiv.org/abs/2602.07755)
- 验收重点：经验记忆应从任务轨迹中提炼可复用规则，而非无差别存储全部对话；记忆需要检索、冲突处理、时效和来源信息；上下文演化可以更新结构化策略手册或上下文工件

### Skill、子 Agent 与 Harness 演化

- Knowledge ID：`rsi-skill-harness-evolution`
- Awesome RSI 分类：Harness-level RSI / Self-Evolving Agent Frameworks / Frameworks & Tools
- 关键材料：[2603.18000](https://arxiv.org/abs/2603.18000)、[2507.03616](https://arxiv.org/abs/2507.03616)、[2410.04444](https://arxiv.org/abs/2410.04444)、[2305.16291](https://arxiv.org/abs/2305.16291)、[ace](https://github.com/ace-agent/ace)
- 验收重点：Harness 包括 Prompt、工具定义、工作流、记忆、执行策略和子 Agent 结构；Skill 应沉淀可迁移过程性知识，并带有适用条件和验证证据；成功轨迹可抽象成可复用子 Agent 或工具，但需要验证任务边界

### 自验证、评测与独立监督

- Knowledge ID：`rsi-verification-evaluation`
- Awesome RSI 分类：Harness-level RSI / Self-Verification & Self-Correction / Benchmarks & Evaluations
- 关键材料：[2303.17651](https://arxiv.org/abs/2303.17651)、[2305.11738](https://arxiv.org/abs/2305.11738)、[2309.11495](https://arxiv.org/abs/2309.11495)、[2310.01798](https://arxiv.org/abs/2310.01798)、[2305.20050](https://arxiv.org/abs/2305.20050)
- 验收重点：Self-Refine 和 Chain-of-Verification 提供迭代反馈或核验流程，但不保证事实正确；工具交互和可执行测试可提供模型之外的验证证据；过程奖励模型检查中间步骤，结果奖励关注最终结果

### 自修改 Coding Agent

- Knowledge ID：`rsi-coding-agent-modification`
- Awesome RSI 分类：Coding / Software-Engineering Self-Improvement / Self-Modifying Coding Agents
- 关键材料：[2505.22954](https://arxiv.org/abs/2505.22954)、[2504.15228](https://arxiv.org/abs/2504.15228)、[2412.21139](https://arxiv.org/abs/2412.21139)、[dgm](https://github.com/jennyzzt/dgm)、[SWE-bench](https://github.com/SWE-bench/SWE-bench)
- 验收重点：Agent 读取并修改自身代码或执行脚手架，形成候选版本；候选补丁应在隔离环境中构建、测试和评测；基准任务需要避免答案泄漏、测试污染和环境不一致

### 自动化 AI 研发与 AI-for-AI

- Knowledge ID：`rsi-automated-ai-rd`
- Awesome RSI 分类：Automated AI R&D / Benchmarks & Evaluations
- 关键材料：[2408.06292](https://arxiv.org/abs/2408.06292)、[s41586-026-10265-5](https://doi.org/10.1038/s41586-026-10265-5)、[2606.06473](https://arxiv.org/abs/2606.06473)、[2603.01712](https://arxiv.org/abs/2603.01712)、[autoresearch](https://github.com/karpathy/autoresearch)
- 验收重点：研发流程包括假设、实验设计、实现、执行、分析、复核和下一轮计划；实验环境应可执行、可复现并记录代码、数据、模型和配置版本；代理指标和最终研究目标必须区分

### 多智能体协同与共演化

- Knowledge ID：`rsi-multi-agent-coevolution`
- Awesome RSI 分类：Multi-Agent Self-Improvement / Co-Evolution
- 关键材料：[2605.29790](https://arxiv.org/abs/2605.29790)、[2605.09959](https://arxiv.org/abs/2605.09959)、[2508.05004](https://arxiv.org/abs/2508.05004)、[2602.04837](https://arxiv.org/abs/2602.04837)
- 验收重点：Proposer、Solver、Critic 和 Verifier 等角色可以形成互补闭环；群体共演化可以更新个体策略、协作方式和团队结构；保留个体上下文和共享全局状态之间需要权衡

### 具身智能与物理环境自改进

- Knowledge ID：`rsi-embodied-adaptation`
- Awesome RSI 分类：Embodied & Physical Self-Improvement
- 关键材料：[2602.04411](https://arxiv.org/abs/2602.04411)、[2607.00272](https://arxiv.org/abs/2607.00272)、[2606.19980](https://arxiv.org/abs/2606.19980)、[2305.16291](https://arxiv.org/abs/2305.16291)
- 验收重点：环境反馈来自真实物理状态，而不只是模型生成的文本评价；仿真可以降低探索成本，但存在 sim-to-real 差距；失败恢复轨迹可成为技能和策略更新的数据来源

### 进化搜索、开放式演化与候选档案

- Knowledge ID：`rsi-evolutionary-search`
- Awesome RSI 分类：Evolutionary & Open-Ended RSI
- 关键材料：[2505.22954](https://arxiv.org/abs/2505.22954)、[funsearch](https://github.com/google-deepmind/funsearch)、[](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)、[openevolve](https://github.com/algorithmicsuperintelligence/openevolve)
- 验收重点：Mutation 生成候选变体，Crossover 组合已有候选特征；Selection 根据适应度或约束选择后续候选；Archive 保留历史有效候选和其证据

### RSI 安全、目标保持与治理

- Knowledge ID：`rsi-safety-governance`
- Awesome RSI 分类：Safety, Alignment & Theory / Supporting Safety Foundations
- 关键材料：[2610.00093](https://arxiv.org/abs/2610.00093)、[2609.31186](https://arxiv.org/abs/2609.31186)、[2509.26354](https://arxiv.org/abs/2509.26354)、[2505.02709](https://arxiv.org/abs/2505.02709)、[1908.04734](https://arxiv.org/abs/1908.04734)、[1606.06565](https://arxiv.org/abs/1606.06565)
- 验收重点：目标漂移可能由环境反馈、奖励投机或长期记忆更新引起；评估器漂移会使系统逐步优化错误或变化的标准；Reward Tampering 是系统操纵奖励生成或评估过程

### 内省、自我模型与能力校准

- Knowledge ID：`rsi-introspection-self-modeling`
- Awesome RSI 分类：Introspection & Self-Modeling
- 关键材料：[2601.01828](https://arxiv.org/abs/2601.01828)、[2607.04277](https://arxiv.org/abs/2607.04277)、[2407.18219](https://arxiv.org/abs/2407.18219)、[2410.13787](https://arxiv.org/abs/2410.13787)、[2305.18153](https://arxiv.org/abs/2305.18153)
- 验收重点：自我解释可能是事后生成的合理化文本，不等于真实内部访问；能力校准关注模型能否识别何时知道或不知道；自我预测应与实际行为和其他预测者对照


## 质量约束
1. 每道题的 `topic` 和 `knowledgeId` 均引用本批 KnowledgeNode 的唯一 ID。
2. 所有题目为开放式问题，均提供参考答案。
3. 题目 ID 为 `rsi-001` 至 `rsi-200`，题干不重复。
4. 每个知识节点均声明覆盖的考察角度，并在题目中保留常见误区。
5. 来源记录 Awesome RSI 分类和相关研究论文；论文索引不代表结论已经独立复现。
6. 本次完成静态预检；完整工作区的 TypeScript、Vitest、题库 CLI 和 Vite build 仍需运行。
