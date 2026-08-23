# 架构设计

## 总体形态

单页应用（SPA）：`Vite + React 18 + TypeScript + Ant Design`。LLM 能力通过 `@earendil-works/pi-ai` 在**浏览器内**直连（one-shot 调用），用户密钥存 `localStorage`，无独立后端。pi-agent-core 已移除——对话式 Agent 仅在"对话式模拟面试"落地时回归（Future/Experimental，ADR-019）。

**产品定位（ADR-015）**：个人 AI 面试教练，不是题库测试配置器。首页是训练入口（继续/快速/自定义），系统内部概念（评分权重、API Key 状态）不暴露给用户；每次训练都会沉淀 Learner Memory，并据此推荐下一次训练。

**核心原则**：题库是 source of truth，LLM 是 enhancement layer（不是题库本身）。变体的答案 key 永远来自原题，LLM 只改表达。

## 分层

```
domain/        纯 TypeScript 逻辑，不依赖 React / 网络（全部有单测覆盖）
  categories.ts  类目 slug → 中文标签
  quiz.ts        抽题（Fisher–Yates）、题型判定、pickPrioritized（薄弱主题优先）
  evaluation.ts  评分聚合（rubric 权重）、选择题确定性判分、DEFAULT_RUBRIC
  variant.ts     变体校验（validateVariant）+ 落地（applyVariant）
  learner.ts     Learner Memory：updateLearner / sessionFromQuiz / recommendWeakTopics
                 / buildCoachDefinition / recommendationText（Training Coach 数据核心）

ai/            LLM 适配层，应用只依赖 LLMProvider 接口
   pi.ts             pi-ai 底层封装（buildModels / callLLM / extractJSON / 密钥注入）
   chrome.ts         Chrome Prompt API 封装（chromeAvailability / chromeComplete，ADR-021）
   variant.ts        变体生成（one-shot 重写题干；complete 由 provider 注入，不感知底层）
   evaluate.ts       开放题评分（one-shot 四维评分；overall 由 domain 聚合；同上注入 complete）
   provider.ts       LLMProvider 工厂 + isConfigValid + PiAIProvider / ChromeAIProvider

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
  settings/SettingsPanel.tsx    AI 引擎设置（本地 Chrome AI / 云端 provider + model + API Key，
                                 chrome 时隐藏密钥项并展示模型可用性）

data/questions/       题库（用户数据契约，按类目一文件：questions/<slug>.json；
                       slug 类目 + topic/tags/reference + 可选 rubric；237 题，
                       ai-fundamentals（基础原理）→ agentic-ai / ai-engineering（工程判断）按
                       Scenario/Debugging/Trade-off 等能力维度组织）
data/questionBank.ts  题库装配（import.meta.glob eager 合并；刻意不建索引/数据库层，
                       规模需要时再加动态 import + 构建期 question-index）
data/conceptGraph.json  知识图谱（两类有向边 prerequisite/related；
                         prerequisite 构成基础→进阶 DAG）
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
InterviewDefinition  (声明式：categories / difficulties / questionTypes
                       / count / useAI / scoringRubric / timeLimitSec / evaluationCriteria)
        │
        ↓  interviewEngine.buildSession()
   InterviewSession  (抽中的题目 + 用户答案 + 评分)
        │
        ↓  evaluateAnswer() / evaluateSession()
   EvaluationResult  (overall 0-100 + 四维 dimensions + strengths/gaps/feedback)
```

- 选择题：`gradeChoice` 确定性判分（选中集合 == 正确答案集合）。
- 开放/编程题：走 `LLMProvider.evaluateOpenAnswer`，`useAI=false` 或无有效 provider 时返回 null
  （UI 提示未评分）——useAI 开关同时门控变体出题与开放题评分。
- 题目级 `rubric.required` 会注入评分提示、`rubric.dimensions` 覆盖全局权重
  （合并逻辑在 `ai/provider.mergeQuestionRubric`，纯函数有测试）。

## LLM 能力边界（ADR-019 / ADR-021）

一句话：**Domain 决策是核心，LLM 只是插件；pi-agent-core 只在"需要连续对话"的场景回归。**

