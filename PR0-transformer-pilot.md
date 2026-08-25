# PR0 实验报告 · Transformer 概念面覆盖验证

> 来源：`concept-coverage-action-list.md` 中的 **PR0**（先不写算法，手工把一个领域拆成概念、给现有题加 `tests`、跑一次覆盖缺口表）。
> 领域试点：`transformer`（真实知识节点 `src/data/knowledge/llm-architecture.json#transformer` + 题库 `src/data/questions/transformer.json`，共 43 题）。

## 1. 做了什么（最小、可逆、零生产逻辑改动）

| 改动 | 文件 | 性质 | 是否破坏测试 |
|------|------|------|------|
| `knowledgeNodeSchema` 加可选 `concepts[]` | `src/schemas/knowledge.ts` | 前瞻字段（与既有 `source`/`misconceptions` 同一模式） | 否 |
| `questionSchema` 加可选 `tests[]` | `src/schemas/question.ts` | 前瞻字段（PR2 正式接入校验） | 否 |
| `transformer` 节点挂上 10 概念面 | `src/data/knowledge/llm-architecture.json` | 真实数据改动，单节点 | 否 |
| 43 题 → 概念映射 | `scripts/pilot/transformer-concept-tests.json` | **试点数据，未写入题库** | 否（题库文件未动） |
| 加权覆盖计算脚本 | `scripts/pilot/coverage.mjs` | 只读不写 | 否 |

**关键纪律**：生产题库文件（`transformer.json` 等）一字未改；`tests` 暂存于试点文件，`PR2` 接入 schema 校验后再并回题目。校验结果：`tsc --noEmit` 绿，`npm test` **278 passed**。

## 2. 覆盖缺口表（脚本实测）

```
题库: src/data/questions/transformer.json  |  题目数: 43  |  概念面: 10

概念                          imp  状态          主/辅  触达题数
------------------------------------------------------------------------------------------
Transformer 总体架构            1.0  covered        6/9     15
Self-Attention 与 QKV 计算     1.0  covered       21/15    36   ← 严重过载
多头注意力 MHA                0.9  covered        6/0      6
因果掩码与自回归解码           0.9  covered        5/1      6
KV Cache 与推理优化           0.9  UNCOVERED      0/0      0   ← 本题库 0 题
位置编码与 RoPE               0.8  covered        1/4      5
残差连接与 LayerNorm 放置     0.7  covered        2/0      2
因果 LM 训练目标/TeacherForcing 0.7 WEAK(仅辅)      0/2      2
前馈网络 FFN 子层             0.6  UNCOVERED      0/0      0   ← 全局都无题
FlashAttention 与 IO 优化     0.6  covered        2/5      7
------------------------------------------------------------------------------------------
加权覆盖率 (本题库范围): 81.5%  (已覆盖权重 6.6 / 总权重 8.1)
未覆盖概念: 2  弱覆盖(仅作为辅概念): 1
```

> `*`（脚本中标注）：`residual-normalization` / `ffn` / `causal-mask` / `training-objective` 在当前知识库 `llm-architecture.json` 中**尚无独立知识节点**——既是题库缺口，也是知识图谱缺口。

## 3. 得出的结论（PR0 要验证的核心假设全部成立）

### ① 题目数量 ≠ 知识覆盖
43 道题，但本题库内只触达 8/10 个概念面；`ffn` 与 `kv-cache` 在 `transformer.json` 中 **0 题**。验证："题库压缩 ≠ 知识压缩"——题目多不代表面覆盖广。

### ② 覆盖极度不均（"覆盖最多"也应是目标）
`self-attention` 被 36 题次触达（21 主 + 15 辅），而 `residual-normalization` 仅 2 题、`positional-encoding` 仅 5 题。即便"已覆盖"的概念，深度也相差一个数量级。这正是 greedy weighted-maximum-coverage（action list §21）要解决的问题。

