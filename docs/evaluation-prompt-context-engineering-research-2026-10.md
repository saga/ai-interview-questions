# Evaluation Metrics、Prompt Engineering 与 Context Engineering 研究（2026-10）

> 研究截止日期：2026-10-28。本文汇总官方文档、主要框架文档及近期研究，面向 AI 应用与 Agent 工程的初级/中级面试训练。产品功能、API 状态和退役时间会变化，实施前应重新核对当前文档。

## 本次新增题目

| 题库文件 | 数量 | 重点 |
|---|---:|---|
| [evaluation-metrics-modern-2026-10.json](../src/data/questions/evaluation-metrics-modern-2026-10.json) | 40 | 指标选择、分类/检索指标、RAG、LLM Judge、Agent 轨迹与终态、线上线下评测、回归测试 |
| [prompt-engineering-modern-2026-10.json](../src/data/questions/prompt-engineering-modern-2026-10.json) | 30 | 成功标准、指令、few-shot、结构化输出、PromptOps、缓存、安全、自动优化和模型迁移 |
| [context-engineering-modern-2026-10.json](../src/data/questions/context-engineering-modern-2026-10.json) | 30 | Token 预算、上下文选择/压缩、记忆和任务状态、按需检索、工具渐进披露、Context Rot、权限与观测 |
| **合计** | **100** | **16 道 easy、84 道 medium** |

每道新增题都提供选择题、开放题参考答案、解释、测量意图和常见误区。

## 1. Evaluation Metrics：评估系统是否真的变好

### 1.1 先定义目标，再挑指标

评估不是先挑一个方便计算的分数，而是先明确任务成功标准、失败成本和真实使用环境。验证 JSON Schema、函数参数或 SQL 执行结果，可以优先使用确定性检查；总结是否忠实、回答是否切题、研究报告是否完整，则可能需要 Rubric、人工评审或经过校准的 LLM Judge。OpenAI 的评估指南强调任务特定评估、尽早建立评测、记录失败案例并持续扩大覆盖，而不是依赖主观观感或只看通用 benchmark。

建议保留分层指标，而不是只留一个综合分：

- **任务结果**：用户目标是否达成，关键事实是否正确，业务操作是否成功。
- **组件诊断**：是否检索到相关证据、重排是否改善排名、工具是否选对和参数是否正确。
- **质量与风险**：正确性、完整性、相关性、事实忠实度、安全和合规。
- **运行指标**：延迟（包括尾部延迟）、错误率、Token、成本和工具调用次数。
- **分布切片**：长尾请求、语言/领域差异、长上下文和低频但高风险的情况。

局部指标不是最终目标。检索 Recall 提高可能同时带来噪声，导致回答变差；综合分上涨也可能掩盖安全指标退化。安全或合规硬约束应单独设置门槛，不能让成本或流畅度提升抵消风险下降。

### 1.2 传统指标与生成式任务

类别不平衡时，Accuracy 可能产生误导；Precision、Recall 和 F1 应结合误报/漏报成本解释。Macro-F1 对各类别等权平均，Micro-F1 则汇总各类计数，通常更受高频类别影响。稀有正类任务中，PR 曲线/AUPRC 往往比单独 Accuracy 更有诊断价值；概率型风险模型还需要评估校准，而不仅是排序。

Exact Match、BLEU 和 ROUGE 等词面/字符串指标可作为信号，但无法覆盖开放式输出的全部质量。正确的改写可能因措辞不同被低估；表面相似也不保证事实正确。语义相似度、事实正确性、证据支持和执行结果应按任务组合使用，而不是简单互相替代。

### 1.3 RAG 指标需要分层解释

RAG 应区分“有没有检索到需要的信息”和“模型有没有正确使用这些信息”。

- **Recall@k / Context Recall**：需要的证据是否进入候选上下文。
- **Context Precision / 排名指标**：相关内容是否靠前、无关内容是否过多；具体公式取决于实现。
- **Faithfulness / Groundedness**：回答中的主张是否受到提供的证据支持。
- **Answer Relevancy / Correctness**：回答是否切题，以及事实是否正确。

这些维度相关但不等价。答案碰巧正确不证明检索完整；存在引用也不证明引用支持结论；高忠实度也不证明上下文涵盖完整答案。Ragas 指标目录可供查找常见指标，但仍要查看项目采用版本的具体定义，用领域样本校验其解释力。

