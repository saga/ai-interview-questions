# 关键决策记录（ADR）

> 记录影响架构走向的关键决策及其理由。新决策追加在顶部，保留历史便于追溯。

## ADR-019 · 架构收敛（减法）：LLM 是插件，Domain 拥有分数与决策

- 状态：已采纳 · 2026-08-23
- 背景：MVP 阶段同时存在 Interview Engine、Adaptive Strategy、Concept Graph、pi-agent-core 四套机制，
  接近"小型 learning platform"；且存在三处安全隐患/职责模糊（变体可改 options/answer、开放题校验过弱、
  LLM 可直出 overall）。
- 决策：
  - **pi-agent-core 移除**：当前所有 LLM 调用都是 one-shot 结构化生成，不需要 Agent。开放题评分改走
    `ai/evaluate.ts`（pi-ai one-shot）；`interviewAgent.ts` 及其测试删除，依赖从 package.json 移除。
    回归条件 = 真正实现对话式模拟面试（Future/Experimental，届时不留死代码占位）。
  - **变体安全收窄**：LLM 只允许重写题干与解析；选择题 options/answer、开放题 referenceAnswer 在
    applyVariant 中原样保留——索引错位事故在结构上不可能发生，validateVariant 退化为"题干非空"。
  - **分数所有权**：LLM 只输出四维 dimensions + 反馈；overall 一律由 `domain/aggregateOverall` 按权重计算，
    忽略 LLM 直出的任何总分。Domain 拥有最终分数。
  - **图边砍到两类**：10 种关系收敛为 `prerequisite`（DAG）+ `related`（无向）；deep_dive/challenge/
    part_of/tradeoff 等类型删除。nodeTypes 保留（覆盖面展示仍用）。graphlib 保留但限定在 conceptGraph 模块内。
  - **mastery 简化**：`mastery = avgScore/100`，置信度由 attempts 表达，不做加权公式。
  - **分层归位**：`lib/interviewEngine.ts` → `application/interviewEngine.ts`（应用服务层，非 utils 垃圾桶）；
    ai 层文件重命名为 pi / variant / evaluate / provider。
  - **保留不动**：Evidence 链（差异化价值）、localStorage（数据量小）、确定性自适应策略（不引入 LLM 策略 Agent）、
    全局+题目两级 rubric（不再加 category/difficulty/model 维度的 rubric）。
- 理由：下一步决定产品好坏的是题库质量、推荐效果与 LLM 评分质量，而不是架构能力；
  收敛后每一层职责单一、边界清晰，为上述三者让路。
- 后续重点：题库质量、Learner Memory 推荐效果、LLM 评分质量。

## ADR-018 · 知识图谱正规化（typed nodes + typed edges + 前置 DAG + evidence）

- 状态：已采纳 · 2026-08-23（演进 ADR-017 的概念图）
- 背景：首版图只有 `related` / `prerequisites` 两种无类型列表，无法回答"是什么关系、谁是子概念、
  哪个更基础、答好后该往哪追问"；且双向边重复、前置不成 DAG、掌握度是无证据的裸分数。
- 决策：
  - **typed nodes**：每个 topic 标注 nodeType（concept/architecture/pattern/technique/problem/
    tradeoff/decision/metric），domain 直接复用题库 category，不为节点重复存域。
  - **typed directed edges**：10 种关系（prerequisite / part_of / extends / alternative / tradeoff /
    contrasts / related_to / technique + 面试迁移 deep_dive / challenge）。每对主题只存一条有向边，
    无向语义（related 族）由遍历层双向展开。
  - **prerequisite 是有向 DAG**：方向统一"基础 → 进阶"，`prerequisiteClosure` 支持传递闭包——
    高级主题的前置未掌握时，gap-probe 与覆盖面判定沿闭包回退到根因。
  - **evidence 落库**：`TopicStats.evidence`（questionId/score/at，最近 10 条）让掌握度可回溯到
    具体作答；localStorage v1 结构为附加可选字段，向后兼容。
  - **自适应选题消费新图**：deep-dive 优先级 = 同主题更高难度 → 图声明的 deep_dive 目标 → 子概念；
    gap-probe 沿前置闭包回退；broaden 用无向语义族。
