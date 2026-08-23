# 架构设计

## 总体形态

单页应用（SPA）：`Vite + React 18 + TypeScript + Ant Design`。LLM 能力通过 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` 在**浏览器内**直连，用户密钥存 `localStorage`，无独立后端。

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
  models.ts          pi-ai 底层封装（buildModels / callLLM / extractJSON / 密钥注入）
  variantGenerator.ts 变体生成（one-shot，走 pi-ai；不需要 Agent）
  interviewAgent.ts   面试评价 Agent（走 pi-agent-core；状态化 / 事件流，未来可扩展追问）
  provider.ts         LLMProvider 工厂 + isConfigValid + PiAIProvider（委托上面两者）

storage/       本地持久化
  settings.ts    LLM 配置（localStorage）
  learner.ts     LearnerProfile / SessionRecord（localStorage v1 key）

lib/
  interviewEngine.ts  编排：buildSession / evaluateAnswer / evaluateSession
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
  settings/SettingsPanel.tsx    AI 设置（provider / model / API Key）

data/questions.json   题库（用户数据契约，slug 类目 + topic/tags/reference + 可选 rubric；100 题，
                       其中 agentic-ai 按 Scenario/Debugging/Trade-off/开放题等能力维度组织）
data/conceptGraph.json  知识图谱（typed nodes + 10 类有向边；prerequisite 构成基础→进阶 DAG）
types.ts              全局类型（含 LLMProvider / LearnerProfile）
```

依赖方向：`components → lib(interviewEngine) → domain + ai`；`ai → domain`（评分聚合复用）；`domain` 不依赖 React、不 import 任何 LLM 库。

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
  `@dagrejs/graphlib`。节点带类型（concept/architecture/pattern/technique/problem/tradeoff/decision/metric），
  边带类型与方向（prerequisite/part_of/extends/alternative/tradeoff/contrasts/related_to/technique +
  面试迁移 deep_dive/challenge）；prerequisite 是"基础→进阶"DAG——加载期 `isAcyclic` 校验（有环即抛错），
  `topsort` 提供学习顺序，`prerequisiteClosure` 做传递闭包。
  节点复用题库 `topic` 字段，domain 复用 category。
- **覆盖面地图**：`computeCoverage()` 按类目统计 练过/掌握 的 topic 比例；
  blocked 判定沿前置闭包上溯（根因未掌握则高级主题被标记为"先补前置"）。
  ProgressPage 展示类目覆盖条 + `suggestNextTopics()` 学习建议。
- **证据链**：`TopicStats.evidence`（questionId/score/at，最近 10 条）让掌握度可回溯到具体作答，
  而非裸分数；updateLearner 每次会话追加。
- **教练推荐升级**：`buildCoachDefinition` 的 topicPriorities 经
  `expandWithPrerequisites()` 沿前置闭包展开（先补地基再攻难点）。
- **边界**：策略决策当前为确定性规则（可测、可解释）；Contradiction Probe 与 LLM 策略 Agent
  （每轮输出 candidate_state + next_strategy JSON）是后续演进方向，届时 LLM 只决定策略、仍从结构化题池选题。

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
   InterviewSession  (抽中的题目 + 变体记录 + 用户答案 + 评分)
        │
        ↓  evaluateAnswer() / evaluateSession()
   EvaluationResult  (overall 0-100 + 四维 dimensions + strengths/gaps/feedback)
```

- 选择题：`gradeChoice` 确定性判分（选中集合 == 正确答案集合）。
- 开放/编程题：走 `LLMProvider.evaluateOpenAnswer`，无 provider 时返回 null（UI 提示未评分）。

## Interview Agent 层（pi-agent-core）

职责边界（ADR-012）：**Quiz Domain 完全自写，pi-agent-core 只管 "LLM Agent 层"**：

```
React UI ──┬──→ Quiz Domain（抽题/判分/进度/会话，纯 TS，无 Agent）
           └──→ LLMProvider.evaluateOpenAnswer
                          │
                          ↓
              ai/interviewAgent.ts（唯一依赖 pi-agent-core 的地方）
                          │   new Agent({ systemPrompt, model, streamFn })
                          ├── agent.prompt()  +  agent.subscribe(message_update → text_delta)
                          ├── 流式 delta 拼成完整文本 → parseEvaluation → EvaluationResult
                          └── 状态化 transcript，未来可直接扩展成"追问型面试 loop"（continue / steer）
                          ↓
                 pi-ai（streamSimple 作 Agent 的 streamFn；浏览器 local-first，无后端代理）
