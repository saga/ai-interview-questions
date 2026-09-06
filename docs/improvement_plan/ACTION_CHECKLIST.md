# Contract 收口 + 题库内容治理 Checklist

来源：2026-09-02 全仓复核（schema / CLI / skill / runtime / docs）+ 同日第二轮变体复核。
状态：所有判断**已逐一在代码里核对过**，下面每条都带 `文件:行` 与验收命令。
分支：`dev0902`（复核意见基于 `main`，差异见下方口径校正）。

共 16 项，两条线：

- **Part A（1–10）契约与代码收口**：P0 四项（契约 + 一个实打实的 bug）、P1 六项（文档清理 + 离线变体 pipeline 补完）
- **Part B（11–16）Skills 体系收口**：P0 一项（三层分层）、P1 三项、P2 两项

> ⚠️ 前置阻塞：`node_modules` 目前为空（`npm install` 因 registry idle timeout 失败，
> `EIDLETIMEOUT`）。凡是需要 `tsc` / `vitest` 的验收项，必须先跑完 `npm install`。
> 只依赖 Node 原生 type-stripping 的脚本（`validate:questions`、`question:add`）现在就能跑。
>
> 📌 **口径校正（2026-09-02 第二轮）**：复核意见基于 `main`，本清单在 `dev0902` 上执行。
> ADR-069 的离线变体 pipeline **在本分支已有脚手架**（`question:variants` /
> `question:validate-variants` / `domain/variantPool.ts` / `schemas/variant.ts`，
> `runtimeVariantEnabled` 默认 `false`），`main` 上还没有。
> 所以「离线生产能力 2/10」要改成 **脚手架就位、产出为零**（`src/data/variants/` 只有 `.gitkeep`）。
> 真正缺的不是生成器，是 **候选超采 + 质量筛选**。见 P1-9 / P1-10。
>
> ⚠️ 工作区已有未提交改动：28 题 misconceptions 回填 + `validate-questions.ts` 新增两道门禁。
> 开始本清单前先确认它还在（`git diff --stat` 应见 7 个文件）。
>
> ⚠️ `src/data/questions/wiki-skill-evolution-2026-08.json`（+237）**不是本分支这轮改的**，
> 疑似并行 session 的产物。它已混入当前 diff，开始动 schema 前先决定：单独 commit 还是 stash 出去。

---

## P0 — 契约收口（立即修）

### [x] 1. `angle` 从 schema optional 改为 required

**现状（三个契约并存）：**

| 位置                                 | 契约                                      |
| ---------------------------------- | --------------------------------------- |
| `src/schemas/question.ts:60`       | `angle: questionAngleSchema.optional()` |
| `scripts/validate-questions.ts:52` | 缺 angle → **error**（必填）                |
| `scripts/add-question.ts:68`       | 缺/非法 angle → **error**（必填）             |
| `src/domain/coverage.ts:100-106`   | 缺 angle → `untagged++` 跳过（可选）           |

**动作：**
- `src/schemas/question.ts:60` → `angle: questionAngleSchema`
- `src/domain/coverage.ts`：`TopicCoverage.untagged` 字段删除；`questionCoverageMatrix` 里
  `if (!q.angle) { t.untagged++; continue; }` 分支删除；`formatCoverageReport` 里
  `⚠ N 题未标注 angle` 那行删除（`:155`）
- 同步扫 `untagged` 的其它引用（`src/domain/coverage.test.ts`、蓝图/审计脚本）

**风险：零。** `validate:questions` 已报「带 angle 1308 题（100.0%）」，全库无缺口。

**验收：**
```bash
npm run validate:questions          # 1308 题 / 123 节点，无 error
npm run typecheck
npx vitest run src/domain/coverage.test.ts src/data/bank.test.ts
```

---

### [x] 2. `choice.answer` 越界检查下沉到 Zod

**现状：** `src/schemas/question.ts:20-45` 的 `choiceFormatSchema.superRefine` 只校验
「answer 不重复 / single=1 / multiple≥2」，**没有** `answer[i] < options.length`。
该约束实际由 `scripts/validate-questions.ts:76-82` 和 `bank.test.ts` 补位 —— 契约被三处瓜分，
`parseQuestion()` 单独调用时会放过 `{options:[A,B,C,D], answer:[9]}`。

**动作：** 在 `choiceFormatSchema.superRefine` 内增加
`for (const i of choice.answer) if (i >= choice.options.length) addIssue({path:['answer'], ...})`。

**动作（配套）：** `misconceptionMap` 校验同样下沉 —— 长度必须等于 `options.length`、
`null` 或落在 `misconceptions` 下标内、正确项必须 `null`。现在这条只在
`scripts/validate-questions.ts` 里。（`misconceptions` 与 `choice` 分属 question 层与 choice 层，
需在 `questionSchema.superRefine` 里做，不能塞进 `choiceFormatSchema`。）

**验收：** 补 3 个 Zod 单测（越界 answer / 越界 misconceptionMap / 正确项被标注误解），均期望
`parseQuestion` 抛错；`npm run validate:questions` 仍全绿。

---

### [x] 3. 归一化解重复从 warning 提升为 hard error