- 理由：题目本身不稀缺，**关系与证据才是评估引擎的地基**。渐进式正规化（不推倒题库、不改题型）
  让后续 per-dimension mastery 与 Contradiction Probe 有处可挂。
- 后续：题目级 `dimension` 标注（definition/mechanism/failure-mode/tradeoff...）→ 候选人模型升级为
  concept × skill 维度矩阵；LLM 策略 Agent 读图输出策略 JSON。

## ADR-017 · 自适应面试引擎（迁移策略 + 概念图 + 覆盖面地图）

- 状态：已采纳 · 2026-08-23
- 背景：原流程"一次性随机组卷 → 全部答完再评分"无法模拟真实面试的追问与方向调整；用户需要
  "根据上一题表现深入（deep dive）或换方向（broaden）"，以及知识覆盖面/薄弱地图。
- 决策：
  - **下一题 = 决策而非抽取**：`domain/adaptive.ts` 定义 4 种迁移策略（deep-dive / gap-probe /
    broaden / move-on），由上一题 AnswerSignal（topic/score/difficulty）+ 概念图邻居可用性决定；
    纯函数、rng 可注入、全单测。
  - **知识图谱做在 topic 层**：`data/conceptGraph.json` 只存边（related/prerequisites），节点复用
    题库 topic 字段——避免给每道题维护 concepts 元数据。
  - **逐题模式**：`InterviewDefinition.adaptive` 开关；buildSession 只组第一题，UI 走 AdaptiveQuiz，
    提交即评分（选择题即时判分 / 开放题 LLM），引擎 `nextAdaptiveStep` 追加下一题；提前结束随时可用。
  - **覆盖面**：`computeCoverage` 按类目统计练过/掌握比例，前置全掌握的未学主题标记 readyToLearn；
    ProgressPage 展示覆盖条与学习建议；教练推荐经 `expandWithPrerequisites` 先补前置。
  - **LLM 的角色边界**：当前策略为确定性规则；未来 LLM 策略 Agent 只输出策略 JSON（candidate_state +
    next_strategy），仍从结构化题池选题——不让 LLM 凭空出题。
- 理由：题目本身不构成护城河，"作答信号 → 策略 → 选题 → 画像 → 推荐"闭环才是；确定性规则先行保证
  可靠性与可解释性，LLM 只在其真正增值处（策略叙述、追问生成）介入。
- 后续：Contradiction Probe（跨题矛盾检测）依赖逐题证据留存，随 LLM 策略 Agent 一并设计。

## ADR-016 · 代码展示与编辑分离（Shiki 只读 / Monaco 可编辑）

- 状态：已采纳 · 2026-08-23
- 背景：题库与 AI 反馈中出现大量代码（题干片段、参考答案、用户提交代码）。统一用一个控件（如直接上 Monaco）会把 bundle 与复杂度抬高一个数量级。
- 决策：
  - **只读展示 = Shiki**（`CodeBlock` / `RichText` + `lib/codeFence`）：TextMate grammar 高亮 + CSS 行号，覆盖题干片段/解析/参考答案。
  - **可编辑 = Monaco**（`CodeEditor`）：编程题作答；**对比 = Monaco DiffEditor**（`CodeDiff`）：用户代码 vs 参考答案。
  - 两者都懒加载，只在出现编程题/展开对比时下载。
- 理由：Shiki 轻量且高亮质量与 VS Code 一致，足够覆盖 90% 只读场景；Monaco 的编辑/diff 能力只有"写代码"才需要。演进路径：Phase 3（代码执行/沙箱/AI Code Review）在 DiffEditor 基础上扩展，不推翻现有组件。
- 踩坑：monaco-editor 0.56 exports map 对深层导入解析有误，worker 需相对路径导入（详见 ARCHITECTURE「技术栈注意点」）。

