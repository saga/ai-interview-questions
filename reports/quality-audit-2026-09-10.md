# 题库质量体检报告 · 2026-09-10

基线：1409 题 / 148 知识节点 / 53 个变体池文件（1261 变体，覆盖 647 题 = 45.9%）
门禁现状：`validate:questions` ✓（100% angle）· `vitest` 890/890（61 files）· `validate-variants` EXIT 0（0 stale / 0 近重复 / 0 语言质量）· `tsc -b` ✓

---

## 一、结论先行

**没有判分级的错误**（答案冲突 0、重复题 0、id/索引越界 0）。但有两个**工具/门禁层面的 P0/P1 缺陷**会让质量报告失真或护栏失明，必须先修，否则后续所有体检数字都不可信。

| # | 级别 | 问题 | 影响 |
|---|---|---|---|
| 1 | P0 | `analysis/question_audit.py` 的 `VALID_ANGLES` 过期（11/19） | 16 条假 P0；缺口数 20 被虚报为 26 |
| 2 | P1 | `bank.test.ts:77` 正则不匹配全角冒号 | 645 题（45.8%）的 choice/open 一致性校验被静默跳过 |
| 3 | P1 | 140 道选项长度比 >1.8×（49 strong） | 长度泄题，AGENTS.md 明令禁止 |
| 4 | P1 | 单选占比 42.0%（目标 ≤33.3%） | 历史存量，全库门禁按设计默认关闭 |
| 5 | P1 | 覆盖缺口 20（其中 5 格是我建节点时自造） | 期望格由节点 `angles` 推导 |
| 6 | P1 | 无 source 73.6% / 无 concepts 93% / 缺 assessment 3 | 溯源与 assessment 去重能力不可用 |
| 7 | P1 | 难度倾斜：easy 仅 6.2%，hard 50.9% | 入门梯度过薄 |
| 8 | P2 | 过载格 51 个（≥4 题） | 题量偏斜 |
| 9 | P2 | 3 道多选「正确项互为复述」（含我出的 2 道） | 多选失去区分度 |

---

## 二、P0 · `question_audit.py` 的 angle 白名单过期

`analysis/question_audit.py:22` 的 `VALID_ANGLES` 只有 11 个值，而 `src/schemas/common.ts:16` 的 `questionAngleSchema` 已有 19 个。缺失 9 个：`causal / diagnosis / prediction / architecture / boundary / misconception / quantitative / implementation / synthesis`。

后果：
- 报 **16 条假 P0「invalid-angle」**，覆盖近期几乎所有入库批次：
  `dit-2026-09.json`(2)、`knowledge-agent-engineering-2026-09.json`(1)、`llm-pretraining-data-2026-09.json`(2)、`moe-shazeer-2017.json`(3)、`multi-agent-trading-2026-09.json`(2)、`multimodal.json`(5)、`wemm-multimodal-embedding-2026-09.json`(1)
- 未识别的 angle 不计入 `covered_cells` ⇒ **缺口数从真实 20 虚报为 26**。

修复：把 `VALID_ANGLES` 与 `questionAngleSchema` 对齐（建议改为从 schema 生成或加一条单测守护）。

---

## 三、P1 · `bank.test.ts` 的 open/choice 一致性护栏对近半库失明

`src/data/bank.test.ts:77`：
```ts
const answerMatch = open.referenceAnswer.match(/正确答案\s*([A-Z](?:\s*[,、和]\s*[A-Z])*)/i);
if (answerMatch) { /* 才校验 */ }
```
`\s` 不匹配全角冒号 `：` ⇒ 写作 `正确答案：A、B` 的题全部匹配失败、断言被跳过。

- 全角冒号写法：**645 题（45.8%）**
- 空格写法（能被校验）：154 题
- 无任何 `正确答案` 标记（rubric 写法）：477 题（CHANGELOG 记录过这是刻意迁移方向，非缺陷）

**当前数据无冲突**：放宽为 `正确答案[：:\s]*` 逐题复算 1409 道，**open 与 choice 答案字母不一致 = 0**。
运行时不解析该标记（open 走 LLM 以 `referenceAnswer` 为锚评分），所以这是**测试盲区，不是判分 bug**——但它是目前唯一的自动护栏。

修复：正则改为 `正确答案[：:\s]*([A-Z]…)`，并对「无任何标记」的题改为校验 referenceAnswer 非空 + 长度下限。

---

## 四、其余问题明细

**③ 长度泄题**：`lint:length` 命中 140 道（>1.8×），`lint:bias` strong 档 49 道（正确项全局最长 + 明显过短干扰项），典型如 `sebastian-raschka-2026-08-30`（26 vs 13，2.0×）、`mtp_speculative_decoding_canonical`（141 vs 78）。近期 4 个新批次 0 命中。

**④ 单选占比 42.0%**（592/1409）；AGENTS.md §4.2 目标 ≥2/3 多选，全库门禁 `--gate-format-ratio` 默认关闭待存量清理。

**⑤ 覆盖缺口 20**（402 期望格，全为 P1）：LLM 核心 7 · LLM 应用 8 · Agent 工程 5。
其中 5 格来自我建的 4 个 multi-agent 节点——声明了 4 个 angles、每题只落 2 道，期望格却按声明推导（`multi-agent-communication-protocol` 缺 mechanism/scenario、`-dialectical-debate` 缺 comparison、`-react-governance` 缺 tradeoff、`-role-specialization` 缺 mechanism）。要么补题，要么收窄 `angles`。

**⑥ 治理缺口**：无 `source.materialId` 1037（73.6%）；`concepts` 缺失 1311（93%，但其为 schema 可选项；缺失会让 assessment 去重实际不可用）；`assessment` 缺失 3（全在 `dit-2026-09.json`）。

