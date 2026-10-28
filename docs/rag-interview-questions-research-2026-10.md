# RAG 面试题扩充：最新工程实践与参考来源

> 研究与校对日期：2026-10-28。本文用于解释本次新增的 120 道初级/中级 RAG 题目覆盖了什么、为什么加入这些主题，以及后续如何维护题库。它不是某个云厂商产品的操作手册；产品 API、预览状态和默认行为应以对应版本的官方文档为准。

## 本次变更

新增 120 道题，放在 `src/data/questions/` 下的三个 JSON 批次文件。原有 35 道 RAG 题保留，RAG 相关题库总量增至 155 道。

| 批次文件 | 新增数量 | 主要内容 |
| --- | ---: | --- |
| `rag-modern-2026-10-01-foundations.json` | 43 | RAG 基础与边界、文档解析、切块策略、表格和多语言语料、增量更新、知识来源治理 |
| `rag-modern-2026-10-02-retrieval.json` | 58 | BM25 与稠密检索、混合检索/RRF、查询改写与分解、重排、Contextual Retrieval、父子块、Late Chunking、GraphRAG、多模态、Agentic RAG、检索评测、安全与运维 |
| `rag-modern-2026-10-03-operations-security.json` | 19 | Agentic Retrieval 产品形态、托管检索的责任边界、评测集治理、LazyGraphRAG、引用验证、延迟/新鲜度 SLO、缓存、权限过滤、红队和灰度发布 |

难度分布为 **22 道 easy、98 道 medium**。新增题全部提供选择题和开放题两种形态；选择题统一采用六个选项的多选形式，正确选项位置已打散，并附解析、参考答案、认知任务、测量意图和具体常见误区。题目以知识点理解、方案比较、工程诊断和设计取舍为主，不以背诵产品参数为主。

## 近期值得理解的变化

### 1. 不要把 RAG 简化为“向量 Top-k + 一次生成”

生产检索需要组合多种信号。BM25/关键词检索对错误码、产品编号、日期和稀有专名很有用，稠密向量更擅长某些语义改写；混合检索把两个召回来源合并，RRF 是常见的排名融合方式。重排能改善候选排序，但不能把从未进入候选集的相关文档“排回来”。

这类设计不应被理解为必选组件清单。应从真实查询分布出发，比较召回、排序、端到端正确性、P95/P99 延迟和成本。Azure AI Search 的混合检索文档说明了关键词检索、向量检索与 RRF 的组合思路；Anthropic 的 Contextual Retrieval 则说明了为什么 chunk 离开原文语境后会难以准确检索。

### 2. 查询处理从单查询向多查询、规划和分解演进

真实用户常用口语、省略表达或复合问题。查询改写、同义表达扩展和子查询分解可以改善覆盖；但改写结果本身是推断出来的内容，可能改错实体、日期或限定条件，因此要保留原始查询并用评测集检查改写收益。对于简单且稳定的问题，固定 RAG 通常更简单、延迟更低；当问题需要跨文档综合、多个来源查证或根据证据缺口继续搜索时，再考虑 Agentic RAG。

截至本文校对日，Azure AI Search 的 Agentic Retrieval 文档将部分能力标记为 preview，并区分适用于生产的 API 版本和 preview API 版本。具体能力与可用状态会变化，应以实际使用的服务、API 版本和区域为准，不能把厂商当前的推荐直接当成所有系统的通用架构结论。NVIDIA RAG Blueprint 的公开实现也展示了规划、并行子任务、合成与验证的工作流，同时明确列出比单次检索更高的调用和延迟成本。

### 3. 修复 chunk 语境丢失，不只是调整 chunk 大小

固定长度切块实现简单，但可能切断条款、表格、标题和前后条件。可以评估结构感知切块、为 chunk 关联标题路径、父子块检索、邻近上下文补充，以及 Contextual Retrieval 这类索引前上下文增强方法。Late Chunking 则试图让分块的向量表示保留更长输入的上下文信息。

