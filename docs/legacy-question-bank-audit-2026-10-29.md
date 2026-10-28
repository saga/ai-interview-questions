# 既有题库与知识库抽样审查（2026-10-29）

## 范围与方法

- 对 `src/data/questions/` 中的既有题库文件逐文件取样，覆盖 120 个非本次 2026-10 新增题库文件；按文件抽取代表题，并对高风险主题（模型架构、Agent 上下文、检索、AWS、Snowflake、训练/推理、MCP、安全）追加定向检查。
- 对 `src/data/knowledge/` 的 36 个知识文件逐文件查看知识节点摘要与关键要求。
- 对发现的高置信问题回读完整题目与参考答案后修订。此审查是“每个文件抽样 + 风险定向复核”，不是对每一道题逐字逐项重新验证；不能据此宣称整个题库已完成全量事实校验。

## 已修订

### 1. Context Manager 参考答案存在真实逻辑错误

文件：`src/data/questions/context-engineering.json`，题目 `ai-code-005`。

原参考代码在预算循环中把已存在的旧轮次再次追加进 `older`，同时又把这些轮次的 token 加回总量，不能实现“将旧历史压缩以降低输入预算”的目标；摘要后也没有从 `turns` 中移除已压缩轮次，后续调用可能重复摘要同一段历史。此外，它把由用户对话生成的摘要放进 `system` role，错误地提高了不可信历史内容的指令优先级。

修改：重写参考实现，按最旧轮次压缩、压缩后移除原始轮次、以新摘要替换旧摘要；历史摘要按不可信会话数据传入，而非作为 system 指令；增加压缩后预算复核与超限报错，并明确字符数估算不能替代目标模型 tokenizer。

### 2. ViT 的空间归纳偏置描述过于绝对

文件：`src/data/knowledge/vision-transformer.json`、`src/data/questions/vision-transformer.json`。

原知识摘要把 ViT 描述为“初始无二维空间先验、完全依赖数据学习空间结构”；题目解析也将 Patch 关系描述为“完全自适应学习”，并把超大规模预训练后超过 CNN 的结果写成较普遍的结论。常见 ViT 使用位置编码，故“完全没有空间信息”不准确；ViT 与 CNN 的比较也依赖数据规模、训练方法、模型和具体任务。

修改：明确区分“没有卷积式局部性和平移等变性”与“没有位置编码”；将性能结论改为条件性判断。同步修订 [CLS] 题目中“无偏聚合”“避免位置偏差”的绝对表述，改为全局表征能力并不保证消除位置偏差。

## 本次抽样中需要保留的边界

- 评估、RAG、Agent、MCP、数据工程、PostgreSQL、Snowflake、AWS、Transformer、MoE、训练/推理和安全等多个领域均有覆盖。基础机制题不因没有最新发布日期就属于过时内容。
- 产品名、模型名或厂商来源本身不等于错误；只有当题目依赖过期接口、错误的当前状态或不成立的普遍断言时才应改写。
- 一些知识条目是高度专门化的研究摘要（如特定互连拓扑、蒸馏校正和新型模型结构）。本轮未对所有论文中的实验数字逐项复现，因此不把“尚未独立复现”误报成已证实错误。

## 验证限制

修改后重新读取并解析了三个变更 JSON 文件，检查了题目数量、参考答案字段和选项长度比例；这些静态检查通过。当前未在本地运行 `npm run test`、`npm run validate:questions`、`npm run question:quality` 或 `npm run build`。GitHub Actions API 返回的最新几次运行标记为 failure，但作业列表为空，无法从可用结果定位失败原因；因此不能宣称测试和构建已通过。

## 第二轮扩展抽样：300 余道题与知识点复核

本轮在初次审查基础上扩展至 300 余道题。抽样按多个题库文件的主题和位置分层，覆盖 Agent / Harness、评估、LLM 基础、模型架构、推理、Prompt/Context、Memory、RAG 与搜索、工具调用与安全、训练与对齐、AWS、PostgreSQL、Snowflake、Transformer、集群互连、可靠性等；同时回读了相关知识节点。该方式覆盖面较广，但仍属于抽样，不代表每一道旧题都完成了逐项事实验证。

### 本轮新增确认并修复

#### 3. SageMaker Real-Time Inference 的限制值已过时

文件：`src/data/questions/aws-ai-practitioner.json`，题目 `aws-ai-practitioner-06`。

