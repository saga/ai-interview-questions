# rag / agentic-ai 域 Question.tests 标注对照表

> 2026-08-29 补标注，共 80 题。P=primary（主考概念），S=supporting（辅助概念）。
> 校验：primary 唯一、每题 ≤3 概念，`npm run validate:questions` 通过。

## rag（17 题）

| # | 题目 id | 题干摘要 | 标注概念 |
|---|---|---|---|
| 1 | `agentic-41` | RAG 应该放在 Agent 外部（前置管线）还是作为 Agent 内部的一个 Tool？两者各适合什么场景？… | **P** `rag-overview` |
| 2 | `ai-code-003` | 请实现一个简单的 Recursive Text Chunker：支持 chunkSize 和 overlap，并避免在单词中间切断文本。… | **P** `rgp-chunking` · S `rgp-chunk-size` |
| 3 | `ai-eng-016` | 一个 RAG 系统的 retrieval recall@10 达到 95%，但是最终回答准确率只有 70%。正确答案经常出现在 Top-10 中… | **P** `rgp-end2end-eval` · S `rgp-rerank` |
| 4 | `ai-eng-017` | 你需要为企业 ESG 报告建立 RAG 系统。PDF 中同时包含长文本、表格、脚注、多级标题和图表。你会选择固定长度 chunk、semanti… | **P** `rgp-chunking` · S `rgp-parsing` |
| 5 | `ai-fund-034` | RAG 为什么能够降低 Hallucination？它的作用机制是什么？… | **P** `rag-hallucination-guard` · S `rag-overview` |
| 6 | `ai-fund-035` | Chunk size 为什么会影响 RAG 效果？chunk 过大或过小分别有什么问题？… | **P** `rgp-chunk-size` · S `rgp-chunking` |
| 7 | `ai-fund-036` | Vector Search 和 Keyword Search（如 BM25）有什么区别？各自擅长什么？… | **P** `vdb-hybrid` · S `rk-biencoder` |
| 8 | `ai-fund-039` | 一段文档与 query 的 Embedding 相似度很高，是否意味着它能回答这个问题？为什么？… | **P** `rgp-embedding` · S `rag-failure` |
| 9 | `ai-fund-048` | 公司希望模型掌握 10 万条内部 FAQ。你会选择继续 Pre-training、Fine-tuning 还是 RAG？请说明理由和实施路径。… | **P** `rag-when-to-use` · S `rag-overview` |
| 10 | `ai-fund-049` | 一个 RAG 系统 Recall 很高，但最终回答质量很差。请描述你的排查思路。… | **P** `rgp-end2end-eval` · S `rag-failure` |
| 11 | `ai-rag-009` | 你的 Vector Search 对长问题效果很好，但对 “ESG scope 3？”、“DPO？” 这类短 Query 效果很差。你会如何优化… | **P** `rgp-retrieval` · S `rgp-embedding` |
| 12 | `ai-rag-012` | 通用 Embedding Model 在你的金融领域检索效果只有 75%。你会优先更换模型、Fine-tune Embedding Model，… | **P** `rgp-embedding` · S `rgp-rerank` |
| 13 | `llm-04` | 什么是检索增强生成（RAG）？请描述其基本流程及相比单纯依赖模型参数的优势。… | **P** `rag-overview` |
| 14 | `slm-rag-ceiling-01` | 由于参数量限制，小语言模型（SLM）存在隐式事实记忆容量受限的“知识天花板”（Knowledge Ceiling）。关于克服小模型知识天花板的架… | **P** `rag-when-to-use` · S `rag-overview` |
| 15 | `rag-vs-param-memory` | 为解决大型 Transformer 模型'隐式参数记忆'带来的知识时效性差、更新成本高和幻觉问题业界提出了结合外置向量数据库的架构（如 RAG、… | **P** `rag-overview` · S `rag-when-to-use` |
| 16 | `long-context-rag-tradeoff` | 随着上下文窗口扩展至百万 Token 级别某些团队主张直接将全部企业文档加载至 Prompt 中彻底淘汰 RAG 系统。系统架构师指出需要考虑计… | **P** `rag-when-to-use` · S `rag-augmentation` |
| 17 | `rag-private-enterprise-01` | 某金融机构为满足数据严苛不出域的合规要求，计划构建基于本地代码库的私有 RAG（检索增强生成）系统。架构师设计了一套全本地化的闭环架构方案。关于… | **P** `rag-overview` · S `rag-when-to-use` |

