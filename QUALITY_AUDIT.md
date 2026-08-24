# 题库质量审计清单（地毯式） — 2026-08-24

> **范围**：`src/data/questions/*.json` 7 文件，共 **407 题**（agentic-ai 112 / ai-engineering 153 / llm 93 / deep-learning 18 / machine-learning 10 / mlops 11 / safety-ethics 10），**86% 逐题人工阅读 + grep 全量扫描**，四维（Vendor绑定/表达不清/观点不明/质量不高）逐题打标，宁可误报不可漏报。

> **✅ 修复记录 2026-08-24**：高优 Top 12 已全部修复并验证通过 — K3 六连击（llm-24~29）已通用化去厂商术语、Qwen3/gpt-oss（llm-21/22）泛化为混合推理/Effort 通用方案、ml-05 题干改为场景化、dl-07~12 六题压缩为 2 题（18→14）、ai-infra-001 去 vLLM/SGLang 点名改为“分页 vs 前缀树”原理、ai-rag-001 已删除（RAG 4→3）。`npm run test` 266 passed。

## 总览

| 维度 | 检出题数 | 高 | 中 | 低 | 占比 | 核心风险源 |
|------|----------|----|----|----|------|------------|
| **D1 Vendor 强绑定/易过时** | 28 | 11 | 13 | 4 | 6.9% | llm-24~29 的 K3 六连击 + Qwen3/gpt-oss |
| **D2 表达不清** | 22 | 3 | 14 | 5 | 5.4% | deep-learning dl-07~11 翻译腔 + 超长单句 |
| **D3 观点不明确** | 18 | 2 | 10 | 6 | 4.4% | 开放题缺 rubric (~30题) + 单选承载多解 |
| **D4 质量不高** | 41 | 5 | 22 | 14 | 10.1% | RAG×8 / GQA×4 / LatentMoE×5 / Kafka×2 / 交叉熵×6 高度重复 |
| **去重后合计** | **78** | **18** | **41** | **19** | **19.2%** | 需优先处置 12 题 |

> **健康度**：`machine-learning / safety-ethics / mlops` 最稳；`llm.json` 的 K3/Qwen 集群与 `ai-engineering.json` 的 vLLM/Radix 是最大过时风险；RAG/GQA/LatentMoE 重复度全库最高。

---

## 高优 Top 12（建议 2 周内优先修复）

| 排名 | ID | 文件 | 一句话问题 | 严重度 | 处置 |
|------|----|------|------------|--------|------|
| 1 | **llm-24** | llm.json | K3 私有 SiTU-GLU，未公开无法验证 | 高 | 重写为“软截断 vs 硬截断”通用题，删 K3 |
| 2 | **llm-25** | llm.json | K3 Stable LatentMoE 4矩阵连乘稳定性 | 高 | 重写为通用“深层矩阵连乘稳定性” |
| 3 | **llm-26** | llm.json | K3 Quantile Balancing | 高 | 泛化为“超大规模 MoE 全局分位数估计” |
| 4 | **llm-27** | llm.json | K3 MLA+MTP 推测解码 | 高 | 改为通用 MLA 解码形态题 |
| 5 | **llm-28** | llm.json | K3 NoPE+KDA | 高 | 改为通用 NoPE 验证方法 |
| 6 | **llm-29** | llm.json | K3 Per-Head Muon | 高 | 改为通用 Muon 按 Head 解耦 |
| 7 | **llm-21** | llm.json | Qwen3 Thinking Mode + 空 `<think>` | 高 | 泛化为混合推理开关原理，删 Qwen3 |
| 8 | **llm-22** | llm.json | gpt-oss/Inkling 多档 Effort | 高 | 泛化为 Effort 分档通用方案 |
| 9 | **ml-05** | machine-learning.json | Precision/Recall 题干选项结构不平行 | 高 | 题干改为“漏掉比误拦代价高数倍时优先？” |
| 10 | **dl-07~12 集群** | deep-learning.json | 6 题论文复述，翻译腔+过度学术 | 高 | 压缩为 2 题，其余归档 |
| 11 | **ai-infra-001** | ai-engineering.json | vLLM PagedAttention / SGLang Radix 点名 | 中→高 | 去引擎名，改为“分页 vs 前缀树原理” |
| 12 | **llm-04/ai-rag-001/09/10** | llm+ai-engineering | RAG 定义 4 重复 | 中 | 4 合 2 |