**现状：** `scripts/add-question.ts:70-71`
```ts
const duplicate = existingTexts.get(normalizedText(question.question));
if (duplicate) warnings.push(`${question.id}: 题干与 ${duplicate} 规范化后重复`);
```
`normalizedText` = NFKC + lowercase + 去所有标点/符号/空白（`:26`），即**规范化后完全相同**
仍只 warning，写完照样落盘。

**动作：** 改为 `errors.push(...)`。层级划清：

| 层级                    | 处理                 |
| --------------------- | ------------------ |
| exact / normalized 重复 | **hard fail**（本次） |
| lexical 近似重复（fuzz）   | warning（保留）       |
| semantic 重复           | review / challenger |

**注意：** `existingTexts` 只装了存量题，同一批次内部的互相重复还没覆盖 —— 循环末尾
`existingTexts.set(...)`（`:72`）虽在追加，但比对发生在追加之前，所以批内重复靠这一行兜住了。
改动时别破坏这个顺序。

**验收：** 造一份含「与存量题 NFKC 归一化后相同」的 draft，`npm run question:add -- --file d.json --check`
必须 exit 1。

---

### [x] 4. 修 `variant-bench.ts` 双 `main()` 执行 bug

**现状：** `scripts/variant-bench.ts:302` 和 `:307` 各有一处 `main().catch(...)`，
benchmark 主流程会**跑两遍**（两次批量 LLM 调用 = 双倍花费 + 污染 telemetry）。

**动作：** 删掉后一处，只保留一个入口。

**验收：** `grep -c "main().catch" scripts/variant-bench.ts` → `1`；
`--dry-run` 跑一次，确认统计输出只出现一轮。

---

## P1 — 这一轮修

### [x] 5. 清掉 `lint-bias.ts` 的过期 retry 描述

**现状：** `scripts/lint-bias.ts:60`
> 新变体已由 generateVariant 自动重试修正。

与架构实际相反：`docs/ARCHITECTURE.md:534/539` 明确 `single call, no retry`，
`validateVariant` 失败即 fallback 原题 + 原因码进遥测。

**动作：** 改成「变体校验失败即回退原题并计入遥测，不再 retry」。

---

### [x] 6. 把 variant 安全表述改诚实：drift detector ≠ semantic proof

代码注释**已经是对的**（`src/domain/variant.ts:6, 102, 143-145, 165` 反复声明
「不验证语义等价」），漂移在 ARCHITECTURE.md 里也已降级为软信号。剩下两处措辞偏强：

- `docs/ARCHITECTURE.md:9` —「变体的答案 key 永远来自原题，LLM 只改表达」
  → 只保证 answer 索引不被篡改，不保证改写后选项仍真假成立
- `docs/ARCHITECTURE.md:531` — Invariant 列表里的「**正确性语义及适用条件**」
  → 没有任何机制能守住这条，应从 Invariant 降级为「由 `optionChangedTooMuch`（`token_set_ratio < 45`）
  粗粒度兜底」

**动作：** 只改这两处措辞，**不动代码、不引入在线第二 judge**。

> ✅ 2026-09-02 22:24 已收口：`ARCHITECTURE.md:9` 已重写为诚实版本（答案索引程序保证不被覆盖，但语义等价不在线验证）；`:531` Invariant 已分「程序保证 / Prompt 请求但不校验」两级。

---

### [x] 7. `ANGLE_SUGGESTIONS.format` 标注为 generation hint

**现状：** `src/domain/coverage.ts:25-36` 把 `comparison / tradeoff / scenario / debugging /
system-design / design` 全锁成 `hard + open`。`:124` 注释已经写了「启发式 / 起点」，
但 `src/domain/coverage.test.ts:87` 直接断言 `ANGLE_SUGGESTIONS['system-design'].format === 'open'`，
把 hint 冻成了契约，Agent 容易读成「comparison 缺口 ⇒ 必须生成 open」。

**动作：** 常量改名为 `ANGLE_GENERATION_HINTS`（保留旧名导出做兼容，或一次性改完 + 改测试），
字段加 `hint` 语义注释；`coverageSuggestions` 输出里加一行
「难度/形态为生成起点建议，非覆盖契约——comparison/scenario/mechanism 均可做成高质量多选」。

**验收：** `npx vitest run src/domain/coverage.test.ts`。

> ✅ 2026-09-02 22:24 已收口：常量改名为 `ANGLE_GENERATION_HINTS`；`coverage.test.ts:92` 断言已更新；`formatCoverageReport` 末尾新增 hint 行（「难度/形态为生成起点建议、非覆盖契约——comparison/scenario/mechanism 均可做成高质量多选」），实跑报告已含该提示行。

---

### [x] 8. 题库 content-quality review（长期项，本轮先立基线）

已确认的真实样例 `src/data/questions/agent-fundamentals.json[0]`（`agent-arch-localized`，multiple，ans=[0,1,2]）：

- 正确项 0 = **是什么**（做法定义）
- 正确项 1 = **为什么**（收益）
- 正确项 2 = **反过来为什么不行**（反面做法比较）
- 干扰项 3 = 把整段反面论述塞进一个选项的「小答案」

前三个不在同一认知层级，等于让考生从同一段 explanation 里拆三句话 —— 与
`skills/add-question-to-bank` 里「每个正确/错误选项都应是独立、可解释的判断」冲突。

