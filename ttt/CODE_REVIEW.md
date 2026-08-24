# 代码与文档一致性 / 架构评审报告

- 日期：2026-08-23
- 范围：全量源码 `src/**`、`docs/`（ARCHITECTURE / DECISIONS / CHANGELOG）、README、AGENTS.md、数据文件（questions.json / conceptGraph.json）
- 基线验证：`npm run test` 66 例全过 · `npm run typecheck` 通过 · `npm run build` 通过（仅主 chunk 体积警告）
- 本报告只分析、不改代码。

---

## 一、代码与架构文档不一致的地方

### A1.【高】README 仍宣传已被移除的 pi-agent-core

- `README.md:5`：「集成 `@earendil-works/pi-agent-core` 做开放题 Agent 评分」。
- 事实：ADR-019 已删除 pi-agent-core 依赖与 `interviewAgent.ts`，package.json 中无此依赖，开放题评分走 `ai/evaluate.ts` one-shot。ARCHITECTURE.md 与代码一致，唯独 README 没同步。

### A2.【高】「rubric.required 注入评分提示」文档有承诺、代码未接线

- 承诺方：`README.md:57,65`、`docs/ARCHITECTURE.md:201`（"required 会注入评分提示，计入 completeness"）。
- 事实：
  - `ai/evaluate.ts` 的 `buildEvalUser` 支持 `opts.requiredPoints`（且 `evaluate.test.ts:34` 有测试覆盖）；
  - 但唯一调用链 `ai/provider.ts:33-43 → evaluateOpenAnswer()` 只合并了 `q.rubric.dimensions`，从未把 `q.rubric.required` 传进 `EvalOptions`；
  - 题库中 **46/100 道题带 `rubric.required`**，全部实际失效。
  - 文档描述了一个不存在的行为（同时是功能 bug，见 B3）。

### A3.【中】mastery 公式旧注释残留（ADR-019 简化后未清理）

- `src/types.ts:168`：`TopicStats.mastery` 注释仍写「随尝试次数收敛的置信度加权掌握度」，实际实现是 `avgScore/100`。
- `src/domain/learner.ts:52-54`：`updateLearner` docstring 仍写「mastery = avg/100 × 置信度因子」，而同函数第 81 行行内注释已是 ADR-019 版本——同一文件前后矛盾。
- `src/domain/learner.test.ts:62`：测试名「尝试次数多时收敛到 avg/100」同样是旧公式语义残留（断言数值上碰巧兼容新公式）。

### A4.【中】conceptGraph.ts 头注释仍列 10 种边类型

- `src/domain/conceptGraph.ts:2-4` 头注释列举 `part_of / extends / alternative / tradeoff / contrasts / related_to / technique / deep_dive / challenge`；ADR-019 已砍到 `prerequisite + related` 两类，`EdgeType` 定义也只剩两类。头注释是 ADR-018 时代残留。

### A5.【中】ADR-019「保留 nodeTypes」的理由与代码不符

- ADR-019 决策项：「nodeTypes 保留（覆盖面展示仍用）」。
- 事实：`computeCoverage` 与 ProgressPage 均未使用节点类型；`nodeTypeOf` / `NodeType` 在生产代码零引用（仅 conceptGraph.test.ts 引用）。「覆盖面展示仍用」目前不成立——要么接线（如覆盖面卡片按节点类型展示），要么按 AGENTS 原则 2 删除。

### A6.【低】若干过期注释

- `src/ai/pi.ts:2`：「上层（variantGenerator / interviewAgent）才表达业务语义」——variantGenerator 已改名 `variant.ts`，interviewAgent 已删除。
- `src/components/common/CodeBlock.tsx:23`：「后续 Coding Interview 用 Monaco」——Monaco 已落地（ADR-016），"后续"已完成。

### A7.【低】ADR 记录的小瑕疵

- ADR-018 称「每对主题只存一条有向边」，实际数据中 16 对主题同时存在 `prerequisite` 与 `related` 双边（语义不同、不算数据错误，但表述不严谨）。
- ADR-012 / ADR-014 已被 ADR-019 实质性推翻（pi-agent-core 移除），但未标注 superseded 关系；纯按时间倒序阅读时容易误读为现行方案。

---

## 二、明显的错误与问题（Bug）

### B1.【高】自适应 + 限时模式：换题会重置倒计时与训练时长

- `App.tsx:217-235` 倒计时 useEffect 依赖 `[phase, session, ...]`，而自适应模式每追加一题都执行 `setSession({ ...s, questions: [...] })`（`App.tsx:158`），session 对象引用变化 → effect 重跑 → **剩余时间重置回完整 limit**。
- 后果：「模拟面试」（`InterviewPage.tsx:23-25`，timeLimitSec=1800 且 adaptive=true）每答一题，30 分钟计时重新开始，总时长可被无限拉长；"限时"形同虚设。
- 同理 `App.tsx:189-193` 的 `startedAtRef` 也依赖 `[phase, session]`，导致 `durationSec` 只从最后一次追加题目起算——写入 Learner Memory 的训练时长失真。
- 修法方向（供参考）：计时起点/截止点只依赖"会话开始"这一事件（如用 definition 或 startedAt 做 key），不跟随 session 对象。

