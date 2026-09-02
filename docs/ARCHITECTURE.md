# 架构设计

## 总体形态

单页应用（SPA）：`Vite + React 19 + TypeScript + Ant Design`，五页（训练 / 进度 / 面试 / Agent 面试 / 设置）。LLM 能力通过 `@earendil-works/pi-ai` 在**浏览器内**直连（one-shot 调用），用户密钥存 `localStorage`，核心为纯静态 SPA、无独立业务后端。「Agent 面试」页由 `@earendil-works/pi-agent-core` 驱动（`src/agent/`），作为并行运行时保留并持续建设，定位为未来正式方向（ADR-034）。规则式「模拟面试」与训练流程仍走确定性引擎（ADR-017）。仅 Cloudflare Workers AI provider 需要同源代理：本地开发由 `server/index.js`（经 Vite dev proxy 转发）提供，生产由 `worker/index.ts`（Cloudflare Worker）提供，二者均不含业务逻辑（详见 `DEPLOYMENT.md`）。**代理安全（ADR-060）**：两者在 `new URL(stripped, base)` 之后硬性校验 `hostname === 'api.cloudflare.com' && protocol === 'https:'`，拒绝协议相对（`//evil.com`）或绝对 URL 改变目标主机——否则会变成对任意主机的开放中继并泄露 `Authorization`，违规请求直接返回 400。

**产品定位（ADR-015）**：个人 AI 面试教练，不是题库测试配置器。首页是训练入口（继续/快速/自定义），系统内部概念（评分权重、API Key 状态）不暴露给用户；每次训练都会沉淀 Learner Memory，并据此推荐下一次训练。

**核心原则**：题库是 source of truth，LLM 是 enhancement layer（不是题库本身）。变体的答案索引永远直接取自原题（程序保证不被模型覆盖），LLM 只负责改写题干/选项/场景的**表达**——但改写后选项是否仍逐项真假成立，仅由结构校验与抗暗示兜底，**语义等价不在线验证**（详见下方「变体安全边界」）。

> **变体安全边界（勿高估）**：「答案 key 来自原题」保证的是**程序层面**答案不可被模型覆盖，它**不**保证改写后的题干/选项在语义上仍等价于原题。`validateVariant` 只查结构项与抗暗示（选项去重、长度泄题、指代自包含、形态对齐），是**漂移探测器**而非语义等价性证明——语义走偏（换了条件、引入新前提、干扰项不再错误）的变体可以完整通过全部硬门槛。因此变体只用于**同格内扩充题量**，不得用于跨 `topic × angle` 补覆盖缺口；离线量产须先叠加超采 + 质量 challenger（见 `ACTION_CHECKLIST.md` A-10）。

## 统一交互入口（Phase 1–5 已实施，ADR-061/062，plan0831_4 融合收敛）

Copilot Chat 作为统一入口：`Question Mode → QuestionCapability`，`Interview Mode → Adaptive/Agent Runtime`，共享 `Question/Evaluation/Learner/ConversationSession` 能力；`ConversationSession`（`context+messages+questions+answers+evaluations`）统一持久化（`localStorage CONVERSATION_SESSION_KEY`），`end_interview` 时一次性聚合为单 `SessionRecord` 落库，不再每题一 record。`handleSend` 经 `routeUserMessage` 三通道分流（ADR-064）：`command`（5 个确定性训练动作，无 LLM）→ `answer`（提交作答）→ `copilot`（解释/提示/比较/追问/知识问答，零副作用）；检索在 `copilot.ts` 内先于 LLM 完成（ADR-063），失败只降级为无依据问答。`buildCopilotSystemPrompt` 已抽至 `application/conversation/copilotPrompt.ts`（含 §8 六约束）。训练和 Agent 仍各有 Hook/runtime，但不再三套行为源。

目标架构为：

```text
Conversation UI → Conversation Controller → routeUserMessage（三通道分流：command / answer / copilot）
                                      ↓
       Question / Evaluation / Interview / Learner Capabilities
                                      ↓
                 Question Bank / Domain / Storage
                                      ↑
                 Agent Runtime（能力消费者）
```

设计约束：LLM 只识别经 schema 校验的结构化 intent；出题、评分、session 状态和 Learner 写入由 application capabilities 确定性执行。采用 adapter-first 分阶段实施：先抽 capability，再引入 `ConversationContext` 和 question mode，最后评估统一 `LearningSession`；不一次性重写现有 Hook、Agent runtime 或 IndexedDB。详见 `docs/CONVERSATION_ARCHITECTURE.md` 与根目录 `ACTION_CHECKLIST.md`。

## 分层