**动作（本轮）：** 只做**检测**，不做批量改写。
写一个只读审计脚本，输出四类嫌疑题清单，纳入 `check-question-bank-quality` 的 Level 3：

1. **正确项层级不一致** — 同题多个正确项，语义类型（定义 / 收益 / 反面比较 / 条件）混杂
2. **选项塞整段答案** — 单选项含 ≥3 个从句或明显长于同题其它选项中位数
3. **信息密度泄题** — 正确项的专业度/具体度显著高于干扰项（长度 lint 拦不住的那一类）
4. **多选题只考一个判断** — 正确项全部同源同一句 explanation

**注意：** 「长度平衡 ≠ 选项质量平衡」。这四项靠 lint 规则堆不出来，只能做 LLM challenger
+ 人工复核。**不因此新增 lint 硬门禁。**

**⚠️ 验收口径（补记，2026-09-02 复核）：** 本项叫「本轮先立**基线**」，
「立基线」= 脚本产出 + **人工抽检算出误报率**。二者缺一不算完成。
只跑脚本得到 214 命中（16.4%）只是**候选集**，不是基线——不知道其中多少是真问题，
就无法用它排人工复核的优先级，Level 3 会退化成"看谁顺眼就改谁"。

> ✅ 2026-09-02 已完成（前半）：`scripts/audit-question-quality.ts`（`npm run question:quality`），
> 只读、恒 exit 0、4 个探测器；`skills/check-question-bank-quality` Level 3（:34/:113）已接线，
> 并在 REWRITE 闭环示例（:105）里写明「复核 = 重跑探测器 ②，确认原命中消失」。
> 实跑：1308 道选择题 → 214 题命中（16.4%）：① 层级混杂 56 · ② 选项塞段落 102 ·
> ③ 信息密度泄题 105 · ④ 多选单判断 3。
>
> ⏸ **未完成（后半）：人工抽检基线。** 从 214 里分层抽 20 题人工复核，
> 记录「探测器命中且确为缺陷」的比例（精确率）。精确率 < 40% 说明阈值太松，
> 先调探测器再加进 Level 3 的日常使用；**不要跳过抽检直接按清单改写 214 题**。
> 阻塞点：需人工判断，无法自动化。命令：`npm run question:quality`。
>
> **2026-09-03：抽检这一步本身已做成可复现、可交接，剩下只有「判」。**
> 上一版把抽检当一次性手工活，问题是它既不可复现（这次抽哪 20 条无从追溯），
> 也不可交接（换个人重抽一次，基线就对不上）。已给 `scripts/audit-question-quality.ts` 加三个开关：
>
> | 开关                     | 作用                                                        |
> | ------------------------ | ----------------------------------------------------------- |
> | `--sample <n>`           | 按探测器**分层**抽 n 条；比例配额 + 最大余数法               |
> | `--seed <s>`             | 确定性 PRNG（mulberry32，默认 20260902），同种子必得同一样本 |
> | `--review-sheet <file>`  | 导出 Markdown 复核表：题干 + 选项（✓标正确项）+ 解析 + 待填结论 |
>
> 两个设计点：
> - **每层保底 1 条**。n=20 时 ④ 类（仅 3 条命中）的比例配额只有 0.23 → floor 0，
>   纯比例抽样会把小类整个漏掉，基线就只反映 ②③ 两个大头；
> - **复核表自带判定口径**（「干扰项是否已失去区分度」）与**精确率分级结论**
>   （≥60% 可直接排优先级 / 40–60% 先收紧阈值 / <40% 先调探测器），避免每个人判得不一样。
>
> 执行方式（一条命令）：
> ```
> npm run question:quality -- --sample 20 --seed 20260902 \
>   --review-sheet temp/quality-review-2026-09-03.md
> ```
> 人工判完 20 条，把「命中数 / 抽样数 / 精确率」贴回本项，本项才算真正收口。
>
> ⚠️ **当前阻塞：命令行环境失效**（2026-09-03，连 `/bin/echo` 都返回 exit 127），
> 无法执行脚本生成复核表，也无法跑 `tsc` 验证改动。待环境恢复后执行上面那条命令。

---

### [x] 9. 离线变体 corpus 首次量产（把空池填起来）

**现状（2026-09-03 复核）：** ADR-069 Pool-first 架构已落地为代码，且**已有真实产出**：

| 组件                              | 状态                                                      |
| ------------------------------- | ------------------------------------------------------- |
| `src/schemas/variant.ts`        | ✅ 4 种 kind + `sourceHash`（FNV-1a）stale 检测                 |
| `src/domain/variantPool.ts`     | ✅ 运行时解析                                                  |
| `scripts/question-variants.ts`  | ✅ `--ids/--topics/--count/--kind/--missing-only/--stale/--dry-run/--concurrency/--prompt-version` |
| `scripts/validate-variants.ts`  | ✅ 只读审计：stale 标记 + variant-vs-variant 近重复报告                 |
| `src/config/sample-config.json` | ✅ `runtimeVariantEnabled: false`（Pool-first，运行时仅兜底）        |
| `src/data/variants/`            | ✅ **`wiki-skill-evolution-2026-08.wb-llm-20260902.json`**：21 题 × 2 变体 = 42 条，0 stale，门禁 0 失败 |