原解析写普通实时推理 payload 约 6 MB、超时约 60 秒；当前 AWS 官方文档列明普通 Real-Time Inference payload 最大 25 MB、常规响应处理时间 60 秒，Streaming responses 可达 8 分钟；Serverless 为 4 MB / 60 秒，Asynchronous 为 1 GB / 60 分钟。已修订解析与参考答案，并将题干从含混的“需要近实时延迟”改为“调用方不要求同步 HTTP 响应、希望作业完成后尽快取回结果”，避免让人误以为异步推理能满足严格的同步低延迟 SLO。题目保留“长处理时间、大 payload 适合异步推理”的结论，并提示配额须按 endpoint 类型与官方文档核验。

官方依据：
- https://docs.aws.amazon.com/sagemaker/latest/dg/deploy-model-options.html
- https://docs.aws.amazon.com/sagemaker/latest/dg/async-inference-troubleshooting.html

#### 4. RoPE 的注意力分数机制写得不准确

文件：`src/data/questions/model-architecture.json`，题目 `ai-fund-006`；`src/data/knowledge/llm-architecture.json` 的 `rope` 节点。

原解析声称 attention 分数“只取决于相对距离”。准确地说，RoPE 让相对位置偏移进入 Q/K 内积，但注意力 logit 仍同时依赖内容向量，不是只由距离决定；采用 RoPE 也不自动保证超长上下文外推稳定。已修订题目、开放题答案、评估目标和知识节点，明确相对位置与内容相似度共同影响分数，长上下文扩展应使用实测评估。

#### 5. TPU slice 集合通信性能的倍数结论过度绝对

文件：`src/data/questions/cluster-interconnect-20260911.json`，题目 `tpu-torus-mesh-subslice-degradation`；`src/data/knowledge/cluster-interconnect.json` 的 `tpu-cluster-topology` 节点。

原文从 wraparound 链路缺失直接推导通信步数与延迟“约 2 倍”，缺少对实际 slice 拓扑映射、算法、消息大小、链路争用和运行时实现的限定。已改为：拓扑变化会影响路径与通信成本，但具体倍率必须以实际拓扑和目标负载测量，不能作为普遍规律。

官方参考：
- https://docs.cloud.google.com/tpu/docs/v5e

#### 6. Cortex Agents 的新推荐路径已纳入知识节点

文件：`src/data/knowledge/snowflake-coco-skills-expansion.json` 的 `snowflake-coco-analyst-chat`，以及 `src/data/knowledge/snowflake-asset-management-agentic.json` 的 `sf-am-agent-architecture`。

Snowflake 在 2026-08-28 的官方更新中建议新应用从 Cortex Analyst 转向 Cortex Agents；现有 Cortex Analyst REST API 仍可用，Semantic Views 和 Verified Queries 可继续复用。已修订知识节点，说明新建多步应用可优先评估 Cortex Agents，但不应误称旧 API 已下线或要求重建语义层。

官方参考：
- https://docs.snowflake.com/en/release-notes/2026/other/2026-08-28-cortex-analyst-transition-cortex-agents
- https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents

#### 7. 其他本轮修订的边界问题

- `aws-ai-practitioner-09`：已修正 SSE-S3 需要 `kms:Decrypt` 的错误说法。SSE-S3 不需额外 KMS 权限；SSE-KMS 的权限要求不同。依据：https://docs.aws.amazon.com/AmazonS3/latest/userguide/troubleshoot-403-errors.html
- `ai-eng-067`：已将“检索、账户上下文和工具调用都应并行”的普遍要求改为依据依赖图并行；存在数据依赖时必须按顺序执行。
- `ai-eng-037`：已说明经典 speculative decoding 通常要求同/兼容 tokenizer，但 Universal Assisted Decoding 支持不同 tokenizer。依据：https://huggingface.co/docs/transformers/assisted_decoding
- `prompt-cache-min-tokens-01`：移除将 1,024/2,048 说成跨厂商统一门槛的表述，改为按模型和 API 核对缓存最小长度与 checkpoint 规则。OpenAI 当前文档指出 GPT-5.6 及之后为 1,024 个可见输入 token，早期模型依请求设置而异。依据：https://developers.openai.com/api/docs/guides/prompt-caching
- `rlhf-vs-cai-alignment`：明确区分传统 Reward-Model-based RLHF + PPO 与通常直接使用偏好对优化策略的 DPO，不再把两者写成必须串联的步骤。
- `rl_critic_ppo_trajectory_canonical` 和 `rl-critic-ppo-trajectory`：移除“GRPO 必须要求组内轨迹长度/结构一致，否则归一化必然失效”的断言，改为强调轨迹分段后必须保留组关联并明确奖励、掩码和样本语义；Critic 也不保证精确解决长程 credit assignment。