这些方法各有适用条件：上下文增强会增加处理成本；父块可能混入大量噪声；长输入仍受模型窗口和表示方式限制。正确方法不是给所有语料统一加大 chunk，而是对常见问题、跨段落问题、精确标识符和无答案问题分别做对照评测。

### 4. RAG 评估应区分检索质量、证据支持和任务完成

仅检查最终答案好不好，很难知道问题出在哪个阶段。可以把评估拆成几层：

- **检索与排序：** Recall@k、MRR、nDCG，以及按查询类型划分的召回和排序质量。
- **上下文质量：** Context Precision、Context Recall、相关内容覆盖率、噪声与重复程度。
- **回答质量：** Faithfulness（回答主张是否受到提供上下文支持）、回答相关性、答案正确性和完整性。
- **生产表现：** 延迟、成本、索引新鲜度、拒答质量、引用可定位性和用户任务成功率。

Ragas 文档提供了 Context Precision、Context Recall、Faithfulness、Response Relevancy、Noise Sensitivity 及多模态相关指标，说明评估并非一个单一分数。LLM-as-Judge 可扩大评估规模，但应通过人工标注样本校准，并复核关键失败；公开 benchmark 不能替代企业自己的查询、术语和权限场景。评测集也要避免被反复调参“用穿”，建议保留独立测试集和随时间更新的挑战样本。

### 5. GraphRAG 不是普通向量 RAG 的必然升级

GraphRAG 通过从文本中抽取实体、关系和社区信息，为特定实体的局部问题以及跨语料的全局主题问题提供不同检索路径。Microsoft 文档把 Local Search、Global Search、DRIFT Search 和 Basic Search 分开说明：Local Search 将图信息与原始文本结合，Global Search 通过社区报告进行 map-reduce 式汇总，DRIFT 则结合社区信息与后续局部探索。

这些方法尤其可能帮助多跳关系和全局归纳，但会引入实体抽取、消歧、图构建、摘要更新和额外推理成本。LazyGraphRAG 等方向在研究如何重新分配索引与查询时的计算开销；选型时应比较目标查询的质量、延迟和生命周期成本，而不是只看图谱是否“更先进”。

### 6. 多模态 RAG 的关键是保留结构，而不只是把文件向量化

PDF、扫描表格、图表、图片和音视频包含的有效信息不一定能从纯文本抽取中保留。可依据场景评估 OCR、布局感知解析、表格结构抽取、图像描述、视觉嵌入或视觉重排。表格尤其要保留表头、单位、行列关系、页码以及相关实体；否则即使检索命中了数值，模型仍可能把它与错误的行或时间段联系起来。

多模态方案会增加摄入及在线推理成本，因此评测集应包含真正依赖图像/表格的问题，并与文本型问题分开统计。NVIDIA RAG Blueprint 的官方文档列出了多模态检索、视觉嵌入/重排、OCR、表格与图像相关管线能力，可作为了解当前工程实现形态的参考。

### 7. RAG 安全必须覆盖“数据进入模型之前”的链路

RAG 不会自动消除风险，而是把风险扩展到文档摄入、索引、检索、缓存、生成和工具调用等环节。OWASP 的 RAG Security Cheat Sheet 特别强调以下问题：

- **文档投毒与间接提示注入：** 检索出的文本是数据，不是系统指令；对来源、隐藏内容和解析产物做检查，并在生成阶段保持指令/数据边界。
- **权限继承：** 权限、租户和分类信息必须随 chunk 一起保存，并在查询时强制检查；不能交给 LLM 自行决定某用户是否有权看某份文档。
- **删除和权限撤销：** 删除应传播到向量、关键词索引、派生数据和答案缓存，并验证没有遗留可搜索的 chunk。
- **缓存隔离：** 缓存键和失效规则需要覆盖用户/租户权限、过滤条件、数据版本和时间敏感性。
- **可观测性与红队测试：** 记录足够的查询、检索、引用和版本关联用于排查，同时按数据敏感度控制日志；在 CI 中测试投毒、跨租户检索、旧权限、缓存泄露和未授权工具调用等问题。

