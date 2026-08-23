# 架构设计

## 总体形态

单页应用（SPA）：`Vite + React 18 + TypeScript + Ant Design`。LLM 能力通过 `@earendil-works/pi-ai` 在**浏览器内**直连（one-shot 调用），用户密钥存 `localStorage`，无独立后端。pi-agent-core 已移除——对话式 Agent 仅在"对话式模拟面试"落地时回归（Future/Experimental，ADR-019）。

**产品定位（ADR-015）**：个人 AI 面试教练，不是题库测试配置器。首页是训练入口（继续/快速/自定义），系统内部概念（评分权重、API Key 状态）不暴露给用户；每次训练都会沉淀 Learner Memory，并据此推荐下一次训练。

**核心原则**：题库是 source of truth，LLM 是 enhancement layer（不是题库本身）。变体的答案 key 永远来自原题，LLM 只改表达。

## 分层

```
domain/        纯 TypeScript 逻辑，不依赖 React / 网络（全部有单测覆盖）
  categories.ts  类目 slug → 中文标签
  knowledge.ts   知识点层查询：knowledgeById / requiredPointsFor（评分要点回退）
                 / knowledgeCoverage（P0 覆盖率与题库建设 gap 路线图）
  quiz.ts        抽题（Fisher–Yates）、availableFormats、pickPrioritized（薄弱主题优先）
                 / planComposition（抽题 + 形态配额：开放 ≈ floor(count*0.3)，ADR-027）
  evaluation.ts  评分聚合（rubric 权重）、选择题确定性判分、DEFAULT_RUBRIC
  variant.ts     变体校验（validateVariant）+ 落地（applyVariant）
  learner.ts     Learner Memory：updateLearner / sessionFromQuiz / recommendWeakTopics
                 / buildCoachDefinition / recommendationText（Training Coach 数据核心）

ai/            LLM 适配层，应用只依赖 LLMProvider 接口（实现仅两套：Chrome / PiAI；
               多引擎按 AIConfig.providers 顺序组成降级链，ADR-023）
   pi.ts             pi-ai 底层封装（buildModels / callLLM / extractJSON；local 在此路由到
                     createProvider 注册的自定义 provider，ADR-022）
   chrome.ts         Chrome Prompt API 封装（chromeAvailability / chromeComplete，ADR-021）
   local.ts          本地 OpenAI 兼容服务 provider 构建（默认 Unsloth 127.0.0.1:8888/v1）
   variant.ts        变体生成（one-shot 重写题干；complete 由 provider 注入，不感知底层）
   evaluate.ts       开放形态评分（one-shot 四维评分；overall 由 domain 聚合；同上注入 complete）
   provider.ts       LLMProvider 工厂 + isEntryValid/isConfigValid
                     + ChromeAIProvider / PiAIProvider / FallbackProvider（降级链，ADR-023）

storage/       本地持久化
  settings.ts    LLM 配置（localStorage）
  learner.ts     LearnerProfile / SessionRecord（localStorage v1 key）

application/
  interviewEngine.ts  应用服务：buildSession / nextAdaptiveStep / evaluateAnswer / evaluateSession

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
                                 providers 数组顺序即降级链优先级；保存时整体校验，
                                 错误定位到 providers[i]；chrome 可用性状态展示，ADR-023/ADR-025）

data/questions/       题库（用户数据契约，按类目一文件：questions/<slug>.json；
                       slug 类目 + topic/tags + 可选 rubric；237 题全部同时携带
                       choice 与 open 双形态（ADR-027），其中 173 题的选择形态带
                       场景化专属题干 cf.question（ADR-028，工程决策/安全治理/
                       生产运维类）；ai-fundamentals（基础原理）→ agentic-ai /
                       ai-engineering（工程判断）按能力维度组织）
data/questionBank.ts  题库装配（import.meta.glob eager 合并；刻意不建索引/数据库层，
                       规模需要时再加动态 import + 构建期 question-index）
data/conceptGraph.json  知识图谱（两类有向边 prerequisite/related；
                         prerequisite 构成基础→进阶 DAG）
data/knowledge/        知识点层（ADR-029，按领域一文件：knowledge/<area>.json，×8 领域）。
                        知识点是一等公民、题目只是它的 View：节点 id = topic slug
                        （与题目 / conceptGraph / Learner Memory 同一 join key），携带四类
                        "修饰素材"——summary（变体与复盘锚点）/ required（评分必须要点，
                        题目未自带 rubric.required 时回退注入）/ misconceptions（干扰项、
                        追问与 gap 分析素材）/ angles（definition→mechanism→calculation→
                        tradeoff→scenario→system-design 的出题角度梯度）。节点必须有题目
                        支撑（无悬空节点，测试强制）；gaps 机制输出下一步该补的题
data/knowledgeMap.ts   知识点装配（import.meta.glob eager 合并，同 questionBank 模式）
types.ts              全局类型（含 LLMProvider / LearnerProfile）
```