即：默认路径「canonical → 预生成变体 → adaptive selector，完全不调 LLM」**已不再是空跑**。
首批量产由 WorkBuddy 自身作为模型产出改写文本 + `scripts/assemble-variants.ts` 复用真实
`validateVariant` / `computeVariantSourceHash` / `variantPoolSchema` 组装落盘（**无需外部 API key**）。

**动作（已执行）：**
1. `--dry-run` 确认计划与题量（21 题）
2. 模型产出 surface-options / context-options 两种改写（题干 + 选项逐项同义改写，保留核心技术词以过 `optionChangedTooMuch`）
3. `assemble-variants.ts` 跑真实门禁（非空 / 禁指代「下文」/ 选项数量一致 / 非空 / 去重 / length bias / 选项漂移 ≥45）+ 计算 sourceHash + 组装
4. `validate-variants.ts` 审计

**验收（当前）：**
- `npm run question:validate-variants` → 题目覆盖 21、变体 42、**stale 0**
- `src/data/variants/` 非 `.gitkeep` 文件 = 1；覆盖率 = 21 / 1308 题（仅 wiki-skill-evolution 一个 topic）
- ⚠️ **近重复 9 对**（阈值 token_set_ratio ≥ 88）：均为同题 surface⇄context 变体（相似度 88–94%）。
  根因：两变体共用同一套选项改写、仅题干不同 → 互相 ~90% 相似。按 `question-variants.ts` 生成管线
  ≥88 去重阈值，第二条会被筛掉 → **单题实质只有 1 条差异化变体**。要得 2 条真正不同的变体需对选项也做
  差异化改写；但纯中文选项无空白分词，fuzzball `token_set_ratio` 易把合理改写判为漂移（`< 45` 拒），
  当前 assemble 路径对纯中文选项以 canonical 原选项兜底。属已知质量天花板，不阻塞首批量产。

**前置：** P1-10 已完成 ✅。

**下一阶段（真正剩余工作）：** 扩到更多 topic（如 `evaluation` / `agent-fundamentals`）才能把覆盖率提上去；
同时提升单题两变体的选项多样性（需改良 fuzzball 中文分词或换去重策略，否则按现状去重会塌成 1 条/题）。

> 🔴 **2026-09-03 二复核（推翻上一版诊断）：根因在代码不在数据，已修；池子待重产。**
>
> **上一版诊断是错的，这里更正。** 上一版归因于「纯中文无空白分词，`token_set_ratio` 把合理改写
> 判为漂移（`<45` 拒）→ 越保守越重复」。实测（temp 探针）结论相反：
>
> | 改写类型                     | option-vs-canonical | 判定（阈值 ≥45） |
> | ---------------------------- | ------------------- | ----------------- |
> | 轻改（换几个词）             | 53                  | ✅ 通过           |
> | 中等改写（换句式 + 同义词）  | 30                  | ❌ 拒             |
> | 真漂移（结论被偷换）         | 34                  | ❌ 拒             |
> | **只改题干、选项照抄**       | stem 55 / **整体 90** | **近重复**      |
>
> 即：**漂移门禁不是卡点**，卡点在**反方向**——选项照抄让 sibling 相似度冲到 90。
>
> **真实根因（两处，均已定位到代码）：**
> 1. `scripts/assemble-variants.ts` 旧行 `options: entry.options ?? canonicalOpts`
>    —— 草稿没给选项就**静默回落到 canonical 原选项**，两变体因此共用一套选项；
> 2. 去重规则**只存在于** `validate-variants.ts`，assemble 路径**根本不过这道门**
>    → 生成器会拒的批次，assemble 能直接落盘，问题被留在池子里而不是暴露在生成时。
>
> **量化**：真实池样本中，选项各 ≈110 字 × 4 ≈ 450 字符，题干 ≈40 字符——**选项文本量约为题干的 10 倍**。
> 题干在整体指纹里只占约 1/11 权重，**改题干不可能把整体相似度拉下来**。
>
> **已修（5 处，代码层）：**
> 1. `src/domain/variant.ts`：去重规则上提为领域函数 `findNearDuplicateVariants()` +
>    `VARIANT_DUP_THRESHOLD = 88`；
> 2. 度量换成 **`cjkDice`（字符 bigram Dice 系数）**，替掉 `token_set_ratio`（中文无空白分词）；
> 3. 比较对象换成 **选项级 `variantOptionText()`**，不再比较 stem+options
>    —— 题干本就该随变体不同，选项雷同才是判定面。实测档位：
>    **逐字照抄 = 100 · 同义轻改 ≈ 91 · 重述改写 ≈ 54**；阈值 88 卡在 91 与 54 之间；
> 4. `scripts/assemble-variants.ts`：选项改为**每个 variant 必填**（`surfaceOptions` / `contextOptions`），
>    多 variant 缺选项直接 reject；落盘**前**加去重门禁；
> 5. `scripts/validate-variants.ts`：删掉本地重复的 `fingerprint()`，改为复用领域同一函数。
>
> 验证：`temp/variant-draft-fixtest.json` 走 assemble → 2 条变体双门禁全过，sibling 相似度 **90 → <70**，
> 逐选项漂移余量 45–72（均 ≥45）；旧的共用选项草稿被正确拒绝（exit 1，未落盘）。
> 领域测试 42/42、全量 727/727、`tsc` EXIT=0。
>
> **残留工作（数据层，未做）：** 门禁修好只让它**不再新增**坏的，池子里现存 117 题仍是旧的。
> 新度量下全池审计为 **117 题 / 234 条 / stale 0 / 近重复 117 对（100%）**
> ——比旧度量的 96 对更差，不是退化，是**新度量把问题暴露得更彻底**。
> 需按「重述级」改写重产（目标 sibling ≈54，轻改 ≈91 仍会被判死）。

