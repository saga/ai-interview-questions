# 项目长期记忆（ai-interview-questions）

## 题库新增题目 / 知识节点的硬性约束（必读）
- `question.topic`（题侧）必须是 `src/data/knowledge/*.json` 里已有的**知识节点 id**（bank.test.ts 强制校验），不要写成 taxonomy 的 topic 或高层标签。
- 若需为全新子域**新建知识节点**：节点 `topic` 字段必须是 `src/data/taxonomy.ts` 骨架内合法的 topic id，且必须满足 `domainOfTopic(topic) === area`（taxonomy.test.ts 不变量）；节点 `id` 才是细粒度概念 slug。即「题侧 topic = 节点 id」「节点侧 topic = taxonomy 骨架 topic」两者不同，别把节点 topic 写成概念 id（会触发 taxonomy.test.ts 失败）。
- knowledge.test.ts 要求**每个知识节点至少有 1 道题**支撑（无悬空节点）；新建节点须同步配题。
- §4.2 格式门禁：一批 ≥3 道选择题时单选占比必须 ≤1/3，否则 `scripts/add-question.ts --check` 直接报错退出（应改写为多选，勿绕过）。少于 3 道小批量自动豁免。
- 选项长度平衡 ≤1.8×（中文按字符数，用 python `len()` 实测，勿手数估算）。
- angle 白名单 10 个：definition / fundamental / mechanism / comparison / calculation / tradeoff / scenario / debugging / system-design / design；不在白名单则改写。
- `scripts/question_analysis.py --semantic` 本仓不存在，语义去重只能人工复核（非阻断）。

## 结构化知识检索（ADR-063，2026-08-31）
- 模块：`src/domain/knowledge/`（`nodes` 知识点查询 / `documents` 投影 / `index` BM25 / `graph` 1-hop / `retrieve` 混合评分）；应用层 `application/conversation/knowledgeCapability.ts` 负责 scope 与答案安全模式（确定性正则，不额外调 LLM）。
- 真值隔离在**检索层**：`questionDocument` 把 explanation / choice.answer / referenceAnswer 放进 `sensitiveText`，`renderDocument(doc, mode)` 硬裁剪，不靠 prompt 约束模型。
- 题目证据槽位上限 `questionSlotLimit`：global/topic 下题目至多 2 条，`current_question` 与 `quiz` 放开。删过一版 `KIND_PRIORS` 乘性先验——实测无法改变排序，别再加。
- 改检索评分后**必须在真实语料上跑冒烟看 top5 组成**（题干+4 选项文本长，词面命中天然压过知识节点），只加单测看不出排序退化。
- 踩坑：把 `src/domain/knowledge.ts` 拆成目录时，旧文件挪进去后相对导入深度要 `../` → `../../`（含同名 `.test.ts`），否则 tsc 报 TS2307 但 `tsc -b` 退出码仍是 0，容易漏看。
- 踩坑：新 ADR 号取号前先 grep `docs/DECISIONS.md` 顶部，ADR-062 已占用（Chat×Agent 融合收敛）。

## 工具链注意（2026-09-02）
- 本机 `node_modules/.bin` 目录缺失、`@rolldown/pluginutils` 未安装 → `npx vitest run` / `npm test` 报 `command not found`（`zod`/`typescript`/`node` 本身可用）。修复：`npm install`。
- **vitest 不可用时的题库校验替代通道**（已验证）：① `node scripts/validate-questions.ts` 做结构+规则校验（注意它只 `import type`，**不做 zod schema 校验**）；② 自建脚本 `node --experimental-strip-types x.ts`，`import { questionSchema } from '<abs>/src/schemas/question.ts'` 后逐题 `safeParse`。
- 写含 `${...}` 的 TS/JS 时用 Write 工具落文件，别用 shell heredoc（zsh 会报 `Bad substitution`）。

## 题库内容提升基线（2026-09-02 起）
- 1308 题 / 123 节点 / 77 文件。单选 629（48.1%，§4.2 目标 ≤33.3%）、选项长度泄题 216 题 P2、缺 source 103、缺 misconceptions 1159、misconceptionMap 仅 97（7.4%）、覆盖 315/357 → 42 gap。
- **提升手法**：单选→多选改写时，同步把 `angle` 重定向到该文件 topic 下的 gap cell——一题同时消单选 + 填 gap，避免与既有补充题产生孪生冗余（同格 2–3 题属 healthy，≥4 才算 oversaturated）。
- **`misconceptionMap` 只能人工标注**：`scripts/backfill-misconceptions.ts` 用字符 2-gram Dice 匹配「选项文本 vs 误解文本」，实测覆盖率 ~12%（mis 是「以为…」句式、选项是陈述句，字面重合低）。脚本有 `if (cf.misconceptionMap) continue`，人工标注不会被覆盖。
- 单题精改（多选化 + 补 misconceptions/open/misconceptionMap）约 5–10 分钟，全库剩余 629 道单选约 50–100 小时，**必须按文件分批**。