依赖方向：`components → application(interviewEngine) → domain + ai`；`ai → domain`（复用评分聚合等纯函数）；`domain` 不依赖 React、不 import 任何 LLM 库。

**ai → domain 的边界约定**：`ai` 只允许依赖 domain 的**纯计算函数**（`evaluation.aggregateOverall`、`provider.mergeQuestionRubric`、variant 校验等），
不得依赖业务流程模块（`learner` / `adaptive` / `quiz`）——AI 层只负责"生成/评价语言内容"，不理解产品业务流。

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
   InterviewSession.questions: SessionQuestion[] (question 快照 + format + 用户答案 + 评分)
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

## LLM 能力边界（ADR-019 / ADR-021 / ADR-023）

一句话：**Domain 决策是核心，LLM 只是插件；pi-agent-core 只在"需要连续对话"的场景回归。**

```
Quiz / 训练流程 ──→ createLLMProvider(AIConfig)：启用且合法的引擎按配置顺序串成链（ADR-023）
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
对话式模拟面试   ──→ （未来）pi-agent-core，仅此场景引入 Agent
```

- 当前所有 LLM 调用都是 one-shot 结构化生成，无状态、无事件流；`interviewAgent.ts` 与 pi-agent-core 依赖已删除。
- **双底层（ADR-021）**：`variant` / `evaluate` 只依赖注入的 `CompleteFn(system, user)`，
  pi-ai 与 Chrome Prompt API 各自实现；prompt 构建、JSON 解析、评分兜底逻辑只有一份。
  chrome 通道无需 apiKey/model（isEntryValid 按引擎区分）；运行时模型不可用会抛错，
  在降级链中表现为"切换到下一引擎"，链尾才由 interviewEngine 现有 catch 兜底
  （原题 / 不评分），不做 polyfill。设置页用 `chromeAvailability()` 展示本地模型状态
  （available/downloadable/downloading/unavailable）。
- **多引擎降级链（ADR-023）**：`AIConfig.providers` 是有序数组，典型排布
  chrome → local → 云端强模型——免费本地模型优先，失败自动落到云端兜底。
  LLMProvider 接口不携带 config：实现类构造时绑定自己的 ProviderEntry，
  interviewEngine 只向工厂传一次 AIConfig。
- 回归条件：真正实现"面试官追问 → 候选人回答 → 继续追问"的多轮对话时，才重新引入 Agent 层；
  在那之前不保留任何死代码占位。

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
```

- **记忆是"结构化信号"而非对话原文**：不把用户历史回答塞给 LLM；Coach 只看压缩画像（如 `tool-calling: weak`）。
- **掌握度**：`mastery = avgScore/100`，简单直接（ADR-019）；置信度由 `attempts` 字段本身表达，不做加权公式。`trend` 由"上次得分 vs 历史均分"判定（±2 分阈值）。
- **薄弱主题推荐**：`mastery < 0.85 且 avgScore < 85` 的主题按掌握度升序取前 3，写入 `InterviewDefinition.topicPriorities`；`buildSession` 用 `pickPrioritized` 保证薄弱主题的题优先进入训练。
- **持久化**：`storage/learner.ts`（localStorage `learner.v1`）；MVP 足够，数据量大（对话/流式结果）再迁 IndexedDB。
- **边界**：推荐逻辑当前为确定性规则（纯函数、可测）；未来"教练叙事 / 追问面试"可接 `pi-agent-core`，但 Agent 只读压缩画像，不读全文。

## LLM 变体安全（关键）

安全模型（ADR-019）：**LLM 只允许重写题干与解析，答案数据结构上就不在它的输出契约里**——
不靠校验兜底，靠收窄权限杜绝"选项重排导致 answer 索引错位"这类事故：

```
Canonical Question ──→ LLM（只输出 question / explanation）
        │                     ↓ validateVariant（唯一硬校验：题干非空）
        │                通过 → applyVariant：只替换题干/解析，
        │                      formats（options/answer/referenceAnswer）原样保留
        └──────────────── 失败 → 保留原题（会话持有的是快照副本，题库对象永不被写）