---

### [x] 10. 候选超采 + 质量筛选（本轮最关键的一项）

**现状：** `question-variants.ts --count N` 的语义是「每题产出 N 个变体并保留通过校验的」，
**没有超采比**。而当前 hard gate 只有：

```
结构        题干非空 / 禁指代 / 选项数量一致 / 非空 / 不重复 / length bias
语义漂移     fuzzball token_set_ratio < 45 → reject
```

`token_set_ratio ≥ 45` 通过 ≠ 语义正确。两个真实例子：

```text
原选项：「只有在 KV cache 命中前缀时才能复用已有 KV」
改后　：「KV cache 可以复用已有 KV，因此可以减少计算」   ← 条件丢失，但词汇高度重合，放行
```
```text
原题　：「为什么增大 batch size 可能提高吞吐？」
改后　：「在 GPU 利用率不足时，提高 batch size 通常可以提升吞吐…」  ← 合理但新增条件，也可能放行
```

现有 validator 擅长**防明显坏变体**，不擅长**判断这是高质量变体**。
实时模式靠 fallback 原题还能接受；**一旦永久落盘就不够了**。

**动作：** 把 pipeline 改成超采—漏斗：

```
canonical
   ↓  generate N candidates（N = 目标数 × 2~3，如目标 5 则生成 12）
   ↓  cheap deterministic gates（现有 validateVariant，纯程序，无 LLM）
   ↓  quality challenger（离线才付得起）
   ↓  dedup（fuzzball，含 variant-vs-variant 与 variant-vs-canonical）
   ↓  difficulty / angle / concept 审计
   ↓  persist only accepted
```

**Quality Challenger 的 5 个维度**（离线专用，不进 runtime）：

| 维度                       | 判据                                    |
| ------------------------ | ------------------------------------- |
| concept preserved        | 原题 `required` 概念在变体里仍然成立            |
| answer preserved         | 正确/错误属性逐项未翻转（当前只靠 canonical 索引，不校验语义） |
| difficulty preserved     | 未因新增条件变简单、未因删条件变难                     |
| diagnostic value         | 干扰项仍然有诊断力，没被改写成明显荒谬项                  |
| accidental clue          | 未意外引入长度/专业度/信息密度泄题                    |

**红线（与 P2 一致）：** challenger **只在离线 pipeline 里跑**，
不进 runtime、不做在线双模型 —— runtime 仍然 one-shot + fallback 原题。

**验收：** 同一批题分别用「直接 --count 5」和「--oversample 12 → 筛选到 5」跑，
人工盲评两组的语义保真率；筛选组应显著更高，且留存率可观测（程序生成/筛掉各多少）。

> ✅ 2026-09-02 已完成（代码 + 单测）：`src/ai/variantChallenger.ts`（上表 5 维）；
> `cheapVariantQualityFlags()` 先跑确定性预检（长度 bias + 信息密度 + 归一化重复），
> 过了才付 LLM 调用；`parseVariantChallenge` 解析不出结果按**失败**处理（不静默放行）。
> `scripts/question-variants.ts` 改三段式（超采 → 确定性闸门 + 去重 → challenger 打分取 top-N），
> 新增 `--oversample`（默认 3）与 `--no-challenger`，汇总打印过闸候选/质询否决/留存率。
> `src/ai/variantChallenger.test.ts` 11 例全绿；`--dry-run` 已验证计划量与漏斗口径。
>
> ⏸ **未完成（2026-09-03 二复核：更正「死代码」的措辞 + 给出决策）。**
>
> **更正：** 上一版称 `variantChallenger` 为「已接线的死代码」，措辞不准确。实况是：
> - **已接线**：`scripts/question-variants.ts:295`（阶段 2）确实调用 `challengeVariant`，
>   超采—质询—取 top-N 三段式完整；
> - **已单测**：`src/ai/variantChallenger.test.ts` **11 例全绿**，含 stub `complete` 的端到端路径；
> - **零真跑**：唯一没做的是**用真实模型跑一遍**——首批量产走 `assemble-variants.ts`，
>   绕开了 `--oversample` 与 `challengeVariant`。
>
> 准确表述应为：**已接线 + 已单测 + 零真跑**，不是死代码。因此 **AGENTS.md §3 的「删掉」不适用**。
>
> **决策（选 A：真跑测量；不选退役）：**
>
> 第 9 项的发现反过来**加强了**本项的立项理由，而不是削弱它。本项的核心论断是
> 「通过硬门槛 ≠ 是好变体」——而第 9 项给出了这句话的实测证据：
> 234 条变体 **100% 通过 `validateVariant`**，却在选项级去重下暴露 **117 对（100%）近重复**。
> 结构门禁连「选项照抄」都抓不住，更谈不上判断质量。
> 退役 challenger = 承认落盘变体永远只过结构门禁，与 ADR-070 的漏斗设计直接冲突。
>
> **解除方式（无需外部 API key）：** 复用第 9 项已被验证的做法——
> 由 WorkBuddy 自身充当 challenger 模型，对**已落盘的 234 条变体**逐条跑五维质询，
> 新增 `scripts/challenge-pool.ts` 聚合产出**质询否决数 / 留存率**。
> 这样测的是真实数据，且不需要 `VARIANT_API_KEY`。
>
> ⚠️ **当前阻塞：命令行环境失效**（2026-09-03，连 `/bin/echo` 都返回 exit 127），
> 脚本无法执行与验证。待环境恢复后按上述方案执行，再把汇总数字贴回本条。
> 判据不变：留存率 < 30% 先查 canonical 或 prompt，**不要靠调低 `--oversample` 掩盖**。