## ADR-015 · 产品转向 Training Coach（Learner Memory + 四页结构）

- 状态：已采纳 · 2026-08-23
- 背景：首版 UI 把系统内部概念（Interview Definition / 评分权重 / API Key 状态）暴露给用户，像"题库测试配置器"而非"个人教练"。
- 决策：
  - **首页=训练入口**（继续训练 / 快速训练 / 自定义训练折叠），隐藏评分权重，API Key 移入设置页（首页仅 "AI ✓ / AI 未配置" chip）。
  - **Learner Memory**：`LearnerProfile`（topicStats 的 avgScore/mastery/trend/commonWeaknesses + 最近 50 条 SessionRecord），存 localStorage（MVP 够用，量大再迁 IndexedDB）。
  - **记忆=结构化学习信号，不是聊天记录**：不把用户历史对话塞给 LLM，只聚合"分数/弱项/掌握度"；Agent（后续 Training Coach）只看压缩画像。
  - **Coach 抽题**：`topicPriorities` + `pickPrioritized`，薄弱主题优先（mastery<0.85 且均分<85）。
  - 结果页：对比上次 delta / 强弱项 / AI 建议 / 继续训练；新增进度页（掌握度条 + 趋势 + 需要关注）与模拟面试页（30 分钟限时，追问 loop 待接）。
- 理由：产品核心 loop = 训练 → 评估 → 学习记忆 → 教练推荐 → 下一次训练；记忆与推荐是差异化价值，非锦上添花。
- 局限：推荐逻辑当前为确定性规则（纯函数，可测）；接入 LLM 的"Training Coach"叙事生成可复用 `pi-agent-core`（Agent 只读压缩画像，不读全文）。

## ADR-014 · Vitest 测试基建（落实 AGENTS 原则 2）

- 状态：已采纳 · 2026-08-23
- 背景：AGENTS.md 原则 2 要求"纯逻辑必须测"，但此前一直没有测试框架，`npm run test` 不存在。
- 决策：引入 **Vitest**（`npm run test` = `vitest run`，`vitest.config.ts` 独立于 vite.config，纯 node 环境）；`*.test.ts` 与被测代码同目录，并从 `tsconfig.app.json` 排除（不参与生产构建类型检查）。已覆盖：抽题/判分/评分聚合/变体校验（domain）+ 提示词构建/评估解析（ai 纯函数）+ **真实 pi-agent-core Agent + mock streamFn** 的集成测试（不发网络）。
- 理由：domain 与 ai 纯函数是确定性高风险区；Agent 集成测试验证事件流协议（`start→text_delta→done`），防止升级 pi-agent-core 时静默破坏。
- 约定：LLM 一律 mock；mock `streamFn` 必须产出 `done` 事件（否则 `waitForIdle` 挂起）。

## ADR-013 · 评分维度更名 + 题目级 rubric

- 状态：已采纳 · 2026-08-23（修订 ADR-008）
- 背景：评审建议题目自带 rubric（required 要点 + 维度权重），且原"深度 depth / 表达 clarity"命名与 Agentic/系统设计题的评估重点不贴合。
- 决策：四维更名为 **correctness / completeness / architecture / communication**（默认 0.4/0.2/0.2/0.2）；`Question.rubric` 支持 `required`（必须覆盖的要点，计入 completeness）与 `dimensions`（该题权重覆盖，`PiAIProvider.evaluateOpenAnswer` 合并进全局 rubric）。题库 5 道开放/编程题已带 rubric 样例。
- 理由：rubric 使评估提示更结构化（比"请打 0-100 分"可靠）；architecture 更贴合系统设计/编程题。

## ADR-012 · pi-agent-core 只做 "LLM Agent 层"，不接管 Quiz Engine

