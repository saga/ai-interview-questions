# 题库正确性验证报告 — 2026-09-07

按 `verify-question-correctness` SKILL.md 流程执行：**triage → 独立求解 → 逐选项裁定 → 取证 → 判定 → 报告**。
本报告为 **report-only**，未修改任何 `src/data/questions/*`（SKILL.md §30 Do Not Auto-edit）。

- 机器明细：`reports/question-correctness-report-2026-09-07.jsonl`（26 条，符合 §24 schema）
- Triage 输入：`reports/question-correctness-worklist.jsonl`（360 条：HIGH 7 / MEDIUM 49 / LOW 304）

> ## 修复记录（2026-09-07 12:18，经人工确认后已落地）
>
> 下方 2 个 P0 的 `formats.open.referenceAnswer` 已重写，与 `choice.answer` 及 `explanation` 对齐。
> 未改动任何选项文本、`choice.answer`、`explanation`、`misconceptions`。
>
> 回归校验：open/choice 答案集比对 **637 对 · 0 矛盾**（修复前 2）；结构完整性 1354 题 0 问题；
> `validate:questions` 1354/124 通过；`question:validate-variants` **0 stale / 0 近重复 / 0 语言质量**；
> `typecheck` 干净；`npm test` **839/839**。
>
> 下方 P0 原文保留为问题记录。

## 结论概览

| 项 | 数量 |
|---|---|
| 已验证题目 | 24（7 HIGH 全覆盖 + 17 MEDIUM 抽样） |
| VERIFIED / KEEP | 20 |
| CONDITIONAL / REVIEW | 4 |
| INCORRECT / FIX（P0） | 2 |

## 全库扫描结果

| 扫描 | 范围 | 结果 |
|---|---|---|
| 结构完整性（answer 越界 / 空 answer / 重复选项 / 选项数<2 / misconceptionMap 长度·越界·正确项误绑·干扰项未绑） | 1354 题 | **0 问题** |
| `open.referenceAnswer` vs `choice.answer` 答案集矛盾 | 全库 | **2 命中**（即下方 2 个 P0） |
| open 参考答案回显干扰项独有数字/复杂度 | 全库 11 命中 | 9 良性 + 2 即上述 P0 |

> 扫描局限：答案集比对只覆盖 open 参考答案显式写出选项字母集的题目，是**必要非充分**条件检查。

---

## P0（必须修复，需人工确认）

### 1. `inference-vram-budget-calc-01` — open 参考答案与答案键完全相反

- `choice.answer = [0,1]`，`explanation` 与 open 参考答案**互相矛盾**。
- `open.referenceAnswer` 写 `正确答案：A、B、C、D`，且其 A/B/C/D 与当前 `choice.options` **完全对不上**（属于旧版本选项残留）：
  - open 的 B：`7.7+3.5+1.5=12.7GB≤16GB，安全` → 采用的 3.5 GB 正是本题设计要抓的**错误 KV 值**（漏算 K/V 因子 2）。
  - open 的 C：`64K 时 7.7+7.0+1.5=16.2GB` 又是第三套数值，与 choice 的 22.1 GB 也不一致。
- **正确答案（已独立验算）**：权重 `14e9 × 0.55 ≈ 7.7 GB`；每 token KV `2×48×8×128×2 = 196,608 B ≈ 0.1875 MiB`；32K ≈ 6.4 GB、64K ≈ 12.9 GB；32K 总计 ≈ 15.6 GB；64K 总计 ≈ 22.1 GB（必然 OOM）。
- **建议修复**：重写 `formats.open.referenceAnswer`，对齐 choice 侧。

### 2. `flashattn-07` — open 参考答案是干扰项原文

- `open.referenceAnswer = "约 33 倍：HBM IO 从 O(N²) 降到 ~O(Nd)（N=4096,d=128）。"`
- 这是**选项 [2] 的原文**，而 `choice.answer = [0,1]` 判定 [2] 错误，`explanation` 也明确驳斥了它。
- **正确答案（已取证 arXiv 2205.14135v2 Theorem 2）**：标准注意力 `Θ(Nd + N²)`、FlashAttention `Θ(N²d²M⁻¹)`，比值约 `M/d²` 与 N 无关；论文实测 GPT-2 medium（N=1024, d=64, A100）HBM R/W 40.3 GB → 4.4 GB，即原文 "up to 9×"。
- **建议修复**：把 open 参考答案改为上述定理表述，删掉 33 倍。

> 注意：`long-context-attn-01` 选项 [3] 说「显存占用 O(N²)→O(N)」与 `flashattn-07` **不矛盾**——前者是显存占用，后者是访存流量，`flashattn-07` 的解析已显式区分。建议两题加交叉引用。

---

## P2 复核结论（2026-09-07 12:30，用户口径：「有错误就改，没错误就不改」）