对 Text-to-SQL 或工具执行任务，安全固定环境中的程序化执行/结果检查，通常比字符串比较更有意义。但“能执行”不等于“业务正确”：还需检查权限、副作用、查询成本和业务约束。

### 1.4 LLM-as-a-Judge：评分器也必须被评估

LLM Judge 能扩展开放式文本评估，但它的分数不是天然的 ground truth。Rubric 应明确维度、可观察标准、分数锚点和边界案例。应与领域专家标注做对照，分析一致性和分类型误差，并在独立样本上验证。

尤其要注意：

- **位置偏差**：成对比较中，答案展示顺序可能影响判定。交换 A/B 顺序，检查偏好是否翻转。
- **冗长偏差**：较长答案可能获得不合理的高分。分别评价正确性、完整性和简洁性。
- **Rubric 歧义**：含糊的“整体质量”难以稳定复现；分项标准、锚点示例及明确通过条件更可操作。
- **评测集过拟合与 grader hacking**：被评估系统或优化器可能利用评分规则漏洞；需要独立留出集、对抗样本和人工抽查。
- **统计波动**：对非确定性 Agent 应进行足量重复运行，说明样本量和波动，不以单次最佳结果代表典型表现。

2025 年 IJCNLP/ACL Anthology 的位置偏差研究提供了对 LLM Judge 位置效应的实证分析。它提示我们：仅仅换用更强的裁判模型，并不能自动消除测量偏差。

### 1.5 Agent 评估：同时看轨迹与终态

Agent 的合法执行路径可能不止一种，仅要求工具调用序列逐步匹配参考轨迹，可能误判正确的替代路径；反过来，只看最终答案也可能漏掉越权操作、不安全副作用或明显低效路径。应结合：

- **End-state / Task Success**：最终业务状态是否达到目标。
- **Trace / Trajectory Quality**：工具选择、参数、执行顺序、交接和策略遵循。
- **副作用与安全**：是否访问未授权数据、重复执行动作或违反操作边界。
- **可靠性统计**：pass@k 表示多次尝试中至少一次成功；pass^k 关注所有尝试均成功，两者回答不同问题。
- **成本与性能**：工具/模型调用、Token、延迟和错误率。

OpenAI 的 Agent eval 文档将 Trace grading 用于诊断工具选择、交接、护栏和工作流变化，并建议在发现关键失败模式后，将其沉淀成可重复运行的评测集。

### 1.6 建议的评估工作流

1. 明确任务目标、可观测成功条件和不可妥协的风险门槛。
2. 建立版本化评测集，覆盖真实请求、长尾和对抗用例；记录来源并处理敏感数据。
3. 对可确定判断的内容使用代码/执行验证，对开放式质量使用 Rubric、人工评审或校准后的 Judge。
4. 在相同测试集和可比环境下对照版本，观察分项指标和失败案例。
5. 发布时进行灰度/线上观察，监控质量、风险、延迟和成本。
6. 把确认过的生产失败转成新的回归用例，同时保留独立测试集，避免反复调参导致测试集过拟合。

## 2. Prompt Engineering：把任务要求变成稳定接口

### 2.1 从成功标准开始

Anthropic 的 Prompt Engineering 文档建议先定义成功标准和经验测试。并非所有失败都应该靠提示词解决：根因可能是模型选择不当、证据不足、工具 Schema 有问题，或者应用架构缺少验证。

一个可维护的 Prompt 应明确任务、受众、输入边界、必要内容、输出形式、不可违反的约束，以及证据不足时的处理方式。比起“请给出高质量结果”，更有效的方式是明确需要哪些字段、字段依据什么、哪些情况返回 unknown 或请求澄清。

### 2.2 Few-shot、结构化输出与信任边界

Few-shot 示例能示范格式和判定标准，但错误、相互冲突或不符合真实输入分布的示例也会误导模型。应检查示例的正确性与代表性，并在固定评测集上比较有无示例。

输出需要供代码消费时，尽量使用平台支持的结构化输出/Schema 能力，再在应用侧验证类型、值域和业务不变量。格式合法不等于语义正确：JSON 可以被解析但事实依然错误，关键字段仍需证据或规则校验。

邮件、网页、PDF 或检索到的文档可能包含恶意指令；它们应作为不可信数据处理，而不能因进入 Prompt 就取得指令权限。分隔符有帮助，但不是完整的安全方案；工具权限和服务端授权必须独立实施。

