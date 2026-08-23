# 设计变更记录

> 记录每次影响设计/架构的变更。新条目追加在顶部，标注日期与变更点。

## 2026-08-23 · 第四批：LLMOps / Safety / System Design / Coding 实践题（去重后收 36 题，总 237 题）

- **新增**（`ai-engineering` +28 / `agentic-ai` +2 / `ai-fundamentals` +6）：
  foundation model 范式、logits 链路、cross-attention、FlashAttention、MoE 工程复杂度、蒸馏设计；
  few-shot 取舍、prompt 消融瘦身、prompt 版本化、CoT 成本归因；
  embedding 迁移双索引、换模型 Recall 暴跌定位、短 query 优化、向量库降本、检索升级阶梯；
  planning vs tool 归因、MCP 引入决策；FT 反例清单、LoRA 效果差三因诊断；
  response cache、semantic cache、RPM/TPM 双限流、provider 切换防风暴；
  prompt 变更验证、LLM 回归测试 CI 化；guardrails 前后置分工、PII 防护、间接注入纵深防御;
  Coding Agent / AI API Platform / Agent-vs-RAG 架构决策三道系统设计题；
  以及首批 5 道 coding 实践题（retry backoff、cosine、recursive chunker、tool handler、context manager）。
  新 topic 仅 foundation-model / flash-attention / distillation / prompt-engineering / vector-db / caching，
  其余复用（privacy/prompt-injection/agent-guardrails/system-design/context-engineering 等既有节点）；
  conceptGraph 增 attention → flash-attention、pretraining → distillation。
- **刻意去重约 24 题**：temperature/top-k-p（ai-fund-026/028）、GQA（dl-06）、alignment tax（ai-posttraining-006）、
  JSON 输出失败（ai-eng-020）、固定步骤 workflow（ai-eng-001）、无限循环检测（ai-eng-011）、
  200 tools routing（ai-eng-006）、量化原理与 70B 上 80GB（ai-inference-005）、judge 可靠性（ai-fund-041）、
  中间指标（ai-eval-001）、幻觉治理（ai-fund-045）、reproducibility trace（ai-engineering-003）、
  routing 信号与降级阶梯（ai-engineering-001/002）、文档 QA 系统设计（agentic-15）、
  跨 session memory 设计（ai-eng-014）、高相似低相关（ai-fund-039）等——均有现成题目覆盖。
- **coding 题型首次入库**：`type: coding` + `language: typescript`，referenceAnswer 存参考实现，
  复用现有 OpenQuestion 渲染与评分链路，未改任何 schema。

## 2026-08-23 · 工程题第三批：去重后收编 26 题（总 201 题）

- **新增**（`ai-fundamentals` +11 / `ai-engineering` +10 / `agentic-ai` +5）：
  attention 长文本退化排查、KV Cache OOM 定位与优化、tokenizer 跨模型差异、
  next-token 为何有效、10T 预训练数据工程、数据配比质量 vs 数量、DP/TP/PP 选型、
  loss NaN 排查、SFT 数据分级清洗、SFT 灾难性遗忘、风格需求 Prompt/RAG/FT 决策、
  TTFT 升高 decode 不变排查、continuous batching、量化方案取舍、RAG 时效性边界、
  Agent 评测设计、70% 准确率分段归因、双 Agent 成功率/成本权衡、model routing、
  降级阶梯、Agent trace 五要素、tool calling 本质、retry 分层放置、工具权限与确认门、
  MCP vs Function Calling、客服 RAG/Workflow/Agent 决策。
  新 topic 仅 training-data / distributed-training / training-stability / observability，
  其余复用既有节点；conceptGraph 增 pretraining → {training-data, distributed-training, training-stability}。
- **刻意去重 20 题**（对方批次与现有题库重复）：Transformer vs RNN、QKV、位置编码/RoPE、
  KV Cache 原理、scaling law、pretrain/posttrain 分工、SFT 定义、RLHF reward model、DPO、
  LoRA 原理与 rank、RAG vs FT 知识库、prefill/decode、chunking 重设计、hybrid search、
  reranker、"recall 高回答差"排查、300 tools routing、agent loop 循环、Plan-and-Execute 取舍、
  cost 优化与 retry/backoff（已由 ai-eng-021/023 覆盖）——按 AGENTS 原则不留重复题。
- 测试 79 例全过；typecheck/build 通过。