- 状态：已采纳 · 2026-08-23
- 背景：评估 `@earendil-works/pi-agent-core`（0.84.2，stateful + tool execution + event streaming）时，需界定其职责边界，避免把整个 Quiz Engine Agent 化。
- 决策：
  - **Quiz Domain 完全自写**（抽题/随机化/判分/进度/会话/结果），与 Agent 无关。
  - **开放/编程题评分走 Agent**：新增 `ai/interviewAgent.ts`（唯一依赖 pi-agent-core 处），`new Agent({ systemPrompt, model, streamFn })` + `subscribe(message_update→text_delta)` 流式拼文本 + `parseEvaluation` 结构化；未来可扩展成追问型面试 loop（continue/steer）。
  - **变体不走 Agent**：one-shot 生成留在 `variantGenerator.ts`（pi-ai），不需要状态与事件流。
  - 浏览器 local-first：用 pi-ai 的 `streamSimple` 作 Agent 的 `streamFn`，不引入后端代理。
- 理由：Agent 的价值在于状态化循环/流式/工具执行，而非"调一次 LLM"；刻意保留边界符合"不要为了用 Agent 而全部 Agent 化"。
- 验证：pi-agent-core 不静态 import `pi-ai/compat`（旧 #6851 场景已消失）；`node:fs/crypto/...` 在浏览器构建 externalize 成警告（只用 Agent、不触 harness 则不崩）；主 chunk 1.26 MB / 369 kB gzip，provider 代码为懒加载 chunk。

## ADR-011 · 目录分层 domain / ai / storage

- 状态：已采纳 · 2026-08-23
- 背景：原 `src/lib` 把纯逻辑、AI 调用、存储、编排混在一起，组件直接依赖 pi-ai。
- 决策：`domain/`（纯 TS，不依赖 React/网络）、`ai/`（LLMProvider 适配层，唯一碰 pi-ai 处）、`storage/`（localStorage）、`lib/interviewEngine.ts`（编排）、组件按 `quiz/result/settings` 分组。
- 理由：domain 可独立测试；换 LLM 底层不影响上层；符合"AI 藏在 adapter 后"的边界设计（ADR-007）。

## ADR-010 · API Key 定位为 local-first，非安全机密

- 状态：已采纳 · 2026-08-23
- 背景：原 README 称"密钥仅存浏览器"易被误解为安全存储。
- 决策：明确写为 local-first 隐私友好架构，但强调浏览器侧密钥受 XSS / 恶意扩展威胁，非安全机密，禁用高权限生产密钥。
- 理由：诚实的安全边界表述，避免误导用户。

## ADR-009 · 题库模型升级 + 重心调整

- 状态：已采纳 · 2026-08-23
- 背景：原题库仅有中文类目，缺 topic/tags，不利于按主题筛选；产品定位偏向泛 ML Quiz。
- 决策：每题加 `topic` / `tags` / `reference.concept`；`category` 改为 slug（如 `machine-learning`）；新增 `agentic-ai` 类目（10 题），保留原有 ML 基础题。显示层用 `domain/categories.ts` 的 `categoryLabel` 映射。
- 理由：topic/tags 支撑"只练 Agentic AI / Tool Calling / Hard"等精准筛选；slug 类目机器可读、利于扩展为开源平台。

## ADR-008 · 四维评分 Rubric

- 状态：已采纳 · 2026-08-23
- 背景：原评分仅"一个 0-100"或三维（正确/深度/表达），粒度不足。
- 决策：`EvaluationResult.dimensions` 改为 正确性 / 完整性 / 深度 / 表达 四维，默认权重 0.4/0.2/0.2/0.2，由 `aggregateOverall` 聚合。
- 理由：更贴合真实面试评估，结果面板可展示强弱项。

## ADR-007 · LLM 藏在 Adapter 后（LLMProvider 接口）

