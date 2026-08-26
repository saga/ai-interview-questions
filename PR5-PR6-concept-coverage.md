# PR5–PR6 实施报告：Concept-coverage 生成管线前移 + Dynamic Probe

> 落地日期：2026-08-26 · 配套 ADR-042 · 前置：PR0 试点、PR1–PR4、引擎接线（概念优先抽题已接入运行时）。
> 验证：`npx tsc --noEmit` 绿；`npm test` **321 passed**（原 295，+26：blueprint.concept 8 / probe 4 / adaptive.probe 5 / engine.probe 3 / generateQuestion 4 / provider 2）；`npm run validate:questions` 绿（520 题 / 43 带 tests / 10 概念面）。

## 核心思想（一句话）
把"生成题"从 **LLM 直接出 5 道题** 前移为 **concepts → blueprint → question → tests**；把"运行时补覆盖"从 **只能从已有题库挑** 升级为 **无题的概念也能当场由 LLM 生成临时探针题**。两者共用同一套 `QuestionBlueprint` 与 `generateQuestionForBlueprint`。

---

## PR5 · 生成管线前移为 Blueprint

### 改动（`src/domain/blueprint.ts`，纯函数、可审查、可单测）
- `blueprintFromConcept(concept, node, opts)`：以目标概念为 **primary**，同节点其它概念为支撑（≤2），`expectedConcepts` ≤3；`purpose` 用概念名套角度模板，保证"为何生成此题"可审查。
- `conceptBlueprintsFromGaps(face, gaps, nodes, opts)`：**均衡**生成清单——每个概念最多 `maxPerConcept=1` 张蓝图，从源头消灭"5 题全问同一概念"；按 `conceptPriority`（importance 降序）优先补高权重概念；orphan 概念（无节点归属）跳过。
- `testsFromBlueprint(bp)`：蓝图 → `tests[]`（1 primary + ≤2 supporting）。
- `buildQuestionFromGeneration(gen, bp, id, opts)`：LLM 输出 → 正式 `Question`（支持 `transient` 标记）。

### LLM 生成（`src/ai/generateQuestion.ts`，PR5/PR6 共用）
- `generateQuestionForBlueprint(bp, node, complete)`：在蓝图约束内生成 self-contained 新题（不依赖原题）；
  输出经 `assembleGeneratedQuestion` 规范化（缺 `tests` 时回退蓝图映射，choice/open 形态兜底）。
- `LLMProvider` 接口新增 `generateQuestion(bp, node)`，由 `PiAIProvider` / `ChromeAIProvider` / `FallbackProvider` 实现，降级链自动生效。

### 离线入口（可审查产物）
- `scripts/generate-concept-questions.ts` → `npm run generate:concept-questions -- --node transformer --count 5`。
- 实跑 transformer 节点：**概念面 10 / 本节点题 12 / 未覆盖概念 5 → 5 张均衡蓝图**（multi-head-attention / kv-cache / training-objective / ffn / flash-attention 各 1 张），每张含 `purpose` + `expectedConcepts` 链路，可直接交 LLM 出题。

---

## PR6 · Dynamic Probe（运行时按需生成临时题）

### 运行时接线（`src/application/interviewEngine.ts`）
- `pickNextConceptAware` 新增 `allowProbe` 参数：开 AI 且选中概念**无对应题库题**时，返回 `{ question: null, probeConceptId }`（而非静默回退）。
- `pickNextAdaptive` 透传 `probeConceptId` 信号。
- `nextAdaptiveStep` 收到信号后：找概念所属节点 → `buildProbeBlueprint` → `provider.generateQuestion` → 组装为 **transient 临时题**返回；并新增可选 `providerOverride` 测试接缝。
- **向后兼容铁律**：无 AI（`providerOverride` 缺且 `def.useAI=false`）或生成失败时，自动回退到原 topic/angle 路径——默认行为零变化。

### 探针语义（`src/domain/probe.ts`，纯函数）
- `buildProbeBlueprint(concept, node)`：首次探测 unseen 概念用易定义题建立认知（definition / easy / choice）。
- `probeFrequency` / `shouldPromoteProbe`（阈值 `PROBE_PROMOTION_THRESHOLD = 3`）：统计同一概念被探针反复探测次数——达阈值即视为真实、值得补成正式题的缺口。
- 引擎返回时带上 `probe: { conceptId, promoted }` 信号，供上层把该概念送交 curated 题库生产管线（题库自演化）。
- **不变量**：探针题 `transient=true` 且 `tests` primary 命中目标概念 → 作答后该概念被会话历史记入、覆盖缺口关闭；`validate:questions` 仅校验正式题库，不强制 transient 题。

---

## 关键文件
| 文件 | 作用 |
|------|------|
| `src/domain/blueprint.ts` | PR5 概念蓝图生成（blueprintFromConcept / conceptBlueprintsFromGaps / testsFromBlueprint / buildQuestionFromGeneration） |
| `src/ai/generateQuestion.ts` | LLM 据蓝图生成全新题（PR5/PR6 共用） |
| `src/ai/provider.ts` | `LLMProvider.generateQuestion` 接口与三实现 |
| `src/domain/probe.ts` | PR6 探针频率 / 晋升阈值 / 探针蓝图（纯逻辑） |
| `src/domain/adaptive.ts` | `pickNextConceptAware` 增 `allowProbe`；`pickNextAdaptive` 透传 `probeConceptId` |
| `src/application/interviewEngine.ts` | 运行时接线：探针生成 + `providerOverride` 接缝 + `probe` 返回 |
| `src/schemas/question.ts` | `Question.transient` 可选字段 |
| `src/types.ts` | `GeneratedQuestion` 类型 |
| `scripts/generate-concept-questions.ts` | PR5 离线蓝图生成入口（`npm run generate:concept-questions`） |
| `docs/DECISIONS.md` | ADR-042 更新（PR5/PR6 已落地） |

