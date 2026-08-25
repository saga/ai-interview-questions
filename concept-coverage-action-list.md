# Action List：从「题库驱动」升级为「知识覆盖驱动」

> 来源：用户提供的架构建议（"题库的压缩 ≠ 知识的压缩"）。
> 目标：用有限的题目尽可能覆盖一个知识领域的"面"，把 Adaptive Interview 从 `Topic → Question` 升级为 `Concept → Question`。
> 定位：本清单是**增量演进**，不是推倒重来。当前 `coverage.ts`（domain+topic+angle）、`adaptive.ts`（deep-dive/gap-probe/broaden/move-on 四策略 + `pickLeastCovered`）、`blueprint.ts`、`source.ts` 已存在，本计划在其上叠加 concept 层。
> 建议落成：`docs/DECISIONS.md` 的 **ADR-042**（与 ADR-040 确定性策略、ADR-041 课程管线同源）。

---

## 0. 核心结论（一句话）

> **Knowledge Set（领域实际有什么）≠ Question Set（我们有哪些题）≠ Assessment Set（这次实际问了什么）。**
> 题目少 ≠ 覆盖少；关键是系统要知道**哪些 concept 还没被任何题触达**，并让抽题从"选哪道题"变成"先选最该验证哪个 concept"。

---

## 1. 现状基线（已具备 / 缺口）

| 能力 | 现状 | 缺口 |
|------|------|------|
| 知识节点 | `src/data/knowledge/*.json` 7 个文件、每文件是多节点数组；节点含 `id/name/area/topic/priority/summary/required/misconceptions/angles` | 节点**内部**没有再拆 `concepts[]`（细粒度知识点） |
| 覆盖统计 | `src/domain/coverage.ts` 已有 `TopicCoverage`（domain+topic+angle），CLI 报告"按能力域汇总" | 没有 **concept 级**覆盖率；没有 importance 加权 |
| 自适应选题 | `adaptive.ts` `pickNextAdaptive` 已按 `(topic,angle)` 证据升序挑最缺考察的（`pickLeastCovered`） | 粒度停在 topic/angle；不感知单个 concept 的 unseen/weak |
| 题→知识映射 | `questionSchema` 有 `reference.concept`（**当前未被 evaluation 使用**） | 没有权威的 `tests[]`（concept+role）；选题无法按 concept 反查 |
| 生成蓝图 | `src/domain/blueprint.ts` 已存在 | 需从"直接生成题"前移为"先生成 concept→blueprint→题" |
| 来源抽象 | `src/data/source.ts` `QuestionSource` 已就位 | 动态 Probe 题可经此接入 |
| 学习者画像 | `learner.ts` `sessionRecordSchema`/`questionResultSchema` | `TopicStats` 无 `concepts: Record<id, ConceptStats>` |

**结论**：四成地基已在。本计划主要补 **concept 模型 + tests 映射 + concept 级 coverage + adaptive 改为 concept-first** 四块。

---

## 2. 目标架构：三个集合（数量故意不相等）

```text
Knowledge Set        100 concepts   （领域实际有什么，完整）
      │
      ▼
Question Bank         25 questions  （高质量、可复用、有限）
      │
      ▼
Assessment Set         8 questions  （这一次为判断该用户实际问的，更有限）
      │
      ▼
Coverage + Mastery  →  Next Frontier（下一个最该探测的 concept）
```

- **Coverage** = 触达了知识面的多少（按 importance 加权）。
- **Mastery** = 对**已触达**的知识，掌握得怎么样。
- 两个独立指标：`Coverage=35%/Mastery=92%` 与 `Coverage=90%/Mastery=68%` 是两种完全不同的用户状态，现有 engine 据此得到新信号："不只找 weak topic，还要找 uncovered concept"。

---

## 3. 数据模型增量（最小三处）