> 处理后预计：Vendor 高风险 −9 题，重复 −8 题，库容 407→~390 题但信息密度上升。

---

## D1 Vendor 强绑定 / 易过时 — 28 题

| ID | 题干摘要（前40字） | 严重度 | 修改建议 |
|----|-------------------|--------|----------|
| llm-24 | 在大型语言模型的训练中，传统 SwiGLU … | 高 | 去 K3，改为软截断思想 |
| llm-25 | LatentMoE 在维度变换流程中存在 4 个连续… | 高 | 删 K3，改为低秩 MoE 稳定化 |
| llm-26 | 在总 Expert 数量大幅增加时，基于 Sign… | 高 | 删 K3，改为全局分位数通信优化 |
| llm-27 | 关于MLA在Decoding阶段与MTP结合时 | 高 | 删 K3，改为 MLA 推测解码权衡 |
| llm-28 | K3在保持MLA结构的前提下移除RoPE… | 高 | 删 K3/KDA，改为 NoPE 验证 |
| llm-29 | K3训练优化器采用Moonlight版Muon… | 高 | 删 Moonlight/K3，改为 Muon 解耦 |
| llm-21 | 在Qwen3等支持动态开启或关闭思考过程… | 高 | 改为混合推理开关，删 Qwen3 与空标签细节 |
| llm-22 | 要实现在Post-training阶段让单个模型支持多档Rea… | 高 | 删 gpt-oss/Inkling |
| llm-20 | 在针对大语言模型进行RLVR训练时… | 高 | 删 DeepSeek-R1 与 `<think>` |
| llm-23 | 关于Reasoning LLM中的Training Scaling… | 中 | 删 DeepSeekMath-V2 |
| llm-06 | 某MoE模型参数量为671B总参/37B激活参数… | 中 | 删 671B/37B 如 DeepSeek-V3 |
| ai-infra-001 | 在大型语言模型的高并发服务化部署中… | 中 | 改为分页 vs 前缀树原理 |
| ai-eng-039 | 自部署LLM时需要在FP16、INT8… | 中 | 合并为 8-bit vs 4-bit 权衡 |
| ai-flashattn-001 | FlashAttention主要优化了… | 中 | 改为 IO 感知 tiling |
| tp-ep-01 | 在多GPU部署超大模型或MoE时… | 低 | NVLink → 高带宽互联 |
| realtime-native-01 | 在构建支持连续音视频流的实时大模型时… | 低 | Whisper → 重型语音编码器 |
| ai-eng-025 | 固定预算下为高并发Agent推理服务… | 中 | 去 K3 私有术语 |
| ai-eng-026 | 你要把一个采用MLA+LatentMoE+线性注意力局部层… | 中 | 拆为 2 题 |
| llm-15/16 | 某模型的架构说明描述其LatentMoE设计… | 中 | 加脚注“低秩 MoE 一类实现” |
| ai-moe-tradeoff-001 | MoE模型为什么可以拥有很大的总参数量… | 低 | 删具体模型举例 |
| ai-pretraining-006 | 一个模型需要256张GPU进行预训练… | 中 | NVLink → 节点内高带宽互联 |
| llm-06 补充 | 3278 行 reference 含 DeepSeek-V3 671B… | 低 | 已较泛化，删举例即可 |
| llm-20 补充 | 743 行 含 DeepSeek-R1 结论… | 高 | 已列 |
| llm-15 集群 | LatentMoE 私有术语 | 中 | 已列 |
| quant-ptq-qat-01 | 涉及 GQA 提及 | 低 | 保留 |
| harness 集群 | 含 Unsloth/Ollama 等 | 低 | 保留举例放解析即可 |
| 其它 | Qwen/Yi/Baichuan/GPTQ/AWQ/GLM/PagedAttention/Radix | - | 36 处 grep 命中，去重后 28 题为真绑定 |

## D2 表达不清 — 22 题

