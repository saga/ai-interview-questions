# 架构设计

## 总体形态

单页应用（SPA）：`Vite + React 18 + TypeScript + Ant Design`，五页（训练 / 进度 / 面试 / Agent 面试 / 设置）。LLM 能力通过 `@earendil-works/pi-ai` 在**浏览器内**直连（one-shot 调用），用户密钥存 `localStorage`，无独立后端。「Agent 面试」页由 `@earendil-works/pi-agent-core` 驱动（`src/agent/`），作为并行于确定性 InterviewEngine 的第二运行时长期共存、互为对照（ADR-034）；规则式「模拟面试」与训练流程仍走确定性引擎（ADR-017）。

**产品定位（ADR-015）**：个人 AI 面试教练，不是题库测试配置器。首页是训练入口（继续/快速/自定义），系统内部概念（评分权重、API Key 状态）不暴露给用户；每次训练都会沉淀 Learner Memory，并据此推荐下一次训练。

**核心原则**：题库是 source of truth，LLM 是 enhancement layer（不是题库本身）。变体的答案 key 永远来自原题，LLM 只改表达。

## 分层

```
schemas/       数据契约层（Zod 4）：runtime validation + TypeScript 类型推导（单源）
  common.ts      共享枚举（difficulty / providerId / angle 等，`export type X = z.infer<typeof xSchema>`）
  question.ts    Question 形状（Zod 负责“长什么样”，domain 负责“是否合理”）
  knowledge.ts   KnowledgeNode 形状
  conceptGraph.ts ConceptGraph 形状（只验结构，DAG 仍由 domain 校验）
  ai-config.ts   AIConfig 形状（校验结构，业务不变量由 isEntryValid / 去重等保障）
  evaluation.ts  LLM 输出形状（只验 JSON 形状，overall 仍由 domain 聚合）
  types.ts       兼容 re-export 层（`types.ts` 不再手写 `interface Question`，全部 `export type X = z.infer` 自 schemas，行为契约 `LLMProvider` 等除外）
  errors.ts      统一 ZodError → path/message 格式化（bracket 记法 providers[0].id）
  questionBank / knowledgeMap / conceptGraph 的加载期校验均在此层完成；
  详见「数据契约与运行时校验」小节（ADR-033）

domain/        纯 TypeScript 逻辑，不依赖 React / 网络（全部有单测覆盖）
  categories.ts  类目 slug → 中文标签
  knowledge.ts   知识点层查询：knowledgeById / requiredPointsFor（评分要点回退）
                 / knowledgeCoverage（P0 覆盖率与题库建设 gap 路线图）
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
   pi.ts             pi-ai 底层封装（buildModels / callLLM / extractJSON；local 在此路由到
                     createProvider 注册的自定义 provider，ADR-022）
    chrome.ts         Chrome Prompt API 封装（chromeAvailability / chromeComplete）+ ChromeAIExecutor
                      （并发上限 + 单次超时 + AbortSignal 取消 + 失败重试 + session 自动销毁，
                      核心机制见下「Chrome 内置 AI 的并发与卡死」，ADR-021）
   local.ts          本地 OpenAI 兼容服务 provider 构建（默认 Unsloth 127.0.0.1:8888/v1）
   variant.ts        变体生成（one-shot 重写题干；complete 由 provider 注入，不感知底层）
   evaluate.ts       开放形态评分（one-shot 四维评分；overall 由 domain 聚合；同上注入 complete）
   provider.ts       LLMProvider 工厂 + isEntryValid/isConfigValid
                     + ChromeAIProvider / PiAIProvider / FallbackProvider（降级链，ADR-023）

storage/       本地持久化（IndexedDB + localStorage；两者均为不可信边界，一律经 Zod 校验）
   db.ts         Dexie 数据库 schema（version 2）：learner 单例表 + sessions 表（startedAt/overall/*topics 索引）+ memory/agentSessions 预留表 + errorLog 诊断表（scope/createdAt 索引，记录 Copilot/引擎等调用失败的结构化上下文，与业务数据隔离，fire-and-forget 不阻塞主流程）
  settings.ts   LLM 配置（localStorage，`aiConfigSchema` 形状 + `isEntryValid`/去重等不变量）——小 KV 配置保留 localStorage（甜点区）
  learner.ts    LearnerProfile / SessionRecord（IndexedDB via Dexie）：画像存单例表（剔除 sessions），会话历史拆分到 sessions 表；不读取/迁移任何旧 localStorage 数据，直接以空画像起步

application/
  interviewEngine.ts  应用服务：buildSession / nextAdaptiveStep / evaluateAnswer / evaluateSession

agent/         Agent 面试运行时（pi-agent-core，ADR-034）：与确定性 Engine 并行的第二运行时
   interviewAgent.ts  Agent 编排（observe → decide → tool 循环；停止条件 / 工具守卫）
   tools.ts           AgentTool 薄包装 domain/learner/evaluation/ai——确定性工作全部走工具，
                      Agent 只做"不确定的决策"（选题/追问/收尾）；评分不归 Agent
   prompt.ts          系统提示词；runtime.ts 事件流装配；types.ts 会话与事件类型
                      （InterviewAgentSession，App 持有、工具读写引用共享）
   持久化复用既有管线：sessionRecordFromAgent → updateLearner + saveLearner，
   与训练/模拟面试写入同一份 LearnerProfile

lib/
  codeFence.ts        ``` 围栏切分（纯逻辑 + 单测，容错未闭合围栏）

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

