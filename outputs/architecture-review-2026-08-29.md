# 架构 / 代码 / 文档 一致性审查报告

> 审查日期：2026-08-29
> 范围：`docs/ARCHITECTURE.md`、`docs/DECISIONS.md`、`docs/CHANGELOG.md` vs `src/` 实现
> 基线：全量测试 **364 passed**，`tsc` 通过（即下述问题**均不表现为测试失败**，属"文档/配置漂移"与"潜在健壮性"问题）

---

## 结论速览

| 级别 | 问题 | 影响 |
|---|---|---|
| **P0** | Chrome 并发/超时配置 8 处互相矛盾，CHANGELOG 记录的"纠正"未落到代码 | 实际并发行为与所有文档不符；改动即破坏测试 |
| **P0** | `clone()` 无 fallback，不支持时 Chrome 引擎整体失效 | 特定浏览器版本下 Chrome AI 完全不可用 |
| **P1** | ADR-036 决策已漂移但未标注取代，架构文档内部自相矛盾 | 误导维护者；安全语义不明 |
| **P1** | 架构文档数据严重过期（题库 520→624、知识点 74→79） | 文档失真 |
| **P2** | `chromeAgent.ts` 未入文档、`graphology` 冗余、`QuestionSource` 死代码、`scripts/` 覆盖不全 | 轻度 |

---

## P0-1 · Chrome 并发/超时配置全面撕裂（最严重）

同一个配置项，在 **8 个地方**给出了 **5 种不同答案**：

| 出处 | 并发 | 超时 |
|---|---|---|
| `src/ai/chrome.ts:462-466`（代码实际值） | **8** | **90s** |
| `src/ai/chrome.ts:461`（代码注释） | 8 | 90s |
| `src/ai/chrome.ts:469`（`chromeComplete` JSDoc） | 2 | 60s |
| `docs/CHANGELOG.md` 最新条目 | **4** | **60s**（并注明"此前误写成 8/90s，**已纠正**"） |
| `docs/ARCHITECTURE.md:316,318` | 2 | 60s |
| `src/ai/chrome.test.ts:108`（测试标题） | 4 | — |
| `src/ai/chrome.test.ts:123`（测试注释） | 8 | — |
| `src/ai/chrome.test.ts:124-125`（测试断言） | **要求 = 8** | — |
| 你上一轮的明确指令 | **2** | — |

### 核心矛盾

CHANGELOG（08-28）白纸黑字记录：

> **默认并发**：应用层单例 `chromeAI` 设 `concurrency:4 / timeoutMs:60_000 / retries:1`（注意此前误写成 8/90s，已纠正）。

但 `chrome.ts` 实际代码仍是：

```ts
/** 应用层单例：Chrome 内置 AI 并发上限 8，单次 90s 超时，失败重试 1 次。 */
export const chromeAI = new ChromeAIExecutor({
  concurrency: 8,
  timeoutMs: 90_000,
  retries: 1,
});
```

**即：变更日志记录了一次"已纠正"的修改，但这次修改没有落到代码里（或被回退）。**

### 为什么现在没人发现

测试断言是 `expect(maxActive).toBeLessThanOrEqual(8)` + `toBeGreaterThanOrEqual(8)`（要求恰好 8）。
一旦按 CHANGELOG 改成 4，该断言**立刻失败**。所以测试把"错误值"锁死了——这是典型的"测试保护了当前实现而非契约"。

### 性能上的反向证据（重要）

CHANGELOG 同一条目里还有实测数据，且与"改成 4"自相矛盾：

> 真实计时（10 题，干净浏览器）：clone + 并发 4 ≈ **250s** 进入题目页……实测此前并发 8（无 clone）约 **90s** 反而更快——故 keep clone 的同时建议把并发提到 **6~8**（待真机验证）。

也就是说：**按 CHANGELOG 改成 4，出题会从 90s 劣化到 250s**。文档自身在"该设几"上是摇摆的（一处说纠正为 4，一处建议 6~8）。