## git 状态
- 截至 2026-09-02，全部改动（Prompt 分层重构 + AI 搜索 40 题 + 自我改进 Agent 7 题 + 多轮 taxonomy/App 修复 + 结构化知识检索 ADR-063 + 双模式 Variant ADR-069 + 题库内容提升试点）均**未 commit**，等用户指示。

## 离线变体生成（no-key 手动通道，2026-09-03）
- 无 API key 时由模型自身产出改写文本草稿（JSON：每题 `options` + `surface` + `context` 两 stem），再用 `scripts/assemble-variants.ts` 复用真实 `validateVariant`/`computeVariantSourceHash`/`variantPoolSchema` 组装落盘 `src/data/variants/*.json`；答案/解释恒取 canonical，不进产物。`scripts/validate-variants.ts` 做 stale + 近重复审计。
- `validateVariant` 门禁坑：① 题干禁含「下文」子串（会误伤「上下文」），纯中文题干需改写避开；② 选项漂移用 fuzzball `token_set_ratio`，而 fuzzball 按空白分词——含英文词（diff/Skill/Proposer/fingerprint/canary）的选项改写易过，纯中文选项一改就当单 token 判 `<45` 漂移，只能保留 canonical 原选项；③ length bias 用 `detectOptionLengthBias`（正确项=全局最长且最短=干扰项且差距≥1.8×，或均值比≥1.8×）。
- 单题两变体（surface-options / context-options）若共用同一套选项改写，互相~90%相似，按生成管线≥88去重会塌成1条/题；要2条真不同需对选项也差异化改写（但纯中文选项受②限制）。
- 现状：仅 `wiki-skill-evolution-2026-08.wb-llm-20260902.json` 一个 topic 有变体（21题/42变体，0 stale）。扩 topic + 提升选项多样性是下一阶段。⑨ 已于 2026-09-03 据实标记完成。

## 文档与代码一致性（2026-09-08）
- **文档里不要写死数字**（题数 / 文件数 / 节点数 / 角度数 / 阈值 / 依赖版本号）。
  `docs/ARCHITECTURE.md` 与 `README.md` 曾大面积过期（77 文件/1317 题 vs 实际 82/1357；
  「10 角度」vs 实际 19；薄弱阈值 0.85/85 vs 常量 0.75/75；`zod@4.4.3` vs 4.5.4）。
  写法约定：只写**常量名**（如 `WEAK_AVG`）或 CLI 口径，必要时加「勿写死数字，以 X 为准」。
- **`ARCHITECTURE.md` 的目录树是失修重灾区**（典型症状：正文引用了某模块，树里却没有）。
  新增 `src/**` 下的模块时顺手补树。已补：adaptive / bias / options / variantPool /
  variantDiversity / reasoningPath / textSimilarity / cognitiveTaskInference / languageSanity /
  chromeAgent / variantChallenger / sessionState / useIsMobile / AgentInterviewPage /
  CopilotSidebar / SessionReplayDrawer。
- **函数归属别凭直觉写**：`expandWithPrerequisites` / `isMastered` / `isAttempted` / `WEAK_*`
  在 `domain/learner.ts`，**不在** `conceptGraph.ts`（后者只回答"知识之间是什么关系"，
  不持有学习状态）。
- **边界规则现状**：`domain` 对 `schemas` 为 **type-only**；仅 `learner.ts`（proficiencyConfigSchema）
  与 `variantPool.ts`（computeVariantSourceHash / variantSourceOf）两处历史值依赖，属例外非范例。

## 外部题目入库（2026-09-08）
- 外部投递的题常是**异构 schema**（`questionRole` / `variantOf` / `assessmentTarget` /
  `formats[]` 数组 / `A/B/C/D` 字母选项 / `answer:["A","B"]`）。必须改写为本库 schema 才能落盘：
  字母→0-based 索引数组；`multiple-choice|single-choice`→`formats.choice.type`；
  补齐 `angle`（19 枚举）/ `cognitiveTask`（12 枚举）/ `concepts` / `assessment{target,reasoningGoal}` /
  `misconceptions` + `misconceptionMap`（长度=选项数，正确项 `null`）/ `formats.open.referenceAnswer`。