### 2.3 PromptOps：把生产提示当作代码

提示会改变应用行为，应当版本化管理并进行代码评审。可将提示放在命名模块中，用类型化参数构造动态内容，在 Pull Request 中审查差异，关联评测结果，并支持灰度和回滚。

受控实验可以先一次改变一个因素，保持模型、工具、评测样本和评分标准一致，再研究变量间交互。反复针对同一测试集打补丁可能导致 prompt overfitting，所以要保留未用于优化的独立测试集。自动 Prompt Optimizer 的改动也需要通过留出集、长尾和安全回归，而不能只看优化器自己报告的分数。

### 2.4 Prompt Cache、模型迁移与近期 API 变化

Prompt caching 通常依赖稳定的可复用前缀。可将稳定指令、共享示例和工具说明放在前面，把用户特定内容、时间戳、request ID 和动态检索内容放在后面。但缓存命中不是第一原则：不能为了复用缓存而使用过时政策、错误会话状态或跨用户数据。

不同模型对提示、推理设置、工具调用和结构化输出的敏感性不同。模型迁移需要重跑工具行为、事实正确性、安全、延迟和成本的回归测试，不能只凭几条回答看起来自然就判断等价。

**截至 2026-10-28 的时效性观察：**访问 OpenAI 官方 Prompting 文档时，文档称可复用 Prompt 对象的创建从 2026-06-03 起会被弱化，API 路径 v1/prompts 计划于 2026-11-30 关闭；新开发建议将 Prompt 作为代码管理。OpenAI Evaluation best practices 文档也称，Evals 平台现有内容从 2026-10-31 起转为只读，计划于 2026-11-30 关闭。此类日期与迁移说明可能变化，本文只记录访问时文档所述；实施前应重新检查厂商的 deprecations 页面，不要把它们当成永不过期的架构事实。

## 3. Context Engineering：管理每次模型调用真正可见的信息

### 3.1 从写好 Prompt 到管理完整上下文

Anthropic 将 Context Engineering 视为每次推理时对信息进行持续策划：除了指令，还包括工具定义、MCP、外部数据、消息历史和动态状态。长时间运行的 Agent 每轮都会产生新的工具结果；工程挑战是从不断增长的候选信息池里挑出当前最有用的内容。

LangChain 的材料将常见策略归纳为 **write、select、compress、isolate**：

- **Write**：把计划、阶段状态和重要发现写到窗口外，避免长任务只依赖对话历史。
- **Select**：从记忆、知识库、文件或工具目录选取与当前任务相关的信息。
- **Compress**：压缩冗长历史、重复检索片段和大段工具输出，同时保留重要状态。
- **Isolate**：将不同任务或子 Agent 的工作上下文分开，通过结构化交接传递必要信息。

### 3.2 窗口大小不等于有效利用能力

更大的窗口不意味着模型能在所有任务中同等利用每个 Token。长上下文可能出现 Context Rot、位置效应、无关信息干扰和来源冲突。Needle-in-a-Haystack 可以诊断某类信息定位能力，但不能证明模型能综合分散证据、处理冲突、追踪时序或完成复杂的多跳推理。

实际系统应按任务控制上下文质量，而非盲目追求长度：按权限、时效和来源可信度过滤候选数据；在相关性排序上增加去重与子问题覆盖；对关键约束和证据清晰分区；用长上下文回归样本检查位置效应。需要更多资料时，保留文件路径、记录 ID 或查询参数，支持按需重新获取，而不是将所有资料永久塞入上下文。

### 3.3 Compaction 应保留可继续执行的状态

长任务压缩不只是写一段普通摘要。有效状态通常需要记录目标、已完成事项、待办、关键决定与依据、约束、失败尝试、资源定位、重试计数和下一步。应把假设与已确认事实区分，并在需要时保留时间戳和来源。

压缩失败可能发生在不同阶段：触发时机不当、压缩时丢失细节，或压缩后信息无法再次访问。2026 年 EMNLP 的 Context Compression survey 从压缩目标、压缩机制和触发控制分析这一设计空间，并归纳了压缩决策、信息损失及压缩后访问相关的失败模式。因此，不能只测压缩率，还要测试压缩后的任务成功、状态恢复、重复副作用和信息访问能力。

### 3.4 工具和数据按需披露

大量工具的完整 Schema 会占据固定上下文并增加选择难度。可以先提供简短工具目录，任务需要时再通过搜索或分类加载详细 Schema。工具发现准确率与参数正确性仍须实测，不能为了减少 Token 而把所有工具一概隐藏。