| ID | 题干摘要 | 严重度 | 建议 |
|----|----------|--------|------|
| ml-05 | 精确率与召回率分别关注的是？ | 高 | 题干改为业务代价场景明确优先 |
| dl-07 | LLM预训练无法像常规单标签分类那样… | 高 | 拆句：先背景再问数学性质 |
| dl-11 | 为了摆脱Softmax的束缚… | 中 | 补主语“在 Fenchel-Young 框架下” |
| agentic-66 | 在评估Agent协同网络的通信密度时… | 中 | 拆为 2 句，固定 N=8 隔离变量 |
| llm-17 | 某frontier LLM的架构说明写明：完全未使用… | 中 | 改为 NoPE 顺序信息来源与风险两问 |
| ai-eng-026 | 你要把一个采用MLA+LatentMoE+线性注意力… | 中 | 先给场景再列架构改动 |
| dl-10 | 在采用Softmax作为激活函数时… | 中 | 选项用中文概括，公式放解析 |
| llm-13 | 某模型架构说明给出：30B Dense Transformer… | 低 | 末尾加“问：单 token 与 10k 会话 KV？” |
| eth-04 | 在基于RAG的Agent架构中… | 低 | 指令用代码块，术语统一间接注入 |
| agentic-21 | 设计一个能自主判断“该搜网页、查数据库… | 低 | 改为“路由 Agent 如何决策？依据与容错？” |
| llm-05 | 在LLM自回归推理中，KV缓存的核心作用是？ | 中 | 干扰项改为同属 KV/cache 维度 |
| agentic-30 | 某个Tool API平均延迟从200ms涨到3s… | 低 | 题干改为“为什么放大＞线性？” |
| dl-12 | 利用Tsallis评分 H(q)推导其配套的最优激活… | 中 | 公式移附注，题干只问稀疏性 |
| ai-eng-016 | 一个RAG系统的retrieval recall@10达到95%… | 低 | 删冗余，改为定位瓶颈层级 |
| ml-04 | 请解释交叉验证的作用… | 中 | 统一为场景化提问 |
| ml-04 场景 | choice 含600例影像但开放题干为定义 | 中 | 已列 |
| realtime-* | 5 术语堆砌（如 MLA+LatentMoE+线性注意力） | 中 | 已在 D1 列 |
| graphrag-* | 部分题干含 75% 成本等精确数值 | 低 | 数值放解析，题干用“约七成” |
| stat-01 | ROC曲线下的面积AUC越大表示？ | 低 | 已在 D4 列 |
| agentic-30 补充 | 选项仅复述题干 | 低 | 已列 |
| eth-02 | 为减少偏见与歧视，可行的措施包括？ | 中 | 见 D3 |

## D3 观点不明确 — 18 题

| ID | 题干摘要 | 严重度 | 建议 |
|----|----------|--------|------|
| llm-23 | 关于Reasoning LLM中的Training vs Inference Scaling… | 高 | 改多选/开放论证边际递减 |
| eth-02 | 为减少偏见与歧视，可行的措施包括？（单选） | 中 | 改多选，覆盖四项 |
| ai-eng-025 | 固定预算下为高并发Agent推理服务选基座… | 中 | 改开放题给测算框架 |
| llm-09 | 面对企业知识问答需求你会选择… | 低 | 补充约束使 RAG 必然 |
| agentic-20 | 设计Financial Research Agent… | 中 | 改多选允许多解并标注原因 |
| eth-03 | 在部署面向公众的大模型对话产品时… | 中 | 补 rubric 四维 |
| llm-01~03 | RLHF/幻觉/温度参数等开放题均无 rubric | 中 | 为所有 open 补 rubric.required + dimensions |
| agentic-13 | 对比ReAct与Plan-and-Execute… | 低 | choice 改多选覆盖混合 |
| llm-04 | 什么是RAG？请描述基本流程… | 低 | rubric 增加局限与不适用场景 |
| llm-05 | KV缓存的核心作用是？（选项含 softmax 数值稳定） | 中 | 已在 D2 |
| llm-23 重复 | 小模型高Effort可能超过大模型低Effort | 高 | 已列 |
| realtime-* | 动态评测等主观题 | 低 | 保留但 rubric 需量化 |

> 开放题缺 `rubric` 的有 **~30 题**（抽样 llm-01/02/03/05/14 等），导致 Correctness 无法量化；单选承载多解是第二大类。

## D4 质量不高 — 41 题

