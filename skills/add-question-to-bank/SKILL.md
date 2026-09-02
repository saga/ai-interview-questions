---
name: add-question-to-bank
description: "写新题并落库。用户要求新增面试题、起草题目或把题目写入题库时使用。审查存量题质量请用 check-question-bank-quality，规划补哪些缺口请用 fill-coverage-gap。"
---

# 添加新题到题库

**定位：authoring + 写入前门禁。** 把新题作为可审计、可评分、可维护的数据加入 `src/data/questions/`。
默认一次只处理用户要求的题目数量，不批量生成未经检查的内容。

职责边界（三件事各有归口，不要在本 skill 里做另两件）：

| 想做什么 | 用哪个 skill |
| --- | --- |
| 该补哪些 `topic × angle` 缺口、出蓝图 | **fill-coverage-gap** |
| 审查**存量题**质量、判定 KEEP/REWRITE/DELETE | **check-question-bank-quality** |
| 写新题 + 校验 + 落库 | **本 skill** |

## 添加前

1. 阅读 `AGENTS.md`、`README.md`、`src/schemas/question.ts`、`src/domain/knowledge/documents.ts`、目标题库 JSON 和 `src/data/knowledge/` 中对应知识节点。
2. 先运行 `npm run question:coverage`，确认新增题解决真实的 topic × angle 缺口，而不是重复堆积已有题型；如果还没确定要补哪些缺口，转 **fill-coverage-gap** skill 先出蓝图和优先级，再回到本 skill 写题。
3. **不要只看 `question:coverage` 的"缺口数"**：它按知识节点自身声明的 `angles` 计算，加题后缺口数不变，既不代表白加、也不代表填上了缺口。必须直接数目标 (topic, angle) 格子的现有题量：

   ```
   python3 -c "import json,glob; qs=[q for f in glob.glob('src/data/questions/*.json') for q in json.load(open(f,encoding='utf-8'))]; print(sum(1 for q in qs if q['topic']=='<topic>' and q.get('angle')=='<angle>'))"
   ```

   格子已有 3 题以上属于"加深"而非"补缺"，需确认新题与已有题不近重复；想真正消缺口就优先挑统计里为 0 的格子。加题后重跑同一条命令，确认格子数确实 +1。
4. 检查同 topic 下已有题的题干、angle、difficulty、选项和答案，避免近重复
   （这是**写入前的去重自查**，不是审查存量题质量——后者转 **check-question-bank-quality**）。
5. 如果题目涉及 AWS、模型、API、认证考试或其他时效事实，确认来源、适用版本和核验日期；不确定的事实不得写成绝对结论。
6. 如果题目内容来自一篇具体文章而不是从零构思，转 **article-to-questions** skill 生成内容，再回到本 skill 完成校验与写入。

## 题目契约

每道题必须满足：

- 全局唯一、稳定且可读的 `id`。
- 合法的 `category`、`topic`、`difficulty` 和 `angle`。
- 题干自包含，不依赖"上述方法""原题""本文"等上下文。
- 题干不得要求考生预先知道来源文章、Lens、认证框架或其分类；禁止"哪种做法符合某 Lens/框架"类问法。将来源原则写成包含目标、约束和验收标准的通用场景，来源名称只放在 `source` metadata。
- `explanation` 明确解释正确答案和关键误区。
- choice 题至少 2 个选项；`single` 恰好 1 个答案；`multiple` 至少 2 个答案。
- 答案索引合法、不重复；选项互斥、无重复、无占位内容。
- 如果同时提供 open 形态，`referenceAnswer` 必须与 choice 正确答案一致。
- 开放题参考答案应包含可检查的关键要点，而不只是重复题干。
- `tags` 使用已有命名风格，避免创建同义或大小写重复标签。
- `topic` 必须是 `src/data/knowledge/` 里已存在的**知识节点 id**（如 `caching`、`cost`、`system-design`），不是 taxonomy 的 topic；`bank.test.ts` 会强制校验，写错直接失败。
- `category` 通常与所在文件名一致；生产补题批次文件（如 `foundational-and-intermediate.json`）允许跨领域收录题目，加载时以题目自身 `category` 为准。
- 目标题库文件普遍是 choice + open 双形态 100% 覆盖，新题应同时写两种形态。
- `open.referenceAnswer` 若写成 `正确答案：B、C、D。`（全角冒号），`bank.test.ts` 的一致性正则**不会命中**（正则要求"正确答案"后紧跟空白+字母），因此需**人工核对**字母与 `answer` 索引一致。

## 检索可见性（ADR-063/065/066）

题库是 Structured Knowledge RAG 的 corpus。写出的题会被 `src/domain/knowledge/documents.ts` 投影成 `KnowledgeDocument`，字段按可见性分成两侧：

| 侧 | 字段 | 可见性 |
| --- | --- | --- |
| 安全侧 | `question` 题干、`formats.choice.options`、`misconceptions`、`tags`、`topic`、`angle`、`difficulty` | **所有**答案安全模式都会进 prompt（含 hint / quiz） |
| 真值侧 | `explanation`、`choice.answer`、`open.referenceAnswer` | 仅 `answer` / `explain` |

由此产生五条硬要求：