## vector-db（6 题）

| # | 题目 id | 题干摘要 | 标注概念 |
|---|---|---|---|
| 1 | `ai-eng-033` | 向量数据库的 ANN 索引有多种实现，关于 HNSW、IVF、PQ 三类索引的原理与取舍，下列说法正确的是？… | **P** `vdb-ann` · S `vdb-hnsw` · S `vdb-ivf` |
| 2 | `ai-rag-007` | 生产环境已经存储了 1000 万条 1536 维 embedding，现在准备切换到 3072 维 embedding。你会如何进行迁移，避免线… | **P** `vdb-ann` · S `vdb-recall-latency` |
| 3 | `ai-rag-008` | 更换 Embedding Model 后，RAG 系统的 Recall 从 92% 降到 65%。你会如何定位问题？… | **P** `rgp-embedding` · S `vdb-recall-latency` |
| 4 | `ai-rag-010` | 一个 Vector Database 已存储 1 亿条 embedding，内存成本越来越高。你有哪些降低成本的办法？会牺牲什么？… | **P** `vdb-quantization` · S `vdb-recall-latency` |
| 5 | `search-02` | 在向量检索中，需同时满足“语义相似且发布时间在近 30 天内”这类带时间过滤的查询。关于过滤与向量搜索的执行顺序，下列说法正确的是？… | **P** `vdb-filtering` |
| 6 | `search-03` | 在混合检索（向量 + 关键词 BM25）中，为什么需要对两路召回结果进行归一化与加权融合，而非直接取 Top-K 拼接？… | **P** `vdb-hybrid` · S `rk-two-stage` |

## rag-pipeline（5 题）

| # | 题目 id | 题干摘要 | 标注概念 |
|---|---|---|---|
| 1 | `agentic-18` | 设计一个 ESG Research Agent：从几十份 ESG PDF 报告中提取碳排放等指标并生成横向对比结论。难点在数字准确性与口径不一致… | **P** `rgp-parsing` · S `rgp-chunking` |
| 2 | `ai-eng-034` | 你要为一个企业文档知识库搭建 RAG 的切分（Chunking）管线，语料混合了技术手册、法律合同、FAQ 和带大量表格的财务报告。请给出你的分… | **P** `rgp-chunking` · S `rgp-parsing` |
| 3 | `ai-eng-056` | 合规审查 RAG 中，只检索法规条文往往不够——条文常是模糊的，真正的执法尺度体现在历史处罚案例里。请设计"条文 + 先例"双库检索方案，并说明… | **P** `rgp-retrieval` · S `rgp-parsing` · S `rag-citation` |
| 4 | `eth-07` | 在企业级 RAG 系统中，文档向量化存储于 Vector DB 中。在多租户/多权限级别场景下，低权限员工通过针对性提问获取了高权限（如 HR … | **P** `vdb-filtering` · S `rgp-retrieval` |
| 5 | `llm-10` | 要把一个 naive RAG 升级为生产级检索管线，以下哪些做法是合理且常见的？（多选）… | **P** `rgp-retrieval` · S `rgp-rerank` |

## reranking（4 题）

| # | 题目 id | 题干摘要 | 标注概念 |
|---|---|---|---|
| 1 | `ai-eng-040` | RAG 两阶段检索中，Reranker（如 cross-encoder / Cohere Rerank）通常能带来 10-15% 的精确率提升，… | **P** `rk-two-stage` · S `rk-latency` · S `rk-recall-dependency` |
| 2 | `ai-eng-063` | 混合检索用 RRF（Reciprocal Rank Fusion，按排名倒数加权）合并向量检索与 BM25 的结果。相比于直接对两路相似度分数做… | **P** `rk-two-stage` · S `vdb-hybrid` |
| 3 | `ai-fund-037` | Hybrid Search 为什么通常比单独使用 Vector Search 更可靠？通常会怎么组合？… | **P** `vdb-hybrid` · S `rk-two-stage` |
| 4 | `ai-fund-038` | 在 RAG 流程中，Reranker 解决的是什么问题？为什么有了向量检索还需要它？… | **P** `rk-crossencoder` · S `rk-two-stage` |