### ③ 概念跨 `topic` 泄漏 → `topic` 级视图会漏掉概念
`kv-cache` 在 `transformer.json` 中 0 题，但在 `model-architecture.json` / `inference.json` 中有**大量**题。说明 "Transformer 总体架构" 这个概念面，其组成概念分散在多个知识 `topic` 下。**以 `topic` 为单位的自适应引擎在探测 "transformer" 时永远调不出 kv-cache 题**——而 concept 级覆盖能跨 topic 把它捞出来。这是 concept-coverage 模型最直接的价值证据。

### ④ 反向缺口：题目在测、知识图没建的概念
`residual-normalization` / `ffn` / `causal-mask` / `training-objective` 被题目反复考察，但知识库里**没有对应节点**。即 **Knowledge Set 比 Question Set 还粗**——与"知识库应比题库更细"的预期相反。这提示：**concept 应作为一层独立的覆盖坐标系**，不必然从 knowledge 节点派生；PR1 需要决定概念面是挂靠知识节点还是独立建模。

### ⑤ 弱覆盖同样致命
`training-objective` 仅作为 2 道 causal-mask 题的 supporting 出现，**没有任何一道题把它当 primary**。系统会误以为"训练目标已覆盖"，实则从未专门验证。这支持 action list 的 `ConceptStatus: unseen/weak/partial/strong` 区分，且 **unseen ≠ weak ≠ partial**。

## 4. 对行动清单的修订建议

| 原 PR0 假设 | PR0 实测后的修正 |
|------|------|
| 概念 = 知识节点的子节点 | 概念应是一层**独立覆盖坐标系**；部分概念当前知识库根本没有节点（④），PR1 需先补节点或允许概念独立存在 |
| 给现有题"加 tests" | 试点用映射文件承载 `tests`，**未污染生产题库**——建议 PR2 再正式并入；当前 schema 已就绪 |
| 覆盖 = 是否触达 | 覆盖需分 **covered / weak / uncovered** 三态（⑤），并加权（importance） |
| topic 级抽题够用 | 概念跨 topic 泄漏证明 **topic 级视图会漏概念**（③），必须 concept-first |

## 5. 结论：PR0 通过，建议进入 PR1/PR2

模型站得住：**抽题从"选哪道题"改为"先选最该验证哪个 concept"** 在真实数据上确实能暴露传统题库视图看不到的缺口。且改动成本极低（2 个可选 schema 字段 + 1 个节点概念面 + 试点脚本），零回归。

**下一步建议（按性价比）：**
- **PR1（补知识节点）**：把 `ffn` / `residual-normalization` / `causal-mask` / `training-objective` 升为 `llm-architecture.json` 的正式概念节点（或新文件），让 Knowledge Set 与 Concept Set 对齐。
- **PR2（tests 落地 + 校验）**：把 `scripts/pilot/transformer-concept-tests.json` 的 43 条 `tests` 并回 `transformer.json` 题目，加 `validate:questions` 校验 `concept` 存在性（复用 coverage 脚本的校验逻辑）。
- **PR3（coverage.ts）**：把脚本里的 `computeConceptCoverage / getConceptStatus / getCoverageGaps` 落成 `src/domain/coverage.ts` 的 concept 级函数（现有已有 topic/angle 级，叠加即可）。
- **PR4（adaptive）**：把 `selectNextConcept → findQuestionForConcept` 接到 `adaptive.ts`，保留既有 `deep-dive/gap-probe/broaden/move-on` 四策略。
- **补题（直接产物）**：按缺口补 2~3 道 `ffn` 题、至少 1 道 `kv-cache` 的 transformer 视角题、1 道 `training-objective` primary 题。

## 6. 产生的文件
- `scripts/pilot/transformer-concept-tests.json` — 概念面 + 43 题映射（试点数据）
- `scripts/pilot/coverage.mjs` — 加权覆盖计算（可复用于其它领域：`node scripts/pilot/coverage.mjs` 目前硬编码 transformer 范围，PR 扩展时参数化）
- `PR0-transformer-pilot.md` — 本报告
