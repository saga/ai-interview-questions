---
name: add-question-to-bank
description: "添加新题到题库。用户要求新增面试题、补充知识点、填补覆盖缺口或把题目写入题库时使用。"
---

# 添加新题到题库

把新题作为可审计、可评分、可维护的数据加入 `src/data/questions/`。默认一次只处理用户要求的题目数量，不批量生成未经检查的内容。

## 添加前

1. 阅读 `AGENTS.md`、`README.md`、`src/schemas/question.ts`、目标题库 JSON 和 `src/data/knowledge/` 中对应知识节点。
2. 先运行 `npm run question:coverage`，确认新增题解决真实的 topic × angle 缺口，而不是重复堆积已有题型；如果还没确定要补哪些缺口，转 **fill-coverage-gap** skill 先出蓝图和优先级，再回到本 skill 写题。
3. **不要只看 `question:coverage` 的"缺口数"**：它按知识节点自身声明的 `angles` 计算，加题后缺口数不变，既不代表白加、也不代表填上了缺口。必须直接数目标 (topic, angle) 格子的现有题量：

   ```
   python3 -c "import json,glob; qs=[q for f in glob.glob('src/data/questions/*.json') for q in json.load(open(f,encoding='utf-8'))]; print(sum(1 for q in qs if q['topic']=='<topic>' and q.get('angle')=='<angle>'))"
   ```

   格子已有 3 题以上属于"加深"而非"补缺"，需确认新题与已有题不近重复；想真正消缺口就优先挑统计里为 0 的格子。加题后重跑同一条命令，确认格子数确实 +1。
4. 检查同 topic 下已有题的题干、angle、difficulty、选项和答案，避免近重复。
5. 如果题目涉及 AWS、模型、API、认证考试或其他时效事实，确认来源、适用版本和核验日期；不确定的事实不得写成绝对结论。
6. 如果题目内容来自一篇具体文章而不是从零构思，转 **article-to-questions** skill 生成内容，再回到本 skill 完成校验与写入。

## 题目契约

每道题必须满足：

- 全局唯一、稳定且可读的 `id`。
- 合法的 `category`、`topic`、`difficulty` 和 `angle`。
- 题干自包含，不依赖“上述方法”“原题”“本文”等上下文。
- 题干不得要求考生预先知道来源文章、Lens、认证框架或其分类；禁止“哪种做法符合某 Lens/框架”类问法。将来源原则写成包含目标、约束和验收标准的通用场景，来源名称只放在 `source` metadata。
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

## 内容设计

- 先明确这道题考查的一个主知识点和一个 angle，不要把多个无关概念塞进一道题。
- 根据难度设计认知要求：easy 偏定义/基础，medium 偏机制/比较，hard 偏计算/权衡/场景/系统设计。
- **题型以多选题为主**（详见 AGENTS.md §4.2）：一批新题里 multiple 应 ≥ 2/3。single 只用于结论唯一、无法拆成多个独立判断的情形（定义判定、单值计算、唯一根因定位）。遇到"下列哪项描述最准确"这类把多个独立判断压成最优选项的单选题，应改写为多选。
- **选项必须逼出思考**：干扰项要"差点就对"——半对（部分正确但漏前提）、条件错配（机制对但场景错）、因果倒置、程度/范围偏差、概念邻近混淆。禁止"完全相反/明显荒谬/换模型/删测试/只看 token/完全自动化"这类稻草人选项，它们会让题目退化成不用读题就能排除。
- 多选题的每个错误选项都要独立地、可解释地错，考生须逐条判断，而不是排除两个就能秒选。
- 计算题给出足够条件和可复核公式；场景题明确约束、目标和评判标准。
- 不要把正确答案写得总是最长、最专业或最完整（长度平衡与"有思考深度"不冲突：难度来自内容而非措辞）。
- **选项深度自检**：遮住正确答案后，剩余选项能否让懂行的人犹豫 2 秒以上？若某选项靠常识或语气就能秒排，重写它。

## 结构质量门槛

写入前逐题确认以下三条，不通过则重写，不要靠 `--check` 的形态门禁兜底：

1. **明确核心 Concept**：每题必须能一句话说清“这道题到底在测哪个核心 Concept”。除 `comparison` / `design` / `system-design` 外，不得要求同时掌握多个独立 Concept 才能作答；supporting / prerequisite Concepts 必须直接服务于核心 Concept 的判断，而非把多个主题并列堆砌。
2. **同 topic × angle 已有 ≥ 3 题须确认新价值**：用“添加前”步骤的计数命令确认目标 (topic, angle) 格子已有题量。若已 ≥ 3 题，新题必须带来新的认知任务、场景、典型 misconception 或难度层次，而不是仅改写措辞；否则优先改写已有题或改补为 0 的格子。
3. **选项同决策层级且不得仅因“更完整”制造正确答案**：所有选项应处于同一抽象粒度与决策层级；正确项不能因为“包含更多组件 / 列出更多条件 / 描述更完整”自然胜出，难度应来自技术判断而非信息量（详见 `docs/添加题库prompt.md` §四、§十一的 Answer Determinism 与 Option-level consistency 约束）。

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
   - `npm run lint:bias`
   - `npm run question:coverage`
   - `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 uv run --project analysis --extra analysis python analysis/question_analysis.py --semantic --json`
     使用仓库内 ONNX INT8 模型检查语义重复；这是人工复核信号，不替代 TypeScript/Zod 契约校验。
5. 再运行 `npm run typecheck` 和 `npm run test`。
6. 运行 `git diff --check`，确认没有意外改动。
7. 最终说明新增题的 id、覆盖的知识缺口、语义重复候选、验证结果和仍需人工复核的事实。

## LLM 使用边界

LLM 可以辅助起草题干、干扰项和参考答案，但不能替代事实核对。生成后必须人工或基于可信来源检查：答案唯一性、解释一致性、技术版本、计算过程和知识点覆盖。不要把实时 LLM 生成结果直接写入题库。