```

要点：
- 变体中选择题的 options/answer 与开放题的 referenceAnswer 永远来自原题——LLM 不接触任何答案数据。
- ADR-027 起「选择 ⇄ 开放」不再是运行时 LLM 变换：两种形态的内容都在题库静态维护
  （一次性迁移补齐，见 CHANGELOG 2026-08-23），运行期只做确定性分配，无额外 LLM 成本与审计负担。
- 原 ADR-024 的 transform 管线（ai/transform.ts、transformAudit 审计日志、
  transformedFrom 字段）已整体删除。

## 评分 Rubric（四维 + 题目级覆盖）

开放题 `EvaluationResult` 拆为四维度（默认权重和为 1）：

| 维度 | 含义 | 默认权重 |
| --- | --- | --- |
| correctness 正确性 | 是否命中核心要点 | 0.4 |
| completeness 完整性 | 是否覆盖应有要点、无明显遗漏 | 0.2 |
| architecture 架构 | 方案/代码结构是否合理（编程题看实现质量） | 0.2 |
| communication 表达 | 清晰度、条理与专业性 | 0.2 |

综合分 `overall` = Σ(dim × weight)，**只**由 `domain/evaluation.aggregateOverall` 计算——LLM 只输出四维 dimensions，不拥有最终分数（ADR-019）。选择题四维同取 100/0。

**题目级 rubric（可选）**：`questions/<category>.json` 里每题可带 `rubric`：

```json
"rubric": {
  "required": ["规划器", "检索器", "失败重试"],
  "dimensions": { "correctness": 0.25, "completeness": 0.25, "architecture": 0.35, "communication": 0.15 }
}
```

- `required`：必须覆盖的要点，注入评分提示，命中情况计入 completeness。
- `dimensions`：该题的四维权重覆盖（未给的维度沿用全局 `InterviewDefinition.scoringRubric`），在 `PiAIProvider.evaluateOpenAnswer` 里合并。
- **知识点回退（ADR-029）**：题目未自带 `rubric.required` 时，`mergeQuestionRubric` 回退到该题 topic 对应知识节点（`data/knowledge/`）的 `required`——评分锚点的默认来源是知识点层而非逐题手写。

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
  `{ providers: [{ id: 'deepseek', model: 'deepseek-v4-flash', ... }] }`；旧单选形态
  （`{ provider, ... }`）由 loadConfig 自动迁移（key 不变，ADR-023）；
  示例配置见 `docs/config.example.json`。
- **pi-ai 浏览器注入密钥**：走 `createModels({ credentials })` 内存 `CredentialStore`；
  Cloudflare 额外经 credential.env 注入 `CLOUDFLARE_ACCOUNT_ID`（其 auth 协议要求 Token + Account ID 双字段）。
- **设置页 = config.json 编辑器（ADR-025/026）**：引擎为
  `chrome / local / deepseek / openrouter / google / cloudflare-workers-ai` 六种（ADR-026 扩容），
  设置面板不再逐引擎表单，而是 Monaco JSON 编辑器直接编辑配置；保存时
  `parseConfigJSON`（storage/settings.ts，纯函数有测试）整体校验并清洗，
  错误信息定位到 `providers[i]`。历史配置中的已下线引擎 id 由 loadConfig/sanitizeEntry 静默丢弃。
- **浏览器直连 LLM 受 CORS 限制**：实测 CORS 友好的云端为 DeepSeek / OpenRouter /
  Google Generative Language API / Cloudflare API（ADR-026）；OpenAI、Anthropic 直连仍不可用，
  有需求走本地 OpenAI 兼容网关（id=local 指向代理地址）。
- **pi-ai 对浏览器友好**：库内部对 `globalThis.process` 与 `node:fs` 做了守卫/懒加载，打包时 `node:fs` 外部化为警告，属预期且不崩。
- **pi-agent-core 已移除**（ADR-019）：当前无 Agent 依赖；对话式面试回归时再引入（届时注意其 dist 顶层 import `node:crypto/fs/...` 会被 externalize 成警告，只用 Agent 不触 harness 则不崩）。
- **monaco-editor 0.56 exports map 对深层导入是坏的**：`monaco-editor/esm/vs/**` 深层导入在 Node 与 rolldown 下均 `ERR_MODULE_NOT_FOUND`（`./*.js → ./esm/vs/*.js` 的 star 替换路径错误），`resolve.alias` 也救不了。解法：worker 用相对路径 `../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker` 绕过包解析；主库走 `import * as monaco from 'monaco-editor'`（`.` 入口正常）。
- **Shiki grammar 懒加载**：语法文件是独立 chunk，渲染对应语言时才下载；主包只含核心引擎。
- **构建**：`npm run build` 用 `tsc -b && vite build`，开启 `noUnusedLocals`，未使用 import/变量直接报错；`*.test.ts` 已从 tsc 排除，由 Vitest 处理。
- **密钥定位**：local-first 隐私友好，但浏览器侧密钥**不是安全机密**（受 XSS / 扩展威胁），勿用高权限生产密钥。
