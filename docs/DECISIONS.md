# 关键决策记录（ADR）

> 记录影响架构走向的关键决策及其理由。新决策追加在顶部，保留历史便于追溯。

## ADR-032 · 题库建设两速分离：覆盖矩阵先行，复用 > 变体 > 生成

- 状态：已采纳 · 2026-08-23
- 背景：题库补什么此前只回答到"哪个知识点还没有题"（knowledgeCoverage 的二元
  判断）。实际缺口是二维的：**知识点 × 考察角度**——"MoE 有 18 道题但 tradeoff
  角度是 0"这类结论得不出来；且若直接上"LLM 自动生成题目"，容易绕开已有资产、
  让 LLM 既定考点又自证正确。
- 决策：
  - **两速分离**：慢速管线（Knowledge → Coverage → Blueprint → Search →
    Variant/Generate → Validate → 入库）与快速运行时（Learner State → Selection
    Policy → QuestionBank）彻底分开；运行时**永不现场生成并直接使用题目**。
  - **覆盖矩阵先行**：`domain/coverage.ts` 纯函数输出 topic × angle 计数矩阵 +
    补题建议（P0 优先），`npm run question:coverage` 随时可查。Question 新增可选
    `angle` 字段（数据契约增量，向后兼容读取）；未标注的题单列 untagged，
    不与真缺口混淆——先给存量题打标，再谈补题。
  - **补题顺序固定为 复用 > 变体 > 生成**：只有矩阵证明某格无题时才进入
    Blueprint（受约束的考察目标）→ LLM 生成 → 独立 Validator 校验 → candidate
    状态 → 人工确认入库；出题（Generator）与选题（Selector）职责不混。
  - **CLI 不走打包路径**：脚本 fs 直读 data JSON + 调纯函数（Node 24 原生 TS），
    与浏览器 import.meta.glob 装配解耦，保证离线可跑、无构建依赖。
- 理由：覆盖度量是零风险增量却直接决定后续生成质量——没有矩阵，Blueprint 没有
  输入；没有 Blueprint，LLM 出题退化为"自己决定考什么"。先把 ①知识 schema（已有）
  ②矩阵 ③CLI 落地，④⑤（Blueprint/Generator/Validator）等真实训练数据暴露出
  高价值缺口后再建。

## ADR-031 · 开放题生成由全局配置门控，默认关闭

- 状态：已采纳 · 2026-08-23
- 背景：开放题依赖 LLM 评分才有完整反馈闭环（`useAI` 关闭或无有效引擎时开放题
  只能"未评分"），且部分用户只想要可确定性判分的选择题训练。此前开放题是否出现
  仅由会话定义的 `formats` 与组卷配额决定，没有全局开关。
- 决策：`AIConfig` 新增 `generateOpenQuestions: boolean`，**默认 false**。
  - 门控点收口在 interviewEngine 的 `effectiveFormats`：关闭时从允许形态中剔除
    open——纯开放题不入池、双形态题一律出选择、自适应模式的随机开放分配恒为
    choice；开启时行为与原先一致（组卷配额 ≈30%）。
  - 定义只选了 open 而全局关闭时**退化为 choice**而非空会话——全局配置是硬约束，
    会话定义在其中取交集；宁可降级也不让一次训练启动失败。
  - 缺省/非法值一律视为 false（loadConfig / parseConfigJSON 清洗），历史 localStorage
    数据无需迁移即获得新默认行为。
- 理由：把"要不要开放题"做成用户显式 opt-in 而非隐式默认，与"LLM 只是增强层"
  定位一致——关闭后整条链路（出题→作答→判分）完全不依赖 LLM；门控收口在
  引擎单点而非散落各 UI 入口，保证所有模式（快速/自定义/教练/面试/自适应）
  行为一致。

## ADR-030 · 概念层级统一 + 图/学习状态分离 + mastery 降级为启发式

