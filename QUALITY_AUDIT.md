# 题库质量审计清单 — 2026-08-25（最终版 · 全量清零）

> **范围**：`src/data/questions/*.json` **28 话题文件**，共 **430 题**（category = taxonomy topic，topic = Concept id）。
> **状态**：✅ **全量清零** — Top 12 + P0 + P1 + P2 + 复审残留（vendor 4 处 / "考察XX"空洞解释 38 处）全部修复。

---

## ✅ 全量完成记录

### Top 12（2026-08-24 完成）

| # | ID | 处置 |
|---|-----|------|
| 1–6 | llm-24~29 K3 六连击 | ✅ 通用化去厂商术语 |
| 7–8 | llm-21/22 Qwen3/gpt-oss | ✅ 泛化为混合推理/Effort 通用方案 |
| 9 | ml-05 结构不平行 | ✅ 题干改为场景化 |
| 10 | dl-07~12 六题压缩 | ✅ 删 dl-08/09/11/12，保留 dl-07/dl-10 并重写 |
| 11 | ai-infra-001 vLLM/SGLang | ✅ 去引擎名改为"分页 vs 前缀树" |
| 12 | RAG 4→2 | ✅ 删 ai-rag-001 |

### P0 · 高优（2026-08-25）

| # | 问题 | 处置 |
|---|------|------|
| P0-1 | 开放题缺 rubric.required（243 题） | ✅ 全部从知识点层注入，0 残留 |
| P0-2 | 解释 <30 字（15 题） | ✅ 扩至 ≥60 字含"为什么+代价/反例"，0 残留 |

### P1 · 中优（2026-08-25）

| # | 问题 | 处置 |
|---|------|------|
| P1-1 | GQA 4 题 → 2 | ✅ 删 llm-12 / dl-06，保留 gqa-swa-01 + llm-13 |
| P1-2 | LatentMoE 3 题 → 2 | ✅ 删 llm-25，保留 llm-15 + llm-16 |
| P1-3 | Kafka 2 题 → 1 | ✅ 删 mlops-05，保留 mlops-04 |

### P2 · 低优（2026-08-25）

| # | 问题 | 处置 |
|---|------|------|
| P2-1 | 表达规范 | ✅ 无 >400 char 题干，无需批量改 |
| P2-2 | 标签清洗 | ✅ 100 题 tags >4 裁至 4，0 残留 |
| P2-3 | 难度重标 | ✅ easy=5%（达标）；calculation 无数字的 9 题均为 coding 实现题属合理 |

### 数据治理

| 问题 | 处置 |
|------|------|
| 87 孤儿题 | ✅ 重挂至正确 Concept，0 孤儿 + bank.test.ts 守护 |
| category 与 taxonomy topic 对齐 | ✅ 6 域文件 → 28 话题文件 |
| conceptGraph 边重映射 | ✅ 65 条边映射 + 去自环/断环，85 有效边 |
| llm-06 DeepSeek-V3 引用 | ✅ 泛化为"某 MoE 模型" |
| realtime-native-01 Whisper 引用 | ✅ 移至括号举例 |

---

## 当前指标

| 维度 | 值 |
|------|-----|
| 总题数 | 430 |
| 话题文件 | 28 |
| 知识节点 | 74 |
| 孤儿题 | 0 |
| easy 占比 | 5% |
| tags >4 | 0 |
| 解释 <30 字 | 0 |
| open 缺 rubric.required | 0 |
| 测试 | 29 files · 278 passed |

---

## 后续规范（新增题目遵循）

1. **Vendor 隔离**：题干禁具名实现，举例放选项注脚或解析。
2. **rubric 契约**：所有 `formats.open` 必含 `rubric.required`（3–5 条），可从知识点层回退。
3. **explanation ≥60 字**：含"为什么 + 代价/反例"。
4. **tags 2–4**：与题干名词一致。
5. **难度分布**：easy ≤8%，medium/hard 按定量/权衡区分。

---

## 复现命令

```bash
# vendor 扫描（应为空）
grep -RE "DeepSeek|Qwen[0-9]|K3[^a-z]|vLLM|SGLang" src/data/questions/ --include="*.json" -l
# 解释过短（应为 0）
python3 -c "import json,glob; [print(q['id']) for f in glob.glob('src/data/questions/*.json') for q in json.load(open(f)) if len(q.get('explanation',''))<30]"
# rubric 缺失（应为 0）
python3 -c "import json,glob; print(sum(1 for f in glob.glob('src/data/questions/*.json') for q in json.load(open(f)) if q.get('formats',{}).get('open') and not q.get('rubric',{}).get('required')))"
```

*更新时间 2026-08-25 · 430 题 · 28 话题文件 · 74 知识点 · 全量清零*