- 状态：已采纳 · 2026-08-23
- 背景：组件与 pi-ai 紧耦合，未来想换底层库会波及全局。
- 决策：定义 `LLMProvider` 接口（`generateVariant` / `evaluateOpenAnswer`），`PiAIProvider` 是唯一实现；上层只依赖接口，经 `createLLMProvider` 工厂获取。
- 理由：可替换性；符合"库是细节，接口是边界"。

## ADR-006 · 变体 answer key 来自原题 + 校验回退

- 状态：已采纳 · 2026-08-23
- 背景：让 LLM 自由重判答案索引易出错（原题 A 正确，变体错标 B）。
- 决策：`validateVariant` 强制校验（选择题 options 长度一致、answer 索引在范围内；开放题仅要求题干非空且 `referenceAnswer` 不被 LLM 改写），失败则回退原题。`GeneratedVariant` 记录 `sourceQuestionId` / `generatedBy`。
- 理由：题库权威不被 LLM 破坏，变体只改表达/顺序。

## ADR-005 · 文档分层（AGENTS / README / docs）

- 状态：已采纳 · 2026-08-23
- 背景：AGENTS.md 被混入"常用命令""技术栈注意点"，与"只放原则约定"的定位冲突。
- 决策：
  - `AGENTS.md` 只保留**原则性约定**（两大原则 + 测试约定）。
  - 常用命令移入 `README.md`（人类与 agent 的共同入口）。
  - 架构设计、技术栈踩坑、关键决策、设计变更分别落到 `docs/` 下独立文件。
- 理由：AGENTS.md 越瘦越好，避免与 README / docs 内容重复（违反"删死代码"原则）。

## ADR-004 · 多维评分模型

- 状态：已采纳 · 2026-08-23
- 背景：原方案仅给开放题一个 0–100 总分，反馈粒度不足。
- 决策：开放题/编程题的 `EvaluationResult` 拆为 `correctness(0.5) / depth(0.3) / communication(0.2)` 三维 + `strengths/gaps/feedback`；选择题仍确定性判分（仅 correctness）。
- 理由：更贴合真实面试评估维度，结果面板可展示强弱项。

## ADR-003 · 浏览器直连 LLM + localStorage 密钥

- 状态：已采纳 · 2026-08-23
- 背景：早期设想用后端 route 藏密钥（Astro SSR / FastAPI）。
- 决策：当前采用浏览器内直连，密钥仅存 `localStorage`，无后端。
- 理由：最快出可用版本；用户自带 key 也规避了平台密钥托管成本。代价是 CORS（默认推荐 OpenRouter）。若后续要做"平台托管题目/成绩"，再引入后端并迁移 LLM 调用到 server endpoint。

## ADR-002 · 不向后兼容（删死代码优先）

- 状态：已采纳 · 2026-08-23
- 背景：重构 EngInE 化时，是否保留旧 setup 逻辑做兼容。
- 决策：直接改成目标形态，确认无引用的导出/类型/文件立即删除，不留 `deprecated` / 兼容分支。
- 例外：对外 JSON 题库结构与 `localStorage` key 属用户数据契约，改动需显式说明。
- 理由：项目处于快速演进期，兼容层只会累积负担。

## ADR-001 · 技术栈选 React+Vite+antd，暂不迁 Astro

- 状态：已采纳 · 2026-08-23
- 背景：有提议将"Interview Trainer"迁到 Astro（内容站 + 交互岛）。
- 决策：**保持 React+Vite+antd 的 SPA**。
- 理由：
  - 当前就是单页高交互 quiz，React 路径最短，pi-ai 浏览器直连最顺。
  - Astro 的红利来自内容页/路由/SEO/静态生成——这些当前**一个都没有**。
  - 迁 Astro 若要藏 key，得把 LLM 调用从 client island 挪到 server route，是额外工作量而非免费升级。
- 触发条件：当真正要做"开源平台 / 内容站 / SEO / 多主题落地页 / 可扩展题库方法论"时，重新评估迁 Astro（把 quiz 当 React island 嵌）。