## 2026-08-23 · 题库拆分为按类目文件（数据布局变更，显式说明）

- **拆分**：`data/questions.json`（175 题单文件）→ `data/questions/<category>.json` ×11
  （agentic-ai 71 / ai-fundamentals 51 / ai-engineering 13 / 其余 ML 基础类共 40）。
  每题字段 schema 不变——变的只是文件布局；新增题目直接追加到对应类目文件，
  新增类目 = 新建同名 JSON + `domain/categories.ts` 登记标签。
  （按 AGENTS 约定显式说明：这属于对外已发布的 JSON 题库结构变更。）
- **装配**：新增 `data/questionBank.ts`，`import.meta.glob('./questions/*.json', { eager: true })`
  启动时合并为 QuestionBank 单例；App.tsx 改从该模块取题库。
  **刻意不建** question-index / SQLite / IndexedDB / Repository 层——题库是静态 content source，
  运行时只是 filter/pick；等规模（bundle/加载）真成为问题时再加动态 import + 构建期索引。
  Learner Memory 边界不变：静态内容在 questions/*.json，用户状态仍在 localStorage。
- **数据完整性测试化**：原靠人工核对的事项固化为 `data/bank.test.ts`（7 例）——
  id 唯一、类目与 categories 吻合、选择题 answer 索引合法、开放题 referenceAnswer 非空、
  difficulty/type/topic 枚举与非空校验、rubric 维度键与权重和 ≤1、conceptGraph 边两端 topic 均有题目支撑。
  相当于把"build script 校验清单"放进 Vitest，暂不引入独立构建脚本。
- 测试 79 例全过；typecheck/build 通过（rolldown 提示可进一步 dynamic import 切包，暂不需要）。

## 2026-08-23 · AI Fundamentals 基础层题库（51 题，总 175 题）

- **题库**：新增 `ai-fund-001..051` 与类目 `ai-fundamentals`，补齐工程题库之下的原理层——
  Transformer/Attention（含 scaled dot-product 选择题）、Tokenization/BPE、Embedding vs hidden state、
  Pre-training/Scaling Law、Post-training 链路（SFT loss masking → RLHF reward model → DPO 隐式 reward）、
  Fine-tuning/LoRA（rank 取舍、LoRA vs RAG 定位）、推理解码（temperature/top-k/top-p/prefill-decode/KV Cache）、
  Context Window、RAG 基础（chunking/hybrid/reranker/相似度≠相关性）、Evaluation（judge 偏差/数据集设计/offline-online）、
  Hallucination 成因与边界；末尾 5 道综合 Scenario/Debugging 题（模型选型、FAQ 接入、RAG 排查、
  延迟定位、Agent 成功率）延续工程判断定位。
- **知识图谱**：新增 12 条 prerequisite 边形成"基础→进阶→工程应用"链：
  tokenization → transformer → pretraining → sft → {dpo, fine-tuning → lora}；
  transformer → inference-optimization → {kv-cache, context-window}；
  word-embedding/context-window → rag → reranking。topic 尽量复用既有节点，
  新增节点仅 transformer/sft/dpo/fine-tuning/scaling-law/context-window/reranking/rope/alignment/model-selection。
- **类目登记**：`domain/categories.ts` 增加 `ai-fundamentals` 中文标签。

## 2026-08-23 · AI Engineering 工程判断题库扩充（24 题，总 124 题）

- **题库**：新增 `ai-eng-001..024`，主干为工程判断而非知识点——workflow-vs-agent、
  agent-components、tool-calling/tool-routing、react/plan-and-execute/reflection、mcp、
  agent-loop（agentic-ai）；context-engineering、memory、rag、evaluation、structured-output、
  reliability、latency、cost、agent-system-design（新类目 `ai-engineering`）。
  题型刻意混入 trade-off 与 debugging 场景，让 Learner Memory 能区分"知道概念"与"能设计/debug 系统"。
  全部落到现有 schema：开放题统一 `type: essay`（场景风味保留在 tags），difficulty 映射为 easy/medium/hard，
  每题带 rubric.required + 四维 dimensions。
- **知识图谱**：新增 11 条 prerequisite 边，形成两条主线
  （workflow-vs-agent → agent-components → tool-calling → tool-routing；
  react → plan-and-execute → reflection）及 agent-system-design 汇聚点（← tool-calling / rag / evaluation）、
  structured-output → reliability、latency → cost。
  未采纳 `context-engineering → memory`：与既有边 `memory → context-engineering` 方向相反，
  双向共存会触发加载期 isAcyclic 报错，保留原方向。

## 2026-08-23 · 架构评审修复批次（ADR-020：接线 + 删除）

- **功能接线（此前文档承诺但代码未生效）**：
  - `rubric.required` 注入评分提示：新增 `ai/provider.mergeQuestionRubric` 纯函数统一合并
    题目级 dimensions/required——此前 46 道带 required 的题全部未生效。
  - `useAI` 门控开放题评分：`evaluateAnswer` 增加 useAI 检查，关闭 AI 不再偷发 LLM 请求。
- **Bug 修复**：
  - 自适应限时模式倒计时/训练时长重置：截止点锚定 `session.startedAt`（换题不再重置计时）。
  - 自适应 move-on 薄弱优先断线：`nextAdaptiveStep` 接入 profile，兜底改用
    `recommendWeakTopics`（此前误用全部练过主题且生产路径未传）。
  - AdaptiveQuiz「提前结束」先对当前题评分再入账，不再以 0 分污染学习画像。
  - SettingsPanel 切换服务商时重置模型（避免跨服务商非法组合）；删除环境变量误导文案。
- **死代码清理（AGENTS 原则 2）**：
  - 删除 `nodeTypes`/`NodeType`/`nodeTypeOf`/`prerequisitesOf` 及 JSON 中 nodeTypes 字段
    （生产零引用；ADR-019「覆盖面展示仍用」的理由不成立）。
  - 删除 `InterviewSession.variants` 与 GeneratedVariant 溯源字段、`followUpStrategy` 预留字段。
  - conceptGraph 公开 API 无参化（去掉被忽略的 graph 参数）；薄弱阈值收敛到单一出处；
    isChoiceCorrect 去重；pi.ts 收敛 `as never` 为正式类型。
- **口径一致**：README 移除 pi-agent-core 表述（ADR-019 遗漏）；模拟面试页未配置 AI 也允许开始；
  过期注释清理（mastery 公式 / 边类型清单 / variantGenerator 等）。
- 测试 72 例全过（新增 provider rubric 合并、engine useAI 门控、adaptive 薄弱优先）；
  typecheck/build 通过。

## 2026-08-23 · 架构收敛（ADR-019：减法清单执行）

- **移除 pi-agent-core**：开放题评分改走 `ai/evaluate.ts`（pi-ai one-shot）；删除 `interviewAgent.ts`
  及其测试与 npm 依赖。对话式 Agent 仅在"对话式模拟面试"落地时回归（Future/Experimental）。
- **ai 层重组**：models.ts → `pi.ts`；variantGenerator.ts → `variant.ts`；新增 `evaluate.ts`；
  `lib/interviewEngine.ts` → `application/interviewEngine.ts`（应用服务层）。
- **变体安全收窄**：LLM 只重写题干/解析——GeneratedVariant 不再含 options/answer 字段，
  applyVariant 原样保留原题答案数据；提示词不再要求 LLM 重排选项、重算索引。
- **分数所有权**：LLM 只输出四维 dimensions；overall 一律由 domain/aggregateOverall 计算
  （parseEvaluation 忽略 LLM 直出总分）。
- **图边砍到两类**：10 种关系 → prerequisite + related；删除 childrenOf/interviewTargetsOf，
  adaptive 的 deep-dive 简化为"同主题更高难度"；graphlib 限定在 conceptGraph 模块内。
- **mastery 简化**：`avgScore/100`，去掉置信度加权公式。
- 测试 66 例全过；typecheck/build 通过。AGENTS.md / ARCHITECTURE / ADR 同步更新。

## 2026-08-23 · 知识图谱迁移到 @dagrejs/graphlib

- 引入 `@dagrejs/graphlib`（自带 TS 类型）承接图的存储与算法，`domain/conceptGraph.ts` 手写遍历逻辑下线：
  - **加载期 DAG 校验**：prerequisite 子图用 `alg.isAcyclic` / `alg.findCycles` 校验，数据有环直接抛错（fail-fast），不再依赖运行时 seen 集合兜底。
  - **拓扑排序**：`alg.topsort` 给出"基础→进阶"学习顺序，suggestNextTopics 的可学新主题按拓扑序排列（此前按闭包长度近似）。
  - 邻接查询改用 `predecessors()`；公开 API 签名不变，adaptive/coverage/coach 调用方零改动。
- 测试 72 例全过（新增闭包传递性、nodeTypeOf 用例）；typecheck/build 通过。

## 2026-08-23 · 知识图谱正规化（ADR-018：typed nodes/edges + DAG + evidence）

- **图数据重构**（`data/conceptGraph.json`）：
  - `related`/`prerequisites` 两个无类型列表 → `nodeTypes`（8 种节点类型）+ `edges`
    （10 种有向关系：prerequisite/part_of/extends/alternative/tradeoff/contrasts/related_to/technique
    + 面试迁移 deep_dive/challenge）；每对主题单条有向边，无向语义由遍历层双向展开。
  - prerequisite 统一为"基础→进阶"有向 DAG（如 agent-fundamentals → tool-calling → react → plan-and-execute）。
- **领域层升级**（`domain/conceptGraph.ts`）：`prerequisiteClosure`（传递闭包）、`childrenOf`、
  `interviewTargetsOf`、`nodeTypeOf`；coverage 的 blocked 判定改用闭包上溯；
  `expandWithPrerequisites` 沿闭包展开。
- **自适应选题消费新图**：deep-dive = 同主题更高难度 → 图声明的 deep_dive 目标 → 子概念；
  gap-probe 沿前置闭包回退到根因。
- **证据链**：`TopicStats.evidence`（questionId/score/at，最近 10 条），updateLearner 追加，
  掌握度可回溯到具体作答；localStorage v1 附加可选字段，向后兼容。
- 测试 70 例全过（含按新 DAG 更新的 gap-probe 断言）；typecheck/build 通过。

## 2026-08-23 · 自适应面试引擎 + 知识覆盖面（ADR-017）

- **自适应逐题模式**（`InterviewDefinition.adaptive`）：
  - `domain/adaptive.ts`：4 种迁移策略——纵向深挖 / 薄弱补查（降难度→退前置→同主题兜底）/ 横向扩展（概念图 related）/ 新方向；纯函数 + rng 注入 + 单测。
  - 引擎：`buildSession` 自适应时只组第一题；新增 `nextAdaptiveStep`（过滤已问 → 策略选题 → LLM 变体）；`pickQuestions/pickPrioritized` 支持 rng 注入。
  - UI：新增 `quiz/AdaptiveQuiz` 逐题视图（显示出题策略标签、提交即评分、可提前结束）；模拟面试页默认开启自适应；App 状态机支持逐题评分循环（grades 已实时填充时 doSubmit 跳过批量评估）。
- **知识图谱与覆盖面**：
  - 新增 `data/conceptGraph.json` + `domain/conceptGraph.ts`：topic 级 related/prerequisites 边；节点复用题库 topic，不给每题加元数据。
  - `computeCoverage`：按类目统计练过/掌握比例，识别 readyToLearn（前置已齐备）vs blocked（先补前置）。
  - ProgressPage 新增「知识覆盖面」卡片与「建议下一步」（薄弱优先 + 可学新主题及原因）。
  - 教练推荐升级：topicPriorities 经 `expandWithPrerequisites` 沿前置链展开（先补地基再攻难点）。
- 测试：新增 adaptive（6 例）+ conceptGraph（7 例），共 **70 例全过**；typecheck/build 通过。

## 2026-08-23 · Agentic AI 题库按能力维度扩充（46 题，总 100 题）

- 按能力维度重组 agentic-ai 题库（40 → 60 题），新增 topic 维度而非机械堆概念题：
  - **Scenario / System Design**（agentic-15~24）：知识库 Agent、GitHub 仓库问答、Research Agent、ESG 数据抽取、SQL 分析 Agent、金融多源研究、工具路由、长任务 checkpoint/resume、Multi-Agent 研究系统、企业级 Agent Platform。
  - **Debugging**（agentic-25~34）：重复调用、选错工具、非确定失败、context pollution、成功率回归定位、延迟放大、双重付款幂等、多 Agent 环路、表面正确检测、lab-to-prod 落差。全部 essay + rubric，主打 LLM 评分场景。
  - **Trade-off**（agentic-35~44）：Memory 存储选型、强/弱模型级联、Planner 确定性、Tool 候选集收窄、Multi-Agent 过度设计、trajectory 存储策略、RAG 放置位置、大窗口 vs Memory、system prompt 自改、CoT 展示策略。考察 senior/staff 级权衡论证。
  - **高级开放题**（agentic-45~52）：无标准答案，评分维度侧重 architecture + communication。
  - **客观题补充**（agentic-53~60）：从概念清单挑现有题库未覆盖的 8 题（workflow vs Agent、State 设计、Reflection vs retry、记忆≠历史、成本硬边界、注入危害差值、judge 三偏差、评估 vs 单测）转 single/multiple，保自动判分覆盖。
- **schema 不变**：expected_concepts 由 `rubric.required` 承担；新增评分维度（trade_off/practicality）需动四维评分引擎与 UI，作为独立变更另行决策（ADR 待补）。
- 校验：JSON 结构校验通过；54 例测试全过；typecheck 通过。

## 2026-08-23 · 题库扩充 + 代码展示/编辑组件（Shiki / Monaco）

- **题库 40 → 54 题**（基于 2026 面试趋势调研），全部复用现有 schema、不新增题型：
  - LLM：KV cache、MoE 总参/激活参数、解码带宽瓶颈优化（多选）、LoRA、RAG vs 微调 vs 提示工程选型（essay+rubric）、生产级 RAG 管线（多选）、手写 scaled dot-product attention（coding）。
  - Deep Learning：GQA 取代 MHA 的原因。NLP：BPE 分词与 "strawberry 数 r" 根因。
  - Agentic AI：MCP 协议、Agent 护栏（多选）、ReAct vs Plan-and-Execute（essay+rubric）、长任务上下文压缩。
- **代码组件边界确立**：只读高亮 = Shiki，可编辑/对比 = Monaco，不混用：
  - 新增 `components/common/CodeBlock`（Shiki 单例 highlighter + CSS 行号）、`RichText`（段落 + 围栏代码混合渲染）、`lib/codeFence.ts`（纯逻辑切分 + 8 例单测，容错未闭合围栏）。
  - 接入：题干/解析走 `RichText`；编程题参考答案与用户提交代码走 `CodeBlock`。
- **集成 Monaco Editor**：
  - 新增 `components/common/CodeEditor`（本地打包 monaco，不依赖 CDN；editor/json/ts worker 走 Vite `?worker`）。
  - 编程题作答由 TextArea 替换为懒加载 `CodeEditor`；结果页新增「用户代码 vs 参考答案」DiffEditor 对比（展开才挂载）。
- 测试共 **54 例全过**；typecheck/build 通过。

## 2026-08-23 · 产品转向 Training Coach（Learner Memory + 四页结构）

- 按用户评审，从"Quiz Configurator"转为"Training Coach"（ADR-015）：
  - **首屏 = 训练入口**：继续训练（按薄弱项）/ 快速训练（自动选题，10 分钟）/ 自定义训练（折叠的高级配置）。
  - **隐藏系统内部概念**：删除评分权重 UI；API Key 移入「设置」页，首页只显示 "AI ✓ / AI 未配置" 状态 chip，不再弹黄色大 Alert。
  - **Learner Memory**：新增 `domain/learner.ts`（纯逻辑）+ `storage/learner.ts`（localStorage v1 key）。结构化学习信号（topicStats 的 avgScore/mastery/trend/commonWeaknesses + 最近 50 条 SessionRecord），**不存对话原文**。
  - **Coach 抽题**：`InterviewDefinition.topicPriorities` + `domain/quiz.pickPrioritized`，薄弱主题（mastery<0.85 且均分<85）优先进入训练。
  - **结果页升级**：比上次得分 delta、亮点/待加强聚合、AI 训练建议（`recommendationText`）、按薄弱项继续训练。
  - **进度页**：总体分 + 主题掌握度条 + 最近趋势折线（内联 SVG）+ 需要关注 + 最近训练列表。
  - **面试页**：30 分钟限时模拟面试入口（追问式 loop 待 pi-agent-core 后续接入）。
- 组件：新增 `home/TrainingHome`、`progress/ProgressPage`、`interview/InterviewPage`、`settings/SettingsPanel`；删除 `SetupPanel`、`SettingsModal`（不向后兼容）。
- 测试：新增 `domain/learner.test.ts`（13 例），共 **46 例全过**；构建通过。

## 2026-08-23 · 接入 pi-agent-core（Interview Agent 层）+ Vitest 测试

- 采纳评审结论：pi-agent-core **只做 LLM Agent 层**，Quiz Domain 完全自写（ADR-012）：
  - 新增 `ai/interviewAgent.ts`：唯一依赖 `@earendil-works/pi-agent-core` 的地方，用 `Agent` + `subscribe(message_update→text_delta)` 做开放/编程题流式评分，`parseEvaluation` 结构化输出；`(model, streamFn)` 依赖注入便于测试。
  - 变体留在 `ai/variantGenerator.ts`（pi-ai one-shot，不走 Agent）；`ai/client.ts` 更名 `ai/models.ts`，`ai/piProvider.ts` 拆为 `variantGenerator.ts` + `provider.ts` 里的 `PiAIProvider` 委托实现。
  - 浏览器 local-first：pi-ai `streamSimple` 作 Agent `streamFn`，无后端代理。
  - 验证：pi-agent-core 不静态 import `pi-ai/compat`；`node:fs/crypto/...` externalize 成警告（只用 Agent 不触 harness 则不崩）；主 chunk 1.26 MB / 369 kB gzip。
- 评分升级（ADR-013）：四维更名为 正确性/完整性/架构/表达；`Question.rubric` 支持 `required` 要点 + 该题 `dimensions` 权重覆盖；题库 5 道开放/编程题补 rubric 样例。
- 测试基建（ADR-014）：引入 **Vitest**（`npm run test`），33 个用例覆盖 domain 抽题/判分/评分聚合/变体校验 + ai 提示词/解析纯函数 + **真实 Agent + mock streamFn** 集成；`*.test.ts` 从生产 tsc 排除。
- 删除：`src/ai/client.ts`、`src/ai/piProvider.ts`（被 models/variantGenerator 取代，不向后兼容）。

## 2026-08-23 · 架构边界重构（domain / ai / storage）

- 采纳评审建议，重构 LLM 变体 / 评分 / 题库模型的边界：
  - 目录拆分：`domain/`（纯逻辑）、`ai/`（LLMProvider 适配层，唯一依赖 pi-ai）、`storage/`、`lib/interviewEngine.ts` 编排；组件按 `quiz/result/settings` 分组。
  - 题库模型升级：每题加 `topic`/`tags`/`reference.concept`，`category` 改 slug；新增 `agentic-ai` 类目 10 题（现共 38 题）。
  - 变体安全：`validateVariant` 校验 + 失败回退原题，开放题 `referenceAnswer` 永不被 LLM 改写（ADR-006）。
  - LLM 藏在 `LLMProvider` 接口后，PiAIProvider 为唯一实现（ADR-007）。
  - 评分升级为四维 Rubric（正确性/完整性/深度/表达）（ADR-008）。
  - 删除旧 `lib/quiz.ts`、`lib/piClient.ts`、`lib/storage.ts` 及旧组件文件（不向后兼容）。

## 2026-08-23 · 文档分层重构

- 将 AGENTS.md 中的"常用命令""技术栈注意点"移除。
- 常用命令并入 `README.md` 的"常用命令"段。
- 技术栈注意点并入 `docs/ARCHITECTURE.md`。
- 新建 `docs/`：`ARCHITECTURE.md`（架构设计）、`DECISIONS.md`（ADR）、本文件（变更记录）。
- 动因：AGENTS.md 应保持"只放原则"，与 README / docs 去重（ADR-005）。

## 2026-08-23 · 引入 AGENTS.md（两大原则）

- 新增 `AGENTS.md`，固化两条大原则：不向后兼容（删死代码优先）、关键逻辑必须加测试（Vitest）。

## 2026-08-23 · Interview Engine 化改造

- 新增 `src/lib/interviewEngine.ts`：声明式 `InterviewDefinition` → `buildSession` → `evaluateAnswer` / `evaluateSession`。
- 类型系统升级：`EvaluationResult`（三维评分）、`coding` 编程题、`tags`、`evaluationCriteria` 等。
- `piClient.gradeEssay` 升级为 `evaluateOpenAnswer`，返回三维评分。
- 新增倒计时（`timeLimitSec`，到点自动交卷）。
- 题库 `questions.json` 增加 2 道 coding 题（softmax / 线性回归 BGD）。

## 2026-08-23 · 初始脚手架

- Vite + React 18 + TS + Ant Design 应用。
- 集成 `@earendil-works/pi-ai`（0.84.2）做题目变体与问答题评分。
- 题库 28 题 / 8 类别 / 单选择·多选·问答三类。
- 修正：antd 6 的 `Divider` 移除 `orientation`；pi-ai 浏览器密钥改用 `createModels({ credentials })`。