data/questions/       题库（用户数据契约，按 topic 一文件：questions/<topic>.json，共 28 文件 /
                       520 题；topic ∈ taxonomy 的 28 个二级主题，如 transformer / rag /
                       tool-calling，与 src/data/taxonomy.ts 的骨架一一对应）。每题
                       `category` = 所属 topic slug（与文件名一致），`topic` = 知识节点 id，
                       外加 `tags` / 可选 `rubric` / `angle`（主考察角度，覆盖矩阵用，
                       ADR-032/037）。6 大能力域（ai-engineering / llm / llm-applications /
                       agent-engineering / ai-systems / ai-security）是 **taxonomy 逻辑分组**
                       （topic → domain 映射见 `taxonomy.domainOfTopic`），不是物理文件单位；
                       UI 分类标签由 `domain/categories.ts` 合并 DOMAIN_LABELS + TOPIC_LABELS。
                       存量 520 题：514 题同时携带 choice 与 open 双形态（ADR-027）、6 题仅
                       choice、180 题选择形态带场景化专属题干 cf.question（ADR-028）。题目角度
                       候选由 taxonomy.ANGLE_WHITELIST（topic→角度子集）约束，节点未声明
                       angles 时回退到所属 topic 白名单（ADR-039）。
data/questionBank.ts  题库装配（import.meta.glob eager 合并 + Zod 形状校验；刻意不建索引/数据库层，
                       规模需要时再加动态 import + 构建期 question-index；失败时抛错并定位到 文件[下标]）
data/conceptGraph.json  知识图谱（两类有向边 prerequisite/related；
                         prerequisite 构成基础→进阶 DAG；加载期先过 Zod 形状校验，再走 isAcyclic DAG 校验）
data/knowledge/        知识点层 = Concept（ADR-029 / ADR-038）。按文件拆分（文件名沿用历史
                        slug，×7：dl-fundamentals / llm-architecture / training / inference /
                        rag / agentic-ai / system-design，共 74 节点），但节点内部不再用文件 slug 当分类——
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
data/courses/          课程题库槽位（前瞻，ADR-041；目录尚未创建——首个真实课程接入时
                        新建）。每课程一个子目录 <courseId>/，独立存放
                        course.json / knowledge/concepts.json / blueprint.json / questions/
                        questions.json / quality/{coverage,validation}.json。关键隔离：本目录
                        **不会被** questionBank.ts 的 import.meta.glob('./questions/*.json')
                        误收，也不进入 Interview taxonomy；课程题库经 QuestionSource 接口
                        （src/data/source.ts）接入引擎与 Agent，与 Interview 来源共享 Question
                        schema / Zod / learner evidence / IndexedDB / LLM provider，但**不共享**
                        taxonomy / blueprint / adaptive policy。