- **外部稿的 `explanation` 不能当事实依据**。含量化断言（「A 优于 B」「无显著差异」「提升 N 倍」）
  必须先回一手来源核实。实例：CLIP 8 题稿里 2 处与论文冲突（Linear Probe 准确率反超 zero-shot；
  线性 vs 非线性投影头做过消融），都是论文从未声称的。
- **「结论对」不代表「论据对」**：干扰项解析里的量化推导也要逐句核，不能因为最终选项字母没变就放过。
  实例：MoE 稿说「专家计算量 O(h²)、传输量 O(h)」，论文实际是「计算量随 h 线性、传输量与 h 无关，
  计算/通信比 = h」——结论一致、标度关系错了。
- 落库后四门禁：`scripts/lint-bias.ts --all`、`scripts/lint-length.ts --all`、
  `scripts/validate-questions.ts`、`vitest run`。新题最常见的失败是
  **正确项全局最长**触发 strong 长度泄题；修法是拉长最短干扰项 + 压缩正确项，而不是砍内容。
  经验值：最长/最短比压到 **≤1.7** 才安全（1.8 是阈值，卡边界易被算成 1.8×）。
- **取 arXiv 全文**：`curl arxiv.org/pdf/...` 与 ar5iv 都超时；可用
  `WebFetch https://arxiv.org/html/<id>v1`（带公式全文），abs 页只能拿摘要。
  PMLR 论文走 `http://proceedings.mlr.press/...` 的 http（非 https）可下载。
- `variantOf` 语义：若难度/角度/认知任务任一改变 ⇒ 属 fork 新 canonical，填 `derivedFrom`；
  只有同 `topic×angle×difficulty×cognitiveTask` 的表达变换才走 `src/data/variants/`。

## 题库审查：来源与断言必须匹配（2026-09-15）
- **自动化门禁查不到「source 与断言不匹配」**。`question:audit` 只查「有厂商词却无 source」，
  不查「source 是否真的支持题目依赖的论断」。2026-09-11 的 `cluster-interconnect` 批整批源自
  一篇分析博客，却登记为「官方文档×3 + 论文×1」——官方 TPU v5e 页只列拓扑/切片形状，
  Shazeer 2017 §3.1 只讲数据并行+模型并行，两处「2× 环形通信」「All-to-All = 分布式矩阵转置」
  断言都不在所引来源里。**URL 可访问 ≠ 该 URL 支持该断言。**
- 审查套路：对含量化倍数/具体数字/特定术语的题，抓 `source.materialId` 回源核对；
  搜索题目里的特征词（如 "wraparound penalty"、"sharded transpose"）常能直接定位真实出处。
- **改 canonical 选项的连带代价**：`sourceHash` 覆盖「题面+选项+元数据」，改选项会让引用它的
  变体判 stale。改前先 grep `sourceSnapshot.id` 数清受影响变体；语义等价时按 ADR-079 §3
  用 `variantSourceOf`/`computeVariantSourceHash`/`computeVariantContentHash` 离线重设基线，
  不必重跑 LLM。只改 `explanation`/`source`/`misconceptionMap` **不影响**变体哈希（不在 snapshot 里）。
- **ADR-079 §2**：纯自包含计算题（如非超售 Fat-Tree 的双切带宽由较小侧决定）**不补 source**，
  如实接受残留即可，不要为凑指标编造来源。

## 手工写变体的四个硬约束（2026-09-15 起）
批次惯例：**10 个 canonical × (surface-options + context-options) = 20 条**，文件名
`assessment.manual-<xx>-<date>.json`，slug `manual-<xx>`，草稿放 temp/ 用完即删。
组装：`node node_modules/vite-node/dist/cli.mjs scripts/assemble-variants.ts <draft.json> <out> <slug>`。
按出错频率排序的坑：
0. **先搞懂度量口径**：`cjkDice`（`src/domain/textSimilarity.ts`）是 **token 多重集 Dice**，
   不是字符级——`cjkTokenize` 把**中文按单字**、**拉丁/数字按整词**（kebab/snake 拆词）切 token，
   空格标点丢弃；`200*|交集|/(|A|+|B|)`。drift 阈值 35 / dup 阈值 88 都在此口径上校准。
   **关键推论**：canonical 选项里的长拉丁词（`temperature`/`prompt`/`PreToolUse`/`hook`）
   只占 1 个 token；翻成中文后展开成多个 token，交集骤降 → 极易跌破 35。
   **对策：canonical 选项里的拉丁词原样保留**（只改周边中文字）。
   注意这与第 4 条不矛盾：extra-hint 只查**题干**，选项里保留拉丁词反而是保 drift 的正确做法。