### B2.【高】`useAI` 开关不控制开放题评分

- `types.ts:112` 与 TrainingHome 开关文案均定义 `useAI` =「是否启用 LLM 变体出题与开放题评分」。
- 事实：`interviewEngine.ts:112-129` 的 `evaluateAnswer` / `evaluateSession` 完全不检查 `def.useAI`，只要 localStorage 里有有效 config 就会调 LLM 评分。
- 后果：用户在自定义训练中明确关闭 AI 后，开放题仍会被发送到 LLM（消耗 token、可能失败）；UI 承诺与引擎行为不一致。

### B3.【中】rubric.required 从未注入评分提示

- 同 A2。这是文档不一致背后的真实功能缺陷：`provider.ts:41` 合并 dimensions 时顺手把 required 一并传入即可修复。

### B4.【中】adaptive 的 move-on「优先薄弱项」从未生效

- `domain/adaptive.ts:67-73,126-129`：`pickNextAdaptive` 支持 `profile` 参数用于 move-on 兜底时优先薄弱主题。
- 但生产调用链 `interviewEngine.ts:103 → nextAdaptiveStep()` 从不传 profile（函数签名也没这个入口），该特性只在测试里活着。
- 另外实现本身与注释不符：传给 `pickPrioritized` 的是 `Object.keys(profile.topicStats)`（**所有练过的主题**）而非薄弱主题，注释写的是「优先薄弱项」。即使接通也不会按预期工作。

### B5.【中】AdaptiveQuiz「提前结束」会把未评分的当前题记 0 分

- `AdaptiveQuiz.tsx:61-65`：index > 0 即可点击「提前结束并查看结果」，直接触发 `doSubmit`；此时当前题尚未提交评分。
- `domain/learner.ts:126`：`sessionFromQuiz` 对无 grade 的题记 `score = 0` 写入 Learner Memory → 用户可能答得很好却以 0 分污染掌握度统计与薄弱推荐。
- 修法方向：提前结束时对当前题先评一次分再入账，或明确提示"当前题将计 0 分"。

### B6.【低】SettingsPanel 切换 provider 后 model 不联动重置

- `SettingsPanel.tsx:59-65`：model 下拉的 options 随 provider 变化，但已选 model 值不清空，可保存出 `provider=anthropic + model=openai/gpt-4o-mini` 这类非法组合；调用时 `pi.ts:43-45` 抛「未找到模型」。

### B7.【低】设置页环境变量提示是 Node 语境残留

- `SettingsPanel.tsx:70-73` 提示 OPENAI_API_KEY / ANTHROPIC_API_KEY 环境变量优先级——本应用是纯浏览器 local-first 架构，不存在服务端读环境变量的路径，文案误导。

### B8.【低】数据与类型脱节：conceptGraph.json 出现未定义节点类型

- 数据中 3 个节点（tool-calling / mcp / kv-cache）的 nodeType 是 `technology`，而 `NodeType` union（conceptGraph.ts:15-23）没有该值；因 `conceptGraph.ts:40` 用 `as unknown as ConceptGraph` 强转，编译期发现不了，`nodeTypeOf` 返回值类型是假的。

### B9.【低】isChoiceCorrect 重复实现

- `domain/evaluation.ts:47-51` 私有一份，与 `domain/quiz.ts:24-28` 导出的完全相同。应复用 quiz.ts 的导出（AGENTS 原则 2：不留重复死代码）。

### B10.【低】其他小问题

- `App.tsx:93-99` answeredCount 内联判断与 `hasAnswerValue`（App.tsx:43-46）逻辑重复。
- `InterviewPage.tsx:76` 无 AI 配置时完全禁止开始模拟面试，而首页/README 说「未配密钥也能练（选择题照常判分）」——两个页面的产品口径不一致。
- `ai/pi.ts:50` `context as never` / `{ apiKey } as never` 绕过类型检查，pi-ai 升级后容易静默失配；建议收敛为最小类型化封装。
- `interviewEngine.ts:79` buildSession 对最多 30 题 `Promise.all` 并发生成变体，可能触发 provider 速率限制使整批回退原题（有优雅降级，暂不算 bug，留意即可）。
- 主 bundle 1.38MB / gzip 412KB（antd + shiki core 全在主包），构建已有警告；Monaco 与 Shiki grammar 已正确懒加载，此项优先级低。

---

## 三、架构设计值得提升的地方（刻意防 over-design）