scripts/question-coverage.ts  覆盖矩阵 CLI（npm run question:coverage）：fs 直读
                        questions/ 与 knowledge/ JSON（不走 import.meta.glob），
                        调 domain/coverage 纯函数输出矩阵与补题建议。Node 24+ 原生
                        运行 TS，无需构建；相对导入必须带 .ts 扩展名
scripts/question-blueprint.ts  蓝图 CLI（npm run question:blueprint -- N）：把前 N 个
                        缺口格输出为蓝图 JSON（含变体候选 id），作为补题/
                        受约束生成的结构化输入
types.ts              全局类型（含 LLMProvider / LearnerProfile）
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
   EvaluationResult  (overall 0-100 + 四维 dimensions + strengths/gaps/feedback)
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
                        单 provider 起步，不接 FallbackProvider
```

- 训练与规则式面试的 LLM 调用都是 one-shot 结构化生成，无状态；Agent 面试的
  多轮决策循环由 `src/agent/interviewAgent.ts` 驱动，是唯一的有状态调用方。
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
> 是选题与覆盖统计的唯一主干。`weakAnglesOf()` 当前被 Agent 面试的追问工具调用
> （`agent/tools.ts` 的 `getWeakAngles`）；确定性引擎里 `angle` 以 `angleEvidence` 的形式参与兜底排序。
```

- **记忆是"结构化信号"而非对话原文**：不把用户历史回答塞给 LLM；Coach 只看压缩画像（如 `tool-calling: weak`）。
- **掌握度**：`mastery = avgScore/100`，简单直接（ADR-019）；置信度由 `attempts` 字段本身表达，不做加权公式。`trend` 由"上次得分 vs 历史均分"判定（±2 分阈值）。
- **薄弱主题推荐**：`mastery < 0.85 且 avgScore < 85` 的主题按掌握度升序取前 3，写入 `InterviewDefinition.topicPriorities`；`buildSession` 用 `pickPrioritized` 保证薄弱主题的题优先进入训练。
- **持久化**：`storage/learner.ts`（IndexedDB via Dexie，见 `db.ts`）。Learner 画像与 SessionRecord 历史已迁 IndexedDB——画像存单例表（剔除 sessions blob），会话历史拆 `sessions` 表并建 `startedAt/overall/*topics` 索引，直接支撑 `getRecentSessions/getWeakTopics` 等范围查询（替代原 localStorage 大 blob 反模式）；小 KV 配置（AIConfig）仍留 localStorage（甜点区）。不读取/迁移任何旧 localStorage 数据，旧画像直接以空画像起步。
- **边界**：推荐逻辑当前为确定性规则（纯函数、可测）；未来"教练叙事 / 追问面试"可接 `pi-agent-core`，但 Agent 只读压缩画像，不读全文。

## LLM 变体安全（关键）

安全模型（ADR-036，取代 ADR-019 字段级白名单）：**LLM 可重构所有 Presentation（题干/场景/选项/distractors/解析），但必须保持 Knowledge Contract 不变量，输出为 VariantCandidate，需经 Domain 校验，无兜底**：

```
                    Knowledge Contract (topic/tags/requiredConcepts/difficulty/type)
                              │
Original Question ──→ LLM ──→ VariantCandidate ──→ validateVariant ──→ GeneratedVariant
  (question/options/                                           │ schema + semantic
   answer/explanation)                          ┌──────────────┴──────────────┐
                                               │ ok → applyVariant         │ fail → 抛错（无回退）
                                               │ 替换 question/options/    │  上层 buildSession 失败
                                               │ answer/explanation        │
```