1. **`optionChangedTooMuch`（CJK-Dice <35 判 option-semantic-drift）**——中文选项改写时换掉核心技术词
   （「KV 压缩」→「键值压缩」、「Agent」→「智能体」）就容易跌破 35。对策：保留原句主干词，
   只换句式/修饰，别动术语；canonical 选项短（<15 字）时尤其要贴着原句改。
   另注：组装器遇到 drift 只报**第一个**失败选项并中止该条——修完 A 可能又报 B，
   要按选项顺序逐个预检。
2. **`detectOptionLengthBias`（strong 与 soft 都阻断）**——正确项为全局最长 **且** 最短项是干扰项
   **且** 差距 ≥1.8× 即拒；`meanCorrect/meanDistractor ≥1.8` 也拒。4 选 1 最容易踩。
   对策：四个选项字数拉近，或让正确项**不要**是最长的（把长干扰项写足）。
3. **sibling 近重复（选项级 Dice ≥88）**——题干不进相似度，只改题干必死。必须给 surface / context
   **各写一套选项**，且两套之间做「重述级」差异（换叙事结构，不只是同义替换）。
4. **`extra-hint` 只看题干里的拉丁词**（正确项独有 + 干扰项没有 + canonical 题干没有 + 不在
   topic/tags 主题词里）→ 题干尽量用中文表述（「词元」「键值」「专家路由」而非 token / KV / MoE），
   可天然规避；选项里出现拉丁词**不影响**该检查。
另有 `checkKindContentMatch`：context 题干与 canonical 的 CJK-Dice 必须 <95（否则判没真加场景）。
`reasoningGoal` 必须含「先…」+（再|然后|据此…）+（排除|逐项|验证|比较|甄别）三段信号。

## Agent 运行时：给会话「加暂停点」的正确做法（2026-09-25）

面试 Agent 有三条判分路径：选择题确定性 `gradeChoice`、降级 `evaluateSessionQuestion`、
LLM 的 `evaluateAnswer` 工具。**只有第三条经过工具**——所以任何「评分后要发生的事」
都不能写在工具里，必须收敛到共享内部缝 `afterEvaluation()`（`src/agent/interviewAgent.ts`）。
写成工具副作用 = 选择题与降级路径静默失效。

**暂停不能用 `agent.abort()`**：运行时按 `stopReason === 'aborted'` 归类为异常，
打 `model_error` 遥测 + 用户看到「模型返回错误」，把正常产品行为伪装成故障。
正确组合：`finishTurn` 返回 `{ action: 'end' }`（停在正常轮次边界）
+ `beforeToolCall` 拦掉等待期不该发生的工具调用。返回 `undefined` 而非
`{ action: 'continue' }`，以免多一次 provider 请求。

## pi-agent-core 0.87 破坏性变更（2026-09-25）

工作区有未提交升级 0.85.1 → 0.87.1（`pi-agent-core` / `pi-ai`，包版本 1.1.2 → 1.2.1），
它先一步弄坏了 HEAD 上的 `tsc`。**`shouldStopAfterTurn` / `ShouldStopAfterTurnContext` 被删除**
（不是改名，`.d.ts` 里完全没有），继任者是 `finishTurn?: FinishTurn`，
入参类型 `AgentTurnContext = { message; toolResults; context; newMessages }`，
返回 `AgentTurnDecision = { action: 'continue' | 'end' }`（可返回 `void`）。
副作用：`deepseek-v4-flash` 已从 DeepSeek 注册表移除，`src/ai/local.test.ts` 3 个用例失败——
该 model id **只在测试里出现**（零运行时引用），要修只需换测试里的 id。

## 测试：不要硬编码题号（2026-09-25）

`pickNextAdaptive` 在同主题多题之间**随机**挑，`expect(...).toBe('q-choice-1')` 会偶发失败。
断言相对关系：先取 `res.firstQuestion!.question.id`，再断言 `not.toBe(first)` 或与 `first` 相等。

## ★ 写测试：断言必须**能失败**（2026-09-25）

**症状**：`learner.test.ts` 里 `expect(JSON.stringify(profile)).not.toContain(' 答案不正确，请参见解析')`
——串首多了个空格，而 JSON 数组元素没有前导空格 ⇒ 这条断言**永远为真**，等于没写。
去掉空格立刻变红，暴露出「假 gap 确实进了 profile」。

