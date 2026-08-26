# PR1–PR4 实施报告：Concept-coverage（概念覆盖驱动抽题）

> 落地日期：2026-08-26 · 配套 ADR-042 · 前置：PR0 试点（`PR0-transformer-pilot.md`）、action list（`concept-coverage-action-list.md`）
> 验证：`npx tsc --noEmit` 绿；`npm test` **292 passed**（原 278，+14）；`npm run validate:questions` 绿（520 题 / 43 带 tests / 10 概念面）。

## 核心思想（一句话）
**Knowledge Set ≠ Question Set ≠ Assessment Set。** 题目多不代表覆盖广。本组改动建立一层"概念覆盖坐标系"——抽题从"选哪道题"变为"先选最该验证哪个概念"，再找探测该概念的题。

## 改动清单（全增量、零回归）

### PR1 · 概念作为独立覆盖层（范围有意调整）
- **原计划偏离（刻意为之）**：action list 曾建议"把 `ffn` / `residual-normalization` / `causal-mask` / `training-objective` 升为正式知识节点"。**已放弃**——它会触发 `knowledge.test.ts` 的"无悬空节点"不变量（每个节点 id 必须作为某题 `topic` 存在）失败，且违背 PR0 洞察 #4（概念应独立于知识节点）。
- 替代方案：这 4 个概念**已作为概念面**存在于 `transformer` 节点的 `concepts[]`（id/title/importance），覆盖坐标系直接建立在概念面之上，无需成为知识节点。
- 新增共享类型（`src/types.ts`）：`ConceptRef` / `ConceptStats` / `ConceptStatus` / `ConceptAttemptSignal` / `QuestionTest`。

### PR2 · 题目 `tests[]` 并回题库 + 校验脚本
- `scripts/pilot/merge-tests.mjs` 把 PR0 试点映射并回 `src/data/questions/transformer.json`：**43/43 题已带 `tests`**（每题 1 primary + 0~2 supporting，≤3 概念）。
- `Question.tests[]` 与 `QuestionTest` 类型已接好（`src/schemas/question.ts`，复用 ADR-041 前瞻字段）。
- `scripts/validate-questions.ts` + npm `validate:questions`：校验 `tests[].concept` 存在于某知识节点概念面、每题 ≤3 概念、primary 唯一。**生产题库一字未改结构，仅增量加了 `tests`**。

### PR3 · 概念级覆盖纯函数（`src/domain/coverage.ts`）
新增：`conceptFaceOf` / `buildConceptStats`（滚动平均聚合）/ `computeConceptCoverage`（**加权** importance）/`getConceptStatus`（unseen/weak(<60)/partial(<85)/strong，unseen≠0 分）/`getCoverageGaps` / `conceptPriority`（importance×需求度）/ `rankConcepts`。**完全不动**既有 topic×angle 覆盖。

### PR4 · 概念优先抽题（`src/domain/adaptive.ts`）
- 新增 `selectNextConcept → findQuestionForConcept` 与 `pickNextConceptAware`。
- `pickNextAdaptive` 增加可选 `conceptCtx` 参数：提供概念面时走概念优先路径，否则回退原 topic/angle 逻辑（**向后兼容，引擎默认路径不变**）。
- deep-dive / gap-probe / broaden / move-on 四策略保留，作用对象从 topic 升级为 concept：unseen 概念 → `move-on`，已测未掌握 → `gap-probe`。

## 关键事实对照（PR0 假设全部成立）
| 概念 | imp | 状态 | 触达题数 |
|---|---|---|---|
| self-attention / QKV | 1.0 | covered（过载 36 题次） | — |
| transformer 总体架构 | 1.0 | covered | — |
| multi-head-attention | 0.9 | covered | — |
| causal-mask | 0.9 | **covered（PR0 时为 uncovered）** | — |
| positional-encoding / RoPE | 0.8 | covered | — |
| residual-normalization | 0.7 | covered | — |
| training-objective | 0.7 | covered（原仅 supporting 弱覆盖） | — |
| **kv-cache** | 0.9 | 概念面已登记（PR0 时 uncovered，但其题在 `model-architecture`/`inference` 题库） | — |
| **ffn** | 0.6 | 概念面已登记 | — |

PR2 后 transformer 主题内 43 题的概念分布已可在 `validate:questions` 与 PR0 覆盖率脚本中复核。

## 如何继续（未做，避免过度设计）
1. **接线引擎**：`interviewEngine.nextAdaptiveStep` 传入 `conceptCtx`（从 `knowledgeNodes` 取 `transformer` 节点 `concepts[]` 作 face，从已答历史派生 `answered`）。当前默认路径不变，属集成里程碑。
2. **Facet（概念×角度）**：V2 再上，先不引入。
3. **BKT / IRT**：沿用 ADR-040 的 Phase 排序，数据就绪后做。
4. **LearnerProfile 持久化 concept 级统计**：当前由 session 历史派生即可，不必先改 schema。
5. **推广概念面**：目前仅 `transformer` 节点有 `concepts[]`；其他高频节点（如 `rag`/`agent-fundamentals`）可照 PR0 方法逐步补面 + 标注 `tests`。

## 与既有 ADR 的关系
- **ADR-040**（确定性策略核心）："coverage 是核心 signal 之一"在此落地为**概念级**覆盖。
- **ADR-041**（课程管线）：复用 `Question.tests` 前瞻字段 + `validate:questions` 思路；课程题亦可带 `tests` 享受同一套概念覆盖。