### 3.1 Knowledge 节点加 `concepts[]`
`src/data/knowledge/<file>.json` 每个节点增加：
```json
{
  "id": "transformer",
  "concepts": [
    { "id": "self-attention", "title": "Self-Attention", "importance": 1.0 },
    { "id": "qkv",           "title": "Q/K/V",          "importance": 1.0 },
    { "id": "positional-encoding", "title": "Positional Encoding", "importance": 0.8 },
    { "id": "residual-normalization", "title": "Residual & Norm", "importance": 0.7 },
    { "id": "kv-cache", "title": "KV Cache", "importance": 0.9 }
  ]
}
```
**约束**：① concept 数量 5–15 / 节点，不要追求 100 个细到 Wikipedia；② 先只 `id+title+importance`，**不加** facets/prerequisite/confidence。

### 3.2 Question 加 `tests[]`（替换/接管 `reference.concept`）
`src/schemas/question.ts` 增加（并标记 `reference` 为 deprecated）：
```ts
const questionTestSchema = z.object({
  concept: z.string().min(1),
  role: z.enum(['primary', 'supporting']),
});
// questionSchema 内：
tests: z.array(questionTestSchema).min(1),
```
**约束**：`primary` 只能 1 个；`supporting` 0–2 个。**绝不让一题 `tests` 10 个 concept**——否则 coverage 虚高、无法诊断用户到底掌握了哪个。

### 3.3 Learner 加 `ConceptStats`
`src/schemas/learner.ts` / `learner.ts`：
```ts
interface ConceptStats {
  conceptId: string;
  attempts: number;
  bestScore: number;
  avgScore: number;
  lastAttemptAt?: string;
}
// TopicStats 增加：
concepts: Record<string, ConceptStats>;
```
状态由 `attempts`/`avgScore` 推导，**不单独存状态枚举**（避免数据不一致）：
```ts
function getConceptStatus(s?: ConceptStats) {
  if (!s || s.attempts === 0) return 'unseen';
  if (s.avgScore < 60) return 'weak';
  if (s.avgScore < 85) return 'partial';
  return 'strong';
}
```

---

## 4. 执行计划（PR0–PR6，每 PR 含验收）

### PR0 · 实验验证（**先写这个，不写算法**）
- **目标**：用手工方式验证 concept 模型是否成立，再决定编码。
- **具体动作**：
  1. 取真实节点 `transformer`（`src/data/knowledge/llm-architecture.json:165`），手工拆成 8–12 个 concept（self-attention / qkv / multi-head / positional-encoding / residual-norm / ffn / autoregressive-decoding / kv-cache / inference-optimization / training-objective）。
  2. 给 `src/data/questions/transformer.json` 现有题逐个加 `tests`（仅标 primary concept，少量 supporting）。
  3. 跑一次 coverage 报告：哪些 concept ①多题 ②仅 1 题 ③完全无题。
- **验收**：产出一份"transformer 覆盖缺口表"，明确题库真实短板（比盲加题有效得多）。
- **依赖**：无。**风险**：无（纯数据实验）。

### PR1 · Concept model
- **改动**：`knowledge/*.json` 各节点加 `concepts[]`（先仅 transformer 节点打通，再推广）。`taxonomy.ts` 或 `knowledgeMap.ts` 暴露 `getAllConcepts()` / `conceptExists()`。
- **验收**：`conceptExists('self-attention')` 可查；节点 concept 数 5–15。
- **依赖**：PR0。

### PR2 · Question → Concept 映射
- **改动**：`questionSchema` 加 `tests[]`（§3.2）；写脚本 `npm run validate:questions`（或在现有 question 校验后追加）：对每个 `tests[].concept` 调 `conceptExists`，不存在则报错。
- **验收**：全题库 `tests[].concept` 100% 命中 knowledge；`primary` 恰 1 个、`supporting` ≤2 的校验通过。
- **依赖**：PR1。