- 状态：已采纳 · 2026-08-23
- 背景：架构评审指出三处边界问题——①"Question 是知识对象"与 ADR-029
  "知识点是一等公民、题目只是 View"术语冲突；②conceptGraph.ts 持有 WEAK_* 阈值、
  isMastered/isAttempted 与 expandWithPrerequisites，把"知识关系"和"学习状态"
  混在一个模块；③`mastery = avgScore/100` 被表述为掌握度定义而非简化启发式。
- 决策：
  - **概念层级统一**：Knowledge 是学习对象（一等公民），Question 是知识点的
    assessment view（可评估表达），SessionQuestion 是一次训练实例。未来 explanation /
    flashcard / follow-up / scenario 等都是 knowledge 的其他 view，不往 Question 上堆职责。
  - **图只回答关系**：conceptGraph.ts 收敛为 prerequisite / related / closure / topo；
    WEAK_* 阈值、isMastered/isAttempted、expandWithPrerequisites（推荐策略）、
    TopicRef/collectTopicRefs（coverage 边界工具）全部迁入 learner.ts——
    "图回答知识间是什么关系，learner 回答用户掌握得怎么样"。graphlib 数据结构
    不外泄，对外只有 topic 字符串。
  - **mastery 是当前启发式**：avgScore/100 无法区分"先会后忘"与"渐入佳境"；
    语义分工明确为 mastery=当前启发式、trend=近期信号、attempts=置信度、
    evidence=溯源。**不升级 Bayesian/ELO/IRT**，除非现有信号被证明不够用。
  - **同时固化为不变量**：SessionQuestion 快照不变量（session 保存"当时看到的
    内容"，题库修改不影响历史）；LLMProvider 接口边界固定为语言增强
    （generateVariant/evaluateOpenAnswer），永不扩展 recommendNextQuestion/
    buildLearningPlan 等策略接口；`useAI` 保持单开关（拆分 enableVariants/
    enableEvaluation 推迟到出现真实需求）。
- 理由：四句话原则——Knowledge 是中心、InterviewEngine 掌管流程、Domain 决策
  LLM 增强、Learner Memory 驱动下一次训练。当前规模下不需要任何"大架构"
  （数据库 / Agent loop / Repository 层 / 图抽象都明确不做）。

## ADR-029 · 知识点层一等公民化：Knowledge Map 数据层 + 题目即 View

- 状态：已采纳 · 2026-08-23
- 背景：题库此前以「题目」为最小组织单位，topic 只是题目上的一个字符串标签；
  出面试题需要的修饰素材（机制说明、评分要点、常见误区、出题角度）散落在
  各题的 explanation / rubric / referenceAnswer 里，同一 topic 无法沉淀复用，
  也无法回答"P0 知识点覆盖了多少、还缺哪些题"。
- 决策：
  - **新增 `data/knowledge/<area>.json` 知识点层**（×8 领域），节点 schema =
    `{ id, name, area, priority, summary, required, misconceptions, angles }`；
  - `id = 题目 topic slug`：与题目、conceptGraph、Learner Memory 共用同一 join key，
    不引入第二套标识体系；节点必须有至少一道题目支撑（无悬空节点，测试强制，
    与 conceptGraph.test 同规则）；
  - **四类修饰素材**编码出题策略：`summary`（变体重写与复盘锚点）、`required`
    （评分必须要点，`mergeQuestionRubric` 在题目未自带 rubric.required 时回退注入）、
    `misconceptions`（干扰项设计/追问/gap 分析素材）、`angles`（definition → mechanism →
    calculation → tradeoff → scenario → system-design 的难度梯度）；
  - `domain/knowledge.ts` 提供查询与覆盖分析（`knowledgeCoverage` 输出 P0 覆盖率
    与 gap 路线图），纯函数 + 单测，UI 接入后续按需做。
- 理由：把"知识点 → 面试题"从手工一次性劳动变成数据驱动的组合——同一知识点可以
  按不同角度 × 场景生成多道 View 题；评分锚点有了默认来源；题库建设从"凭感觉补题"
  变成"按 gap 补题"。模型名称可以是题目的 context，但知识点才是答案的依据。
