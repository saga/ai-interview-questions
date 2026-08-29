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
- `explanation` 明确解释正确答案和关键误区。
- choice 题至少 2 个选项；`single` 恰好 1 个答案；`multiple` 至少 2 个答案。
- 答案索引合法、不重复；选项互斥、无重复、无占位内容。
- 如果同时提供 open 形态，`referenceAnswer` 必须与 choice 正确答案一致。
- 开放题参考答案应包含可检查的关键要点，而不只是重复题干。
- `tags` 使用已有命名风格，避免创建同义或大小写重复标签。
- `topic` 必须是 `src/data/knowledge/` 里已存在的**知识节点 id**（如 `caching`、`cost`、`system-design`），不是 taxonomy 的 topic；`bank.test.ts` 会强制校验，写错直接失败。
- `category` 必须与所在文件名一致，且每个题库文件只含一个 category（唯一例外是 `p0-gap-fill.json`）。
- 目标题库文件普遍是 choice + open 双形态 100% 覆盖，新题应同时写两种形态。
- `open.referenceAnswer` 若写成 `正确答案：B、C、D。`（全角冒号），`bank.test.ts` 的一致性正则**不会命中**（正则要求"正确答案"后紧跟空白+字母），因此需**人工核对**字母与 `answer` 索引一致。

## 内容设计

- 先明确这道题考查的一个主知识点和一个 angle，不要把多个无关概念塞进一道题。
- 根据难度设计认知要求：easy 偏定义/基础，medium 偏机制/比较，hard 偏计算/权衡/场景/系统设计。
- 错误选项应代表真实误解，不能用荒谬、空泛或长度明显更短的选项凑数。
- 计算题给出足够条件和可复核公式；场景题明确约束、目标和评判标准。
- 不要把正确答案写得总是最长、最专业或最完整。

## 修改与验证

1. 先将草稿保存为 JSON 数组，运行 `npm run question:add -- --file draft.json --check`。
2. 检查通过且人工确认后，使用 `npm run question:add -- --file draft.json --write --output src/data/questions/<batch>.json` 写入；目标文件不能覆盖已有文件。
3. 直接修改题库时使用 `apply_patch`，保持现有格式和排序风格。
4. 运行：
   - `npm run validate:questions`
   - `npx vitest run src/data/bank.test.ts`
   - `npm run lint:bias`
   - `npm run question:coverage`
   - `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 uv run --extra analysis python scripts/question_analysis.py --semantic --json`
     使用仓库内 ONNX INT8 模型检查语义重复；这是人工复核信号，不替代 TypeScript/Zod 契约校验。
5. 再运行 `npm run typecheck` 和 `npm run test`。
6. 运行 `git diff --check`，确认没有意外改动。
7. 最终说明新增题的 id、覆盖的知识缺口、语义重复候选、验证结果和仍需人工复核的事实。

## LLM 使用边界

LLM 可以辅助起草题干、干扰项和参考答案，但不能替代事实核对。生成后必须人工或基于可信来源检查：答案唯一性、解释一致性、技术版本、计算过程和知识点覆盖。不要把实时 LLM 生成结果直接写入题库。