### 建议

1. **先定一个数，再全局对齐**。建议以你的实测结论为准（当前 8 反而最快 → 保留 8，或取折中 6），然后一次性同步：
   - `chrome.ts:461` 注释 + `462-466` 常量 + `469` JSDoc
   - `chrome.test.ts:108` 标题 + `123` 注释 + `124-125` 断言
   - `ARCHITECTURE.md:316,318`
   - `CHANGELOG.md` 最新条目（删掉"已纠正"的错误陈述，改为真实值）
2. 把并发数抽成**具名常量**并让测试从代码读取，避免再次漂移。
3. 若你确实要"并发 2"（上一轮指令），请直接告诉我——我会连测试断言一起改。

---

## P0-2 · `clone()` 无 fallback，Chrome 通道可能整体失效

`src/ai/chrome.ts:430-434`：

```ts
const c = await withTimeout(
  (base.clone?.() ?? Promise.reject(new Error('session 不支持 clone'))) as Promise<ChromeSessionLike>,
  timeoutMs, 'clone',
);
```

- `clone()` 是较新的 Prompt API，**并非所有支持 Prompt API 的 Chrome 版本都提供**。
- 一旦 `clone` 不存在：每次调用都在重试 1 次后彻底失败 → **Chrome 引擎 100% 不可用**，只能等降级链落到云端。
- 与项目一贯的"降级/兜底"设计相悖（变体失败回退原题、评分失败返回 null、引擎降级链都有兜底，唯独这里没有）。
- 副作用：clone 失败时 base session 已建立，但不会被及时销毁（留在 `baseSessions`，仅 `idle()` 时由 `disposeBases()` 释放），会额外占用 Chrome 并发槽位。

**建议**：增加 fallback——`base.clone?.()` 不存在时**回退到 `lm.create()`**（即回到 08-28 之前的模式），而不是直接 reject：

```ts
const c = base.clone ? await base.clone() : await lm.create({ initialPrompts: ... });
```

---

## P1-1 · ADR-036 决策漂移，架构文档内部自相矛盾

**ADR-036（08-24）原文**（`DECISIONS.md:109-110`）：

> 失败直接抛错，**无兜底回退**（用户显式要求）。
> `application/interviewEngine.finalizeQuestion` **移除 `try/catch` 回退**，校验失败即让 `buildSession` 失败。

**代码实际**（`interviewEngine.ts:126-140`）：

```ts
} catch (err) {
  console.warn(`变体生成失败(${sq.question.id})，回退到原题：`, err);
  return sq;   // ← 回退原题，try/catch 仍在
}
```

**架构文档内部也打架**：
- `ARCHITECTURE.md:324`（08-28 修复记录）：「`finalizeQuestion` 在变体 validate/JSON 失败时 `console.warn` 并**返回原题**」✅ 与代码一致
- `ARCHITECTURE.md:369-376`（LLM 变体安全章节）：「fail → **抛错（无回退）**」「失败直接抛错，无回退原题（用户显式要求）」❌ 与代码相反

**根因**：08-28 为修复"开始训练永久卡住、进不去题目页"，有意把回退加了回来，但 **ADR-036 与架构文档对应章节未同步修订**。

**建议**：
- 在 `DECISIONS.md` 的 ADR-036 标题加 `（部分被 2026-08-28「finalizeQuestion 回退原题」修订）`，正文标注"无兜底"语义已放宽为"校验失败回退原题，避免整批组卷中断"。
- 统一 `ARCHITECTURE.md` 两处表述。

> 项目本身有"取代 ADR-xxx"的标注约定（如 ADR-027 取代 ADR-024、ADR-036 取代 ADR-019），只是这次漏标了。

---

## P1-2 · 架构文档数据严重过期

| 项目 | 文档声称 | 实测（`scripts` 统计） |
|---|---|---|
| 题库文件数 | 28 | **34** |
| 总题数 | 520 | **624** |
| 双形态题（choice+open） | 514 | **618** |
| 仅 choice 题 | 6 | 6 ✅ |
| 知识点文件数 | 7 | **12** |
| 知识点节点数 | 74 | **79** |