## 验收对照
| 项 | 状态 |
|----|------|
| PR5：生成脚本产出可审查蓝图 JSON | ✅ 实跑 transformer 产出 5 张均衡蓝图 |
| PR5：概念分布均衡（无 5 题同概念） | ✅ `conceptBlueprintsFromGaps` 每概念 ≤1 张，单测覆盖 |
| PR5：禁止 LLM 直接盲生成 5 题 | ✅ 必须先过 `QuestionBlueprint` 约束 |
| PR6：uncovered 概念无题 → LLM 临时题 | ✅ 引擎测试覆盖（transient + tests 主探该概念） |
| PR6：探针频率晋升阈值逻辑 | ✅ `shouldPromoteProbe` 单测（阈值 3）+ 引擎 `promoted` 信号 |
| PR6：无 AI 时回退不报错 | ✅ 引擎测试覆盖（取 bank 题、无探针） |
| 红线：tests ≤3 / primary 唯一 / unseen≠0 分 | ✅ 全部沿用既有约束，未改动 |

## 后续（可选）
1. **推广概念面**：向 `rag` / `agent-fundamentals` 等高频节点挂 `concepts[]`，引擎与 PR6 探针自动对这些节点生效（无需改引擎）。
2. **探针晋升落地**：把 `probe.promoted` 信号接进 curation 管线，触发正式题生产（`generate:concept-questions` 已能产出对应蓝图）。
3. ADR-042 列明的 V2 项（Facet / BKT / IRT / prerequisite 图）仍留待数据就绪后推进。

---

## 后续增强（2026-08-26 晚）：概念面推广 + Curation 闭环

> 把上表"后续（可选）"的第 1、2 项落地。

### 1. 推广 concepts[] 到高频节点
- 在 `rag.json`（`rag`/`vector-db`/`rag-pipeline`/`reranking`，共 33 概念面）与 `agentic-ai.json`（`agent-fundamentals`/`agent-loop`/`tool-calling`/`agent-guardrails`，共 35 概念面）知识节点挂 `concepts[]`。
- 概念 id 加命名空间前缀（`vdb-`/`rag-`/`rgp-`/`rk-`/`af-`/`aloop-`/`tc-`/`grd-`）避免与节点 id 碰撞。
- **零引擎改动**：`nextAdaptiveStep` 的 `ConceptSelectionContext` 与 PR6 探针按 `knowledgeNodes` 中 `concepts[]` 非空节点自动取 face——挂上即生效。实跑 `npm run generate:concept-questions -- --node rag`：8 概念面 / 16 本节点题 → 均衡蓝图正常产出。

### 2. Curation 闭环（探针晋升 → 正式题生产）
- 引擎 `nextAdaptiveStep` 新增可选 `curationSink?: (e: ProbePromotionEvent) => void`（`{conceptId, nodeId, promoted}`）；每次生成临时探针题后调用，由调用方决定如何持久化（SPA 落 IndexedDB / CLI 落文件账本）。省略则只生成探针、不接入 curation。
- 纯逻辑 `src/domain/curation.ts`：`CurationLedger{entries[]}` 跨会话累计每 `(conceptId, nodeId)` 探针次数；`recordProbe` / `isPromoted`（阈值 3）/ `markCurated` / `curationTasks`（晋升概念 → 一张可交 LLM 的 `QuestionBlueprint`，orphan 自动跳过）。
- Node 持久化 `src/infra/curationStore.ts`：`loadLedger`/`saveLedger`/`appendProbe`/`commitCurated`/`ledgerSink(path)`（浏览器 SPA 不应 import）。
- CLI 接线：`generate-concept-questions.ts` 增 `--from-curation [path]`（默认 `data/curation/ledger.json`）+ `--commit`；npm 别名 `curation:produce`。实跑：账本含 vdb-hnsw@vector-db(计数 3 晋升) + rk-crossencoder@reranking(计数 1 未晋升) → 仅产出 1 张 vdb-hnsw 蓝图；`--commit` 后该条目 status 变 `curated`。

### 新增/改动文件
| 文件 | 作用 |
|------|------|
| `src/data/knowledge/rag.json` | 4 节点挂 `concepts[]`（33 概念面） |
| `src/data/knowledge/agentic-ai.json` | 4 节点挂 `concepts[]`（35 概念面） |
| `src/domain/curation.ts` | Curation 账本纯逻辑（recordProbe/isPromoted/curationTasks/markCurated） |
| `src/infra/curationStore.ts` | 账本文件持久化（仅 Node） |
| `src/types.ts` | `ProbePromotionEvent` 类型 |
| `src/application/interviewEngine.ts` | `curationSink` 接线 |
| `scripts/generate-concept-questions.ts` | `--from-curation` / `--commit` |
| `package.json` | `curation:produce` 别名 |
| `docs/DECISIONS.md` | ADR-042 更新（含 Curation 闭环 + 概念面推广） |

### 验证
- `npx tsc --noEmit` 绿；`npm test` **338 passed**（原 321，+17：curation 8 / curationStore 7 / 引擎 curation 接线 2）。
- `node scripts/generate-concept-questions.ts --from-curation` 实跑通过（dry-run 产出 1 任务；`--commit` 落盘 status=curated）。