### PR3 · Coverage（扩展 `coverage.ts`）
- **改动**：在现有 `TopicCoverage` 旁新增 concept 级函数（**不删**原 topic/angle 覆盖）：
  ```ts
  computeConceptCoverage(concepts, stats): number  // Σ(importance of attempted) / Σ(importance all)
  getConceptStatus(stats?)                         // unseen/weak/partial/strong
  getCoverageGaps(knowledge, learner)              // 返回 unseen+weak 的 concept 列表
  ```
- **验收**：单测覆盖三种用户状态（高 coverage 低 mastery / 低 coverage 高 mastery / 混合）；CLI 报告加"按 concept 汇总"段。
- **依赖**：PR1、PR2。

### PR4 · Adaptive 改为 concept-first（核心工程改动）
- **改动**：`adaptive.ts` `pickNextAdaptive` 在 `decideStrategy` 之后、挑题之前插入：
  ```text
  AnswerSignal → updateConceptStats → selectNextConcept(gaps, learner)
              → findQuestionForConcept(concept, questions, session) → Question
  ```
  - `selectNextConcept`：`priority = importance × coverageNeed × masteryNeed`（unseen=1.0 / 弱=0.8 / strong=0.1）。
  - `findQuestionForConcept`：筛 `tests` 中 `concept===target && role==='primary'` 的题，再按"未做过+难度合适+不重复"挑。
  - **保留**现有四策略（deep-dive/gap-probe/broaden/move-on），但作用对象从 topic 细化到 concept（如 gap-probe 的 target 变成 weak concept）。
- **验收**：现有 278 测试不退化；新增 concept-first 路径单测；`pickNextAdaptive` 行为可解释（能打印"为何选此题=为验证 X concept"）。
- **依赖**：PR3。

### PR5 · 生成管线前移为 Blueprint
- **改动**：复用已有 `src/domain/blueprint.ts`。文章/课程 → 抽 concepts → 赋 importance → 生成 **Question Blueprint**（concept+purpose+difficulty）→ 再生成题 → 映射 `tests` → 校验 coverage。禁止"让 LLM 直接生成 5 道题"。
- **验收**：生成脚本产出 blueprint JSON（可审查"为何生成此题"），再据此出题；概念分布均衡（消灭 5 题全问同一概念）。
- **依赖**：PR2（与 ADR-041 课程管线同源，共享 blueprint 层）。

### PR6 · Dynamic Probe（最后才做）
- **改动**：当 `getCoverageGaps` 发现 uncovered concept 且题库无对应题 → 调 `LLMProvider`（沿用现有 `variant`/`generateQuestion` 机制）生成**临时题**（`persist=false`，不经 `QuestionSource` 持久化）；作答后回写 `ConceptStats`。
- **验收**：探针频率统计（如 normalization 被 probe 47 次）→ 触发"晋升为正式题"的阈值逻辑，使题库变成 curated + usage-driven。
- **依赖**：PR4。

---

## 5. V1 / V2 边界与"避免过度设计"红线

| 项 | V1（本清单范围） | V2（跑通后再加） |
|----|------------------|------------------|
| 覆盖维度 | Concept | Concept × **Facet**（concept/mechanism/tradeoff/engineering…） |
| 掌握度模型 | attempts+avgScore 推导状态 | BKT / IRT |
| 选题算法 | greedy weighted coverage | Set Cover 精确解、contextual bandit |
| 概念关系 | 仅 importance | prerequisite 图、PageRank/HITS |
| 探针 | 临时题、不持久 | 晋升阈值 + 题库自演化 |

**红线（V1 严禁）**：
- 不要一次性引入 Facet + BKT + IRT + confidence + evidence-graph + prerequisite 图。
- `tests` 不得 >3 个 concept（1 primary + ≤2 supporting）。
- 不要把 unseen 当 0 分（状态推导见 §3.3）。
- 不要为补 coverage 盲目扩题库——优先 Dynamic Probe（PR6）。

---

## 6. 关键算法（V1 可直接用）