```
Quiz / 训练流程 ──→ LLMProvider（工厂按配置分派）
                      ├── PiAIProvider     → ai/pi.ts（pi-ai one-shot，云端，需 API Key）
                      │     ├── ai/variant.ts    变体 = 只重写题干
                      │     └── ai/evaluate.ts   开放题评分 = 四维 dimensions
                      │           ↓ overall 由 domain/aggregateOverall 计算
                      └── ChromeAIProvider → ai/chrome.ts（Prompt API，本地模型，免密钥）
                            复用同一套 variant/evaluate 编排（CompleteFn 注入）
对话式模拟面试   ──→ （未来）pi-agent-core，仅此场景引入 Agent
```

- 当前所有 LLM 调用都是 one-shot 结构化生成，无状态、无事件流；`interviewAgent.ts` 与 pi-agent-core 依赖已删除。
- **双底层（ADR-021）**：`variant` / `evaluate` 只依赖注入的 `CompleteFn(system, user)`，
  pi-ai 与 Chrome Prompt API 各自实现；prompt 构建、JSON 解析、评分兜底逻辑只有一份。
  `provider==='chrome'` 时无需 apiKey/model（isConfigValid 按引擎区分）；运行时模型不可用会抛错，
  由 interviewEngine 现有 catch 兜底降级（原题 / 不评分），不做 polyfill。
  设置页用 `chromeAvailability()` 展示本地模型状态（available/downloadable/downloading/unavailable）。
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
        │                      options、answer、referenceAnswer 原样保留
        └──────────────── 失败 → 保留原题
```

要点：
- 选择题的 options/answer 永远来自原题——LLM 不接触选项顺序，索引错位不可能发生。
- 开放题的 `referenceAnswer` 永远来自原题。
- 变体只含重写后的题干/解析（`GeneratedVariant`），不含任何答案数据与溯源元数据；
  是否变体成功由题目上的 `aiGenerated` 标记表达。

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

## 技术栈注意点

- **antd 为 6.x**：`Divider` 仅支持 `horizontal / vertical`，无 `orientation` 左右。
- **Chrome Built-in AI（Prompt API）**：仅较新 Chrome 提供，无跨浏览器保证；运行时用
  `(globalThis as any).LanguageModel?.availability()` 能力检测（API 缺失/异常一律视为 unavailable），
  不引入 polyfill。每次调用新建 session 并 destroy（one-shot 无状态）；system prompt 走
  `initialPrompts`。模型 downloadable 状态下首次 create 可能触发下载。
- **pi-ai 浏览器注入密钥**：走 `createModels({ credentials })` 内存 `CredentialStore`；provider id 为 `openai / anthropic / openrouter`。
- **浏览器直连 LLM 受 CORS 限制**：默认推荐 **OpenRouter**；OpenAI/Anthropic 直连可能失败，需自配代理。
- **pi-ai 对浏览器友好**：库内部对 `globalThis.process` 与 `node:fs` 做了守卫/懒加载，打包时 `node:fs` 外部化为警告，属预期且不崩。
- **pi-agent-core 已移除**（ADR-019）：当前无 Agent 依赖；对话式面试回归时再引入（届时注意其 dist 顶层 import `node:crypto/fs/...` 会被 externalize 成警告，只用 Agent 不触 harness 则不崩）。
- **monaco-editor 0.56 exports map 对深层导入是坏的**：`monaco-editor/esm/vs/**` 深层导入在 Node 与 rolldown 下均 `ERR_MODULE_NOT_FOUND`（`./*.js → ./esm/vs/*.js` 的 star 替换路径错误），`resolve.alias` 也救不了。解法：worker 用相对路径 `../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker` 绕过包解析；主库走 `import * as monaco from 'monaco-editor'`（`.` 入口正常）。
- **Shiki grammar 懒加载**：语法文件是独立 chunk，渲染对应语言时才下载；主包只含核心引擎。
- **构建**：`npm run build` 用 `tsc -b && vite build`，开启 `noUnusedLocals`，未使用 import/变量直接报错；`*.test.ts` 已从 tsc 排除，由 Vitest 处理。
- **密钥定位**：local-first 隐私友好，但浏览器侧密钥**不是安全机密**（受 XSS / 扩展威胁），勿用高权限生产密钥。