安全边界必须由服务端授权、数据治理和可执行策略落实。提示词与恶意内容检测可以作为补充，但不能替代检索前的访问控制。

## 题库使用与继续维护

新增题目使用现有知识点 ID（`rag`、`rag-pipeline`、`graph-rag`），避免为同一知识点重复建分类。题目设置了 `angle`、`cognitiveTask`、`assessment`、`misconceptions`、选择与开放双形态，以支持题目覆盖与训练评估。数据校验已检查新增 120 题的数量、ID 冲突、规范化题干重复、知识点映射、选择题结构、选项长度比例与所需字段；结果无错误。若运行本地项目，应继续按仓库现有流程执行题库质量和构建验证。

建议后续维护时将新发现的线上失败案例转化为题目：例如精确实体漏召、权限过滤后召回衰减、chunk 截断导致引用错位、旧版本残留、Agentic 流程未覆盖子问题，以及多模态表格结构错配。不要仅因为某个新模型或框架流行就加入题库；重点仍是理解机制、适用边界、可验证的权衡和生产诊断方法。

## 参考来源

以下主要采用官方文档、官方工程实现或原始研究说明。厂商文档中有关具体产品、 API 和预览状态的描述仅适用于其对应产品版本，不应直接外推到其他平台。

1. [Microsoft Learn — Retrieval-augmented generation (RAG) in Azure AI Search](https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview?tabs=docs)：经典 RAG、Agentic Retrieval、内容准备、混合检索、相关性和治理的整体说明。
2. [Microsoft Learn — Agentic retrieval overview](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview)：查询规划、子查询并行执行、来源引用、活动日志和 API 版本/preview 状态。
3. [Microsoft Learn — Hybrid search overview](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview)：关键词与向量搜索组合，以及 RRF 排名融合。
4. [Anthropic — Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval)（2024-09-19）：Contextual Embeddings、Contextual BM25 和传统分块的上下文损失。
5. [OpenAI API — Retrieval guide](https://developers.openai.com/api/docs/guides/retrieval)：查询改写、metadata filters、排序选项及混合检索权重等具体 API 机制。
6. [OpenAI API — File search](https://developers.openai.com/api/docs/guides/tools-file-search)：托管 File Search、向量存储、文件过滤、结果数量、引用注释与检索结果可观测性。
7. [Microsoft GraphRAG — 官方文档](https://microsoft.github.io/graphrag/)；[Query engine overview](https://microsoft.github.io/graphrag/query/overview/)；[Global Search](https://github.com/microsoft/graphrag/blob/main/docs/query/global_search.md)：Local、Global、DRIFT 与 Basic Search 的适用差异。
8. [Microsoft Research — LazyGraphRAG / GraphRAG 研究项目](https://www.microsoft.com/en-us/research/project/graphrag/)：图检索、全局搜索与 LazyGraphRAG 相关的研究文章和项目进展索引。
9. [NVIDIA RAG Blueprint — Agentic RAG](https://docs.nvidia.com/rag/latest/agentic-rag.html)；[Blueprint documentation](https://docs.nvidia.com/rag/latest/readme.html)：规划、并行检索、合成、验证、混合检索、多模态摄入与可观测性。
10. [Ragas — Available metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/)：检索上下文、忠实度、相关性、噪声敏感度和多模态等评估指标。
11. [OWASP — RAG Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html)：文档投毒、间接提示注入、访问控制继承、索引完整性、缓存隔离、删除与保留，以及红队测试建议。

## 更新注意

此文记录的是 2026-10-28 的检索结果。RAG 的基础机制相对稳定，但托管 API、模型能力、预览状态、默认参数、评分器和框架实现会持续变化。后续修改题目时应重新核对官方来源，并明确区分“可跨供应商复用的概念”与“某产品特有的接口或行为”。