## agent-fundamentals（14 题）

| # | 题目 id | 题干摘要 | 标注概念 |
|---|---|---|---|
| 1 | `agent-arch-localized` | 关于 "Localized Harness"（把控制逻辑本地化到编排代码）的做法，以下哪些是它的主要动机或特征？… | **P** `af-definition` · S `af-side-effects` |
| 2 | `agent-arch-model-harness` | 关于 Agent 的 Model（模型）与 Harness（外部编排代码）的边界，以下哪些说法是正确的？… | **P** `af-definition` · S `af-side-effects` |
| 3 | `agent-arch-system-prompt` | 关于 Agent 的 System Prompt 在运行时（runtime）的构造，以下哪些说法是正确的？… | **P** `aloop-state` · S `af-definition` |
| 4 | `agentic-01` | 一个典型的 AI Agent（智能体）最核心的运行时循环是？… | **P** `af-loop` · S `aloop-cycle` |
| 5 | `agentic-03` | 下列哪些是典型 AI Agent 的核心组件？（多选）… | **P** `af-definition` |
| 6 | `agentic-43` | Agent 是否应该被允许修改自己的 system prompt？请从能力与风险两方面论证，并给出你认为合理的折中方案。… | **P** `af-side-effects` · S `af-uncertainty` |
| 7 | `agentic-53` | 以下哪种场景最不应该使用 Agent，而应该使用传统固定 workflow？… | **P** `af-when` · S `af-vs-llm-app` |
| 8 | `ai-agent-001` | 一个客服系统主要回答企业知识库中的固定问题，偶尔需要查询订单状态。你会设计成纯 RAG、Workflow 还是 Agent？为什么？… | **P** `af-when` · S `af-vs-llm-app` |
| 9 | `ai-eng-001` | 一个系统需要依次执行“读取 PDF → 提取文本 → 清洗文本 → 写入数据库 → 生成摘要”，每一步的输入和输出都已经确定，没有运行时决策。你… | **P** `af-when` · S `af-vs-llm-app` |
| 10 | `ai-eng-002` | 一个客服系统有 20 个固定步骤，其中 3 个步骤需要根据用户意图选择不同分支。你会把整个系统做成 Agent，还是 Workflow + LL… | **P** `af-when` · S `af-vs-llm-app` |
| 11 | `ai-eng-003` | 如果让你从零设计一个最小可用的 AI Agent，你认为至少需要哪些核心组件？请说明每个组件的职责。… | **P** `af-definition` |
| 12 | `ai-eng-061` | 电商客服 AI 要自动解决 60% 的工单（200 万张/月），同时"Where is my order?"自动处理、"我要告你们欺诈"必须立即… | **P** `af-uncertainty` · S `af-when` |
| 13 | `hil-vs-auto-loop` | 在高吞吐量的 AI Agent 辅助软件工程体系中完全无人工干预的自动化循环往往会导致代码库快速退化与代码垃圾堆积。为了在保持高交付并发的同时维… | **P** `af-uncertainty` · S `af-guardrails` |
| 14 | `subagent-vs-inline` | 不同大语言模型在子 Agent 调度能力和上下文管理上存在差异。在将 Spec 转换为代码实现阶段关于选择子 Agent 驱动还是单层内联执行的… | **P** `af-cost` · S `aloop-state` |

## agent-loop（9 题）