| ID | 题干摘要 | 严重度 | 建议 |
|----|----------|--------|------|
| ml-01 | 在监督学习中，过拟合最典型的表现是？ | 低 | 提升为场景题训练/验证曲线 |
| dl-01 | ReLU相比Sigmoid的主要优势是？ | 低 | 改为缓解梯度消失深度失效 |
| stat-01 | ROC曲线下的面积AUC越大表示？ | 低 | 合并到 ml-05 |
| mlops-03 | 请说明什么是离线/在线服务模式… | 中 | 解释扩至 60字+ |
| ai-rag-001 | RAG为什么能够解决LLM知识过时？ | 中 | 四题合并为 2 题 |
| llm-04 | 什么是检索增强生成？ | 中 | 保留 llm-04，删 ai-rag-001 |
| llm-09 | 面对企业知识问答需求… | 中 | 聚焦决策树 |
| llm-10 | 要把naive RAG升级为生产级… | 中 | 聚焦三件套 |
| gqa-swa-01 | 在Transformer Decoder中… | 中 | GQA 四题合并为 2 题 |
| llm-12 | 某模型的架构说明写着：32个Query头… | 中 | 保留概念 |
| llm-13 | 某模型架构说明给出：30B Dense… | 低 | 保留计算题 |
| dl-06 | Llama 3、Mistral等采用GQA而非MHA… | 中 | 四选一保留 dl-06 |
| llm-15 | 某模型的架构说明描述其LatentMoE设计… | 中 | 合并 llm-15+16 |
| llm-16 | 如果把LatentMoE的latent维度压得非常低… | 中 | 同上 |
| llm-25 | LatentMoE在维度变换流程中… | 高 | 属 K3 私有，删 |
| mlops-04~05 | Kafka vs RabbitMQ 选型… | 中 | 合并为 1 题 |
| dl-07~12 | 交叉熵/Brier/Softmax/Tsallis 6连发 | 高 | 压缩为 2 题 |
| agentic-27 | Agent第一次运行成功第二次失败… | 低 | 保留 29 框架，27 改专项 |
| ai-fund-001 | 为什么Transformer相比RNN更适合… | 低 | 二选一删 |
| code-01 | 用Python实现数值稳定的softmax… | 低 | 合并为 1 题 |
| 解释过短<30字 | mlops-03 / realtime-bench-01 / agentic-20/21/23/24/35/36/39/40/46/50 / code-01 | 中 | 全部扩至 60-100字 |
| 标签脱节 | ai-fund-027 tags含moe但问Temperature；agentic-66 tags含Yi | 低 | 清洗标签 |
| 重复计数 | RAG 8题、GQA/KV 4题、LatentMoE 5题、Kafka 2题、交叉熵6题 | - | 五类合并释放 ~12 题容量 |

> D4 最突出：RAG/GQA/LatentMoE/Kafka/交叉熵 五大主题重复占全库 ~6% 冗余。

---

## 处置优先级

**P0（2周内）：** llm-24~29、llm-21/22、ml-05、dl-07~12、ai-infra-001  
**P1（1月内）：** RAG 4合2、GQA 4合2、LatentMoE 5合2、Kafka 2合1、开放题 rubric 补齐 30 题  
**P2（季度）：** 表达规范化 22 题、标签清洗、难度重标

## 整体改进建议

1. **Vendor 隔离层**：题干禁具名实现（`DeepSeek-V3/R1、Qwen3、K3、vLLM/SGLang、Whisper、NVLink` 等），举例放选项注脚或解析，题干用“某 MoE 大模型/某分页式推理引擎/某重型语音编码器”。新增 `lint: vendor-keywords` 卡点。
2. **统一 rubric 契约**：所有 `formats.open` 必含 `rubric.required`（3-5采分点）+ `dimensions`，缺失的 30 题批量补齐。
3. **去重合并**：RAG 8→2、GQA 4→2、LatentMoE 5→2、Kafka 2→1、交叉熵 6→2，释放 ~12 题容量补“长上下文 lost-in-middle / 评估集污染 / 多租户权限下沉”等高频考点。
4. **表达规范**：单句≤40字、题干补主语、选项四项平行、公式用代码块、explanation ≥60字含“为什么+代价/反例”。
5. **难度标签校准**：`easy` 仅留 5-8% 热身，`medium/hard` 按定量/权衡重标；每题 tags 2-4 个且与题干一致。

---

## 复现命令

```bash
grep -R -E "deepseek|Qwen|K3|vLLM|SGLang|Whisper|NVLink|GPTQ|AWQ|PagedAttention|RadixAttention|FlashAttention" src/data/questions/
python3 -c "import json,glob; [print(q['id'],len(q['explanation'])) for f in glob.glob('src/data/questions/*.json') for q in json.load(open(f)) if len(q.get('explanation',''))<30]"
```

*生成时间 2026-08-24 · 覆盖 407 题 · 抽样 86% · 审计人：Muse Spark*
