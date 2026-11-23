# Recursive Self-Improvement（RSI）学习路线与研究资料

> 内容基线：[lobehub/awesome-rsi](https://github.com/lobehub/awesome-rsi)。本课程将其分类、论文和工具目录转成 AI 工程面试知识体系；论文中的实验结论仍应以原论文、代码和独立复现为准。

## 1. 概念边界

| 概念 | 判断标准 | 典型例子 |
|---|---|---|
| Self-refinement | 改善当前任务输出，没有跨任务持久状态变化 | 多轮批评后重写同一答案 |
| Persistent self-improvement | 修改被保留到后续任务可用的系统状态 | 更新权重、记忆、Skill、Prompt、Harness 或代码 |
| Recursive self-improvement | 产生改进的机制本身也被改进，能更有效地产生后续更新 | 自动优化候选搜索器、训练流程或改进器程序 |

证据也分三层：**Task gain** 是任务表现提高；**Retained gain** 是更新被持久保留并在后续任务带来收益；**Improver gain** 是改进机制本身生成更有效的后续更新。架构具有递归结构，不等于已经展示可靠 RSI。

评估时至少记录更新对象、反馈来源、保留工件、外部固定条件、资源预算、验证方式、跨任务迁移和回滚结果。

## 2. 学习地图与关键论文

### 2.1 定义、证据与基础理论
先理解 Self-refinement、持久改进和严格 RSI 的差别，再掌握任务增益、保留增益和改进器增益。
- [A Survey of Self-Evolving Agents: On Path to Artificial Super Intelligence](https://arxiv.org/abs/2507.21046)
- [Recursive Self-Improvement in AI: A Survey](https://www.preprints.org/manuscript/202609.2680)
- [Recursive Self-Improvement in AI: From Bounded Self-Refinement to Autonomous Research Loops](https://arxiv.org/abs/2607.07663)
- [Generalized Agent Iteration](https://arxiv.org/abs/2609.13406)
- [A Formulation of Recursive Self-Improvement and Its Possible Efficiency](https://arxiv.org/abs/1805.06610)
- [Gödel Machines](https://arxiv.org/abs/cs/0309048)

### 2.2 Model-level RSI：自训练、自奖励与自博弈
研究模型如何生成样本、偏好或评分，并用反馈更新自身策略。重点关注奖励质量、合成数据多样性、模型坍塌、评判器漂移和外部校准。
- [Self-Rewarding Language Models](https://arxiv.org/abs/2401.10020)
- [RLAIF vs. RLHF](https://arxiv.org/abs/2309.00267)
- [Self-Play Fine-Tuning](https://arxiv.org/abs/2401.01335)
- [Self-Instruct](https://arxiv.org/abs/2212.10560)
- [Beyond Human Data: Scaling Self-Training](https://arxiv.org/abs/2312.06585)
- [ReSAIL: Mitigating Collapse in Iterative Agent Self-Distillation](https://arxiv.org/abs/2609.39306)
- [R-Zero: Self-Evolving Reasoning LLM from Zero Data](https://arxiv.org/abs/2508.05004)
- [STaR: Bootstrapping Reasoning With Reasoning](https://arxiv.org/abs/2203.14465)

### 2.3 Harness-level RSI：Prompt、程序、上下文和 Skill
修改 Prompt、程序、记忆、Skill、工具、工作流和子 Agent 结构，也能形成持久系统变化。需要验证候选泛化和执行边界。
- [OPRO: Large Language Models as Optimizers](https://arxiv.org/abs/2309.03409)
- [Promptbreeder](https://arxiv.org/abs/2309.16797)
- [TextGrad](https://arxiv.org/abs/2406.07496)
- [Self-Taught Optimizer（STOP）](https://arxiv.org/abs/2310.02304)
- [DSPy](https://arxiv.org/abs/2310.03714)
- [Agentic Context Engineering（ACE）](https://arxiv.org/abs/2510.04618)
- [ExpeL: LLM Agents Are Experiential Learners](https://arxiv.org/abs/2308.10144)
- [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110)
- [ALMA: Learning to Continually Learn via Meta-learning Agentic Memory Designs](https://arxiv.org/abs/2602.07755)
- [Voyager](https://arxiv.org/abs/2305.16291)
- [Automated Design of Agentic Systems（ADAS）](https://arxiv.org/abs/2408.08435)

### 2.4 自验证与自修改软件工程
自我批评不是可靠验证的替代品。Coding Agent 修改自身代码后，需要沙箱构建、测试、回归、任务基准、候选档案和版本回滚。
- [Self-Refine](https://arxiv.org/abs/2303.17651)
- [CRITIC: Tool-Interactive Critiquing](https://arxiv.org/abs/2305.11738)
- [Chain-of-Verification](https://arxiv.org/abs/2309.11495)
- [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798)
- [Darwin Gödel Machine](https://arxiv.org/abs/2505.22954)
- [A Self-Improving Coding Agent](https://arxiv.org/abs/2504.15228)
- [SWE-Gym](https://arxiv.org/abs/2412.21139)

### 2.5 自动化 AI R&D 与多智能体共演化
自动研究将假设、实验、代码、运行、分析和审查连成闭环；多智能体系统还需处理角色共适应、通信成本、群体多样性和独立判断。
- [The AI Scientist](https://arxiv.org/abs/2408.06292)
- [AI Scientist-v2](https://doi.org/10.1038/s41586-026-10265-5)
- [MLEvolve](https://arxiv.org/abs/2606.06473)
- [FT-Dojo](https://arxiv.org/abs/2603.01712)
- [PostTrainBench](https://arxiv.org/abs/2603.08640)
- [Evolve as a Team](https://arxiv.org/abs/2605.29790)
- [G-Zero](https://arxiv.org/abs/2605.09959)
- [Group-Evolving Agents](https://arxiv.org/abs/2602.04837)
- [AutoResearch](https://github.com/karpathy/autoresearch)

### 2.6 具身、进化搜索与开放式探索
具身系统需纳入物理安全和仿真到现实迁移；进化搜索需平衡新颖性、适应度、种群多样性和可验证结果。
- [Self-evolving Embodied AI](https://arxiv.org/abs/2602.04411)
- [ASPIRE: Agentic Skills Discovery for Robotics](https://arxiv.org/abs/2607.00272)
- [ENPIRE: Agentic Robot Policy Self-Improvement](https://arxiv.org/abs/2606.19980)
- [FunSearch](https://github.com/google-deepmind/funsearch)
- [AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)
- [OpenEvolve](https://github.com/algorithmicsuperintelligence/openevolve)
- [POET](https://github.com/uber-research/poet)

### 2.7 安全、目标保持与内省
自演化风险会通过记忆、工具、Skill 和训练跨轮次累积。重点关注目标漂移、评估器漂移、奖励篡改、继承状态污染、误差传播和监督失效。模型自述不等于真实内省。
- [Safety in Self-Evolving Agents: A Survey](https://arxiv.org/abs/2610.00093)
- [Evolutionary Safety of Recursive Self-Improving AI](https://arxiv.org/abs/2609.31186)
- [Your Agent May Misevolve](https://arxiv.org/abs/2509.26354)
- [Evaluating Goal Drift in Language Model Agents](https://arxiv.org/abs/2505.02709)
- [Reward Tampering Problems and Solutions](https://arxiv.org/abs/1908.04734)
- [Concrete Problems in AI Safety](https://arxiv.org/abs/1606.06565)
- [Recursive Introspection](https://arxiv.org/abs/2407.18219)
- [Looking Inward](https://arxiv.org/abs/2410.13787)
- [Do Large Language Models Know What They Don't Know?](https://arxiv.org/abs/2305.18153)

## 3. 评测基准与观测工具

| 资源 | 主要用途 | 使用注意 |
|---|---|---|
| [RSI-Bench](https://github.com/sunghunkwag/rsi-bench) | 自修改深度、改进轨迹、算子发现、适应、安全和目标生成 | 不把单一总分当 RSI 证明 |
| [RSIBench-Data](https://arxiv.org/abs/2607.25886) | 固定后训练栈下评估数据策略迭代改进 | 区分数据策略增益与训练栈变化 |
| [LongWoF-Bench](https://arxiv.org/abs/2608.23200) | 可验证长工作流和经验复用 | 检查完成定义和任务迁移 |
| [PostTrainBench](https://arxiv.org/abs/2603.08640) | 评估 Agent 自动完成 LLM 后训练研发能力 | 资源预算是任务定义的一部分 |
| [AutoLab](https://arxiv.org/abs/2606.05080) | 长周期自动研究与工程任务 | 关注闭环优化和任务真实性 |
| [MLS-Bench](https://arxiv.org/abs/2605.08678) | AI 构建更好 ML 方法的能力 | 检查方法泛化与可扩展性 |
| [MLE-bench](https://github.com/openai/mle-bench) | 端到端 ML 工程任务 | 任务不等于全部 AI R&D 能力 |
| [PaperBench](https://github.com/openai/frontier-evals/tree/main/project/paperbench) | 根据论文描述复现研究 | 复现质量与资源成本一起报告 |
| [RE-Bench](https://github.com/METR/RE-Bench) | 固定时间预算下比较 AI 与人类研究工程表现 | 时间预算不能省略 |
| [MLAgentBench](https://github.com/snap-stanford/MLAgentBench) | 执行和改进 ML 实验 | 验证真实实验执行而非计划文本 |

前沿实验室公开评估框架：
- [Anthropic Autonomous AI R&D Evaluations](https://www.anthropic.com/transparency/model-report)
- [Google DeepMind Frontier Safety Framework：ML R&D](https://deepmind.google/blog/strengthening-our-frontier-safety-framework/)
- [OpenAI AI Self-Improvement Evaluations](https://deploymentsafety.openai.com/gpt-5-6)

## 4. 可运行项目与代码仓库

**自修改与自演化系统**
- [Darwin Gödel Machine](https://github.com/jennyzzt/dgm)
- [Gödel Agent](https://github.com/Arvid-pku/Godel_Agent)
- [HyperAgents](https://github.com/facebookresearch/HyperAgents)
- [AgentFactory](https://github.com/zzatpku/AgentFactory)
- [SEAL](https://github.com/Continual-Intelligence/SEAL)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)

**Harness、Memory 与 Skill**
- [ACE](https://github.com/ace-agent/ace)
- [EvoAgentX](https://github.com/EvoAgentX/EvoAgentX)
- [EvolveR](https://github.com/KnowledgeXLab/EvolveR)
- [Gear](https://github.com/rsi-gear/gear)
- [ALMA](https://github.com/zksha/alma)
- [Voyager](https://github.com/MineDojo/Voyager)
- [Letta Code](https://github.com/letta-ai/letta-code)
- [Memento-Skills](https://github.com/Memento-Teams/Memento-Skills)

**自动搜索与 AI R&D**
- [ADAS](https://github.com/ShengranHu/ADAS)
- [AI Scientist](https://github.com/SakanaAI/AI-Scientist)
- [autoresearch](https://github.com/karpathy/autoresearch)
- [FunSearch](https://github.com/google-deepmind/funsearch)
- [OpenEvolve](https://github.com/algorithmicsuperintelligence/openevolve)
- [MLEvolve](https://github.com/InternScience/MLEvolve)

**可扩展 Agent Harness**
- [Agent Zero](https://github.com/agent0ai/agent-zero)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [OpenClaw](https://github.com/openclaw/openclaw)
- [Pi](https://github.com/earendil-works/pi)

## 5. 初级 / 中级学习顺序
1. **初级：概念与证据**——理解三种改进层次、模型自训练、合成数据、Self-play、Prompt/Memory/Skill 更新和基本评测。
2. **初级：工程闭环**——理解反馈轨迹、候选版本、隔离评测、发布门控、回滚和运行时安全边界。
3. **中级：改进机制**——比较自奖励、Challenger–Solver、Promptbreeder、ACE、进化搜索和多智能体共演化。
4. **中级：系统验证**——设计独立基线、留出集、固定资源预算、评估器校准和安全回归。
5. **中级：AI R&D**——拆解自动研究工作流，判断实验是否可复现、结论是否超出证据。

## 6. 本次题库覆盖

新增 16 个 KnowledgeNode、200 道原创开放式面试题：120 道初级（系统难度 `easy`）、80 道中级（`medium`）。每题提供参考答案、解释、知识点、考察角度、常见误区和论文来源。

| 知识点 | 题量 | 初级 | 中级 |
|---|---:|---:|---:|
| RSI 定义、边界与证据层级 | 13 | 8 | 5 |
| 反馈闭环与改进流程设计 | 13 | 8 | 5 |
| 自训练、自奖励与 AI 反馈 | 13 | 8 | 5 |
| 合成数据、自蒸馏与模型坍塌 | 13 | 8 | 5 |
| 自博弈、挑战者与课程自演化 | 13 | 8 | 5 |
| Prompt、程序与优化器演化 | 13 | 8 | 5 |
| 记忆与上下文演化 | 13 | 8 | 5 |
| Skill、子 Agent 与 Harness 演化 | 13 | 8 | 5 |
| 自验证、评测与独立监督 | 12 | 7 | 5 |
| 自修改 Coding Agent | 12 | 7 | 5 |
| 自动化 AI 研发与 AI-for-AI | 12 | 7 | 5 |
| 多智能体协同与共演化 | 12 | 7 | 5 |
| 具身智能与物理环境自改进 | 12 | 7 | 5 |
| 进化搜索、开放式演化与候选档案 | 12 | 7 | 5 |
| RSI 安全、目标保持与治理 | 12 | 7 | 5 |
| 内省、自我模型与能力校准 | 12 | 7 | 5 |
| **合计** | **200** | **120** | **80** |

题目基于研究主题重新组织为原创面试题，不复制原论文或第三方题库题干。

## 7. 阅读和使用原则
- Awesome RSI 是持续更新的社区研究索引，不应把目录中的每篇预印本都当成已独立复现的事实。
- 先读综述建立术语，再读代表性论文和代码；重要性能结论应检查评测集、基线、资源预算、统计不确定性和复现状态。
- 不要把 Self-Refine、RAG、Memory、自动写 Skill 或普通代码生成单独等同于严格 RSI；要检查持久性和改进器增益。
- 学习目标不仅是“能否自我修改”，还包括“如何知道改进有效、如何阻止错误被继承、如何安全回滚”。

## 8. 原始研究地图
- [Awesome RSI](https://github.com/lobehub/awesome-rsi)
- [BeforeRSI：交互式 RSI 研究图谱](https://github.com/Cherish0925/BeforeRSI)
- [Awesome Self-Improving Agents](https://github.com/selfimproving-agent/awesome-Self-Improving-Agents)
- [rsi.watch：公开 RSI 声明与证据追踪](https://rsi.watch/)