---

## P2 — 明确不做（本轮与下轮都不要碰）

- [x] 不引入新的 knowledge / concept taxonomy
- [x] 不引入 BKT / IRT / DKT / Bandit
- [x] **不引入在线 variant second judge** —— runtime 保持 `one-shot + fallback 原题`。
  离线 quality challenger（P1-10）**不受此限**：它没有延迟约束，是唯一付得起第二遍判断的地方
- [x] 不引入 vector DB / embedding / reranker
- [x] 不重构 application / domain / agent 分层
- [x] **不重写 `generateVariant()` 本体** —— 它的 prompt 约束已经不错（v3，只改表达、
  不传 answer/explanation/difficulty/angle）。缺的是产出后的筛选，不是生成器本身

**覆盖的方向性结论**（写在这里防止后面又走偏）：
`topic × angle` 计数已经够用，`Coverage completeness ≠ Assessment diversity`。
真正的下一阶段是 `topic × angle` **+ misconception 多样性 + difficulty 多样性**，
不靠新增 taxonomy 维度。`misconceptions` / `misconceptionMap` 已进 schema，
但**还没进 coverage / blueprint / adaptive selection** —— 那才是下一阶段的活。

---

---

## Skills 体系收口（第 11–16 项）

来源：2026-09-02 第三轮 `skills/` 专项复核。当前 6 个 skill（`add` / `article` / `fill` / `check` /
`grilling` / `teach`），复核给 **8.5/10**。以下 6 项均已在文件里核对过。

### [x] 11. 【P0】把「内容规范 / 数据契约 / workflow」彻底分层

**现状：** 三个 skill 各自**复制**了同一批规则，而不是引用单一规范：

| 规则                     | 重复出现位置                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| multiple ≥ 2/3         | `fill:37`、`add:65`、`article:36`                                                                    |
| 干扰项"差点就对"             | `fill:38`、`add:66`、`article:37`                                                                    |
| 一个核心 Concept           | `add:76`、`article:46`、`check:32`                                                                   |
| self-contained         | `add:31`、`article:30`、`check:87`                                                                   |
| 产品脱钩                   | `article:32/38`、`check:90`                                                                          |
| Answer Determinism     | `article:48`、`add:78`、`check:33`                                                                   |

**比"复制"更糟的三个事实（复核没提到，但核对时发现了）：**

1. **`check-question-bank-quality` 根本没引用 `docs/添加题库prompt.md`** —— 全文 0 处。
   而 `article:16` 白纸黑字写着它是「各出题 skill 共同引用的规范」。**声明与实际不符**，
   这正是"共享标准靠复制"的直接证据。
2. **`docs/添加题库prompt.md` 的定位是错的。** 它标题就是
   「…生成 Prompt」，内容是给 LLM 贴的生成指令（§二 Canonical 与 Variant、§十九 Variant 必须有真实诊断差异、
   §二十 Option Variant）。**它是生成 prompt，不是内容设计规范**，却被三个 skill 当规范引用。
3. **存在第二份并存版本** `docs/添加题库prompt精简.md`（4.8 KB vs 16 KB）——两份同源、内容不同步，
   本身就是一个漂移源。

**动作：**
```
docs/question-content-spec.md   ← 新建，内容设计规范（为什么 / 应该怎样）
                                   从 添加题库prompt.md 抽 §四/十/十一/十二/十四~十八
docs/添加题库prompt.md            ← 降级为「生成 prompt」，明确引用规范，不再被当规范
src/schemas/ + scripts/         ← 机器可执行契约（必须是什么）← 唯一裁决者
skills/*.md                     ← 只留 workflow（什么时候做什么），规则一律写"见 spec §X"
```
配套：`add-question-to-bank` 减负 —— 把"审查存量题"的部分（`:21`、`:77`、`:96` 的 coverage 复查）
交回 `check-question-bank-quality`，`add` 定位收敛为 **authoring + pre-write gate**，不拆 skill。

**验收：** `grep -c "question-content-spec" skills/check-question-bank-quality/SKILL.md` 从 0 变 ≥1；
三个 skill 里 multiple ≥ 2/3 / 差点就对 / 核心 Concept 各只出现一次（且均为"见 spec"形式）。