- 后续路径：变体提示词注入 misconceptions 做干扰项改写、按 angles 自动选题配比、
  ProgressPage 按 area 聚合展示——均只需消费现有节点数据，无需再动数据契约。

## ADR-028 · 选择形态场景化：ChoiceFormat 独立题干字段 + 选择性内容升级

- 状态：已采纳 · 2026-08-23
- 背景：ADR-027 迁移后的 189 道生成选择题是「概念直问 + 判断说法对错」风格，
  与目标考核形态（真实工程情境下的方案取舍，如认证考试的场景化多选题）差距明显；
  同时共享题干模型下，长情境题干会破坏开放形态的问答体验。
- 决策：
  - **`ChoiceFormat` 新增可选 `question` 字段**（选择形态专属场景题干）：给出时
    选择形态用它提问，未给则回落到共享题干。Question.question/explanation/open
    保持不变——同一知识点的两种形态各自拥有合适的提问方式。
  - **选择性而非全量改造**：只有适合场景化的题（工程决策/系统设计/安全合规/
    成本权衡/生产运维/故障排查）才重写，共 173/237；概念定义、原理辨析、
    数学基础题保留直问风格（强行编造情境反而失真）。
  - 选项为完整方案句，干扰项刻意「似是而非」；引入 multiple 形态（44 道多选），
    判分语义不变（集合全等）。