**两条硬规则**：

1. **不要用「整份对象序列化后不含某串」做断言**。它把「聚合结果」与「忠实原始记录」两种语义
   混在一起，且极易被一个多余空格变成永真。要断言什么，就精确指到那个字段
   （如 `profile.topicStats` / `profile.misconceptionHits`）。
2. **纯否定断言必须配一条正向断言**（如 `not.toHaveLength(0)`），否则实现退化成空值后测试仍是绿的。

**去脆化**：需要比对内容时与**来源函数**同源比对（`expect(fb.keyPoints).toEqual(requiredPointsFor(q))`），
不要硬编码文案——文案改词不该弄坏测试。

**瘦身时的反面清单**（看着像重复、其实要留）：
- 只断言 `.ok === false` 的一组用例后面，往往跟着唯一断言各错误码的那一条；
- 不同字段（`evaluations` vs `answers`）驱动的同名行为不能合；
- **断言相反 ≠ 逻辑互补**。`reasoningPath.ts` 的 `isReasoningPathSubstantiallyDifferent`
  与 `isReasoningPathTooSimilar` 用例一一对应且结果相反，但签名与算法都不同
  （单阈值看 `reasoningGoal` vs 双阈值看 target+goal）。**删之前必须读实现。**

**机械可查的重复已经捞干**：按括号配平切 `it` body、抽 `expect(` 行做集合、同文件内两两算 Jaccard，
阈值 ≥0.45 且交集 ≥3 全部人工过完，剩下的都是误报（共用 `dimensions.correctness` 这类通用断言行）。
再往下就是主观判断，不要指望脚本。

## ★ 运行时状态 ≠ UI 投影（2026-09-25，三个 P0 的共同根因）

这条值得单独记：**不要让 UI 从「投影/派生数据」反推「运行时状态」**。

具体事故：`afterEvaluation` 在 standard 模式**也会**触发 `onEvaluation`（评分总得发生），
但 UI 用 `feedback !== null` 推断「已暂停」⇒ 在「评分完成 → 下一题交付」的窗口里
（开放题下数秒）误弹反馈卡、题目只读、提交按钮消失。

正确做法：
- 运行时**显式**把决策作为回调参数下发（`onEvaluation(q, a, ev, awaitingFeedback)`），
  不要让消费方去读 `session.status`——**回调里读状态字段会与「状态何时写入」耦合**：
  `afterEvaluation` 原本是先调回调、后置 status，回调里读到的是 `'running'`。
- 若要暴露状态，**先置状态再通知**，保证「标志 / status / 投影」同源。
- hook 单独持有 `awaitingFeedback` state 作暂停态真源；`feedback` 只当投影。
- **恢复路径要恢复的是「状态」，不是「上一次渲染的产物」**：`feedback`（投影）与
  `lastEvaluation`（原始数据）是两件事，只还原前者会让依赖后者的入口（「让 Copilot 详细解释」）
  静默消失。`clearFeedback()` 三者一起清。

## 两个 UI 入口 = 一个 runtime，别搞两套（2026-09-25，ADR-084）

「Agent 面试页」与「Copilot 侧栏」曾经各持一套 `InterviewAgentSession`，靠一个上下文对象
单向桥接——结果刷新/并发/暂停态各自为政。现在侧栏直接消费 App 层 `useAgentInterview`。

**坑**：`useAgentInterview` 是**状态 hook 不是事件流**。想让 Copilot 把题目显示成聊天气泡，
就得用 effect 监听状态变化去追加消息 → StrictMode 双调用会重复追加，且消息与真源脱节。
**正确做法是让 UI 按视图渲染派生数据**（题目/反馈面板直接读状态），别把它同步成消息。

**另一个坑**：面试中路由上下文必须由共享会话派生（`interviewRoutingContext()`），
否则 `shouldSubmitAsAnswer` 判定「无待作答题」→ 用户输入的「A」被当成提问 → **面试卡死**。

## 存储读取：按「该字段被谁消费」决定校验强度（2026-09-25，同日修正）

`storage/learner.ts` 的注释早写了「IndexedDB 是不可信边界」，但代码没校验。补的时候踩了两个坑：

- **learner 行**：损坏 → 退回 `emptyProfile()`（而不是抛异常，那会让「进度」页白屏）。
  必须**先校验再遍历**，否则 `Object.entries(rest.topicStats)` 在字段缺失时直接抛。