对应位置：`ARCHITECTURE.md:97-108`（题库）、`ARCHITECTURE.md:115-116`（知识点）。

CHANGELOG 显示 08-27 新增了 `aws-genai-developer-pro`（25 题）、`aws-ai-practitioner`（10 题）等新题域，但架构文档未同步。
另：文档列举的知识点文件名是旧的 7 个（dl-fundamentals / llm-architecture / training / inference / rag / agentic-ai / system-design），实际已扩到 12 个。

---

## P2 · 其他不一致

1. **`src/ai/chromeAgent.ts` 未进架构文档**（中等）：08-28 新增的"Agent 面试支持 Chrome AI"核心模块（prompt-based 工具调用，`runtime.ts:20` 已接线），`ARCHITECTURE.md` 的 `ai/` 分层清单里没有它，第 294-297 行的 Agent 段也未提及 Chrome 走专用运行时。

2. **`graphology` 冗余依赖**（轻微，上次已报告未清理）：`package.json` 声明 `@graphology/...`，`src/` 全树零引用。

3. **`src/data/source.ts` 的 `QuestionSource` 是死代码**（轻微）：定义了 `questionSources` / `getQuestionSource` / `sourceToBank`，但**除自身外无任何调用方**。而 `ARCHITECTURE.md:137-140` 写的是"课程题库经 QuestionSource 接口接入引擎与 Agent"，措辞暗示已接入。ADR-041 称"前瞻设计，尚未实现课程来源"——建议把架构文档改为"预留接口，尚未接线"，避免误导。

4. **`scripts/` 覆盖不全**（轻微）：架构文档只描述了 `question-coverage.ts` / `question-blueprint.ts`，实际还有 `generate-concept-questions.ts` / `lint-bias.ts` / `fix-bias.ts` / `validate-questions.ts` / `pilot/`，且 `package.json` 已暴露为 npm scripts。

---

## 已验证正常（无需担心）

- ✅ **分层边界**：`ai/` 零越界依赖 `domain/learner|adaptive|quiz`；`domain → schemas` 仅 `conceptGraph.ts` 一处，且在文档豁免列表内；`domain` 不依赖 React / LLM 库。
- ✅ **ChromeAIExecutor 核心机制已真实实现**：并发队列、回调式 `withTimeout`、`AbortController` 取消、失败重试、`finally destroy()`、`runningTasks` Map —— 与 `ARCHITECTURE.md:315-322` 描述一致（仅数值不符，见 P0-1）。
- ✅ **评分红线**：未作答 / 无 provider / `useAI=false` 一律返回 `null` 而非 0，全链路一致（`interviewEngine`、`agent/tools`、`learner.sessionFromQuiz`）。
- ✅ **Agent 接线完整**：`runtime.ts` → `buildChromeAgentRuntime()` → `chromeAgent.ts`，测试覆盖 5 例。
- ✅ **工程健康**：364 tests passed，`tsc` strict 通过，`schemas/` Zod 边界统一。
- ✅ 文档引用的 `docs/config.example.json`、`scripts/*` 均真实存在。

---

## 建议处理顺序

1. **定死 Chrome 并发数**（P0-1）——这是唯一会让"改动即破坏测试"的项，需你拍板 2 / 4 / 6 / 8。
2. **补 `clone()` fallback**（P0-2）——纯增量改动，无风险，10 行以内。
3. **修订 ADR-036 标注 + 统一架构文档两处表述**（P1-1）——纯文档。
4. **刷新架构文档里的题库/知识点数据**（P1-2）——纯文档，建议改为"由 `validate:questions` 生成，勿手写数字"。
5. 补 `chromeAgent.ts` 到文档、清理 `graphology`、修正 `QuestionSource` 措辞（P2）。

告诉我先处理哪几项（或全部），我就动手。第 1 项需要你确认目标并发数。