```
schemas/       数据契约层（Zod 4）：runtime validation + TypeScript 类型推导（单源）
  common.ts      共享枚举（difficulty / providerId / angle 等，`export type X = z.infer<typeof xSchema>`）
  question.ts    Question 形状（Zod 负责“长什么样”，domain 负责“是否合理”）
  knowledge.ts   KnowledgeNode 形状
  conceptGraph.ts ConceptGraph 形状（只验结构，DAG 仍由 domain 校验）
  ai-config.ts   AIConfig 形状（校验结构，业务不变量由 isEntryValid / 去重等保障）
  evaluation.ts  LLM 输出形状（只验 JSON 形状，overall 仍由 domain 聚合）
  types.ts       跨层行为契约与轻量聚合类型的单一出处（`QuestionBank` / `AnswerValue` / `LLMProvider` / `CompleteFn` / `GeneratedVariant` / `VariantCandidate` / `QuestionBlueprint` 等）——不再 re-export 数据形状类型，后者直接从 `schemas/*` 导入
  errors.ts      统一 ZodError → path/message 格式化（bracket 记法 providers[0].id）
  questionBank / knowledgeMap / conceptGraph 的加载期校验均在此层完成；
  详见「数据契约与运行时校验」小节（ADR-033）

domain/        纯 TypeScript 逻辑，不依赖 React / 网络（全部有单测覆盖）
  categories.ts  类目 slug → 中文标签
  knowledge/     知识点查询 + 结构化知识检索（Structured Knowledge RAG，ADR-063）
    nodes.ts       knowledgeById / requiredPointsFor（评分要点回退）
                   / knowledgeCoverage（P0 覆盖率与题库建设 gap 路线图）
    types.ts       KnowledgeDocument / Hit / Evidence 契约；RetrievalScope（current_question/
                   topic/knowledge/global）、RetrievalMode（answer/explain/hint/quiz）、混合权重
    documents.ts   投影层：KnowledgeNode / Question → 统一 KnowledgeDocument（knowledge/
                   question/misconception/concept），真值隔离进 `sensitiveText`
    index.ts       内存倒排索引 + BM25（CJK 单字 + bigram、拉丁串整体成词），纯函数
    graph.ts       Concept Graph 1-hop 扩展（seed 1.0 / prerequisite 0.8 / related 0.6 /
                   dependent 0.45）——同一张图同时服务 adaptive selection 与 retrieval
    retrieve.ts    searchKnowledge：metadata + lexical + graph 混合评分
                   （0.40/0.25/0.20，semantic 0.15 未接入前按比例回填）
  conceptGraph.ts 知识关系图（prerequisite/related/closure/topo）——只回答
                 "知识之间是什么关系"，不持有任何学习状态与掌握度策略（ADR-030）；
                 graphlib 数据结构不外泄，对外只有 topic 字符串
  quiz.ts        抽题（Fisher–Yates）、availableFormats、pickPrioritized（薄弱主题优先）
                 / planComposition（抽题 + 形态配额：开放 ≈ floor(count*0.3)，ADR-027）
  evaluation.ts  评分聚合（rubric 权重）、选择题确定性判分、DEFAULT_RUBRIC
  variant.ts     变体校验（validateVariant）+ 落地（applyVariant）
  learner.ts     Learner Memory：updateLearner / sessionFromQuiz / recommendWeakTopics
                 / buildCoachDefinition / recommendationText（Training Coach 数据核心）；
                 掌握度策略也在此（ADR-030）：WEAK_* 阈值、isMastered/isAttempted、
                 coverage、expandWithPrerequisites——mastery=avgScore/100 是当前简化
                 启发式而非能力度量，trend/attempts/evidence 各自承担信号语义
  coverage.ts    题库覆盖矩阵（topic × angle）+ 补题建议 + 报告格式化（纯函数，
                 题目/知识点由调用方注入，浏览器与 CLI 共用；ADR-032 慢速生产管线度量端）
  blueprint.ts   题目蓝图：缺口格→受约束考察目标（purpose/expectedConcepts 取自
                 知识节点）+ 同主题变体候选检索 + 成题一致性校验（ADR-032 管线 ③ 步；
                 注意其对 coverage.ts 的运行时导入带 .ts 扩展名——Node 原生 TS 直跑要求，
                 tsc 由 allowImportingTsExtensions 放行）

ai/            LLM 适配层，应用只依赖 LLMProvider 接口（实现仅两套：Chrome / PiAI；
               多引擎按 AIConfig.providers 顺序组成降级链，ADR-023）
   pi.ts             pi-ai 底层封装（buildModels / callLLM / extractJSON / piUsageToLLMUsage；
                     local 在此路由到 createProvider 注册的自定义 provider，ADR-022）。
                     callLLM 支持 opts（jsonMode / temperature / onUsage）：jsonMode 时经
                     samplingParams 透传 response_format=json_object（DeepSeek 原生 JSON 模式，
                     免去偶发非 JSON 被 extractJSON 抛错触发整段重生成）；onUsage 回传归一化用量。
   capabilities.ts   Provider 能力协商（P2⑦）：LLMCapabilities { jsonMode, toolCalls, thinking,
                     contextCaching, multiRound } + capabilitiesFor(entry) 查表。业务层只问「能力有没有」，
                     不写死 provider；新增引擎只需此处登记，callLLM / provider 无需改动。
    chrome.ts         Chrome Prompt API 封装（chromeAvailability / chromeComplete）+ ChromeAIExecutor
                      （并发上限 + 单次超时 + AbortSignal 取消 + 失败重试 + session 自动销毁，
                      核心机制见下「Chrome 内置 AI 的并发与卡死」，ADR-021）
   local.ts          本地 OpenAI 兼容服务 provider 构建（默认 Unsloth 127.0.0.1:8888/v1）
   variant.ts        变体生成（one-shot 重写题干；complete 由 provider 注入，不感知底层）。
                     VARIANT_SYSTEM 为稳定契约前缀（v2 分层：角色→知识契约不变量→变化维度→生成规则→
                     distractor 规则→抗暗示→静默验证→JSON 输出契约），专为 Flash 类模型设计，把
                     「真正不同（认知角度/reasoning path）/ requiredConcepts 必须被实际考察 / 答案适用条件
                     不变量 / 优先用有明确错因的 plausible distractor」写成显式规则；动态数据只在 buildUser
                     （知识契约 + 原题 + 变体目标），便于 DeepSeek KV Cache 命中。
   evaluate.ts       开放形态评分（one-shot 四维评分；overall 由 domain 聚合；同上注入 complete）。
                     EVAL_SYSTEM 为稳定契约前缀（角色 + 判断标准 + 四维原则 + 责任边界「LLM 不计算
                     overall」+ JSON 输出契约），动态数据只在 buildEvalUser。
   questionChallenger.ts  质询（one-shot 结构化 JSON；QUESTION_CHALLENGER_SYSTEM 同样为稳定契约前缀）。
   usageTelemetry.ts KV Cache 命中遥测（P1④）：devUsageLogger 仅 import.meta.env.DEV 打印
                     in/out/token 与 cacheHit/cacheMiss，用于验证 stable-prefix prompt 是否命中缓存。
   provider.ts       LLMProvider 工厂 + isEntryValid/isConfigValid
                     + ChromeAIProvider / PiAIProvider / FallbackProvider（降级链，ADR-023）。
                     createLLMProvider(config, onUsage?) 把用量回调透传给每个 PiAIProvider 通道。

storage/       本地持久化（IndexedDB + localStorage；两者均为不可信边界，一律经 Zod 校验）
  db.ts         Dexie 数据库 schema（version 4）：learner 单例表 + sessions 表（startedAt/overall/*topics 索引）+ errorLog 诊断表（scope/createdAt 索引，记录 Copilot/引擎等调用失败的结构化上下文，与业务数据隔离，fire-and-forget 不阻塞主流程）+ agentSessions 表（进行中 Agent 面试草稿：session/messages/questions/entryId/profile 快照，刷新/重开可续面；只存重建所需纯数据，不存题库、存 entryId 而非 apiKey）
  settings.ts   LLM 配置（localStorage，`aiConfigSchema` 形状 + `isEntryValid`/去重等不变量）——小 KV 配置保留 localStorage（甜点区）
  learner.ts    LearnerProfile / SessionRecord（IndexedDB via Dexie）：画像存单例表（剔除 sessions），会话历史拆分到 sessions 表；不读取/迁移任何旧 localStorage 数据，直接以空画像起步

application/
  interviewEngine.ts  应用服务：buildSession / nextAdaptiveStep / evaluateAnswer / evaluateSession
  sessionEvaluator.ts  双引擎共享衔接层：isAnswerEmpty / effectiveFormats /
                        evaluateSessionQuestion；选择题判分与开放题 LLM 评分的统一入口
  conversation/        统一交互入口的能力层（ADR-061/062/063/064）
    commandDetector.ts     命令检测器（ADR-064）：仅 5 个确定性训练动作，无 LLM 意图分类
    copilot.ts             Copilot 通道（ADR-064）：runCopilotTurn = 检索→组装→LLM→引用，零副作用
    conversationSession.ts ConversationSession 聚合与 localStorage 持久化
    questionCapability.ts  出题；evaluationCapability.ts 评分；learnerCapability.ts 画像
    interviewCapability.ts Chat × Agent runtime 的衔接
    copilotPrompt.ts       buildCopilotSystemPrompt（纯函数，UI 不拼 prompt；含 ADR-064 §8 六约束）
    knowledgeCapability.ts 知识检索的应用层：query planner（scope / mode 由确定性规则决定）、
                           evidence → prompt 片段、引用列表

agent/         Agent 面试运行时（pi-agent-core，ADR-034）：与确定性 Engine 并行的第二运行时
   interviewAgent.ts  Agent 编排（observe → decide → tool 循环；停止条件 / 工具守卫）
   tools.ts           AgentTool 薄包装 domain/learner/evaluation/ai——确定性工作全部走工具，
                      Agent 只做"不确定的决策"（选题/追问/收尾）；评分不归 Agent
   prompt.ts          系统提示词；runtime.ts 事件流装配；types.ts 会话与事件类型
                      （InterviewAgentSession，App 持有、工具读写引用共享）
   **生命周期（ADR-060）**：`Agent` 构造显式 `toolExecution: 'sequential'`（共享 `session` 状态，防并行工具竞态）；
                      `dispose()` 为「清看门狗 → `agent.abort()` → unsubscribe」的真实释放；`useAgentInterview.finalize()`
                      由 `finalizedRef` 幂等守卫保证 `onComplete` 只落库一次；`getQuestion` 经 `isDelivered` 守门不重复出题；
                      `parseEvaluation` 遇不可解析的模型输出抛 `EvaluationParseError`，上层记为 `null`（跳过评分）而非 0 分。
   持久化复用既有管线：sessionRecordFromAgent → updateLearner + saveLearner，
   与训练/模拟面试写入同一份 LearnerProfile

lib/
  codeFence.ts        ``` 围栏切分（纯逻辑 + 单测，容错未闭合围栏）

hooks/
  useTrainingSession.ts  训练会话状态机（组卷 → 作答 → 自适应逐题评分选下一题 → 提交 →
                          落库 Learner 画像），从 `App.tsx` 抽出；`App.tsx` 只保留
                          路由/布局/导航与 JSX 渲染，不持有业务状态
  useAgentInterview.ts   Agent 面试会话状态机（从 `AgentInterviewPage` 抽出，提升到 App 层：
                          切 tab 不丢进行中的会话，Agent 在后台继续跑，restart 才 dispose）
  useSettingsDraft.ts     设置页「未保存草稿」编辑态（draft/text/promptDraft 及各字段更新器），
                          提升到 App 层：编辑中途切到其它 tab 再切回，未保存的改动不丢

components/
  common/CodeBlock.tsx     只读代码高亮（Shiki，单例 highlighter + CSS 行号）
  common/RichText.tsx      文本段落 + 围栏代码块混合渲染
  common/CodeEditor.tsx    Monaco 编辑器（CodeEditor 作答 / CodeDiff 对比，懒加载）
  quiz/AdaptiveQuiz.tsx    自适应模式逐题视图（提交即评分 → 策略选下一题）
  home/TrainingHome.tsx         训练入口（继续/快速/自定义，隐藏系统内部配置）
  quiz/QuestionCard.tsx         单题作答卡片
  result/ResultPanel.tsx        成绩 + 对比上次 + 强弱项 + AI 建议 + 继续训练
  progress/ProgressPage.tsx     掌握度条 + 趋势折线 + 需要关注 + 最近训练
  interview/InterviewPage.tsx   30 分钟限时模拟面试入口
  settings/SettingsPanel.tsx    AI 引擎设置（Monaco JSON 编辑器直接编辑 config.json：
                                 providers 数组顺序即降级链优先级；generateOpenQuestions
                                 门控开放题生成，默认 false（ADR-031）；保存时整体校验，
                                 错误定位到 providers[i]；chrome 可用性状态展示，ADR-023/ADR-025）

data/questions/       题库（用户数据契约，按 topic 一文件：questions/<topic>.json，共 77 文件 /
                         1317 题；topic ∈ taxonomy 的二级主题，如 transformer / rag /
                       tool-calling，与 src/data/taxonomy.ts 的骨架一一对应）。每题
                       `category` = 所属 topic slug（与文件名一致），`topic` = 知识节点 id，
                       外加 `tags` / 可选 `rubric` / `angle`（主考察角度，覆盖矩阵用，
                       ADR-032/037）。6 大能力域（ai-engineering / llm / llm-applications /
                       agent-engineering / ai-systems / ai-security）是 **taxonomy 逻辑分组**
                       （topic → domain 映射见 `taxonomy.domainOfTopic`），不是物理文件单位；
                       UI 分类标签由 `domain/categories.ts` 合并 DOMAIN_LABELS + TOPIC_LABELS。
                       存量 1317 题：约 1237 题同时携带 choice 与 open 双形态（ADR-027）、80 题仅
                       choice（open 形态统一由双形态题的 open 字段承载，ADR-027）。题目角度
                       候选由 taxonomy.ANGLE_WHITELIST（topic→角度子集）约束，节点未声明
                       angles 时回退到所属 topic 白名单（ADR-039）。
data/questionBank.ts  题库装配（import.meta.glob eager 合并 + Zod 形状校验；刻意不建索引/数据库层，
                       规模需要时再加动态 import + 构建期 question-index；失败时抛错并定位到 文件[下标]）
data/conceptGraph.json  知识图谱（两类有向边 prerequisite/related；
                         prerequisite 构成基础→进阶 DAG；加载期先过 Zod 形状校验，再走 isAcyclic DAG 校验）
data/knowledge/        知识点层 = Concept（ADR-029 / ADR-038）。按文件拆分（文件名沿用历史
                          slug，16 文件：dl-fundamentals / llm-architecture / training / inference /
                          ml-theory / gnn-theory / nmf-theory 等，共 123 节点，含 ml-foundations 11 节点、GNN 6 节点与矩阵/主题建模 4 节点），但节点内部不再用文件 slug 当分类——
                        每个节点声明 `area`（6 大能力域之一：ai-engineering / llm /
                        llm-applications / agent-engineering / ai-systems / ai-security，
                        骨架见 src/data/taxonomy.ts 的 TAXONOMY）与 `topic`（域下二级主题，
                        如 Inference / RAG / Agents）。由此构成 **Domain → Topic →
                        Concept(id)** 三级路径；题目再经 `subtopic`（Concept→Subtopic）与
                        `angle`（definition→…→system-design 等 10 角度，见 ADR-037）落到
                        **Concept → Subtopic → Angle** 的考察维度。
                        知识点是一等公民、题目只是它的 View：节点 id = topic slug
                        （与题目 / conceptGraph / Learner Memory 同一 join key），携带四类
                        "修饰素材"——summary（变体与复盘锚点）/ required（评分必须要点，
                        题目未自带 rubric.required 时回退注入）/ misconceptions（干扰项、
                        追问与 gap 分析素材）/ angles（definition→mechanism→calculation→
                        tradeoff→scenario→system-design 的出题角度梯度）。节点必须有题目
                        支撑（无悬空节点，测试强制）；gaps 机制输出下一步该补的题
data/knowledgeMap.ts   知识点装配（import.meta.glob eager 合并 + Zod 形状校验，同 questionBank 模式）
data/courses/          课程题库尚未实现。课程需求出现前不创建目录、注册来源或课程专用 schema；
                        首个真实课程接入时再设计独立来源与数据管线，避免维护空接缝。
scripts/question-coverage.ts  覆盖矩阵 CLI（npm run question:coverage）：fs 直读
                        questions/ 与 knowledge/ JSON（不走 import.meta.glob），
                        调 domain/coverage 纯函数输出矩阵与补题建议。Node 24+ 原生
                        运行 TS，无需构建；相对导入必须带 .ts 扩展名
scripts/question-blueprint.ts  蓝图 CLI（npm run question:blueprint -- N）：把前 N 个
                        缺口格输出为蓝图 JSON（含变体候选 id），作为补题/
                        受约束生成的结构化输入
scripts/add-question.ts     题目导入闸门（npm run question:add）：复用 Zod 解析，
                             检查 ID/题干重复、topic/angle、选项和 coverage 增量；
                             默认只检查，显式 --write 才写入批次文件
analysis/question_audit.py   Python 标准库离线审计（npm run question:audit）：输出题库
                             分布、覆盖率、重复/占位/答案问题与时效元数据告警；
                             Python 只做分析，不复制 TypeScript schema
analysis/question_analysis.py Python 离线分析：pandas/NumPy 统计、rapidfuzz 近重复、
                             scikit-learn TF-IDF/聚类/难度信号、NetworkX 图分析；
                             --semantic 使用仓库内 ARM64 ONNX INT8 embedding 模型
                             做语义重复与 embedding 聚类，不参与线上运行时
analysis/models/              Git LFS 管理的本地分析模型；当前仅 check in
                             paraphrase-multilingual-MiniLM-L12-v2 的 ONNX INT8 权重
types.ts              跨层行为契约（LLMProvider / QuestionBank / AnswerValue 等），数据形状类型直接用 schemas/*
```

依赖方向：`components → application(interviewEngine) → domain + ai`；Agent 面试页 `components/agent → agent/`（`agent → domain + ai + types`，复用评分与持久化管线，不绕过 application 语义）；`ai → domain`（复用评分聚合等纯函数）；`domain` 不依赖 React、不 import 任何 LLM 库；`schemas` 不依赖 domain（纯数据契约），`domain` 也不依赖 `schemas`——仅在装配边界（questionBank / knowledgeMap / conceptGraph / settings / evaluate）消费校验结果，内部逻辑不感知 Zod。

**ai → domain 的边界约定**：`ai` 只允许依赖 domain 的**纯计算函数**（`evaluation.aggregateOverall`、`provider.mergeQuestionRubric`、variant 校验等），
不得依赖业务流程模块（`learner` / `adaptive` / `quiz`）——AI 层只负责"生成/评价语言内容"，不理解产品业务流。

**schemas → domain 的边界约定（ADR-033）**：Zod 只回答“数据长什么样”（类型/枚举/必填/数组长度），domain 回答“数据之间是否合理”（单选题恰好一个答案、前置不能成环、topic 必须有知识点支撑、provider 去重与完整性等）。校验分两层：`schemas/*.ts` 做形状，`domain/*.test.ts` 与 `data/bank.test.ts` 做不变量；前者 fail-fast 于加载期，后者保障业务语义。

## 核心数据流（主架构）

产品核心只有这一条闭环，其余（LLM Provider / ConceptGraph / Knowledge 元数据 / Storage / UI）都是支撑：

```
Question Bank（知识点的 assessment views）
      │
      ▼
Knowledge（学习对象，一等公民）
      │
      ▼
Interview Definition ──────┐
      │                    │ <── 上一次的 Recommendation（Learner Memory 驱动）
      ▼                    │
Interview Engine           │
      │                    │
      ▼                    │
Session（SessionQuestion 快照，不变量：保存"当时看到的内容"，
      │                     题库后续修改不影响历史回放）
      ▼
Answer → Evaluation → Learner Signal
      │
      ▼
Learner Profile
      │
      └──► Recommendation ─┘
```

四条核心原则：

1. **Knowledge 是中心，Question 是 View。** 一个知识点可派生 MCQ / 开放题 /
   计算题 / 场景题 / System Design / 追问等多种 view；扩展时新增 view 类型，
   不往 Question 上堆职责。
2. **InterviewEngine 掌管业务流程。** 出题、判分路由、自适应推进都在引擎。
3. **Domain 决策，LLM 只增强。** LLMProvider 是 one-shot 语言增强接口
   （generateVariant / evaluateOpenAnswer），永不扩展为推荐/规划/学习者分析类接口。
4. **Learner Memory 驱动下一次训练。** 掌握度启发式 + 薄弱项推荐构成闭环；
   图只回答关系，learner 回答掌握状态（ADR-030）。

## 结构化知识检索（Structured Knowledge RAG，ADR-063）

Copilot 此前是 prompt-only：只把「当前题目 + 训练信息 + 薄弱主题」拼进 system prompt 后直连 LLM，从未真正检索知识库。Phase 1 增加一层检索能力，**不引入 embedding / 向量库 / 外部依赖**。

```text
KnowledgeNode ┐
Question      ┼→ 投影（documents.ts）→ KnowledgeDocument ─┐
ConceptGraph  ┘                                          │
                                        ┌────────────────┘
                                        ↓
                              内存倒排索引（index.ts, BM25）
                                        ↓
User Query → query planner（scope / mode，确定性规则）
                                        ↓
                    metadata 0.25 + lexical 0.40 + graph 0.20
                                        ↓
                              top 5 evidence（retrieve.ts）
                                        ↓
               knowledgeCapability → copilotPrompt → LLM → 回答 + 依据
```

四条硬规则：

1. **投影而非切块**：`KnowledgeNode`（summary/required/misconceptions/angles）与 `Question`（stem/options/explanation）投影成统一的 `KnowledgeDocument`，保留 metadata 供精确过滤；不把 JSON 当 chunk 直接喂。
2. **真值隔离在检索层**：`explanation / choice.answer / referenceAnswer` 进入 `sensitiveText`，`renderDocument(doc, mode)` 硬裁剪——`hint` 只给知识骨架与误解，`quiz` 只给题干。检索不能绕过 assessment boundary。
3. **scope / mode 由确定性规则决定**，不额外消耗一次 LLM 调用：检索范围与答案可见性是安全边界，不能交给模型判断。`explain` 只在 scope=`current_question` 时出现（用户明确在谈那道题、或对其求提示/求详细解读）；其余知识问题默认走安全模式 `hint`，不暴露题库真值（`answer`/`explain` 才开真值闸门）。
4. **Question 是 Knowledge 的 evidence 而非主知识源**：`knowledge` scope 排除题目；其余 scope 题目证据最多 2 个槽位（`current_question` / `quiz` 放开）。实测不加限制时 top 5 全是题目，模型会「从题库答案总结答案」。

Concept Graph 由此从「出题算法辅助结构」升级为 **Knowledge Backbone**：同一张图（1-hop：prerequisite 0.8 / related 0.6 / dependent 0.45）同时驱动 adaptive selection 与 knowledge retrieval。

Phase 2/3 未做（有意推迟）：embedding 语义通道（权重 0.15 已预留，未接入时按比例回填）、reranking、query expansion、multi-hop；`KnowledgeNode.keyIdeas / tradeoffs` 字段扩展；Learner memory 参与检索排序；MCP 暴露 Knowledge Base。

## 自适应面试引擎 + 知识覆盖面（ADR-017）

核心思想：**下一道题不是随机抽的，而是一次决策**。题库只是素材库，面试由 Interview State 驱动。

```
作答信号 AnswerSignal (topic/score/difficulty)
        ↓ domain/adaptive.decideStrategy()
迁移策略 Strategy
  ├─ deep-dive   纵向深挖：同主题更高难度继续问
  ├─ gap-probe   薄弱补查：降难度 → 回退前置主题 → 同主题兜底
  ├─ broaden     横向扩展：切换概念图 related 主题
  └─ move-on     新方向：排除刚答主题，薄弱画像优先
        ↓ domain/adaptive.pickNextAdaptive()（纯函数，rng 可注入）
下一题 → 引擎 nextAdaptiveStep() 过滤已问 + LLM 变体 → 追加进会话
```

- **模式开关**：`InterviewDefinition.adaptive`。开启后 `buildSession` 只组第一题；UI 走 `AdaptiveQuiz`
  逐题视图——提交即评分（选择题确定性判分 / 开放题 LLM），随后引擎选下一题追加。
- **知识图谱**：`domain/conceptGraph.ts` + `data/conceptGraph.json`，图操作委托
  `@dagrejs/graphlib`（限定在 conceptGraph 模块内，不外溢为架构核心）。图数据只有两类有向边：
  `prerequisite`（基础→进阶 DAG，加载期 `isAcyclic` 校验、`topsort` 学习顺序、闭包上溯）
  与 `related`（无向语义，双向遍历）。边复用题库 `topic` 字段；图是模块级单例，
  公开 API（prerequisiteClosure / relatedOf / expandWithPrerequisites / topoRankOf）不要求传 graph 参数。
  职责边界：conceptGraph 只回答"知识之间是什么关系"；掌握判定 isMastered/isAttempted
  与薄弱阈值 WEAK_* 也定义在此（单一出处），但**学习策略**（coverage / 建议下一学什么）
  归 `domain/learner.ts`。
- **覆盖面地图**：`learner.computeCoverage()` 按类目统计 练过/掌握 的 topic 比例；
  blocked 判定沿前置闭包上溯（根因未掌握则高级主题被标记为"先补前置"）。
  ProgressPage 展示类目覆盖条 + `learner.suggestNextTopics()` 学习建议。
- **证据链**：`TopicStats.evidence`（questionId/score/at，最近 10 条）让掌握度可回溯到具体作答，
  而非裸分数；updateLearner 每次会话追加。
- **教练推荐升级**：`buildCoachDefinition` 的 topicPriorities 经
  `expandWithPrerequisites()` 沿前置闭包展开（先补地基再攻难点）。
- **边界（Future/Experimental，非当前架构）**：Contradiction Probe 与 LLM 策略 Agent 仅作为远景记录——
  确定性策略已满足当前需求；届时 LLM 只决定策略、仍从结构化题池选题。

## 代码展示与编辑（Shiki 只读 / Monaco 可编辑）

边界（刻意分开，不要混用）：

| 场景 | 组件 | 实现 |
| --- | --- | --- |
| 题干/解析中的代码片段、参考答案 | `common/CodeBlock` | Shiki 只读高亮 + 行号 |
| 含 ``` 围栏的富文本 | `common/RichText` | `lib/codeFence` 切分后分段渲染 |
| 编程题作答 | `common/CodeEditor` | Monaco Editor（懒加载 chunk，gzip ≈325KB） |
| 用户代码 vs 参考答案对比 | `common/CodeEditor.CodeDiff` | Monaco DiffEditor（Collapse 展开才挂载） |

- **Shiki**：`createHighlighter` 单例按需注册语言（python/js/ts/sql/json/bash）；未知语言回退 `text`；高亮就绪前先渲染转义纯文本兜底。
- **Monaco**：本地打包（`loader.config({ monaco })`），不依赖 CDN；worker 用 Vite `?worker` 打包（editor/json/ts）。整块懒加载，只在出现编程题时下载。
- **演进预留**：Phase 3（代码执行/沙箱/测试用例/AI Code Review）在 CodeDiff 基础上扩展。

## Interview Engine

```
数据模型（ADR-027）：Question 是**知识对象**（题干/解析/formats 不变），
SessionQuestion 是**会话实例**（同一道题本次以哪种形态呈现）。组卷 = 抽题 + 分配形态。

```
InterviewDefinition  (声明式：categories / difficulties / formats('choice'|'open')
                       / count / useAI / scoringRubric / timeLimitSec / evaluationCriteria)
        │
        ↓  interviewEngine.buildSession()
   过滤题池（具备任一允许形态即入池）
   → planComposition（抽题 + 形态配额：开放 ≈ floor(count*0.3)，超额与池内未抽中
     的可选择题原位换题，无题可换则裁剪；整池单形态时跳过配比）
   → finalizeQuestion（LLM 变体快照，失败回退原题）
   InterviewSession.questions: SessionQuestion[]（仅含「题目快照 question + 本次呈现形态 format」，不含答案与评分）
        │   注：用户作答与评分不挂在 SessionQuestion 上，而分别存于会话运行态的 answers / evaluations（按 questionId 索引），
        │   最终由 sessionFromQuiz 聚合进 LearnerProfile。
        │
        ↓  evaluateAnswer() / evaluateSession()
   EvaluationResult  (overall 0-100 + 四维 dimensions + levels 0-4 序级 + evidence + strengths/gaps/missingConcepts/feedback)
```

- 选择形态：`gradeChoice(cf, selected)` 确定性判分（选中集合 == 正确答案集合，顺序无关）。
- 开放形态：走 `LLMProvider.evaluateOpenAnswer(question, open, answer)`，
  `useAI=false` 或无有效 provider 时返回 null（UI 提示未评分）——useAI 开关同时门控变体出题与开放形态评分。
- 自适应模式无组卷配额：双形态可用时按 p(open)=0.3 加权随机分配，体验与普通会话的 7:3 一致。
- 题目级 `rubric.required` 会注入评分提示、`rubric.dimensions` 覆盖全局权重
  （合并逻辑在 `ai/provider.mergeQuestionRubric`，纯函数有测试）。

## LLM 能力边界（ADR-019 / ADR-021 / ADR-023 / ADR-034）

一句话：**Domain 决策是核心，LLM 只是插件；Agent 只做"不确定的决策"，确定性工作全部走工具。**

```
Quiz / 训练 / 规则式模拟面试 ──→ createLLMProvider(AIConfig)：启用且合法的引擎按配置顺序串成链（ADR-023）
                        │   单通道 → 直接返回实现；多通道 → FallbackProvider
                        │   （调用失败/引擎不可用自动切换下一引擎，全败才抛错由上层兜底）
                        ├── ChromeAIProvider → ai/chrome.ts（Prompt API，本地模型，免密钥）
                        └── PiAIProvider(entry) → ai/pi.ts（pi-ai one-shot，统一入口）
                              ├── 云端：deepseek / openrouter / google(Gemini) / cloudflare-workers-ai
                              ├── 本地 OpenAI 兼容服务（ADR-022）：buildModels 路由到
                              │   ai/local.ts 的 createProvider 注册（默认 Unsloth 8888/v1）
                              ├── ai/variant.ts    变体 = 只重写题干
                              └── ai/evaluate.ts   开放题评分 = 四维 dimensions
                                    ↓ overall 由 domain/aggregateOverall 计算
Agent 面试（第 5 页）──→ src/agent/ + pi-agent-core：observe → decide → tool 循环（ADR-034）
                        选题/评分/读画像经 tools.ts 薄包装既有能力，Agent 不自己打分；
                        题目正文不进 Agent 上下文，呈现归 UI（ADR-053）；
                        单 provider 起步，不接 FallbackProvider
```

- 训练与规则式面试的 LLM 调用都是 one-shot 结构化生成，无状态；Agent 面试的
  多轮决策循环由 `src/agent/interviewAgent.ts` 驱动，是唯一的有状态调用方。
- **题目呈现的职责边界（ADR-053）**：`Agent = 决策 / 编排 / 解释`，`UI = 题目呈现`。
  `getQuestion` 的 `details` 恒为 `{ id, format, matchedBy }`——**题干 / 选项 / 答案 / 解析一律不进
  Agent 上下文**，真实题干由 `session.currentQuestion`（`AgentInterviewPage.tsx:168-172`）渲染。
  因此 prompt 禁止 Agent 重新生成、改写或完整复述题干与选项，只说考察方向 / 操作提示 / 评估反馈；
  但**允许简短引用关键概念**（如「你解释了 KV Cache 的作用，但没说明它为什么能减少重复计算」）——
  禁令针对「重新生成」，不扩大到「提及题目内容」。
  - 为什么不给 `getQuestion` 补 `question` / `options`：补数据会让 Agent 在**选题阶段**拿到
    `answer` / `explanation` 等它不需要的数据，还扩大 prompt injection 与数据污染面；
    划清职责优于补齐上下文。
  - **改动面是 5 处措辞而非一处**：`prompt.ts` 的 §你的职责 / §题目呈现 / §工具调用铁律 / 开场指令，
    加 `tools.ts` 中 `getQuestion` 的 description 与结果正文、`searchQuestions` 的 `nextStep`。
    留任何一处，模型都仍会收到「呈现题目」的指令——其中工具结果正文那句紧跟在返回之后，是最直接的触发器。
  - 修复前 prompt 要求模型「把题干 + 选项清晰表述给用户」，而它上下文里只有 id
    （`深度审查报告.md` C1 / P0，已于 2026-08-30 修复）。
- **评价结果进 LLM 上下文（ADR-054，同源）**：`textResult` 的 `details` 给程序/UI/logging，**不**自动进模型上下文；
  因此 prompt 要求 Agent 使用的字段必须由**文本**显式带出。`evaluateAnswer` 现在在 content 里写入
  `综合评分 / 维度序级（0-4）/ 薄弱点 gaps`（经 `domain/evaluation.describeEvaluationSummary`），
  `details` 仍完整保留整个 `EvaluationResult`；`evidence` / `strengths` / `feedback` 不进文本（对选题无增量）。
  这是与 C1 同类的 **Agent context contract 不一致**——可归纳为一句话检查：
  *prompt 要求 Agent 用 X → Tool 是否把 X 放进 LLM-visible 的 text？*
- **id 纠错池不再回退全题库（ADR-055，同源 context-replay 成本）**：`getQuestion` 的 `not_found` / `topic_exhausted`
  自纠正依赖一个 id 池（旧 `validIdPool`）。旧实现在 `lastSearchIds` 为空时回退到 `Array.from(byId.keys())`
  ——即整张题库——会把上千个 id 一次性灌进一条历史消息，并在后续 replay 中持续占 token。
  正确修复不是「截断」或「降 `searchQuestions` 的 `limit`」，而是把池子收窄为
  `deliverableIds` = 「最近一次 `searchQuestions` 真实返回、且本轮尚未交付」的题号（`tools.ts:109`），
  `not_found` 改为四路 `hint`：有候选只列 ≤5 个真实 id；题库全考完引导 `finishInterview`；
  主题考完/完全没搜索过则引导 Agent 主动 `searchQuestions`。**代价视角与 C1/C2 一致**：
  避免把确定性的大块数据塞进每轮重放的上下文，代价由工具的确定性行为承担，而非靠 prompt 约束 Agent 不犯错。
- **双底层（ADR-021）**：`variant` / `evaluate` 只依赖注入的 `CompleteFn(system, user)`，
   pi-ai 与 Chrome Prompt API 各自实现；prompt 构建、JSON 解析、评分兜底逻辑只有一份。
   chrome 通道无需 apiKey/model（isEntryValid 按引擎区分）；运行时模型不可用会抛错，
   在降级链中表现为"切换到下一引擎"，链尾才由 interviewEngine 现有 catch 兜底
   （原题 / 不评分），不做 polyfill。设置页用 `chromeAvailability()` 展示本地模型状态
   （available/downloadable/downloading/unavailable）。

### Chrome 内置 AI 的并发与卡死（修复记录，2026-08-28）

- **现象**：训练页点「开始自定义训练」后一直卡在"正在用 LLM 生成变体题目…"，从不进入题目。
- **根因**：Chrome 内置 AI 的 `LanguageModel` 偶尔会让一次 `session.prompt()` 既不 resolve 也不
  reject、且不响应 `AbortSignal`；该 session 会一直存活并占用进程内的并发名额。一旦名额被
  这类"僵尸 session"占满，后续所有 `create()` 都会永久挂起 → 整批出题死锁。该上限**不是**硬性的
  1（干净状态下 `lm.create()` 并发 2 个均可成功），而是被残留的僵尸 session 占满名额所致。
- **修复**：`chromeComplete` 改为委托给同文件内的 `ChromeAIExecutor`（`src/ai/chrome.ts`）：
  - 并发上限 `concurrency`（当前 **4**），超出排队，避免瞬间打满名额；
  - 每次 `create` 与 `prompt` 都套 `withTimeout`（`setTimeout` 回调式，非 race 的 reject promise，
    避免伪未处理拒绝），单次 `timeoutMs`（当前 **90s**）后**一定**拒绝；
  - ⚠️ 这三个数值的**单一出处**是 `chrome.ts` 导出的 `CHROME_AI_CONCURRENCY` / `CHROME_AI_TIMEOUT_MS`
    / `CHROME_AI_RETRIES`；测试亦直接引用这些常量。历史上它们曾散落在六处并互相矛盾
    （并发 8/4/2、超时 90s/60s），调整时**只改常量**，不要在本文档或其它地方再写死数字。
  - 用 `AbortController` 取消（手动合并多个 signal，不依赖 `AbortSignal.any`）；
  - 失败按 `retries`（默认 1）重试一次；无论成功/失败/超时，`finally` 中 `session.destroy()`
    释放本 session，腾出并发名额；
  - 用 `runningTasks` Map 跟踪在途任务（用户提供的第 3 点修正：避免共享闭包变量被并发覆盖）。
- **配套兜底**：`interviewEngine.finalizeQuestion` 在变体 `validate/JSON` 失败时 `console.warn`
  并返回原题，避免单题坏数据导致整批 `buildSession` 中断（与降级链链尾兜底互补）。
- **多引擎降级链（ADR-023）**：`AIConfig.providers` 是有序数组，典型排布
  chrome → local → 云端强模型——免费本地模型优先，失败自动落到云端兜底。
  LLMProvider 接口不携带 config：实现类构造时绑定自己的 ProviderEntry，
  interviewEngine 只向工厂传一次 AIConfig。
- **Agent 边界（ADR-034）**：Agent 是并行运行时而非替代——现有训练页与确定性
  InterviewEngine 全部保留，两者长期共存、互为对照；评分所有权仍在 domain/LLM
  provider，持久化复用 `sessionRecordFromAgent → updateLearner` 同一管线。

## Training Coach / Learner Memory

产品核心 loop（ADR-015）：`训练 → 评估 → 结构化学习信号 → Learner Profile → 推荐下一次训练`。

```
Raw Attempts ──→ 评分（确定性判分 / LLM 评估）
                    ↓
          SessionRecord（单题分数 + gaps + correct）
                    ↓
        domain/learner.updateLearner()   ← 纯函数，可单测
                    ↓
     LearnerProfile（topicStats: avgScore/mastery/trend/commonWeaknesses + 最近50条会话）
                    ↓
  buildCoachDefinition() → topicPriorities → pickPrioritized() → 下一次训练

> 角度级证据（ADR-037）：`LearnerProfile.angleCoverage` 额外按 `topic|angle` 累计
> （attempts/avgScore/lastScore/lastAskedAt），与 topic×angle 覆盖矩阵（`coverage.ts`）形成双向闭环；
> `weakAnglesOf()` 给出某 topic 下证据最薄弱的角度。
>
> ⚠️ **覆盖索引统一为 `topic × angle`（ADR-043）**：概念层（`Question.tests` / `KnowledgeNode.concepts[]`）
> 已于 2026-08-29 移除——它只覆盖约 20% 题库，且与 `subtopic`/`tags` 重复建模，
> `primary/supporting` 的判定还高度主观。现在 `topic` 与 `angle` **均 100% 覆盖且无需额外人工标注**，
> 是选题与覆盖统计的唯一主干。`weakAnglesOf()` 的同源原语 `angleWeakRank` 现在同时驱动**确定性引擎**
> （`adaptive.ts` 的 `pickByWeakAngle`：在每个策略子集内「弱角度优先、证据最少次之」）与 Agent 追问工具
> （`agent/tools.ts` 的 `getWeakAngles`）——topic×angle 掌握度成为选题主干（ADR-045）。
```

- **记忆是"结构化信号"而非对话原文**：不把用户历史回答塞给 LLM；Coach 只看压缩画像（如 `tool-calling: weak`）。
- **掌握度**：`mastery = avgScore/100`，简单直接（ADR-019）；置信度由 `attempts` 字段本身表达，不做加权公式。`trend` 由"上次得分 vs 历史均分"判定（±2 分阈值）。
- **薄弱主题推荐**：`mastery < 0.85 且 avgScore < 85` 的主题按掌握度升序取前 3，写入 `InterviewDefinition.topicPriorities`；`buildSession` 用 `pickPrioritized` 保证薄弱主题的题优先进入训练。
- **持久化**：`storage/learner.ts`（IndexedDB via Dexie，见 `db.ts`）。Learner 画像与 SessionRecord 历史已迁 IndexedDB——画像存单例表（剔除 sessions blob），会话历史拆 `sessions` 表并建 `startedAt/overall/*topics` 索引，直接支撑 `getRecentSessions/getWeakTopics` 等范围查询（替代原 localStorage 大 blob 反模式）；小 KV 配置（AIConfig）仍留 localStorage（甜点区）。不读取/迁移任何旧 localStorage 数据，旧画像直接以空画像起步。
- **边界**：推荐逻辑当前为确定性规则（纯函数、可测）；未来"教练叙事 / 追问面试"可接 `pi-agent-core`，但 Agent 只读压缩画像，不读全文。

## LLM 变体安全（关键）

安全模型（ADR-036，取代 ADR-019 字段级白名单）：**LLM 只负责语义变换（题干 + 选项文本），所有结构变换（选项顺序 / answer 索引重映射 / 格式 / 校验）由程序完成**；`answer`/`explanation` 永远来自 canonical；单次调用、无 retry，校验失败即回退原题。

职责分层（ADR-068，第五轮收敛）：`ai/variant.generateVariant` = **LLM 适配 + 解析**（不做任何校验）；`application/sessionEvaluator.finalizeQuestion` = **唯一** validate + apply + fallback。此前 `validateVariant` 在 ai 层与 application 层各跑一次（重复校验），已消除。

```
                    Knowledge Contract (topic/tags/requiredConcepts/difficulty/type/angle)
                              │
                              ▼
Original Question ──→ LLM ──→ parse ──→ GeneratedVariant ──→ finalizeQuestion（唯一校验入口）
  (question/options)  JSON        {question, options}            │
   (answer always                                                ├─ validateVariant（选项先规范化）
    canonical)                                                   │   ├─ 结构：题干非空/无原题指代、
                                                                 │   │      options 必填·数量一致·非空·去重
                                                                 │   ├─ 抗暗示：长度泄题（仅 choice）
                                                                 │   └─ 软信号：字面锚点缺失 → warning（不阻断）
                                                                 │
                                                                 ├─ fail → 记 code 到遥测 + 回退原题
                                                                 └─ ok → applyVariant
                                                                     ① 规范化选项文本（与校验同一份）
                                                                     ② 程序 Fisher–Yates 重排选项
                                                                     ③ 按 originalIndex 确定性重映射
                                                                        canonical.answer（顺序与答案
                                                                        彻底与 LLM 解耦）
```

- **Invariant（必须保持）**——按保证强度分两类，不要混为一谈：
  - **程序保证（可断言）**：`topic / tags / angle / formats.type / answer 索引 / explanation` 全部**直接取 canonical**，不经 LLM；`difficulty band` 与选项数量/真假属性由结构校验兜住。`Question.angle` 因此是**继承**下来的，不是重新推导的——变体不换角度，只换表达。
  - **Prompt 请求、但不校验（不可断言）**：正确性语义与适用条件、`question intent`、`requiredConcepts` 的语义覆盖。这些只写在 `VARIANT_SYSTEM` 里要求模型遵守，**没有任何运行时检查能证明它们成立**（ADR-057 已明确拆除字面语义闸门，理由是字面匹配无法证明语义等价、只会误杀换场景的合法变体）。引用时请写「要求保持」而非「保证保持」。
- **语义变换（LLM 负责）**：题干措辞、场景/上下文、选项文本表达（逐项改写现有文本）。
- **结构变换（程序负责）**：选项顺序（Fisher–Yates 重排）、answer 索引重映射、多选题答案升序归一化、选项文本空白折叠。解析（`explanation`）与选项真假属性/数量均不可变，永远取 canonical。
- **校验（唯一入口：`finalizeQuestion` → `domain/variant.validateVariant`，ADR-056/068）**：**硬门槛只有结构项与抗暗示**，失败即回退原题、原因码计入遥测——**不再 retry**。① 结构：题干非空；自包含无“原题/上述/本文/该方案…”等 10 类指代（含“前文/下文/题目中/题干中”）；选择题 `options` **必填**、数量须与 canonical 一致（保证逐项一一对应）、非空、**规范化后**无重复。② 抗暗示：长度泄题（仅 choice，见下）。`answer` 不在此校验（永远来自 canonical）。**形态对齐（P0-1/ADR-056）**：`format` 参数（本次会话实际呈现形态 `sq.format`）决定选择/开放结构——`format==='choice'` 才要求 options，否则按开放题跳过；不传 `format` 时回退到 `canonical.formats.choice` 是否存在，使双形态题（约 1078/1084）按当前 Session 形态生成变体而非永远当选择题（choice 的 single/multiple 子类型由 `q.formats.choice!.type` 推导，而非一律按多选题生成）。**「语义闸门」已拆除（ADR-057，勿恢复）**：`requiredCoverageMet`（requiredConcepts 字面覆盖 ≈2/3，`need = max(1, round(N*2/3))`）于 2026-09-01 第四轮删除，余下的字面锚点于 2026-09-02 第五轮降级为 warning（见下条）——字面匹配无法证明语义等价，只会误杀换场景的合法变体。`fuzzball` 兜底（`token_set_ratio ≥75` / `partial_ratio ≥80`）现只服务于该漂移软信号。
- 选择题 `options` 文本可由 LLM 改写，但**选项数量/真假属性固定**，且**顺序由 `applyVariant` 调 `shuffleChoiceOptions` 程序重排**（非 LLM 决定）；`answer` 索引永远由 canonical 经确定性重映射得到（`applyVariant` 写死 `canonical.answer` 再重排），彻底避免“答案被模型覆盖 / 顺序被模型泄露”。`toGeneratedVariant` 已移除对缺失 `question` 的静默回退（缺失由校验显式拒绝），并丢弃模型可能回吐的 `answer/explanation`。
- **Prompt 约束**：`VARIANT_SYSTEM` 为轻量变体版（v3，约 40 行稳定前缀，KV-Cache 友好），要求“逐项改写现有文本”、明令禁止改动选项数量/真假属性/答案/解析，并明确“不交换选项顺序（顺序由程序统一处理）”；`buildUser` 只注入 `topic/requiredConcepts/question/options`（choice 时），不暴露 `answer/explanation/referenceAnswer/angle/difficulty`，从源头切断“LLM 重新决定答案”的路径。
- **原生 JSON Mode（主路径）+ `extractJSON` 兜底**：`PiAIProvider.generateVariant` 声明 `jsonMode:true`（DeepSeek/OpenRouter 走 `response_format=json_object`，强制合法 JSON、省 token）；`ChromeAIProvider` 不走原生 JSON（Prompt API 不支持），退回 `extractJSON` 解析 markdown 包裹。两层共享同一 `VARIANT_SYSTEM` 与 `generateVariant` 逻辑。
- ADR-027 起「选择 ⇄ 开放」仍不在运行时变换：形态内容静态维护，变体仅在同一形态内重构表达。
- **抗暗示（anti-cueing）硬失败**：`domain/variant.validateVariant` 在选择题分支对**规范化后**的选项跑 `domain/bias.detectOptionLengthBias`；命中长度泄题（正确项全局最长且存在明显过短干扰项，差距 ≥1.8×）即拒绝，并带机器可读 `code='option-length-bias'`，由 `finalizeQuestion` 回退原题、原因码计入 variant 遥测——**不再重新请求 LLM**（轻量变体边界：省掉最耗时的一次重试）。第五轮前该检查位于 `ai/variant.generateVariant`，随「单一校验入口」内移。
- **规范化前移（ADR-068）**：`validateVariant` 与 `applyVariant` 都先 `normalizeOptionText` 再做去重/空串/长度 bias 检查与 shuffle，顺序为 `normalize → validate → shuffle`（旧版是 `validate 原文 → shuffle → normalize`）。修掉的漏洞：`"Redis"` 与 `" Redis "` 在旧流程里算两个不同选项、能通过去重检查，却在渲染后变成两个一模一样的选项。
- **漂移软信号（ADR-068，不是 gate）**：`stemAnchorMissing`（topic/tags/required 在题干里连一个字面锚点都没命中）只产出 `warning: STEM_ANCHOR_WARNING`，**不参与拒绝决策**。它衡量的是「题干可能与主题脱钩」这一信号，而非语义等价性；命名与注释刻意避开“语义闸门/硬门槛”——字面锚点只能证明「题干仍与主题相关」，无法证明语义等价，会误杀「换场景不换知识点」的合法变体（例：原题「为什么 KV Cache 能降低 prefill 成本？」→ 变体「某服务前缀高度重复却仍重复相同前向计算，如何降低开销？」零锚点命中却完全合法）。变体安全的真正兜底是另外两条硬边界：`VARIANT_SYSTEM` 的逐项一一对应约束，以及 `answer`/`explanation` 恒取 canonical（变体改歪也不会判错题）。证据面仍只取题干（排除 `explanation`/`options`，理由同上条）。
- **拒绝原因码（ADR-068）**：`VariantCheck.code` 为机器可读原因（`empty-question` / `forbidden-reference` / `missing-options` / `option-count-mismatch` / `empty-option` / `duplicate-option` / `option-length-bias`），`finalizeQuestion` 直接透传给 `recordVariantRound`，使 fallback 归因从笼统的 `validation-failed` 细化到具体原因，支撑「按真实失败率调 gate」。

## 变体双模式：Offline Variant Pool + Runtime fallback（ADR-069）

训练时每道题的变体来源有两条路径，由 `config.runtimeVariantEnabled`（默认 OFF）控制是否启用第二条：

```
                 ┌─────────────────────────────────────────────────────────┐
                 │  Offline Variant Pool（默认，零 LLM）                     │
                 │  src/data/variants/*.json（import.meta.glob 合并）        │
                 │  经 domain/variantPool.resolveQuestionVariant 选变体      │
                 └───────────────────────────────┬─────────────────────────┘
                                                  │ Pool 命中？
                              ┌───────────────────┴───────────────────┐
                          是  │                                        │ 否（miss）
                              ▼                                        ▼
                  validateVariant → applyVariant                runtimeVariantEnabled?
                  （零 LLM 直接落地，记 latency=0）            ┌───────┴───────┐
                                                            OFF │           ON │ + provider?
                                                                ▼               ▼
                                                          回退 canonical    1 次 LLM（generateVariant）
                                                          （零 LLM）        → validateVariant
                                                                           ├─ fail → 回退 canonical
                                                                           └─ ok → applyVariant（结果不写回题库）
```

- **资产契约（`src/schemas/variant.ts`）**：`VariantKind`（surface / context / surface-options / context-options）、`QuestionVariant`（`id/kind/question/options?/generatedAt/generator/promptVersion/sourceHash`）、`VariantPool`（`version/generatedAt/promptVersion/variants: Record<id, QuestionVariant[]>`）。`sourceHash = computeVariantSourceHash(canonical)`（FNV-1a）用于 stale 检测。
- **Pool-first（默认）**：训练选择逻辑在 `finalizeQuestion` 编排——先查 Pool，命中即取 `selectVariant`（确定性 Fisher–Yates + seen 去重）落地；miss 且开关 OFF 时直接回 canonical（**零 LLM**）。
- **Runtime fallback（可选）**：仅 miss + 开关 ON + 存在可用 provider，才 1 次 LLM（`generateVariant` 加 `kind` 注入风格指令）；结果**不写回题库**——晋升靠 telemetry → 离线 review → 手动 `npm run question:variants` promote。
- **离线生成器 / 审计**：`npm run question:variants`（vite-node）复用 `generateVariant` + `validateVariant`，支持 `--ids/--topics/--count/--kind/--missing-only/--stale/--dry-run/--concurrency/--prompt-version`，每题默认 2 变体、严格校验 + fuzzball 去重、按 batch 落盘；`npm run question:validate-variants` 标 stale + 近重复报告。**红线**：不建 Variant 专用 Agent、不写第二套 LLM 实现、Runtime 不自动写回、类型锁死 4 种。
- **UI 开关**：SettingsPanel「使用 AI 实时生成题目变体」（默认 OFF），接线 `config.runtimeVariantEnabled`；文案明确「Pool first / Runtime fallback」。

## 评分 Rubric（四维 + 两层评分锚点）

开放题 `EvaluationResult` 拆为四维度（默认权重和为 1）：

| 维度 | 含义 | 默认权重 |
| --- | --- | --- |
| correctness 正确性 | 是否命中核心要点 | 0.4 |
| completeness 完整性 | 是否覆盖应有要点、无明显遗漏 | 0.2 |
| architecture 架构 | 方案/代码结构是否合理（编程题看实现质量） | 0.2 |
| communication 表达 | 清晰度、条理与专业性 | 0.2 |

综合分 `overall` = Σ(dim × weight)，**只**由 `domain/evaluation.aggregateOverall` 计算——LLM 不拥有最终分数（ADR-019）。

**LLM 判「序级」而非百分制（评分层重构）**：LLM 对每个维度只输出 `level: 0-4` 的ordinal rating + 一句 `evidence`，分数由 `domain/evaluation.levelToScore` 按固定映射归一化（`0→0, 1→25, 2→50, 3→75, 4→100`）。这样「LLM 做判断、代码做数学」——避免让 LLM 伪装成精确的 0-100 评分器（82 vs 84 通常没有可靠语义差），且层级映射是确定性的、可复现。选择题四维同取 level 4/0（即 100/0）。`EvaluationResult` 同时携带 `dimensions`（0-100 归一化分，供下游与存储兼容）与 `levels`（原始序级，供 UI 展示等级标签）及 `evidence` / `missingConcepts`。

**评分锚点分两层**（ADR-044：题目级 `rubric` 字段已删除）：

| 层 | 来源 | 作用 |
| --- | --- | --- |
| 泛化锚点（必须覆盖的要点） | `KnowledgeNode.required`（经 `domain/knowledge.requiredPointsFor`，按题目 topic 查节点） | 注入评分提示，命中情况计入 completeness |
| 题目锚点（该题特有结论） | `Question.explanation` | 注入评分提示，判断回答是否覆盖本题特有的关键结论 |

权重**统一使用全局 `InterviewDefinition.scoringRubric`**，不再支持题目级覆盖。

> ⚠️ **常见误解**：`explanation` 与 rubric **原本并无交互**——`explanation` 只用于 UI 展示
> （`ResultPanel` / `SessionReplayDrawer`）与变体生成，评分时 LLM 拿到的是 `open.referenceAnswer`，
> **不是** `explanation`。ADR-044 是让 `explanation` **新增**承担评分锚点职责，而非两者本就重合。
>
> 删除理由：493 题的 `rubric.required` 中有 239 题（48.5%）与知识节点 `required` 逐字相同（纯副本）；
> `rubric.dimensions` 仅覆盖 185 题（29.6%）、21 种组合，收益低于维护成本。
> 代价：254 题（51.5%）的逐题定制要点改由 `explanation` 承担，形态从"结构化要点清单"变为"解析文本"。

## 数据契约与运行时校验（Zod 边界层，ADR-033）

Zod 4 作为**数据边界的 runtime contract**，不进入 domain 业务层。目录 `src/schemas/` 集中定义所有对外/不可信输入的形状；验证发生在边界，内部拿到的是已信任对象。

```
                         External / Untrusted
                                │
             ┌──────────────────┼─────────────────┐
             │                  │                 │
          JSON data          LLM output       localStorage
             │                  │                 │
             ▼                  ▼                 ▼
          Zod parse          Zod parse         Zod parse
             │                  │                 │
             └──────────────────┼─────────────────┘
                                ▼
                         Trusted objects
                                │
                                ▼
                         Domain / Engine
                                │
                                ▼
                         Business invariants
```

- **职责切分**：Zod 校验 `type/difficulty/options 是否为数组/question 是否为 string`；domain 校验 `单选题恰好一个答案 / topic 必须存在于 knowledge / prerequisite 不能成环`。前者在 `schemas/*.ts`，后者在 `domain/*` 与 `data/bank.test.ts`。
- **类型即 schema**：`export type Question = z.infer<typeof questionSchema>`，运行时与静态类型由同一份定义产生，避免两套类型漂移。数据形状类型（`Question`/`AIConfig`/`LearnerProfile` 等）由各模块直接从 `schemas/*` 导入；`src/types.ts` 仅保留没有单一归属模块的跨层行为契约（`LLMProvider` / `QuestionBank` / `AnswerValue` / `CompleteFn` 等），不再承担数据类型 re-export。
- **装配期 fail-fast**：`data/questionBank.ts`、`data/knowledgeMap.ts`、`domain/conceptGraph.ts` 在 `import.meta.glob` eager 合并后逐条 `safeParse`，失败直接抛错并定位到 `文件[下标]` 与 `path → message`（bracket 记法如 `providers[0].id`），不在用户进入某 topic 时才暴露坏数据。
- **AIConfig**：`storage/settings.ts` 的 `parseConfigJSON` 先走 `aiConfigSchema.safeParse` 做形状校验（provider id 白名单、数组结构），再走 domain 不变量（同引擎去重、`isEntryValid` 完整性、`至少一个可用引擎`、`generateOpenQuestions` 非 true 视为 false 的清洗语义）。`loadConfig` 只识别 `{ providers: [...] }` 形态（旧单选 `{ provider, ... }` 迁移分支已于 2026-08-29 移除，不合法/缺失一律回退默认配置）。
- **LLM 输出**：`ai/evaluate.ts` 的 `parseEvaluation` 在 `extractJSON` 之后走 `llmEvaluationRawSchema.safeParse`，形状合法才进入 `clamp + aggregateOverall`；`overall` 仍由 `domain/evaluation` 聚合，LLM 不拥有分数。`schemas/jsonSchema.ts` 的 `z.toJSONSchema(aiConfigSchema)` 已接入 `SettingsPanel` 的 Monaco 校验（自动补全/悬停/枚举提示），后续可复用同一份契约做 LLM structured output。
- **持久化**：`storage/learner.ts` 的 `LearnerProfile / SessionRecord / QuestionResult` 由 `schemas/learner.ts` 定义（`topicStats`/`evidence`/`questionResults` 全约束），`persistedLearnerSchema = { version: literal(1), data: learnerProfile }` 版本化包装；`loadLearner` 兼容旧直接存储形态（无 `version`）与新 `version:1` 形态，`saveLearner` 一律写入版本化结构，损坏数据回退空画像。Migration 仍属 storage/domain 逻辑，不塞进 Zod。
- **错误呈现**：`schemas/errors.ts` 的 `formatSchemaError` 将 ZodError 扁平为 `{ path, message }`，path 按 `a.b[0].c` 记法，便于维护大量 JSON 题库时定位；`questionBank/knowledgeMap/conceptGraph/settings` 统一使用该格式化。
- **演进**：`schemas/` 已覆盖 question / knowledge / conceptGraph / ai-config / evaluation / interview / learner / session；后续仅需为 `InterviewSession` 等运行时会话补充可选的回放校验，不再新增大范围 schema。

## 技术栈注意点

- **antd 为 6.x**：`Divider` 仅支持 `horizontal / vertical`，无 `orientation` 左右。
- **Chrome Built-in AI（Prompt API）**：仅较新 Chrome 提供，无跨浏览器保证；运行时用
  `(globalThis as any).LanguageModel?.availability()` 能力检测（API 缺失/异常一律视为 unavailable），
  不引入 polyfill。每次调用新建 session 并 destroy（one-shot 无状态）；system prompt 走
  `initialPrompts`。模型 downloadable 状态下首次 create 可能触发下载。
- **本地 OpenAI 兼容服务（ADR-022）**：走 pi-ai `createProvider`（SDK 原生自定义 provider 路径，
  models.json 加载器属 coding-agent CLI 不在 SDK 内）；compat 关闭 developer role /
  reasoning_effort。浏览器直连 localhost 仍受 CORS 限制，本地服务需允许跨域。
  踩坑：openai-completions 是 SSE 流式（mock 测试须回 event-stream）；pi-ai 把传输错误
  吞成 stopReason='error'（callLLM 返回空文本，上层 parse 兜底）；空 apiKey 不能以
  complete() 选项显式传入，否则覆盖 auth 解析导致请求发不出。
- **默认云端引擎为 DeepSeek**：`storage/settings.ts` 默认降级链
  `{ providers: [{ id: 'deepseek', model: 'deepseek-v4-flash', ... }], generateOpenQuestions: false }`；
  示例配置见 `docs/config.example.json`。DeepSeek 特性已按能力协商充分利用：
  - **原生 JSON 模式**：声明 `jsonMode` 能力的引擎（deepseek / openrouter）经 samplingParams 透传
    `response_format={type:'json_object'}`，变体/评分/质询均走原生 JSON（extractJSON 仅作 fallback）；
    DeepSeek 要求 prompt 含 "json"，三套系统提示的系统契约段均满足。
  - **KV Cache（默认开启，prefix matching）**：one-shot 路径（variant/evaluate/challenge）把角色/原则/
    JSON 契约等稳定内容放进 system 前缀、动态数据只放 user 消息；Agent 路径由 pi-agent-core 维持
    append-only 多轮历史 + 稳定 system 前缀——均天然命中缓存，不做「每轮重新压缩 prompt」。
  - **Tool Calls**：Agent 走 pi-agent-core 原生工具调用（searchQuestions / getQuestion /
    evaluateAnswer / getUserWeaknesses / getWeakAngles / getCoverageGaps / finishInterview），
    确定性工作全在工具内，Agent 只做选题/追问/收尾决策；工具结果只回 id 级事实，
    题目正文不进上下文（ADR-053），省下的输出 token 也不再重复 UI 已渲染的题干与选项。
  - **Thinking**：能力已声明（deepseek `thinking:true`），但由选 `deepseek-reasoner` 模型驱动而非运行时参数；
    当前不自动切模型，需用户配置 reasoner 模型才启用。
  - **Cache 遥测**：dev 下 `devUsageLogger` 打印 cacheHit/cacheMiss，用于验证命中率（见 usageTelemetry.ts）。
- **开放题生成门控（ADR-031）**：`AIConfig.generateOpenQuestions` 默认 false——
  interviewEngine 的 `effectiveFormats` 从允许形态剔除 open（纯开放题不入池、
  双形态题一律出选择、自适应随机开放分配恒为 choice），定义只选 open 时退化
  为 choice 而非空会话；缺省/非法值按 false 清洗。
- **pi-ai 浏览器注入密钥**：走 `createModels({ credentials })` 内存 `CredentialStore`；
  Cloudflare 额外经 credential.env 注入 `CLOUDFLARE_ACCOUNT_ID`（其 auth 协议要求 Token + Account ID 双字段）。
- **设置页 = config.json 编辑器（ADR-025/026，ADR-033 增强）**：引擎为
  `chrome / local / deepseek / openrouter / google / cloudflare-workers-ai` 六种（ADR-026 扩容），
  设置面板 Monaco JSON 编辑器直接编辑配置，`z.toJSONSchema(aiConfigSchema)` 注入 `monaco.languages.json` 诊断（enum 提示、hover、实时校验）；保存时
  `parseConfigJSON`（storage/settings.ts，纯函数有测试，形状校验由 Zod 接管）整体校验并清洗，
  错误信息定位到 `providers[i]`。历史配置中的已下线引擎 id 由 loadConfig/sanitizeEntry 静默丢弃。
- **Zod 4（ADR-033）**：`strict: true` 已开启，`zod@4.4.3` 与 pi-ai 共享；`schemas/` 为唯一契约出处，`z.toJSONSchema` 已用于 Monaco（`schemas/jsonSchema.ts`），并可复用为 LLM structured output 的 JSON Schema；`allowImportingTsExtensions` 对 `schemas` 导入不产生影响（仅 `domain/coverage` 等 CLI 直跑路径需要 `.ts` 扩展名）。
- **浏览器直连 LLM 受 CORS 限制**：实测 CORS 友好的云端为 DeepSeek / OpenRouter /
  Google Generative Language API / Cloudflare API（ADR-026）；OpenAI、Anthropic 直连仍不可用，
  有需求走本地 OpenAI 兼容网关（id=local 指向代理地址）。
- **pi-ai 对浏览器友好**：库内部对 `globalThis.process` 与 `node:fs` 做了守卫/懒加载，打包时 `node:fs` 外部化为警告，属预期且不崩。
- **pi-agent-core（ADR-034）**：仅在 `src/agent/` 使用，承载「Agent 面试」页的决策循环；
  训练/规则式面试不引入 Agent。注意其 dist 顶层 import `node:crypto/fs/...` 会被
  externalize 成构建警告，只用 Agent 不触 harness 则不崩；工具参数 schema 用 TypeBox
  （pi-agent-core 要求），与项目既有 Zod 不冲突。
- **monaco-editor 0.56 exports map 对深层导入是坏的**：`monaco-editor/esm/vs/**` 深层导入在 Node 与 rolldown 下均 `ERR_MODULE_NOT_FOUND`（`./*.js → ./esm/vs/*.js` 的 star 替换路径错误），`resolve.alias` 也救不了。解法：worker 用相对路径 `../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker` 绕过包解析；主库走 `import * as monaco from 'monaco-editor'`（`.` 入口正常）。
- **Shiki grammar 懒加载**：语法文件是独立 chunk，渲染对应语言时才下载；主包只含核心引擎。
- **构建**：`npm run build` 用 `tsc -b && vite build`，开启 `noUnusedLocals`，未使用 import/变量直接报错；`*.test.ts` 已从 tsc 排除，由 Vitest 处理。
- **fuzzball（浏览器纯 JS 模糊匹配，ADR-047 语义漂移兜底）**：`fuzzball@latest` 纯 JS 实现，无 Node 核心依赖，适配 Vite SPA；`domain/variant.validateVariant` 内的 `anchorHasEvidence`（配合 `stemAnchorMissing`，ADR-068 起仅作漂移软信号）在精确 token 未命中时追加 `token_set_ratio ≥75` / `partial_ratio ≥80` 二次判定，处理词序/形态/拼写差异（如 `batch statistics ↔ statistics across the batch` 100 分、`regularisation ↔ regularization` 93 分），计算量仅 `1题×数个 requiredConcepts×数百字文本`，无需后端；bundle 增量约 15KB gzip（52KB 原始），已验证 `npm run build`。
- **密钥定位**：local-first 隐私友好，但浏览器侧密钥**不是安全机密**（受 XSS / 扩展威胁），勿用高权限生产密钥。