- **session 行**：**分级降级，不是「要么全信要么整条丢」**。见下。

### session 行：`parseSessionRow` 三段式（修正早前「只做最小形状检查」的结论）

旧口径只查 `Array.isArray(row.questionResults)` ⇒ `{ questionResults: [{}] }` 能过 ⇒
`result.topic` 是 undefined 被写进 `topicPracticeSessions`，脏形状流进进度页与历史回放。
但**整行套 `sessionRecordSchema` 也会误伤**：该 schema 传递性要求
`questionResults[].evaluation`（完整 `EvaluationResult`）与 `questions`（原题快照），
而这些都是**历史回放才读**的字段——旧版本写下的形状可能过不了当前 schema，
严格校验会**整条丢弃用户历史**（我第一次这么写就弄坏了 `sessionFromQuiz → … → load` 端到端测试）。

正确口径三段式：严格 → 逐条摘掉不过的 `evaluation`（其余题目评分保留）
→ 整行摘掉 `questions` / `answers` → 仍不过才丢行。

**判据是「该字段被谁消费」**：
- 核心字段（`overall` / `questionResults` 骨架）被**进度聚合**消费 → 坏了必须丢行；
- 回放快照只在 `SessionReplayDrawer` 读 → 坏了只降级（该组件本就支持退化成「分数 + 解析」视图）。

「不可信边界」不等于「全部严格」，也不等于「只做最小检查」——要按消费方分级。

## ★ 守卫按「状态」冻结，不要按「工具名」枚举（2026-09-25，ADR-085）

`src/agent/interviewAgent.ts` 的 `beforeToolCall` 曾在 `awaiting_feedback` 下只拦
`getQuestion` / `evaluateAnswer`。但 `toolExecution: 'sequential'` ⇒ **同一条 assistant 消息
可带多个 tool call**，而 `finishTurn` 只在**整轮工具全部执行完**之后才调用 ⇒ 模型一轮返回
`evaluateAnswer + finishInterview` 时第二个工具无人看守，状态被从 `awaiting_feedback`
直接推到 `finished`，用户跳过反馈卡。

**改法是 `if (session.status === 'awaiting_feedback') return { block: true }`，不判断工具名。**
黑名单式守卫的维护成本随被守卫集合增长，按状态冻结不会——下次新增工具不会重现同类漏洞。

## ★ 两个 UI 入口共用 runtime：重入闸用 ref，且要留逃生口（2026-09-25）

- **`busy` 是 React state，事件回调里读到的是本次渲染时的旧值**，覆盖不了「点击发生在
  setState 之后、重渲染之前」的窗口。`useAgentInterview` 用 `busyRef` 同步镜像（写入统一走
  `setBusyBoth`），暴露 `agentBusy()` 给 `submit` / `jumpToNextQuestion` 入口 `return`。
- **UI 的 `disabled` 只是提示，不是契约**（`Sender` 的曾写成字面量 `false`）。两层都要做。
- **加「忙判断」前先问：这个忙碌标志与我要保护的状态，生命周期是否一致。** 不一致时忙判断
  不是保护，是丢事件：
  - `end_interview` **不能拦**——`finalize()` 会先 `abort()`，它是用户主动中止的逃生口；
  - `continueAfterFeedback` **不能用 `busy` 拦**——`awaiting_feedback` 在 `afterEvaluation`
    **内部**置，而 `busy` 要到 `agent_end` 才清，拦了会把提交后立刻点的「继续」**无声吞掉**。
- **`finalize()` 必须 `await onComplete`**（IndexedDB 写入是 Promise）。同步调用会让失败变成
  unhandled rejection，而 UI 已显示「已保存」——**「假成功」比直接报错更糟**。

## 评审稿不是事实（2026-09-25）

外部评审稿给的文件路径与代码片段是**线索**。第 4 项称 `CONTINUE_PATTERN` 仍是前缀匹配并建议加
`$`，但它**早在 ADR-083 收口时就已是整句匹配**（末尾保留指代填充 / 难度修饰 / 语气词的可选组），
按稿子的朴素 `$` 写法改会弄坏 `detectCommand('下一题难一点')?.difficulty === 'hard'`。
**落地前必须回文件核对；不一致时要报告差异，而不是照稿执行。**

## 内存目录

`.workbuddy/memory/` 是实际在维护的那份；`.workbuddy-ai/memory/` 停在 2026-09-03。
新笔记写 `.workbuddy/memory/YYYY-MM-DD.md`。

