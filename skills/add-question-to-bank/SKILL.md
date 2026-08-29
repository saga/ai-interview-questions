---
name: add-question-to-bank
description: "添加新题到题库。用户要求新增面试题、补充知识点、填补覆盖缺口或把题目写入题库时使用。"
---

# 添加新题到题库

把新题作为可审计、可评分、可维护的数据加入 `src/data/questions/`。默认一次只处理用户要求的题目数量，不批量生成未经检查的内容。

## 添加前

1. 阅读 `AGENTS.md`、`README.md`、`src/schemas/question.ts`、目标题库 JSON 和 `src/data/knowledge/` 中对应知识节点。
2. 先运行 `npm run question:coverage`，确认新增题解决真实的 topic × angle 缺口，而不是重复堆积已有题型。
3. 检查同 topic 下已有题的题干、angle、difficulty、选项和答案，避免近重复。
4. 如果题目涉及 AWS、模型、API、认证考试或其他时效事实，确认来源、适用版本和核验日期；不确定的事实不得写成绝对结论。

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
5. 再运行 `npm run typecheck` 和 `npm run test`。
6. 运行 `git diff --check`，确认没有意外改动。
7. 最终说明新增题的 id、覆盖的知识缺口、验证结果和仍需人工复核的事实。

## LLM 使用边界

LLM 可以辅助起草题干、干扰项和参考答案，但不能替代事实核对。生成后必须人工或基于可信来源检查：答案唯一性、解释一致性、技术版本、计算过程和知识点覆盖。不要把实时 LLM 生成结果直接写入题库。