- **Invariant（必须保持）**：`topic/tags/requiredConcepts`、正确性语义、`question intent`、`difficulty band`、`formats.type(single/multiple/open)`。由 `domain/knowledge.requiredPointsFor` 提供 `requiredConcepts`。
- **Variant（允许自由变化）**：题干措辞、场景/上下文、选项表达与 distractors、解析表达。
- **校验**：`domain/variant.validateVariant` 做结构（题干非空、选项≥2无重复、answer 索引合法且与 type 一致、至少一干扰项、自包含无“原题/上述”指代）+ 语义（required 概念仍覆盖）；失败直接抛错，无回退原题（用户显式要求）。
- 选择题 `options/answer` 可由 LLM 重设计，`answer` 索引由 LLM 给出但由校验重算合法性，彻底避免“索引错位”靠验证而非靠字段禁止。
- ADR-027 起「选择 ⇄ 开放」仍不在运行时变换：形态内容静态维护，变体仅在同一形态内重构表达。
- **抗暗示（anti-cueing）自愈**：`ai/variant.generateVariant` 在拿到 LLM 变体后，对选择题跑 `domain/bias.detectOptionLengthBias`；若命中长度泄题（正确项全局最长且存在明显过短干扰项），用修正提示词**一次性重试**改写选项，避免把“正确项明显更长/干扰项过短”的偏差写进变体。属软信号、非校验阻断（沿用 ADR-036 无兜底语义：仅重生成，不因此抛错改回原题）。

## 评分 Rubric（四维 + 两层评分锚点）

开放题 `EvaluationResult` 拆为四维度（默认权重和为 1）：

| 维度 | 含义 | 默认权重 |
| --- | --- | --- |
| correctness 正确性 | 是否命中核心要点 | 0.4 |
| completeness 完整性 | 是否覆盖应有要点、无明显遗漏 | 0.2 |
| architecture 架构 | 方案/代码结构是否合理（编程题看实现质量） | 0.2 |
| communication 表达 | 清晰度、条理与专业性 | 0.2 |

综合分 `overall` = Σ(dim × weight)，**只**由 `domain/evaluation.aggregateOverall` 计算——LLM 只输出四维 dimensions，不拥有最终分数（ADR-019）。选择题四维同取 100/0。

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
- **类型即 schema**：`export type Question = z.infer<typeof questionSchema>`，运行时与静态类型由同一份定义产生，避免两套类型漂移。当前为增量迁移阶段，`src/types.ts` 仍保留以兼容存量引用，后续可收敛为 `z.infer` 单一来源。
- **装配期 fail-fast**：`data/questionBank.ts`、`data/knowledgeMap.ts`、`domain/conceptGraph.ts` 在 `import.meta.glob` eager 合并后逐条 `safeParse`，失败直接抛错并定位到 `文件[下标]` 与 `path → message`（bracket 记法如 `providers[0].id`），不在用户进入某 topic 时才暴露坏数据。
- **AIConfig**：`storage/settings.ts` 的 `parseConfigJSON` 先走 `aiConfigSchema.safeParse` 做形状校验（provider id 白名单、数组结构），再走 domain 不变量（同引擎去重、`isEntryValid` 完整性、`至少一个可用引擎`、`generateOpenQuestions` 非 true 视为 false 的清洗语义）。`loadConfig` 的历史 `provider → providers` 迁移与静默丢弃逻辑保留于 storage 层。
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
  旧单选形态（`{ provider, ... }`）由 loadConfig 自动迁移（key 不变，ADR-023）；
  示例配置见 `docs/config.example.json`。
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
- **密钥定位**：local-first 隐私友好，但浏览器侧密钥**不是安全机密**（受 XSS / 扩展威胁），勿用高权限生产密钥。