```

- **变体不走 Agent**：one-shot 结构化生成用 `variantGenerator.ts`（pi-ai），不需要状态与事件流。
- **依赖注入便于测试**：`InterviewAgent` 构造时注入 `(model, streamFn)`；测试用 mock `streamFn`（按 `start → text_delta → done` 事件协议）驱动**真实 Agent**，不发网络请求（见 `src/ai/interviewAgent.test.ts`）。
- **浏览器 bundle 结论**：pi-agent-core 不静态 import `pi-ai/compat`（旧 issue #6851 的场景已不存在），provider 代码被 pi-ai 拆成按需懒加载 chunk；其自身引用的 `node:fs/crypto/...` 在浏览器构建中 externalize 成警告，运行时只用 `Agent`（不触 harness），不崩。代价是主 chunk 变大（约 1.3 MB / 380 kB gzip），local-first 工具可接受。

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
- **掌握度**：`mastery = avgScore/100 × 置信度因子`（尝试 <5 次时压低，≥5 次收敛到真实水平）；`trend` 由"上次得分 vs 历史均分"判定（±2 分阈值）。
- **薄弱主题推荐**：`mastery < 0.85 且 avgScore < 85` 的主题按掌握度升序取前 3，写入 `InterviewDefinition.topicPriorities`；`buildSession` 用 `pickPrioritized` 保证薄弱主题的题优先进入训练。
- **持久化**：`storage/learner.ts`（localStorage `learner.v1`）；MVP 足够，数据量大（对话/流式结果）再迁 IndexedDB。
- **边界**：推荐逻辑当前为确定性规则（纯函数、可测）；未来"教练叙事 / 追问面试"可接 `pi-agent-core`，但 Agent 只读压缩画像，不读全文。

## LLM 变体安全（关键）

变体生成遵循 `domain/variant.validateVariant` 的硬校验，失败则**回退原题**：

```
Canonical Question ──┬──→ LLM ──→ GeneratedVariant
                     │                │
                     │                ↓
                     │          validateVariant
                     │           ├─ 选择题：options 长度须一致、answer 索引在 [0,len)
                     │           └─ 开放题：题干非空即可（referenceAnswer 不被 LLM 改写）
                     │                │
                     └── 通过 → applyVariant（落地变体，aiGenerated=true）
                         失败 → 保留原题
```

要点：**开放题的 `referenceAnswer`（答案 key）永远来自原题**，`applyVariant` 刻意不覆盖它；`GeneratedVariant` 记录 `sourceQuestionId` 与 `generatedBy` 便于调试。

## 评分 Rubric（四维 + 题目级覆盖）

开放题 `EvaluationResult` 拆为四维度（默认权重和为 1）：

| 维度 | 含义 | 默认权重 |
| --- | --- | --- |
| correctness 正确性 | 是否命中核心要点 | 0.4 |
| completeness 完整性 | 是否覆盖应有要点、无明显遗漏 | 0.2 |
| architecture 架构 | 方案/代码结构是否合理（编程题看实现质量） | 0.2 |
| communication 表达 | 清晰度、条理与专业性 | 0.2 |

综合分 `overall` = Σ(dim × weight)，由 `domain/evaluation.aggregateOverall` 计算；LLM 也可直出 overall（优先使用）。选择题四维同取 100/0。

**题目级 rubric（可选）**：`questions.json` 里每题可带 `rubric`：

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
- **pi-ai 浏览器注入密钥**：走 `createModels({ credentials })` 内存 `CredentialStore`；provider id 为 `openai / anthropic / openrouter`。
- **浏览器直连 LLM 受 CORS 限制**：默认推荐 **OpenRouter**；OpenAI/Anthropic 直连可能失败，需自配代理。
- **pi-ai 对浏览器友好**：库内部对 `globalThis.process` 与 `node:fs` 做了守卫/懒加载，打包时 `node:fs` 外部化为警告，属预期且不崩。
- **pi-agent-core 浏览器构建**：其 dist 顶层 import `node:crypto/fs/os/path/readline/url`，Vite 会 externalize 成警告；只要运行时只用 `Agent`（不调用 harness 的文件/Shell 能力）就不会崩。主 chunk 约 1.26 MB / 369 kB gzip，比引入前大但可接受；provider 代码是懒加载 chunk，不进主包。
- **Agent 层测试**：mock `streamFn` 需按 pi-ai 事件协议产出 `start → text_delta → done`（`done` 要带完整 `AssistantMessage`，否则流不结束、`waitForIdle` 挂起）。见 `src/ai/interviewAgent.test.ts`。
- **monaco-editor 0.56 exports map 对深层导入是坏的**：`monaco-editor/esm/vs/**` 深层导入在 Node 与 rolldown 下均 `ERR_MODULE_NOT_FOUND`（`./*.js → ./esm/vs/*.js` 的 star 替换路径错误），`resolve.alias` 也救不了。解法：worker 用相对路径 `../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker` 绕过包解析；主库走 `import * as monaco from 'monaco-editor'`（`.` 入口正常）。
- **Shiki grammar 懒加载**：语法文件是独立 chunk，渲染对应语言时才下载；主包只含核心引擎。
- **构建**：`npm run build` 用 `tsc -b && vite build`，开启 `noUnusedLocals`，未使用 import/变量直接报错；`*.test.ts` 已从 tsc 排除，由 Vitest 处理。
- **密钥定位**：local-first 隐私友好，但浏览器侧密钥**不是安全机密**（受 XSS / 扩展威胁），勿用高权限生产密钥。
