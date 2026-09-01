# 全库 KEEP/REWRITE/REMOVE 内容 pass — REWRITE 候选清单（待确认）

> 范围：86 个 overloaded 格（同 `topic×angle` ≥4 题，共 647 题）逐题读完。
> 模式：清晰同构近重复已直接删（累计 6 道，见末尾）；同认知任务换措辞的中重复列此清单，**未擅自动笔**，等确认后执行。

## 一、已执行 REMOVE（6 道，均早前清晰同构近重复，工作树未 commit）

| 删除 id | 保留孪生 | 同考内容 |
|---|---|---|
| sebastian-raschka-2026-08-164 | sebastian-raschka-2026-08-120 | 可复现性应记录什么 |
| continuous-batching-core | ai-infra-002 | 连续批处理核心调度 |
| agentic-14 | ai-eng-012 | 长任务 context 溢出处理 |
| cross-attn-qkv-mech | crossattn-qkv-flow | Cross-Attention Q/K/V 来源 |
| sebastian-raschka-2026-08-53 | sebastian-raschka-2026-08-95 | 最终答案奖励 vs 过程监督 |
| cross-attn-qkv | crossattn-qkv-flow | Cross-Attention Q/K/V 来源 |

## 二、REWRITE 候选跨格集群（按同认知任务归并，共 23 簇）

> 标注 `留K改M` 为建议保留/改写数量；「确定性」高=题干+正确项高度同构，低=仅认知任务重叠、角度略异。

### A. 高确定性（建议直接改写，留 1 改 1~2）
1. **推理时计算 / 测试时计算（跨 5 格）**：`sebastian-96/58/21`(tradeoff) + `sebastian-23/93/51/63`(system-design) + `rl-test-time-compute-01`(comparison) + `sebastian-162/150/133`(calculation) + `sebastian-91/49`(comparison，概念层)。→ 留核心策略题 + 2~3 道，其余改写为 best-of-N / tree search / 帕累托前沿 / 长上下文测量等不同切面。
2. **√d_k 缩放（跨 2 格）**：`sdpa-scaling-mech / softmax-scaling-01 / sebastian-32`(self-attn mechanism) + `ai-fund-003`(attention mechanism)。→ 留 1 改 3。
3. **因果掩码移除（self-attention/debugging）**：`mask-remove-debug` ≈ `sebastian-35`。→ 留 1 改 1。
4. **漏 √d_k 缩放后果（self-attention/debugging）**：`sdpa-omit-scaling` ≈ `scale-factor-debug`。→ 留 1 改 1。
5. **训练扩展 vs 推理扩展（inference-optimization/comparison）**：`sebastian-91` ≈ `sebastian-49`。→ 留 1 改 1。
6. **FlashAttention 四手段（flash-attention/mechanism）**：`flashattn-02` ≈ `flashattn-04`。→ 留 1 改 1。
7. **KV Cache 显存计算（kv-cache/calculation）**：`gqa-kv-cache-calc` ≈ `llm-13`（换参数不换题）。→ 留 1 改 1。
8. **可验证奖励（rlhf/mechanism）**：`sebastian-92` ≈ `sebastian-52`（正确项 3/4 同构）。→ 留 1 改 1。
9. **工具膨胀（跨 2 格）**：`harness-discovery-01 / ai-eng-006`(tool-calling) + `context-2026-104`(context-eng tradeoff)。→ 留 1 改 2。
10. **研究 Agent 设计（跨 2 格）**：`ai-eng-024 / agentic-07 / agentic-17`(system-design) + `agentic-23`(multi-agent)。→ 留 1~2 改 2~3。

