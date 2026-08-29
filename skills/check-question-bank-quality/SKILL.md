---
name: check-question-bank-quality
description: "检查题库质量。用户要求审查题库、校验题目、找坏题、检查覆盖率或评估题库内容时使用。"
---

# 检查题库质量

对本仓库题库做可复现、证据驱动的质量检查。默认只读；只有用户明确要求修复时才修改题目或规则。

## 检查顺序

1. 读取 `AGENTS.md`、`README.md`、题目 schema 和相关校验脚本，确认当前数据契约。
2. 运行基础检查：
   - `npm run validate:questions`
   - `npm run lint:bias`
   - `npm run question:coverage`
   - `npx vitest run src/data/bank.test.ts`
3. 统计题库规模、题型、难度、angle、topic、重复题和元数据覆盖率。
4. 抽查失败项的完整题目、选项、答案、解析和开放题参考答案，不只看脚本摘要。
5. 按 P0/P1/P2 输出问题：必须包含题目 id、文件、字段证据、影响和建议。

## 自动化工具

- `npm run question:audit`：运行无第三方依赖的 Python 离线审计，输出规模、分布、覆盖率和分级问题。
- `python scripts/question_audit.py --json --output reports/question-audit.json`：生成机器可读报告；Python 报告是辅助分析，TypeScript/Zod 仍是数据契约唯一来源。
- `uv run --project analysis --extra analysis python scripts/question_analysis.py --semantic --json`：使用仓库内 ARM64 ONNX INT8 模型发现语义重复和 embedding 概念簇；默认离线，不访问 Hugging Face。
- 审计报告中的 P0 表示结构性阻塞，P1/P2 仍需结合完整题目人工复核，不要把启发式告警直接当作事实错误。
- 如果发现 topic × angle 覆盖缺口且用户要求补题，转 **fill-coverage-gap** skill 处理，不在本 skill 内直接生成新题。

## 必查项目

- `id` 唯一，题干无精确或规范化重复。
- `topic` 映射到知识节点，`angle` 属于合法枚举。
- `single` 恰好一个答案，`multiple` 至少两个答案，答案索引合法且不重复。
- choice 与 open 双形态的答案契约一致。
- 选项无占位文本、原题指代、明显重复或不互斥内容。
- explanation 与正确答案一致，题干无需阅读原题即可作答。
- topic × angle 覆盖、难度梯度和题量偏斜。
- 厂商、API、模型和认证题的时效风险。
- 文章题的产品绑定风险：移除厂商/产品名后是否仍是可迁移的工程问题；“功能名是什么/主要做什么”属于 P1 内容质量问题，不因 schema、答案索引或测试通过而放行。
- 来源框架前置知识风险：题干是否出现“符合某 Lens/框架/考纲”并把它当作判断标准；这类题即使答案技术上正确也属于 P1，必须改写为给出目标、约束和验收标准的自包含工程场景。
- `source`、`lastVerified` 等字段若不存在，明确说明这是治理缺口，不要虚构来源。

## 质量判断原则

- 结构通过不等于内容正确；测试全绿时仍要报告未被自动校验覆盖的风险。
- 题库审查必须抽查内容是否考察工程推理，而不是文章术语记忆；对产品绑定题优先改写为目标、约束、机制和权衡明确的场景题。
- 先修复会影响判分的答案冲突、错误索引和不可判定题，再补覆盖缺口。
- 不要为了小规模题库引入 embedding、向量数据库或复杂 ML 管线。
- 不要仅凭关键词命中断言语义正确；需要人工复核或独立事实来源。
- 选项长度偏差是启发式信号，soft 命中不要直接当作错误。
- 不要把 `subtopic` 缺失自动判为质量错误，除非产品明确依赖它。

## 修改后的验证

如果用户要求修复：

1. 最小化修改，保留题目 id 和现有数据格式。
2. 题目内容变更后重新运行上述专项检查。
3. 再运行 `npm run typecheck` 和 `npm run test`。
4. 用 `git diff --check` 检查格式。
5. 最终报告修复项、剩余风险和未处理的低优先级问题。