| # | 题目 id | 题干摘要 | 标注概念 |
|---|---|---|---|
| 1 | `agent-arch-loop` | 关于 Agentic Loop（代理循环：观察→思考→行动→再观察），以下哪些设计是正确且必要的？… | **P** `aloop-cycle` |
| 2 | `agent-chain-01` | 在一个基于大语言模型（LLM）的自主 Agent 系统中，某个复杂任务被拆解为连续执行的 20 个依赖前一步输出的决策步骤。假设模型在每一步做出… | **P** `af-guardrails` · S `aloop-maxsteps` |
| 3 | `agent-control-01` | 在生产环境 AI Agent 的控制流（Control Flow）设计中，完全由 LLM 自主掌控循环逻辑容易带来死循环、成本失控和行为不可预测… | **P** `aloop-termination` · S `aloop-maxsteps` |
| 4 | `agent-react-guard-01` | 在 AI Agent 系统运行环境（Agent Runtime）的 ReAct（Reasoning + Acting）循环中，模型通过“思考-决… | **P** `aloop-cycle` · S `grd-cost-cap` |
| 5 | `agentic-04` | ReAct（Reasoning + Acting）框架的核心思想是什么？… | **P** `aloop-cycle` · S `af-loop` |
| 6 | `agentic-62` | ReAct 模式让 Agent 以 Thought → Action → Observation 循环执行任务。请解释该循环的运作机制、四种典型… | **P** `aloop-cycle` · S `grd-repeat` |
| 7 | `ai-eng-007` | 请解释 ReAct 类 Agent 的基本思想。它与一个只调用一次 LLM 然后执行工具的系统有什么本质区别？… | **P** `aloop-cycle` · S `af-vs-llm-app` |
| 8 | `ai-eng-011` | 一个 Research Agent 经常出现 search → analyze → search → analyze 的无限循环。没有任何异常，… | **P** `aloop-termination` · S `aloop-repeat-detect` |
| 9 | `ai-eng-067` | 客服对话流被建模为状态机：意图分类 → 知识检索(RAG)/账户上下文/工具调用 → 草稿生成 → 安全检查 → 置信度检查 → 发送或转人工。… | **P** `aloop-state` · S `grd-confirm` |

## tool-calling（17 题）

| # | 题目 id | 题干摘要 | 标注概念 |
|---|---|---|---|
| 1 | `agent-arch-tool-schema` | 关于 Tools Schema（工具接口定义）与实现的解耦，以下哪些说法是正确的？… | **P** `tc-schema` |
| 2 | `agent-arch-translation` | 关于 Agent 架构中的 "Translation Layer（翻译层）"，以下哪些说法是正确的？… | **P** `tc-function` · S `tc-observation` |
| 3 | `agent-tool-mcp-01` | 在 AI Agent 的工具层（Tool Layer）扩展架构设计中，若需要支持 Agent 动态接入数十种跨语言、分布式部署的第三方服务（如身… | **P** `tc-schema` · S `grd-sandbox` |
| 4 | `agentic-02` | 在 LLM 的 Tool / Function Calling 中，工具 schema（如 JSON Schema）的主要作用是？… | **P** `tc-schema` · S `tc-function` |
| 5 | `agentic-08` | 实现一个简单的 tool-calling 分发器：给定 tools 列表（每个含 name 与 callable），以及模型返回的 tool_c… | **P** `tc-function` · S `tc-observation` |
| 6 | `agentic-19` | 设计一个分析 SQL Server 数据并生成分析报告的 Agent。如何保证生成的 SQL 安全、正确？… | **P** `tc-confirmation` · S `grd-permission` |
| 7 | `agentic-21` | 设计一个能自主判断“该搜网页、查数据库还是调内部 API”的路由 Agent。决策依据是什么？如何避免路由错误？… | **P** `tc-function` · S `tc-error` |
| 8 | `agentic-38` | Agent 的可用 Tool 应该完全交给 LLM 自由选择，还是由代码按任务阶段限定候选集？为什么？… | **P** `tc-confirmation` · S `grd-permission` |
| 9 | `ai-code-004` | 请实现一个简单的 Tool Calling Handler：解析模型返回的 tool call，根据 tool name 找到对应函数，执行函数… | **P** `tc-function` · S `tc-observation` |
| 10 | `ai-eng-004` | 一个 Agent 有 20 个 tools。线上发现 tool selection accuracy 只有 75%，而且经常在多个功能相似的 t… | **P** `tc-schema` · S `tc-function` |
| 11 | `ai-eng-005` | 为什么 Agent 的 tool schema 不应该无限详细？如果一个 tool 的参数有 30 个字段，你会考虑如何重新设计？… | **P** `tc-schema` |
| 12 | `ai-eng-006` | 一个企业 Agent 最终拥有 300 个 tools。把 300 个 tools 全部放进每次 LLM 请求的 tool definition… | **P** `tc-schema` · S `tc-parallel` |
| 13 | `ai-engineering-001` | 一个系统同时接入多个闭源与开源大模型。你会根据哪些因素设计 Model Routing？… | **P** `af-cost` |
| 14 | `ai-tool-001` | LLM 的 Tool Calling 和普通文本生成有什么本质区别？… | **P** `tc-function` |
| 15 | `ai-tool-003` | Agent 调用外部 API 经常 timeout。Retry 应该放在哪一层：模型、Agent Loop、Tool Executor 还是基础… | **P** `tc-error` · S `aloop-retry` · S `tc-idempotency` |
| 16 | `eth-05` | 某企业部署了一个运维 Agent，赋予其数据库只读权限以及系统 Shell 执行权限用于分析日志。在处理一条恶意伪造的日志时，Agent 自行解… | **P** `grd-sandbox` · S `tc-confirmation` |
| 17 | `harness-discovery-01` | 当 Agent 系统集成了数百个扩展工具（如各种 API 或 MCP 服务）时，若直接将所有工具的完整 JSON Schema 注入 Promp… | **P** `tc-schema` · S `aloop-state` |