### B. 中确定性（同认知任务，建议留 1~2 改 1~2）
11. **前缀缓存静态前置（跨 3+ 格，考 5+ 次）**：`agentic-caching-02`(memory tradeoff) + `ai-eng-027 / cache-prefix-01`(caching mechanism) + `context-2026-105 / prompt-cache-context-ordering-01`(context-eng scenario)。→ 跨格归并，保留 1~2 题，其余改去考不同切面（动态前缀/压缩缓存/多租户缓存失效）。
12. **Self-Attention 复杂度 O(N²)（跨 3 格）**：`attn-scaling-memory / long-context-attn-01 / mha-complexity-01 / attn-complexity-core`(self-attn calc) + `transformer/comparison` 五连。→ 留 2~3 改 3~4，去考 FlashAttention 降 O(N²) 显存 / 线性注意力破 O(N²) / KV Cache 长序列显存增长。
13. **Transformer vs RNN/CNN 复杂度（transformer/comparison）**：五连最严重。→ 留 `transformer-comparison-01`+`attn-vs-rnn-complexity`，改其余 3。
14. **MoE vs Dense（moe/tradeoff）**：`moe-design-tradeoff / moe-mixtral-05 / moe-vs-dense-compute`。→ 留 1 改 2。
15. **蒸馏轨迹/教师（distillation，跨 2 格）**：`sebastian-57/19`(mechanism) + `ai-eng-042 / sebastian-20 / rl-opd-memory-01 / sebastian-98 / distill-05`(tradeoff，各角度，部分保留)。→ 仅 `sebastian-57/19` 改 1 留 1；tradeoff 五题角度已不同，保留。
16. **Mamba/SSM 混合（hybrid-attention/tradeoff）**：`llm-hybrid-02` ≈ `hybrid-mamba-01`。→ 留 1 改 1。
17. **kernel fusion 消除 HBM（pytorch-performance/mechanism）**：`pytorch-perf-mlp-fusion-01` ≈ `pytorch-perf-gemm-epilogue-01`。→ 留 1 改 1。
18. **模型路由/级联（model-selection/tradeoff）**：`ai-fund-047 / agent-routing-01 / agentic-36`。→ 留 1~2 改 1~2。
19. **消融实验设计（evaluation/system-design）**：`sebastian-136 / 145 / 158`。→ 留 1~2 改 1~2。
20. **检测器评测数据覆盖（evaluation/system-design）**：`sebastian-76 / 82 / 87`。→ 留 1~2 改 1~2。
21. **评测集/回归构建（evaluation/system-design）**：`ai-fund-042 / ai-eval-007 / agent-eval-04`。→ 留 1~2 改 1~2（`ai-eng-018` 为 RAG 具体化，保留）。

### C. 低确定性（可选，角度略异，建议保留或仅微调）
22. **工具权限最小原则 / HITL（跨 4 格）**：`ai-tool-004`(agent-guardrails) + `sebastian-105`(tool-security) + `hitl-2026-006`(human-in-the-loop) + `agent-safety-02`(safety-alignment)。→ 四题同考"最小权限+作用域授权+高危确认/可逆"，留 1~2 改 2~3。
23. **SFT vs 偏好对齐（sft/tradeoff）**：`sft-pref-01` ≈ `ai-fund-021`。→ 留 1 改 1。
24. **语义缓存风险（caching/scenario）**：`ai-ops-002` ≈ `ai-eng-064`（答案错误命中 vs RBAC 越权）。→ 留 1 改 1。
25. **Agent 失败定位观测（observability/debugging）**：`sebastian-108` ≈ `oreilly-radar-10`。→ 留 1 改 1。
26. **NoPE 位置感知（positional-encoding/mechanism）**：`llm-28` ≈ `llm-17`（机制推导 vs 长度泛化验证）。→ 留 1 改 1。

## 三、整体结论
- 86 格在字面层近重复 ≈ 0，内容层多为健康深覆盖（不同 scenario/机制/难度）。
- 真正"同认知任务换措辞"的中重复集中在 **sebastian 系列 + 高频 topic**（self-attention / inference-optimization / transformer / rag / evaluation / model-selection）。
- overloaded 格内检测会漏掉**跨格同认知任务重复**（如推理预算跨 5 格、O(N²) 复杂度跨 3 格、最小权限跨 4 格）——这是 P0 收尾真正要治理的对象，需跨格一次性归并决策。

## 四、待你确认后的下一步
1. 对每条集群拍板「留谁改谁」（或整簇跳过保留）。
2. 改写时改**题目内容/认知任务**（不只用 angle 标签糊弄，遵守 ADR-067 契约）。
3. 全部改完 + 6 道删除一起打 ADR（建议 ADR-068 接 ADR-067），`validate:questions` 必须保持通过。
