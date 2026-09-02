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