## agent-guardrails（8 题）

| # | 题目 id | 题干摘要 | 标注概念 |
|---|---|---|---|
| 1 | `agentic-12` | 为防止 Agent 在执行中失控（无限循环、误用高危操作），下列哪些是有效的工程护栏？（多选）… | **P** `grd-iteration` · S `grd-permission` |
| 2 | `ai-eng-031` | 在长文本问答测试中，当面对全语料覆盖问题（如"汇总全部 33 篇文章中引用的 GitHub 仓库"）时，RAG 仅召回了 5 个 Chunks。… | **P** `rag-eval` · S `af-uncertainty` |
| 3 | `ai-eng-062` | 客服 AI 自动发出的每一条回复都可能构成对用户的承诺。请设计发送前的安全检查层应拦截哪些风险，以及工具调用接地（tool grounding）… | **P** `grd-confirm` · S `grd-sandbox` |
| 4 | `ai-security-002` | 如何设计一个 LLM Application 的 Input Guardrail 和 Output Guardrail？哪些检查应该在 LLM … | **P** `grd-prompt-vs-engineering` · S `grd-sandbox` |
| 5 | `ai-tool-004` | 一个 Agent 可以调用发送邮件、删除数据和查询数据库的工具。你会如何设计工具权限和高风险操作的确认机制？… | **P** `grd-permission` · S `tc-confirmation` |
| 6 | `eth-06` | LLM 响应请求生成了包含恶意 JavaScript 的 Markdown 代码块，系统未做处理直接渲染在前端页面，导致了存储型 XSS；或 L… | **P** `grd-sandbox` · S `grd-prompt-vs-engineering` |
| 7 | `guard-inout-01` | 在大模型 Agent 的双向安全与可靠性护栏架构中，关于输入护栏（Input Guardrails）与输出护栏（Output Guardrail… | **P** `grd-prompt-vs-engineering` · S `grd-sandbox` |
| 8 | `policy-code-01` | 某金融 Agent 存在严格的合规限制：“严禁为特定地区（如夏威夷州）的用户办理开户业务”。开发团队尝试在 System Prompt 中加入强… | **P** `grd-prompt-vs-engineering` · S `grd-permission` |

## 概念含义速查