- 用户数据契约变更：questions/*.json 的 formats.choice 可携带 question 字段，
  属向后兼容的可选扩展（缺省即旧行为）。
- 验证：bank.test.ts 新增 cf.question 非空校验；157 测试全过；typecheck/build 通过。

## ADR-027 · 题目与形态分离：双形态进题库，删除运行时题型变换（取代 ADR-024）

- 状态：已采纳 · 2026-08-23 · **取代 ADR-024**
- 背景：ADR-024 把「同一道题出选择还是开放」交给运行时 LLM 变换，代价是每次组卷
  额外 N 次 LLM 调用（成本/延迟/输出质量波动）加一整套校验与审计配套
  （transform.ts / transformAudit / transformedFrom / PendingTransform）。
  而题库规模是固定的——缺的只是**内容**，完全可以离线补齐后静态维护。
  应用户决策：「针对这些题目，一次性补充需要的 open 格式内容」。
- 决策：
  - **数据模型**：`Question` 收敛为单一知识对象
    `{ id, category, topic, tags, difficulty, question, explanation, rubric?,
       formats: { choice?: ChoiceFormat, open?: OpenFormat } }`；
    新增会话实例 `SessionQuestion = { question, format }`。
    「本次以哪种形态呈现」由组卷决定，题库对象不可变；ChoiceQuestion/OpenQuestion
    联合类型与 QuestionType 四值枚举删除。
  - **题库一次性迁移**：全部 237 题同时具备 choice 与 open 双形态——
    原 180 essay + 9 coding 的 open 形态天然具备；
    原 48 道选择题的 open 形态由代码推导（正确项要点 + 解析合成 referenceAnswer）；
    189 道 essay/coding 的 choice 形态由并行 LLM 生成（题干 + 4 选项 + 正确项，
    统一 single 型），经合并脚本校验注入。迁移脚本为一次性工具，完成后删除，
    契约校验固化在 `data/bank.test.ts`。
  - **删除运行时变换管线**：ai/transform.ts(+test)、storage/transformAudit.ts(+test)、
    `LLMProvider.transformQuestion`、引擎 applyTransforms、题目 transformedFrom 字段、
    localStorage `transform-audit` key 全部移除。LLM 职责回归两件事：变体重写题干、
    开放形态评分。
  - **组卷简化**：`planComposition` 直接返回 `SessionQuestion[]`；配额语义不变
    （开放 ≈ floor(count*MAX_OPEN_RATIO=0.3)）：超额开放题先翻回 choice（若该题具备）、
    再与池内未抽中的可选择题原位换题、无题可换则裁剪；缺额时尾部双形态题翻转为 open。
    整池只有一种可用形态时跳过配比。自适应模式不套配额，双形态可用时按
    p(open)=0.3 加权随机。
  - **接口更名**：`InterviewDefinition.questionTypes` → `formats: FormatId[]`
    （'choice' | 'open'），过滤语义变为「题目具备任一允许形态即入池」。
  - **用户数据契约变更（显式声明）**：questions/*.json 由扁平
    `type/options/answer/referenceAnswer/language` 变为嵌套 `formats.{choice,open}`，
    属破坏性结构升级；localStorage 配置与 learner key 不变，历史学习记录不受影响。
- 理由：形态内容静态化后，组卷路径零 LLM 成本、行为完全确定性、可测；
  审计机制的唯一存在理由（审核变换质量）随之消失。ADR-024 的核心洞见
  （「内容交 LLM、结构交代码」）保留在离线生成环节：生成的选择题仍经脚本校验
  （选项去重、answer 越界、single 恰一正确项）后才入库。
- 取舍：题库体积上升（约 +4200 行 JSON）；新增一道题需同时维护两种形态内容
  （bank.test.ts 强制校验，不会漏）。未来若要"AI 现场出新形态"，应做成
  离线生成 + 校验入库的工具流，而不是运行时变换。
- 验证：测试 157 例全过（bank.test 改为双形态契约校验；quiz/engine 测试重写为
  SessionQuestion 语义；transform/transformAudit 用例随实现删除）；
  typecheck/build 通过。

## ADR-026 · 云端引擎扩容：恢复 OpenRouter，新增 Gemini 与 Cloudflare Workers AI

- 状态：已采纳 · 2026-08-23
- 背景：ADR-025 曾以「CORS 受限、维护成本高」为由把云端直连收敛到 DeepSeek 一家；
  用户实际需要多家云端组成降级链（单家配额/区域可用性波动时自动切换），
  且 pi-ai 已内置 openrouter / google / cloudflare-workers-ai 三家 provider，
  装配成本与 ADR-025 时代的自维护模型目录不可同日而语。
- 决策：
  - **恢复 `openrouter`、新增 `google`（Gemini）、`cloudflare-workers-ai`**：
    ProviderId 六值全量回到白名单（settings.PROVIDER_IDS），pi.ts 按 id 装配对应
    pi-ai provider；模型目录由 pi-ai 内置 catalog 提供，应用零维护。
  - **Cloudflare 需要 Account ID**：其 auth 协议要求 API Token + Account ID 双字段，
    `ProviderEntry` 新增可选 `accountId`（sanitizeEntry 仅在非空字符串时保留，
    其他引擎不产生噪音字段）；CredentialStore 经 credential.env 注入
    `CLOUDFLARE_ACCOUNT_ID`，不依赖浏览器环境变量。
  - **校验按引擎区分**：cloudflare 启用时 model/apiKey/accountId 三者必填，
    其余云端仍为 apiKey+model 两项；parseConfigJSON 错误提示区分文案。
  - 不做向后兼容的原则不变：openai / anthropic 直连仍不在白名单，
    历史配置中的这两个 id 继续被静默丢弃；openrouter 恢复后重新被接受。
- 取舍：ADR-025 的 CORS 论据对 OpenRouter / Google / Cloudflare 实测不成立
  （三家的 API 均允许浏览器跨域调用），真正的硬限制只剩 OpenAI / Anthropic SDK 直连；
  引擎元数据全部来自 pi-ai catalog，「随服务商维护」的成本担忧随之消失。
- 验证：settings/provider 用例更新并新增（accountId 清洗与校验、cloudflare 缺失整体拒绝、
  新云端组链 name 断言）；typecheck/build 通过。

## ADR-025 · 引擎收敛为 chrome/local/deepseek + 设置页改为 config.json 编辑器

- 状态：已采纳 · 2026-08-23
- 背景：ADR-023 的降级链支持六种引擎，但设置面板逐引擎表单（每引擎一张卡：
  启用开关/模型下拉/API Key 输入/上下移按钮）交互繁琐；且 OpenAI / Anthropic /
  OpenRouter 三家云端直连在浏览器侧受 CORS 限制、模型目录需随服务商维护，
  实际使用率低——用户真正在用的是 Chrome 内置、本地 Unsloth 与 DeepSeek。
- 决策：
  - **引擎收敛**：`ProviderId` 收敛为 `'chrome' | 'local' | 'deepseek'`。
    pi.ts 删除 openai/anthropic/openrouter 三家 provider 装配与 pi-ai 对应导入；
    SettingsPanel 删除 MODEL_OPTIONS 预设模型表。不做向后兼容：历史 localStorage
    配置中的已下线 id 由 sanitizeEntry 静默丢弃（key 不变）。
  - **设置页改为直接编辑 config.json**：Monaco JSON 编辑器（懒加载 CodeEditor）
    展示并编辑完整 `AIConfig`，providers 数组顺序即降级链优先级；
    「恢复默认」一键填入 DEFAULT_CONFIG 模板。
  - **保存校验收口到纯函数**：`storage/settings.parseConfigJSON(text)` 整体解析 +
    逐项清洗（id 白名单、同引擎去重、启用引擎字段完整性），任何一处不合法整体拒绝，
    错误信息定位到 `providers[i]`；通过后返回规范化配置再走 onSave → saveConfig。
    loadConfig 的读取清洗逻辑保持不变（防御性兜底）。
- 取舍：放弃逐字段表单的引导性，换取配置的全部能力（批量改、复制粘贴、
  版本化存档）与零维护成本的引擎元数据；JSON 编辑器有 schema 级校验兜底，
  错误可定位，不依赖用户熟悉格式。
- 验证：测试 168 例中本变更相关全过（+13：parseConfigJSON 合法链/停用容忍/
  九类整体拒绝/错误定位、下线引擎丢弃）；typecheck/build 通过。

## ADR-024 · 同题双形态：LLM 题型变换（选择 ⇄ 开放）+ 组卷配额规划

- 状态：**已被 ADR-027 取代（运行时变换删除，形态内容静态化进题库）** · 2026-08-23
- 背景：题库开放题占比高，组卷需要"单选/多选为主"（7:3，ADR-023 后续产品规则
  `MAX_OPEN_RATIO=0.3`）。仅靠换题/裁题时，候选池缺对应题型会导致缩卷或开放题不足；
  既然 LLM 能力已接入，同一道题完全可以两种形态出现。
- 决策：
  - **组卷规划收口到 domain**：`balanceQuestionTypes` 升级为 `planComposition(pool, count,
    priorities, rng, allowTransform)`，返回 `{ picked, transforms }`。超额/缺额开放题先与
    候选池原位交换（尾部动刀，保住前部薄弱主题优先题）；候选池缺题型时
    allowTransform=true 记为 `PendingTransform` 交给 LLM 变换，false 维持纯本地裁剪。
  - **分工修订（2026-08-23 二轮评审，应用户决策）**：**内容交给 LLM，结构交给代码**。
    - 开放→选择（单选或多选）：prompt 直接携带题目与参考答案，LLM 产出完整选择题
      （题干、全部选项、正确项序号标注）；不再做"代码切分参考答案合成正确项"的启发式
      （实测覆盖率 187/189，且语义质量受限——分号衔接的并列论点/有序步骤无法可靠拆分）。
      代价是接受"LLM 标注的正确项可能语义存疑"，由 explanation/rubric 兜底。
    - 代码保结构完整：输出格式校验、选项去重、数量/越界校验；**洗牌后按文本匹配重算
      answer 索引**——"正确项索引错位"这类历史事故结构上不可能发生；
      输出不合法即抛错回退原题；多选请求只得到 1 个正确项时降级单选。
    - 选择→开放不变：prompt 只含题干与主题，referenceAnswer 由代码从权威字段合成。
  - **id 溯源**：变换后题目保留原题 id（learner memory evidence / 会话 answers map 天然对齐），
    映射关系只在 console 日志记录（`[题型变换] <id>: <from> → <to>`），UI 不展示。
  - **接线**：`LLMProvider.transformQuestion(question, target)` 新接口方法，
    PiAI / Chrome 两实现注入各自 CompleteFn，FallbackProvider 自动获得降级链语义；
    引擎 `applyTransforms` 在变体生成前执行，失败逐题回退原题型。
- 不做的事：**open→coding 变换**（编程题需要可执行参考答案与判分契约，essay 变换器不冒充它，
  `transformQuestionWith` 收到 coding 目标直接原样返回；未来真需要时单独设计）；
  自适应模式逐题出题不套配比、不做变换；useAI 关闭时完全走纯本地逻辑。
  变换结果一律显式构造目标形态字段，杜绝来源题型专属字段残留。
- 验证：测试 145 例全过（+16：planComposition 超额/缺额/单题型池/变换标记、
  transform 单选/多选 happy path 与洗牌后文本匹配索引断言、非法输出回退、
  prompt 边界断言、coding 目标 no-op、字段卫生）；typecheck/build 通过。

## ADR-023 · 多引擎降级链（AIConfig.providers 取代单选 provider）

- 状态：已采纳 · 2026-08-23
- 背景：原配置是全局单选（`PiConfig.provider` 单枚举值 + 设置页单 Select），
  所有 LLM 任务共用一个引擎。但 chrome 内置模型 / 本地 Unsloth 能力较弱，
  用户实际想"弱模型优先、失败自动落到云端强模型"——单选形态表达不了这种协作。
- 决策：
  - **配置改为有序降级链**：`PiConfig` 更名 `AIConfig`，结构变为
    `{ providers: ProviderEntry[] }`；每个 `ProviderEntry = { id, enabled, model, apiKey, baseUrl? }`。
    调用时按数组顺序尝试，某引擎调用失败/不可用自动切换到下一个（`FallbackProvider`），
    全部失败才向外抛错（由上层现有 catch 兜底退化为原题/不评分）。典型排布：
    chrome → local → 云端。
  - **LLMProvider 接口瘦身**：去掉 `config` 参数——各实现类在构造时绑定自己的
    `ProviderEntry`，多引擎编排收口到 `createLLMProvider` 工厂（单通道直接返回实现，
    多通道返回 FallbackProvider），interviewEngine 不再向每次调用透传 config。
  - **localStorage key 不变**（`ai-interview-trainer.config`，用户数据契约），
    `loadConfig` 内做旧单选形态迁移：`{provider,...}` → 单元素链；
    新形态逐项清洗（id 白名单、去重保首个、字段兜底）。
  - 校验拆两层：`isEntryValid`（单通道按引擎区分）与 `isConfigValid`
    （至少一个启用且合法的通道）。
  - 设置页改为多卡片列表：每引擎一张卡（启用开关 + 条件字段 + 上移/下移/删除），
    卡片顺序即降级顺序。
- 理由：降级链把"省 token 的本地优先"与"云端兜底保证可用性"统一成一个机制，
  不需要任务级路由的复杂度；接口瘦身后 LLMProvider 与配置解耦，未来加任务级分派
  只需在工厂层扩展。
- 验证：测试 123 例全过（+18：isEntryValid/isConfigValid 拆分、FallbackProvider
  成功短路/逐级降级/全败抛错/空链、loadConfig 迁移清洗往返）；typecheck/build 通过。

## ADR-022 · 本地 OpenAI 兼容服务支持（复用 pi-ai createProvider）+ 实现收敛为两套

- 状态：已采纳 · 2026-08-23
- 背景：用户使用 Unsloth Studio 等本地推理服务（默认 `http://127.0.0.1:8888/v1`，
  OpenAI 兼容协议）。曾考虑手写 fetch 直连，后确认 **pi-ai SDK 原生支持自定义 provider**
  （README「Custom Providers」：`createProvider` + `api/openai-completions.lazy`，
  与官方 models.json 自定义 provider 同一条路径）。
- 决策：
  - **不手写 HTTP**：models.json 式"配置即用"的加载器属于 `@earendil-works/pi-coding-agent`
    （CLI 包），不在 SDK 内；SDK 的原生方式就是 `createProvider` 注册——`ai/local.ts`
    的 ~50 行（Model 定义 / auth.resolve / compat 开关）是 SDK 契约的最小必要集，非重复造轮子。
  - **compat 关闭 developer role 与 reasoning_effort**：多数本地服务器
    （Unsloth / Ollama / vLLM / llama.cpp）不认这些字段（见 pi models 文档）。
  - **免密钥语义**：CredentialStore 对空 key 返回 undefined（不再返回空串 credential），
    callLLM 空 key 时不显式传 apiKey 选项——让 provider 的 auth.resolve 兜底为占位符；
    否则空串会覆盖解析结果导致请求根本发不出。
  - **实现收敛为两套**：删除独立的 LocalProvider 类——local 在 buildModels 层路由到
    pi-ai 自定义 provider，对上层与云端无差别。LLMProvider 只有
    ChromeAIProvider（ADR-021）与 PiAIProvider 两个实现。
  - **默认云端引擎改为 DeepSeek**（provider='deepseek'，model='deepseek-v4-flash'）；
    localStorage 契约不变，仅新增可选 baseUrl 字段。
  - 新增 `docs/config.example.json` 示例配置（chrome / local / cloud 三种形态）。
- 理由：本地推理与产品 local-first 定位一致且零成本；复用 pi-ai 让 prompt 编排、流式、
  错误处理全部继承既有链路（callLLM 一处入口），未来换协议只动 buildModels。
- 踩坑记录：① openai-completions 走 SSE 流式，测试 mock 必须回 event-stream 格式；
  ② pi-ai 把传输错误吞成 stopReason='error' 的消息，callLLM 返回空文本由上层 parse 兜底，
  不抛异常；③ 空 apiKey 必须避免以选项形式显式传入 complete()。
- 验证：测试 105 例全过（local provider 构建 / SSE mock 端到端 / 工厂分派）；
  typecheck/build 通过。

## ADR-021 · 引入 Chrome Built-in AI Provider（本地 Prompt API 双底层）

- 状态：已采纳 · 2026-08-23
- 背景：产品定位是 local-first 的个人 AI 面试教练（ADR-015），但目前唯一 LLM 底层是 pi-ai 云端直连，
  必须有 API Key、答案要发第三方。Chrome 的 Prompt API 提供浏览器内置本地模型（免密钥、低延迟、
  数据不出设备），与定位高度契合；且 LLMProvider 抽象（ADR-007）本就为可替换底层而设。
- 决策：
  - **新增 `ai/chrome.ts` + `ChromeAIProvider`**：工厂按 `config.provider` 分派；
    `ProviderId` 增加 `'chrome'`。不引入 polyfill——运行时能力检测
    （`LanguageModel.availability()`）决定可用性，不支持则上层现有 catch 兜底降级。
  - **解耦复用，不做平行实现**：`variant.ts` / `evaluate.ts` 改为接受注入的
    `CompleteFn(system, user)`；prompt 构建 / JSON 解析 / 评分兜底只有一份，
    两个 provider 各自只提供 complete 实现。避免同一套提示词逻辑出现两份漂移拷贝。
  - **配置语义按引擎区分**：chrome 无需 apiKey/model（isConfigValid 分支）；
    localStorage 配置结构不变（用户数据契约不动）。设置页 chrome 时隐藏密钥项，
    用 availability 展示模型状态（available/downloadable/downloading/unavailable）。
  - **不做的事**：不用 Chrome AI 替换云端 provider（内置模型并非所有环境可用）；
    不引入 polyfill；不在 UI 之外暴露引擎技术细节。
- 理由：最小改动路径——domain / interviewEngine / 题库零改动，只是给已有抽象加一个实现；
  同时把"prompt 编排"与"底层调用"解耦，未来再加任何底层（如 WebLLM）也只是新增一个 CompleteFn。
- 验证：测试 98 例全过（chrome 封装 mock LanguageModel、变体注入、工厂分派/校验）；
  typecheck/build 通过。

## ADR-020 · 架构评审修复批次：接线断线功能 + 死代码清理

- 状态：已采纳 · 2026-08-23
- 背景：全量代码/文档评审发现三类问题——文档承诺的功能未接线、已设计机制在生产路径断线、
  ADR-019 减法后的注释与死代码残留。
- 决策：
  - **rubric.required 接线**：`ai/provider.mergeQuestionRubric`（纯函数）统一合并题目级
    dimensions/required，required 注入评分提示——此前 46 道题的 required 全部失效。
  - **useAI 门控评分**：`evaluateAnswer` 对开放题增加 `def.useAI` 检查；关闭 AI 的自定义训练
    不再偷发 LLM 请求。变体出题原本就受 useAI 门控，现两处行为一致。
  - **自适应计时锚定**：倒计时截止点锚定 `session.startedAt`（自适应追加题目不改变它），
    修复"每次换题重置 30 分钟倒计时"与 durationSec 失真。
  - **adaptive 薄弱优先接通**：`nextAdaptiveStep` 增加 profile 参数并传入 `pickNextAdaptive`；
    move-on 兜底改用 `recommendWeakTopics`（此前误用全部练过主题，且生产路径根本没传 profile）。
  - **提前结束先评分**：AdaptiveQuiz 提前结束时对当前未评题先评一次再入账，不再以 0 分污染画像。
  - **删除 nodeTypes**：NodeType/nodeTypeOf 及 JSON 中 nodeTypes 字段全删（生产零引用，
    ADR-019"覆盖面展示仍用"的理由不成立）；conceptGraph 公开 API 无参化（去掉被忽略的 graph 参数）；
    prerequisitesOf 一并删除（仅测试引用）。
  - **删除 variants 审计字段**：`InterviewSession.variants` 与 GeneratedVariant 的
    sourceQuestionId/generatedBy 无任何消费者；是否变体成功由题目 `aiGenerated` 标记表达。
  - **杂项**：删除 `followUpStrategy` 预留字段；isChoiceCorrect 去重（evaluation 复用 quiz 导出）；
   薄弱阈值 WEAK_MASTERY/WEAK_AVG 收敛到 conceptGraph 单一出处；SettingsPanel 切换 provider
    重置 model、删除环境变量误导文案；模拟面试页未配置 AI 也允许开始（口径与首页一致）；
    pi.ts callLLM 收敛 `as never` 为正式类型。
- 理由：当前不缺架构能力，缺的是把已有机制接通；本批次全部是"接线 + 删除"，不引入新抽象。
- 验证：测试 72 例全过（新增 provider rubric 合并、engine useAI 门控、adaptive 薄弱优先共 9 例）；
  typecheck/build 通过。

## ADR-019 · 架构收敛（减法）：LLM 是插件，Domain 拥有分数与决策

- 状态：已采纳 · 2026-08-23（其中「nodeTypes 保留」一项已被 ADR-020 推翻删除）
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

- 状态：部分取代 · 2026-08-23（typed nodes 被 ADR-020 删除，仅存 prerequisite/related 两类边）
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

- 状态：已采纳 · 2026-08-23（其中 Agent 集成测试部分随 ADR-019 移除）
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

- 状态：已被 ADR-019 取代（pi-agent-core 整体移除）· 2026-08-23
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