### 6.1 Concept 优先级
```ts
function conceptPriority(c: Concept, s?: ConceptStats) {
  if (!s || s.attempts === 0) return c.importance * 1.0;       // unseen
  if (s.avgScore < 85)        return c.importance * 0.8;       // weak/partial
  return c.importance * 0.1;                                    // strong
}
```

### 6.2 Greedy Weighted Maximum Coverage（选 N 道题覆盖最多重要 concept）
```ts
function selectQuestions(cands: Question[], concepts: Concept[], count: number) {
  const selected: Question[] = [];
  const covered = new Set<string>();
  while (selected.length < count && selected.length < cands.length) {
    const best = cands
      .filter(q => !selected.includes(q))
      .map(q => ({
        q,
        gain: q.tests.reduce((sum, t) =>
          covered.has(t.concept) ? sum
            : sum + (conceptsById[t.concept]?.importance ?? 0), 0),
      }))
      .sort((a, b) => b.gain - a.gain)[0];
    if (!best || best.gain === 0) break;
    selected.push(best.q);
    best.q.tests.forEach(t => covered.add(t.concept));
  }
  return selected;
}
```
> 不需要实现 Set Cover；greedy 足矣。

---

## 7. Pilot 实验（立即可做，零风险）

**对象**：`transformer` 节点（`src/data/knowledge/llm-architecture.json:165`）+ `src/data/questions/transformer.json`。
**步骤**：
1. 把该节点 `concepts` 补成 10 个（self-attention / qkv / multi-head / positional-encoding / residual-normalization / ffn / autoregressive-decoding / kv-cache / inference-optimization / training-objective），各赋 importance。
2. 给 transformer.json 每题加 `tests`（仅标 primary）。
3. 跑 coverage：输出"多题 / 仅 1 题 / 0 题"三档清单。
4. 据此判断：是补 `tests` 映射、补题、还是直接确认某 concept 真无题（交给 PR6 Probe）。
**产出**：一份 transformer 覆盖缺口表 + 一份"concept 模型可行性"结论，作为 PR1–PR6 是否全面铺开的依据。

---

## 8. 落地检查单（Action List — 勾选用）

- [ ] **PR0** 手工拆 `transformer` 节点为 10 concepts + 给 transformer.json 题加 `tests`，跑 coverage 缺口表
- [ ] **PR1** `knowledge/*.json` 节点加 `concepts[]`；`knowledgeMap` 暴露 `conceptExists/getAllConcepts`
- [ ] **PR2** `questionSchema` 加 `tests[]`（接管 `reference.concept`）；加 `validate:questions` 脚本校验 concept 存在性
- [ ] **PR3** `coverage.ts` 加 `computeConceptCoverage` / `getConceptStatus` / `getCoverageGaps`（保留原 topic/angle 覆盖）
- [ ] **PR4** `adaptive.ts` 插入 `selectNextConcept → findQuestionForConcept`；四策略作用对象细化到 concept；补单测
- [ ] **PR5** 生成管线复用 `blueprint.ts`，改为 concepts→blueprint→questions→tests 映射
- [ ] **PR6** Dynamic Probe：uncovered concept 无题时 LLM 生成临时题（persist=false）+ 探针频率晋升逻辑
- [ ] **红线** V1 不引入 Facet/BKT/IRT/prerequisite 图；`tests` ≤3 concept
- [ ] **文档** 落 ADR-042 记录本演进；Result 页增加 Coverage/Mastery 双指标（替换纯分数）
- [ ] **验证** 全量 `npm test` 保持 278 passed；`tsc --noEmit` 绿

---

## 9. 与既有 ADR 的关系

- **ADR-040**（确定性 Question Policy）：本计划的 `selectNextConcept` + greedy coverage 即其 P0-3「Question Policy」的 concept 级落地。
- **ADR-041**（Course 管线独立）：Course 题库同样适用 concept/coverage 模型，但**不共享** Interview 的 taxonomy/adaptive policy（共享 `QuestionSource` 抽象与 coverage 算法本身）。
- 本计划**不改** `source.ts` 接缝、不改评分所有权归 domain 的既有边界。