| 概念 id | 所属节点 | 含义 |
|---|---|---|
| `rag-overview` | rag | RAG 总体范式（检索→增强→生成） |
| `rag-augmentation` | rag | 检索结果如何拼回上下文（上下文窗口工程） |
| `rag-citation` | rag | 引用与溯源的可信度保障 |
| `rag-failure` | rag | 错误检索/错误归因导致的失效模式 |
| `rag-eval` | rag | RAG 答案质量评估（faithfulness / relevancy） |
| `rag-hallucination-guard` | rag | RAG 不消除幻觉（错误检索仍误导） |
| `rag-latency` | rag | 端到端延迟与吞吐 |
| `rag-when-to-use` | rag | RAG 的适用边界与前提 |
| `vdb-ann` | vector-db | 近似最近邻索引（ANN）的本质 |
| `vdb-hnsw` | vector-db | HNSW 图索引结构 |
| `vdb-ivf` | vector-db | IVF 倒排索引与聚类 |
| `vdb-recall-latency` | vector-db | 召回率-延迟-内存的三角权衡 |
| `vdb-params` | vector-db | ef / M / nprobe 参数调优 |
| `vdb-hybrid` | vector-db | 向量+关键词混合检索 |
| `vdb-filtering` | vector-db | 预过滤/后过滤与向量检索顺序 |
| `vdb-quantization` | vector-db | 标量量化与索引压缩 |
| `rgp-parsing` | rag-pipeline | 文档解析与结构保留 |
| `rgp-chunking` | rag-pipeline | Chunking 切分策略（固定/语义/层级） |
| `rgp-embedding` | rag-pipeline | 检索向量化与领域适配 |
| `rgp-retrieval` | rag-pipeline | 召回阶段（top-k 与阈值） |
| `rgp-rerank` | rag-pipeline | 重排阶段与候选裁剪 |
| `rgp-end2end-eval` | rag-pipeline | 分环节诊断（召回 vs 生成瓶颈） |
| `rgp-chunk-size` | rag-pipeline | chunk 大小/重叠的语义完整性权衡 |
| `rk-biencoder` | reranking | bi-encoder 双塔检索 |
| `rk-crossencoder` | reranking | cross-encoder 交叉编码器精排 |
| `rk-two-stage` | reranking | 两级检索结构（快+准） |
| `rk-recall-dependency` | reranking | rerank 依赖初筛召回率 |
| `rk-latency` | reranking | rerank 引入的延迟预算 |
| `af-definition` | agent-fundamentals | Agent = LLM + 工具 + 状态 + 循环 |
| `af-vs-llm-app` | agent-fundamentals | Agent 与普通 LLM 应用的分界 |
| `af-loop` | agent-fundamentals | 自主决策循环 |
| `af-side-effects` | agent-fundamentals | 外部副作用与执行边界 |
| `af-uncertainty` | agent-fundamentals | 不确定性管理（步数/权限/确认） |
| `af-guardrails` | agent-fundamentals | 工程护栏决定可靠性与成本 |
| `af-cost` | agent-fundamentals | 成本与可控性权衡 |
| `af-when` | agent-fundamentals | 何时该用 Agent（适用边界） |
| `aloop-cycle` | agent-loop | 感知-决策-行动-观察循环 |
| `aloop-state` | agent-loop | 状态更新与上下文维护 |
| `aloop-termination` | agent-loop | 终止条件设计 |
| `aloop-maxsteps` | agent-loop | 最大步数上限 |
| `aloop-repeat-detect` | agent-loop | 重复/振荡检测与熔断 |
| `aloop-retry` | agent-loop | 失败重试与降级策略 |
| `tc-function` | tool-calling | function calling 本质（结构化输出） |
| `tc-schema` | tool-calling | 工具 JSON Schema 设计 |
| `tc-observation` | tool-calling | 工具结果回填为 observation |
| `tc-idempotency` | tool-calling | 幂等性与副作用管理 |
| `tc-error` | tool-calling | 错误回传与重试 |
| `tc-confirmation` | tool-calling | 高危操作确认门与最小权限 |
| `tc-parallel` | tool-calling | 并行工具调用 |
| `grd-iteration` | agent-guardrails | 迭代上限（max iterations） |
| `grd-repeat` | agent-guardrails | 重复检测与熔断 |
| `grd-confirm` | agent-guardrails | 高危操作人工确认门 |
| `grd-sandbox` | agent-guardrails | 沙箱隔离与最小权限 |
| `grd-cost-cap` | agent-guardrails | 成本硬顶与预算控制 |
| `grd-permission` | agent-guardrails | 权限分级（只读/写/不可逆） |
| `grd-prompt-vs-engineering` | agent-guardrails | 护栏在路径而非提示词里 |