**⑦ 难度倾斜**：easy 87（6.2%）/ medium 605（42.9%）/ hard 717（50.9%）。

**⑧ 过载格 51 个**：`evaluation×scenario` 27、`evaluation×system-design` 26、`context-engineering×system-design` 12、`agent-loop×mechanism` 12、`inference-optimization×mechanism` 18 等。

**⑨ 多选只考一个判断**（`audit-question-quality` ④探测器）：
- `scaled-dot-product-scaling-calculation-canonical`：A「方差≈64」与 B「标准差≈8（=√64）」数学等价，A⇒B，同一判断点考两次
- `multi-head-attention-subspace-calculation-canonical`：正确项最高两两相似度 78
- `transformer-comparison-01`：相似度 70

---

## 五、已排除的嫌疑（不是错误）

- **解析/答案冲突 2 条**：`skillevo-skill-module-spec-01`、`flash-attn-io-mechanism` — 均为「下列说法**错误**的是」否定式题干，答案为错误陈述，非冲突。全库否定式题干仅 5 道。
- **重复题**：id 重复 0、题干规范化后完全重复 0 组、近重复最高 Dice 0.711（跨 topic 短题干假阳性）。
- **时效性风险**：题干/选项点名具体模型或版本仅 1 道，含时间锚点 0 道——`question_audit` 的 103 条 `missing-source` 是按关键词（vendor/API/model）命中且无 source 对象，属治理缺口而非内容过期。
- **自包含性**：题干引用外部材料（「本文中/如上所述」）仅 4 道，均为误报（「前文」出现在技术语境如 Prefix/Suffix）。

---

## 六、修复记录（已执行 ①②⑤，③④待定）

### ① `analysis/question_audit.py` 的 angle 白名单 — 已修

不再硬编码：新增 `_load_angles_from_schema()`，正则解析 `src/schemas/common.ts` 的
`questionAngleSchema`（先剥掉 `//` 行注释再抓 `z.enum([...])`），失败时回退到 19 值副本。
**schema 再加 angle 会自动同步，杜绝再次漂移。**

| 指标 | 修复前 | 修复后 |
|---|---|---|
| P0 | 16（全为假阳性） | **0** |
| 覆盖 | 376/402，缺口 26（虚报） | **382/402，缺口 20**（与 `question-coverage.ts` 一致） |

### ② `bank.test.ts` 的 open/choice 一致性正则 — 已修

正则提为模块级常量 `OPEN_ANSWER_RE = /正确答案[：:\s]*([A-Z](?:\s*[,、和]\s*[A-Z])*)/i`，
并新增回归用例覆盖「全角冒号 / 半角冒号 / 空格 / A 和 C」四种写法。

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 可校验题数 | 154（12.1%） | **799（62.6%）**，+645 |
| 全量测试 | 890 | **891**（+1 回归用例） |

477 道 rubric 式参考答案（无 `正确答案` 标记）按 CHANGELOG 记录的迁移方向保持跳过。

### ⑤ 2 道正确项互为复述的计算题 — 已改写

| 题 | 改前 | 改后 | 相似度 |
|---|---|---|---|
| `scaled-dot-product-scaling-calculation-canonical` | A「方差≈64」与 B「标准差≈8」数学等价 | A 方差=d_k · B **缩放因子 1/√d_k=1/8 而非 1/d_k=1/64** · C 缩放后标准差≈1 且与 d_k 无关 | 85 → **64** |
| `multi-head-attention-subspace-calculation-canonical` | C 与 A 重复堆砌 64/512 | C「依据每个头各自的维度」（去掉数字）· B「头数越多每头越窄，h×d_k 恒等于 d_model」 | 78 → **61** |

同步更新了 `misconceptionMap` / `misconceptions` / `explanation` / `open.referenceAnswer` /
`assessment`；新增 misconception「以为缩放越彻底越好，把 1/√d_k 误用成 1/d_k」与
「忽略 d_k = d_model/h 的约束」。长度比 1.35 / 1.46（安全）。
④ 探测器命中数 **3 → 1**（仅剩存量 `transformer-comparison-01`，卡在阈值 70）。

**连带修复**：改 canonical 选项使变体池出现 2 条 stale（`sourceHash` 含 options）。
无 API key 走手动路径：用新选项写 2 题草稿 → `assemble-variants` 输出到临时池 →
按 `kind` 就地替换回原池（**不可直接写原名，会整文件覆盖丢掉同池其余 10 条**）→ 删临时文件。
现 `validate-variants` 恢复 EXIT 0、0 stale。

### 修复后全量门禁

`validate:questions` 1409/148 ✓ · `vitest` **891/891**（61 files）· `tsc -b` 0 ·
`validate-variants` **EXIT 0 池健康**（0 stale / 0 近重复 / 0 语言质量 / 0 kind 不符）·
`lint:bias`+`lint:length` 对 transformer-attention **0 命中** · python audit **P0=0 / P1=0 / P2=243**

### ③ ④ 待定（需你定夺）

- **③ 覆盖缺口 20**：其中 5 格来自我建的 4 个 multi-agent 节点（`angles` 声明 4 个角度、
  每节点只落 2 题）。二选一：**补 5 道题**（communication-protocol 补 mechanism/scenario、
  dialectical-debate 补 comparison、react-governance 补 tradeoff、role-specialization 补 mechanism）
  或**收窄节点 `angles`**到已覆盖角度。
- **④ 49 道 strong 长度泄题**：历史存量，分布在 `sebastian-raschka-*`、`transformer.json`、
  `training.json` 等文件。建议按文件分批改写，可先挑最严重的 10 道。