**总体判断**：分层（domain / ai / application / storage / components）清晰、依赖方向基本成立；ADR-019 的"减法"方向正确。当前不缺架构能力，缺的是**把已有机制接通**。以下建议全部不引入新层、新框架、新抽象。

### C1. 先接线，再加东西（优先级最高）

三个已设计好但断线的机制，修复成本都极低：
1. `rubric.required` → 评分提示（A2/B3）；
2. `useAI` → 开放题评分门控（B2）;
3. `profile` → `nextAdaptiveStep` → move-on 薄弱优先（B4，同时修正"传全部 topic 而非薄弱 topic"的实现）。

### C2. conceptGraph 的 API 形态二选一：参数注入 or 模块单例

- 现状是最差组合：`prerequisitesOf(_graph)`、`prerequisiteClosure(_graph)`、`computeCoverage(..., graph)` 接收 graph 参数却 `void`/忽略，内部全用模块级单例 `prerequisiteDag`；调用方被迫传一个被忽略的参数。
- 建议（任选其一，倾向前者）：删掉无用参数，公开 API 直接无参化；或真正用传入的 graph 构建索引（可测试性更好）。不要维持"看起来可注入、实际是单例"的假象。

### C3. 清理"预留/零引用"代码（AGENTS 原则 2）

- `InterviewDefinition.followUpStrategy`（types.ts:117，「预留」字段）：零引用，删除；真做追问面试时再加。
- `prerequisitesOf` / `nodeTypeOf` / `NodeType`：仅测试引用，生产零使用；配合 A5 决定去留。
- `InterviewSession.variants`：引擎记录了但 UI 不消费（文档声明"调试/审计用"，勉强可接受）；若近期无审计需求建议删除，需要时 ResultPanel 加一行「本题来自 AI 变体」即可物尽其用。

### C4. 魔法阈值收敛到一处

- 薄弱判定阈值 `0.85 / 85` 在 `learner.ts:146` 硬编码，又在 `conceptGraph.ts:42-43` 定义了 `WEAK_MASTERY / WEAK_AVG` 常量——同一业务语义两处维护。统一从一处导出。

### C5. App.tsx 会话状态机（观察项，暂不动）

- App.tsx ~400 行承载四页路由 + quiz 全状态机 + 自适应循环 + 倒计时。当前规模尚可理解；若继续加功能（如对话式面试），建议只抽一个 `useQuizSession` hook 把 session/answers/grades/signals 收进去，**不建议**为此引入全局状态库或更复杂的架构。

### C6. 明确不建议做的事（避免 over-design）

- 不引入状态管理库（Redux/Zustand）——现状 useState+ref 够用。
- 不给 Learner Memory 上 IndexedDB——数据量远未到（ADR-015 已有迁移触发条件）。
- 不为 conceptGraph 引入图数据库/查询层——graphlib 限定在单模块内的现状是对的。
- 不预先实现 LLM 策略 Agent / Contradiction Probe——ADR-019 已正确标记为 Future。

---

## 四、验证过没问题的点（免复查）

- 题库数据完整性：100 题、id 无重复、选择题 answer 索引全部合法、开放题均有 referenceAnswer。
- 概念图与题库的 topic **双向完全一致**（77 个 topic 一一对应，无孤立节点/缺失节点）；prerequisite 子图加载期 isAcyclic 校验在位。
- ARCHITECTURE 中的事实性数字准确：100 题、Monaco chunk gzip ≈325KB（实测 324.87KB）、antd 6 Divider 注意点与代码一致、worker 相对路径方案与 CodeEditor 实现一致。
- 变体安全模型（LLM 只改题干/解析，answer key 来自原题）代码、类型注释、测试三方一致。
- 分数所有权（overall 只由 domain/aggregateOverall 计算，忽略 LLM 直出总分）落实且有测试。
- 测试基建符合 AGENTS 要求：66 例覆盖 domain 全部纯逻辑 + ai 提示词/解析纯函数，LLM 全 mock 无真实网络请求。

---

## 五、修复优先级建议

| 优先级 | 条目 |
| --- | --- |
| P0 | B1 计时器重置 · B2 useAI 门控 · B3 required 注入（README/ARCHITECTURE 承诺的功能） |
| P1 | B4 profile 断线 · B5 提前结束计 0 分 · A1 README pi-agent-core · A7 nodeTypes 去留决策 |
| P2 | B6 provider/model 联动 · B8 technology 类型脱节 · C2 API 形态 · C3 死代码清理 · C4 阈值收敛 |
| P3 | 其余过期注释（A3/A4/A6）、小重复（B9/B10）、bundle 拆分 |

> 按 AGENTS.md 约定：以上任何影响设计的修改落地时，需同批更新 ARCHITECTURE.md / CHANGELOG.md，涉及取舍的补 ADR。