> ⚠️ 验收命令已按最终实现修订（2026-09-02 复核）：原文写的是
> `grep -c "添加题库prompt.md" skills/check-question-bank-quality/SKILL.md` 从 0 变 1，
> 但落地时 `check` 引用的是**新建的内容规范** `docs/question-content-spec.md`，
> 而不是被降级的生成 prompt —— 按原文的 grep 会一直得到 0，误判为未完成。
> 判断应看「是否引用了单一内容规范」，不看具体文件名。
>
> ✅ 实跑（2026-09-02）：`check:10/11/36-45/105` · `add:73/77-83/89/98/103` ·
> `article:16/32/36/49/56/58/63-65/75/77-78` · `fill:10-11/47/49-53/64/83` ·
> `curate:21/60-68/88/111` 均为 `spec §N` 引用形式，规则正文不再复制。

---

### [x] 12. 【P1】修正 `fill-coverage-gap` 的 variant 语义（与 ADR-069 冲突）

**现状：** `fill-coverage-gap:16-18`
```
variantCandidateIds：同 topic 下已有题的 id，用于判断"复用/改写变体"是否比"从零生成"更合适
…若已有题可以通过调整 angle/难度覆盖该缺口，优先建议变体而不是新写一题。
```
`variantCandidateIds` 一个字段同时承担两个概念：
- **A. 改题型 / angle / difficulty** 的 coverage 改写
- **B. 离线表达变体**（语义保持、认知任务一致、表述不同）

而 `docs/添加题库prompt.md` §二/§十九/§二十 已经把 B 定义得很清楚。skill 落后于架构。

**动作：** 字段改名 `reuseCandidateIds`（A 专用），并重写决策链：
```
coverage gap
  ↓ 已有题能否"重新设计为该 angle"？
  ├─ 能 → curate / rewrite（保留 core concept，换 cognitive task）
  └─ 不能 → 新增 canonical question
                ↓ 成功后
           offline variant generation 产生多个表达变体（P1-9/P1-10）
```
**明确写死一句：variant 不是 coverage 的主要补洞机制** —— 变体不新增 `topic × angle` 格子的计数
（它继承 canonical 的 topic 与 angle），用它补洞等于让覆盖率永远补不满。

---

### [x] 13. 【P1】把 `check → curate → recheck` 生命周期明确起来

**现状：** `check-question-bank-quality` 已有 Level 1–4 和「存量题改写契约（REWRITE 执行标准）」
（`:109-133`），且 `:133` 要求改写后重跑 `question:review` + `validate:questions`。
但**缺一个 KEEP / REWRITE / DELETE 的显式生命周期模型** —— agent 看到 P1 后自己决定怎么处置。

**动作：** 在 `check` 里加分级→动作映射表：

| 级别            | 动作               | 说明                     |
| ------------- | ---------------- | ---------------------- |
| P0 structural | **FIX REQUIRED** | 阻塞，必须修，不可 delete 绕过   |
| P1 content    | **REWRITE / DELETE** | 低价值且无可改造价值 → DELETE |
| P2 heuristic  | **REVIEW**       | 只记录，不改                |

并补闭环最后一步：**重新检查后必须在报告里确认原问题已消失**（不是"改完了"，
是"原 P1 项重新审计后不再命中"）。

---

### [x] 14. 【P1】`expectedConcepts` 是边界，不是 checklist

**现状：** `fill-coverage-gap:15/19/62` 用 `expectedConcepts` 约束新题，
`add:76` 说「`concepts` 第一个元素是 core concept，其余是 supporting / prerequisite」，
但**没有任何地方说明 `expectedConcepts` 不要求单题全部覆盖**。模型很容易理解成
`[A,B,C]` → 一道题必须同时考 A+B+C，题目越写越"胖"。

**动作：** `fill-coverage-gap` 直接加一句：
> `expectedConcepts` 描述候选知识**边界**，不要求单题同时覆盖全部概念；
> 默认选其中一个作为 Core Concept，其余仅在必要时作为 supporting / prerequisite。

---

### [x] 15. 【P2】`article-to-questions` 增加独立的 Candidate concept selection 步骤

**现状：** 流程是「文章 → 知识点 → 出题」（`:12-17`）。过滤要求散落在 `:32`、`:58`，
**没有独立的筛选步骤**。文章里大量存在背景介绍 / 营销观点 / 产品 feature / 作者个人建议 / 案例细节，
没有显式门槛就会被"文章里有什么就考什么"带偏。

**动作：** 在第 2 步与第 3 步之间插入：
```
Extract candidate concepts → Rank interview value → Reject low-value → 剩下的才出题
```
并给 reject 一个可判定的标准（无法脱离原文自证 / 需记忆产品名 / 无真实决策点 → reject）。

---

### [x] 16. 【P2】新增 `curate-question-bank` skill（存量题治理独立成 skill）

**现状：** 1308 题的存量治理现在塞在 `check` 的 REWRITE 契约里。职责模型应是：

```
fill-coverage-gap  = Plan        （该补什么）
article-to-questions = Extract + Author
add-question-to-bank = Author    （怎么写并落库）
check-question-bank-quality = Diagnose
curate-question-bank = Transform （keep / rewrite / delete + 重新验证）← 缺
```