**已修 3 处真错误**（均不涉及答案键）：
- `ai-eng-051`：open 参考答案「1200 例/表面」为乱码 → 改为「需约千例量级样本」。
- `quant-qah-06`：`misconceptions[0]` 漏了「忽略了」，把正确事实写成了误区 → 补回。
- `ai-eng-038`：open 参考答案称 B「注定失败」失实（verifier-gated cascade 并非注定失败，
  B 的问题是缺分层与降级链）→ 改为「缺少分层与降级链，把复杂高风险任务也压给无法胜任的小模型网关」。

**以下 5 处经原文取证确认无错，撤回 P2、未改**：
- `quant-qah-06` 的 8× —— arXiv 2608.20953v1 原文 *"roughly 8× less compute per token"*。
  原文用词就是 compute per token，且题面已限定「原 bf16 权重族」。我原先判的
  「FLOPs vs 硬件耗时口径歧义」**不成立**。
- `quant-qah-02` 的 step700 / 19 点 / 7× —— 同一论文逐条对上（QAT 峰值 54.6@step700 →
  step1200 掉到约 36；QAH ~100 步 vs QAT ~700 步 ≈ 7×）。
- `specdec-03` 的「offload 约 10x」 —— HF blog *assisted-generation* 原文
  *"...relying on memory offloading, you can see up to 10x speedups"*，与 `source.materialId` 一致。
- `transformer-comparison-01` —— AIAYN 原文：contiguous kernels → O(n/k)、dilated → O(log_k n)，判 D 错正确。
- `vectordb-04` / `gqa-kv-cache-calc` —— 前者仅缺测量条件，后者是 GB/GiB 的行业通行混写；答案键无歧义。

## P1/P2（建议改进，不影响答案键）

| 题目 | 级别 | 类型 | 说明 |
|---|---|---|---|
| `quant-qah-06` | P2 | AMBIGUITY | 「每 token 计算量」口径歧义：FLOPs 口径下答案是 2 倍（选项 [2]），硬件耗时口径下是 8 倍（选项 [0]）。建议题干改为「实测算力开销/推理耗时」。 |
| `specdec-03` | P2 | FACT | 「offload 时加速比约 10x」缺可复核来源（一手来源常见 2–3x）。建议补出处或改为定性表述。 |
| `transformer-comparison-01` | P2 | AMBIGUITY | 「受限卷积层」非论文标准术语；论文 Table 1 Convolutional 行给的是 `O(log_k n)`（通常指膨胀卷积）。建议写明「此处指普通卷积，路径 O(n/k)」。 |
| `vectordb-04` | P2 | AMBIGUITY | 「约百毫秒」「约 10ms」缺测量条件（数据集规模 / GPU 型号 / batch）。 |
| `gqa-kv-cache-calc` | P2 | MATH | 单位混用：`131072 × 256 KiB = 32 GiB = 34.4 GB`，选项写 32 GB。建议统一为 GiB。 |
| `ai-eng-051` | P2 | AMBIGUITY | open 答案中「1200 例/表面」疑似乱码；且 1200 依赖单臂单侧假设（双比例双侧 power=80% 下约 3800 例/臂）。建议改为「千例量级」并写明检验假设。 |
| `ai-eng-038` | P2 | EXPLANATION | 对 B 的驳斥「注定失败」过度断言——verifier-gated cascade 是真实有效的生产模式。建议改为「缺少分层与降级链」。 |
| `quant-qah-02` | P2 | OUTDATED | 「step700 / step1200 / 19 点 / 7x」建议附原始出处以便复核。 |

## 已验证无误（节选）

`ai-eng-062` `ai-eng-058`（p95 推导：P(未命中)<5% ⇒ 命中率>95%）`ai-eng-051` `ai-eng-045`
`prompt-cache-billing-tradeoff-01` `long-context-attn-01`（128000²×2 ≈ 32.8 GB）
`mxfp4-vram-savings-calc`（(120−31.875)/120 = 73.4%）`gqa-kv-cache-calc`
`agent-chain-01`（0.95²⁰ = 35.85%）`code-02` `ai-inference-005` `llm-14`
`llm-arch-hybrid-recurrent-attention-01` `ai-eng-047` `vectordb-02` `rnn-to-tf-migration`

## 后续建议

1. **先修 2 个 P0**（需人工确认后由我改，或你自行改）。
2. 把「open 参考答案 vs choice 答案集一致性」做成常驻校验——本次 2 个 P0 **全部**由它发现，是全库性价比最高的一条检查。注意：这属于**新增**一个校验脚本，不是继续扩展 `verify-question-candidates.ts`；是否落脚本请你定。
3. 剩余 LOW 304 条尚未逐题验证，可按需分批继续。