1. **题干和选项不得泄露答案。** quiz 模式只保留题干首行、hint 模式保留题干+选项；任何"正确项天然更完整 / 更专业 / 更多条件"的写法，都会在 hint 下直接漏题——与 §4.2 的长度抗泄题是同一条规则，只是现在后果从"降低难度"变成"绕过 assessment boundary"。
2. **`explanation` 必须能脱离上下文被引用。** Copilot 会原样拼进 prompt 并附 `[Q] <题干>` 引用标记；写成"见上文""该题应选 B"这类指代表述，引用出去就是废话。
3. **`misconceptions` 必须填。** 它是 hint 模式下唯一能说明"用户错在哪"的证据；缺失时 Copilot 只能讲通用知识，诊断价值归零。选择题同步填 `choice.misconceptionMap`（存量可用 `npm run backfill:misconceptions` 回填）。
4. **`topic` 必须是知识节点 id**，它同时是 graph 检索种子与 `detectQueryTopic` 的锚点——写错会让整条 1 跳邻域的证据都错。
5. **`tags` 复用既有词表**，它参与 metadata 评分；同义、单复数、大小写变体会稀释命中。

## 内容设计

**内容规范见 `docs/question-content-spec.md`** —— 写题时逐条对齐，本 skill 不再复制规则：

| 要求 | 规范 |
| --- | --- |
| 一个核心 Concept，不塞多个无关概念 | `spec §1` |
| 答案唯一可判定；多选每个正确项独立成立 | `spec §2` |
| 脱离来源可作答；事实可追溯、不编造 | `spec §3` / `§4` |
| 选项同决策层级、彼此独立、不靠"更完整"胜出 | `spec §5` |
| 干扰项"差点就对"，禁止稻草人 | `spec §6` |
| 不从长度/专业度/信息密度/限定词泄露答案 | `spec §7` |
| 题型以多选为主（multiple ≥ 2/3） | `spec §9` |

补充（规范未覆盖的起草细节）：

- 根据难度设计认知要求：easy 偏定义/基础，medium 偏机制/比较，hard 偏计算/权衡/场景/系统设计。
- 计算题给出足够条件和可复核公式；场景题明确约束、目标和评判标准。
- **选项深度自检**（`spec §6` 的可操作版本）：遮住正确答案后，剩余选项能否让懂行的人犹豫 2 秒以上？
  若某选项靠常识或语气就能秒排，重写它。
- `ANGLE_GENERATION_HINTS`（`src/domain/coverage.ts`）给的是**生成起点提示**，不是约束——
  `scenario` 可以是 medium 单选，`definition` 也可以是 open 题。别把它当规格读。

## 结构质量门槛

写入前逐题确认以下三条，不通过则重写，不要靠 `--check` 的形态门禁兜底：

1. **明确核心 Concept**（`spec §1`）：每题必须能一句话说清"这道题到底在测哪个核心 Concept"。
2. **同 topic × angle 已有 ≥ 3 题须确认新价值**：用"添加前"步骤的计数命令确认目标 (topic, angle) 格子已有题量。
   若已 ≥ 3 题，新题必须带来新的认知任务、场景、典型 misconception 或难度层次，而不是仅改写措辞；
   否则优先改写已有题或改补为 0 的格子。**审查存量题该不该改写，转 check-question-bank-quality**
   （本 skill 只管 authoring + 写入前门禁）。
3. **选项同决策层级且不得仅因"更完整"制造正确答案**（`spec §5` / `§7`）。

## 修改与验证

1. 先将草稿保存为 JSON 数组，运行 `npm run question:add -- --file draft.json --check`。
   该命令已内置**题型门禁**（AGENTS.md §4.2，实现见 `scripts/add-question.ts`）：本批选择题 ≥ 3 道且单选占比 > 1/3 时**直接报错退出**，并打印单选/多选分布。被拦住时应改写为多选，不要想办法绕过门禁；少于 3 道选择题的小批量自动豁免。
   手工查看分布：
   ```
   python3 -c "import json,collections;d=json.load(open('draft.json',encoding='utf-8'));c=collections.Counter(q['formats']['choice']['type'] for q in d if q['formats'].get('choice'));print(dict(c))"
   ```
2. 检查通过且人工确认后，使用 `npm run question:add -- --file draft.json --write --output src/data/questions/<batch>.json` 写入；目标文件不能覆盖已有文件。
3. 直接修改题库时使用 `apply_patch`，保持现有格式和排序风格。
4. 运行：
   - `npm run validate:questions`
   - `npx vitest run src/data/bank.test.ts`
   - `npx vitest run src/domain/knowledge/retrieve.test.ts src/application/conversation/knowledgeCapability.test.ts`
     数据改动会直接影响检索：这两组用例守住投影、混合评分、graph 扩展与四种答案安全模式。
   - `npm run lint:bias`
   - `npm run question:quality` —— 内容质量只读审计（软信号，非门禁）。新题若命中，
     先判断是不是真问题：命中的是**词汇/统计嫌疑**，不是语义判定。
   - **目标格子计数 +1**：重跑"添加前"第 3 步的计数命令，确认目标 (topic, angle) 确实 +1。
     注意这不是覆盖审计——`question:coverage` 的缺口数按节点声明的 `angles` 算，
     加题后缺口数不变是正常的，别拿它当验收标准。全库覆盖审计转 **check-question-bank-quality**。
   - `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 uv run --project analysis --extra analysis python analysis/question_analysis.py --semantic --json`
     使用仓库内 ONNX INT8 模型检查语义重复；这是人工复核信号，不替代 TypeScript/Zod 契约校验。
5. 再运行 `npm run typecheck` 和 `npm run test`。
6. 运行 `git diff --check`，确认没有意外改动。
7. 最终说明新增题的 id、覆盖的知识缺口、语义重复候选、验证结果、检索可见性确认（"遮住正确项后题干仍成立"、hint 模式不漏题）和仍需人工复核的事实。

## LLM 使用边界

LLM 可以辅助起草题干、干扰项和参考答案，但不能替代事实核对。生成后必须人工或基于可信来源检查：答案唯一性、解释一致性、技术版本、计算过程和知识点覆盖。不要把实时 LLM 生成结果直接写入题库。