与第 13 项配套：13 在 `check` 里定义生命周期，16 把 transform 的执行搬出去。
**优先级 P2** —— 先把 13 做了，16 可以等存量治理真正开始规模化时再建。

---

## 变体系统评分（对照 2026-09-02 第二轮复核，已按 dev0902 实际状态修订）

| 项目                  | 复核给分（基于 main） | 本分支实际 | 说明                                    |
| ------------------- | ------------ | ----- | ------------------------------------- |
| Prompt 约束           | 8.5/10       | 8.5   | v3 已经收得很紧，不动                          |
| 防止 answer 被 LLM 改掉  | 9/10         | 9     | canonical 恒取，不传 answer                |
| 结构安全                | 9/10         | 9     | 硬门槛齐备                                 |
| 抗明显语义漂移             | 7/10         | 7     | `token_set_ratio < 45`                |
| 真正语义等价验证            | 4/10         | 4     | 承认不做 → P1-10 只在离线补                     |
| 离线生产能力              | 2/10         | **8** | 4 文件 117 题/234 变体已量产（evaluate/rag/memory/wiki），**单题双变体多样性待解** |
| 离线质量筛选              | 3/10         | 3     | 有 stale + 近重复审计，**缺超采与 challenger**   |
| Runtime fallback 设计 | 8.5/10       | 8.5   | one-shot + fallback，不 retry           |

结论修正：**runtime 轻量变体已基本可用；离线 variant corpus 已产出首批**（wiki-skill-evolution 21题/42变体，0 stale、门禁 0 失败），但仅覆盖单 topic 且单题两变体高度相似（按 ≥88 去重会塌成 1 条/题）。补法不是重写生成器，而是「扩 topic + 改良选项去重/分词，先超采再筛选只留通过的」。

## 收尾总闸门（改完全部 P0/P1 后跑）

```bash
npm run validate:questions
npm run typecheck
npm run test                       # 51 files / 705 tests 基线
npx vitest run src/domain/knowledge/retrieve.test.ts \
               src/application/conversation/knowledgeCapability.test.ts
git diff --check
grep -c "main().catch" scripts/variant-bench.ts   # 必须 = 1
```

## 状态（2026-09-02 复核后更新）

**15/16 完成，1 项阻塞。** 代码与 skill 全部已提交（`b3d2397` / `1fa6906`）。

| 项     | 状态       | 说明                                                     |
| ----- | -------- | ------------------------------------------------------ |
| 1–7   | ✅ 完成    | 契约收口 + 文档措辞；`tsc` / `vitest` / `validate:questions` 全绿 |
| 8     | ⏸ **部分** | 检测脚本 + Level 3 接线完成；**人工抽检基线未做**（214 命中未验证精确率）     |
| 9     | ⚠️ **部分** | 2026-09-03 量产：98 题 / 196 条变体、stale 0；但**近重复 79 对**（81% 的题两条变体 88–96% 相似）——本项验收要求「无近重复」，**未过**。详见该项下红字 |
| 10    | ⏸ **部分** | 超采 + challenger 代码与单测完成；**从未被真实量产使用**（第 9 项绕开了它） |
| 11–16 | ✅ 完成    | 三层分层落地，5 个 skill 全部改 `spec §N` 引用；新增 `curate-question-bank` |

**本轮复核新发现的缺口（原清单没写，已补进正文）：**

- **文档滞后（AGENTS.md §2 硬要求）。** 本批改动含「数据契约变更（`angle` optional→required）、
  导出重命名、两个新模块、一条新规范」，但 `docs/CHANGELOG.md` 与 `docs/DECISIONS.md`
  **一个字都没有** —— 属于"代码已改、文档还停在旧形态"，违反第 2 条大原则。
  已补 CHANGELOG 条目 + ADR-070 / ADR-071，并同步 `ARCHITECTURE.md` 的 ADR-069 段
  （此前完全没提 `--oversample` 与 challenger）。
- **第 8 项「立基线」的含义此前没写清。** 见该项下新增的验收口径：脚本产出 ≠ 基线，
  必须人工抽检算出精确率。
- **B-11 验收命令指向了错的文件名。** 见该项下修订说明。

**阻塞解除顺序（不要乱序）：**

1. **第 9 项近重复**（最高优先）—— 池子已经产出，但 81% 的题两条变体实质是同一条。
   不先修这个，继续扩产只是把冗余放大。
2. **第 8 项人工抽检**（不需要 LLM，现在就能做）—— 定出探测器精确率，才知道 214 命中值不值得改。
3. **第 10 项管线二选一** —— 用 `question-variants --oversample` 真跑一批并回填留存率，
   或按 AGENTS.md §3 把从未被调用的 `variantChallenger.ts` 删掉。不要留着不管。

**不再阻塞：** `npm install` 已解决（`node_modules/.bin` 遗留空目录导致 rename 失败，
移开后重装成功）。当前 `tsc` / `vitest` / `vite-node` 均可用。

**跨线依赖**：B-12 与 A-9/A-10 是同一件事的两端 —— 离线变体的「生产端（脚本）」和
「消费端（skill 语义）」必须同时改，否则 skill 会继续把 variant 当成补洞机制。