大型代码库、日志和文档适合 Just-in-Time retrieval：初始只提供关键指导和索引，再通过搜索、查询或文件工具获取相关片段。这能避免预先载入全部数据，但会增加调用延迟和探索失败风险；许多系统适合“稳定信息预加载 + 动态检索”的混合模式。

### 3.5 权限、来源和新鲜度优先于相关性

最相关的机密数据不代表当前用户有权读取。检索和数据访问层必须在数据进入模型上下文之前实施权限过滤，不能先把所有记录交给模型、再依赖它自行保密。

上下文还应保留来源、版本、生效时间、适用范围和信任级别。官方政策、过期 wiki 和用户口述冲突时，应根据权威性与新鲜度处理。Memory 也可能过期或错误，需要有更新、失效、校验和删除机制。

### 3.6 Context Engineering 本身也要评估

不要只比较 Token 使用量。可以在固定测试集与模型上比较基线检索、去重/重排、动态检索和压缩策略，同时衡量：

- 任务成功、事实正确性和关键证据覆盖；
- 长上下文与长尾案例表现；
- Token、延迟、重新检索次数和总成本；
- 来源可追溯、权限执行与提示注入相关失败；
- 压缩后是否丢失待办、约束或已经完成的外部副作用。

建议记录上下文版本、来源和权限标签、选择/裁剪原因、各来源 Token 占比、检索分数、压缩版本及最终任务结果；日志应遵守脱敏和数据最小化要求。

## 4. 参考来源

优先选择官方文档、研究论文和主要框架作者的材料。具体指标名称、公式、API 生命周期和功能状态可能随版本变化，应该按实际采用版本重新核对。

### 官方平台与框架文档

1. [OpenAI — Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)：任务特定评估、评测集、指标/人工评估/LLM Judge 与连续评测；页面列出 Evals 平台迁移时间。
2. [OpenAI — Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)：Trace grading、工具调用、交接、护栏和从 traces 转向可重复评测集。
3. [OpenAI — Prompting](https://developers.openai.com/api/docs/guides/prompting)：提示模板、稳定缓存前缀、Prompt 作为代码管理及提示对象迁移说明。
4. [OpenAI — Graders](https://developers.openai.com/api/docs/guides/graders)：模型/代码评分器、字符串/相似度检查、评分器校准与 grader hacking 的注意事项。
5. [Anthropic — Prompt engineering overview](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)：先建立成功标准和经验测试，再决定如何优化提示。
6. [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29）：Context Engineering、Context Rot、按需检索、Compaction 和结构化记忆。
7. [LangChain — Context Engineering for Agents](https://www.langchain.com/blog/context-engineering-for-agents)（2025-07-02）：write/select/compress/isolate 分类，以及上下文污染和长任务管理。
8. [Ragas — Available metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/)：RAG、Agent、文本比较与 SQL 任务评估的指标目录。
9. [Google Cloud — Agent evaluation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/optimize/evaluation/agent-evaluation)：多轮 Agent 评估、trace、自动评分、环境模拟与优化流程。

### 研究论文

10. [Shi et al. — Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge](https://aclanthology.org/2025.ijcnlp-long.18/)（IJCNLP 2025）：研究 LLM Judge 在成对/列表比较中的位置偏差，并提出稳定性与位置一致性等分析指标。
11. [Wang et al. — Context Compression for LLM Agents: A Survey of Methods, Failure Modes, and Evaluation](https://aclanthology.org/2026.emnlp-main.2396/)（EMNLP 2026）：从压缩对象、机制和触发策略分析 Agent 上下文压缩，并讨论压缩决策、信息丢失与压缩后访问失败。
12. [A Survey of Context Engineering for Large Language Models](https://arxiv.org/html/2507.13334v2)（2025）：提供上下文检索与生成、上下文处理及相关设计空间的综述视角。

## 5. 后续维护建议

这 100 道题用于补充现有 Evaluation、Prompt 和 Context 题库，而不是替代已有内容。后续补题建议先运行仓库的题目校验、覆盖矩阵、近重复与质量分析工具，检查 topic × angle 覆盖、重复推理路径、选项偏差与知识节点映射。应随官方 API 文档和新研究持续复核，但不要仅为追逐新名词而添加题目；新题应体现可验证的机制、适用边界、工程权衡或失败诊断。