## 更新后的审查结论

抽样发现的问题不只有“旧版本 API”，也包含内容过于绝对、把某些条件性工程经验写成普遍定律，以及错误混淆不同算法/权限语义。已修改能通过题目原文与官方资料交叉确认的问题；其他仅属可疑或依具体实现而定的内容，尽量改为带前提的描述，而不是贸然认定为错误。

当前仍未完成全量逐题事实审校。GitHub Actions 的作业明细接口未提供有效 job 信息，且本地测试命令尚未运行，因此不能宣称整体测试或构建已通过。


#### 8. ZDR 不能简化成“供应商保证不存储、不训练”

文件：`src/data/questions/prompt-injection.json`，题目 `guard-input-mask-01`。

原题将 ZDR 写成一个通用合规承诺，并直接推断可以保留完整上下文、满足隐私合规，还将“私有部署 + ZDR”作为通常优选。实际情况取决于供应商、账户/组织资格、API 端点、具体功能和合同范围；数据保留与是否用于训练是相关但不同的政策维度。OpenAI 文档对不同端点/功能分别说明 ZDR 资格与例外；Anthropic 的官方表格也明确指出有些功能不在 ZDR 范围，部分状态化功能会保留资源或会话数据。已重写选项、答案和解析，改为按实际数据流、威胁模型和功能范围比较 API 留存控制、私有部署及选择性脱敏。

官方依据：
- https://developers.openai.com/api/docs/guides/your-data
- https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention

#### 9. Sanitizer 前后版本差分是强证据，但不是绝对证明

文件：`src/data/questions/security-eval.json`，题目 `sec-eval-02`。

原解析将“PoC 在补丁前版本 crash、补丁后版本不 crash”描述为能确切证明目标漏洞。该差分测试是有力验证，但仍需要保证两次构建与运行条件一致、检查 Sanitizer 报告/堆栈是否对应目标缺陷，并排除构建差异和无关崩溃。已修订解析和开放题参考答案，强调必要时最小化 PoC 并重复验证。

#### 10. 同步修订了受影响的离线题目变体

原题文案和答案解释修订后，进一步更新了相关 `src/data/variants/` 离线变体池中的选项、推理目标、`sourceSnapshot`、`sourceHash` 和 `contentHash`，覆盖上下文工程、RoPE、ViT/[CLS]、SageMaker 推理、SSE-S3 权限、ZDR、RLHF/DPO、GRPO 与 TPU 拓扑等主题。这样可以减少训练过程中仍抽到旧绝对说法的风险。变体改写后的正确/错误选项也按原题答案索引逐项复核。

## 本轮复核与验证边界

本轮按主题分层抽取 300 余道题，并回读了相关知识节点；可确认的问题已修改。但仍不是对整个历史题库逐题逐选项的完整事实审计。部分技术机制没有唯一的最佳设计，应根据场景和实现条件描述，不宜把“常见实践”写成普遍定律。

截至本次更新，已对变更文件做 JSON 解析与部分题目结构静态检查。尚未能确认 `npm run test`、`npm run validate:questions`、`npm run validate:variants`、`npm run question:quality` 和 `npm run build` 全部通过：未在本地完成这些命令，GitHub Actions API 对最近的失败运行仍未提供可用 job 明细。

### 补充复核：线性循环注意力状态的表述不准确

文件：`src/data/questions/llm-architecture-advanced.json`，题目 `llm-arch-hybrid-recurrent-attention-01`。

复核时发现，原选项将 Gated DeltaNet 的循环状态称为“固定大小的隐状态向量”，但这类线性注意力机制通常维护的是矩阵类状态；同时，原解析把逐 Token 解码笼统写成 `O(1)`，容易把“状态规模不随上下文长度增长”误读成“每 Token 总计算量与模型维度无关”。已修订选项、解析、开放题答案和 reasoningGoal：明确状态通常为矩阵类状态，状态规模对上下文长度为常量，但每 Token 计算仍取决于模型维度和具体实现。

依据：Gated DeltaNet / 线性注意力论文对矩阵值状态及递归更新的描述：
- https://jankautz.com/publications/GatedDeltaNet_ICLR25.pdf
- https://arxiv.org/abs/2605.22791

本次是对既有 300 余道抽样审查后的补充复核，不改变“抽样并非全量逐题审校”的结论。
