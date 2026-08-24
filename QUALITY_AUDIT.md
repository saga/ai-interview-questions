# 题库质量审计清单 — 2026-08-25（对齐 28 话题文件版）

> **范围**：`src/data/questions/*.json` **28 话题文件**，共 **434 题**（category = taxonomy topic，topic = Concept id），四维（Vendor绑定/表达不清/观点不明/质量不高）审计。
> **前版修复记录 2026-08-24**：Top 12 已全部完成（K3 六连击通用化、Qwen3/gpt-oss 泛化、ml-05 场景化、dl 六合二、ai-infra-001 去引擎名、ai-rag-001 删除）。

---

## ✅ 已完成

| 维度 | 状态 |
|------|------|
| D1 K3/Qwen3/gpt-oss/DeepSeek-R1/DeepSeekMath-V2/vLLM/SGLang 清除 | ✅ 全部完成 |
| D2 ml-05 题干场景化、dl 拆句 | ✅ 完成 |
| D4 ai-rag-001 删除（RAG 4→3）、dl-11/12 删除（交叉熵 6→4）| ✅ 完成 |
| 数据治理 87 孤儿题 → 0 孤儿 + 守护测试 | ✅ 完成 |
| category 与 taxonomy topic 对齐（28 文件） | ✅ 完成 |
| llm-06 / realtime-native-01 剩余 Vendor 引用清除 | ✅ 本轮补完 |

---

## ✅ P0 已完成（2026-08-25）

| # | 问题 | 处置 |
|---|------|------|
| ~~1~~ | ~~开放题缺 rubric.required~~ | ✅ 243 题已全部从知识点层注入 `rubric.required`，0 残留 |
| ~~2~~ | ~~解释过短 <30 字~~ | ✅ 15 题已扩至 ≥60 字（含"为什么+代价/反例"），0 残留 |

---

## ⚠️ 待处置（按优先级）

### P1 · 中优（本月）

### P1 · 中优（本月）

| # | 问题 | 影响范围 | 建议 |
|---|------|----------|------|
| 3 | **GQA/KV Cache 重复**：gqa-swa-01 / llm-12 / llm-13 / dl-06 四题同考 GQA 缓存压缩 | 4 题 | 合并为 2 题：1 计算公式（保留 llm-13）、1 选型权衡（保留 gqa-swa-01）|
| 4 | **LatentMoE 重复**：llm-15 / llm-16 / latent-moe 节点下 3 题 | 3 题 | 合并为 2 题：机制 + 压缩比权衡 |
| 5 | **Kafka vs RabbitMQ 重复**：mlops-04 / mlops-05 两题高度重叠 | 2 题 | 合并为 1 题选型 + 子问存储细节 |

### P2 · 低优（季度）

| # | 问题 | 建议 |
|---|------|------|
| 6 | 表达规范：单句≤40 字、选项平行、公式放代码块 | 按 topic 逐批改 |
| 7 | 标签清洗：每题 tags 限 2–4 且与题干一致 | 已基本干净（ai-fund-027/agentic-66 已修），剩余零星 |
| 8 | 难度重标：`easy` 占比控制在 5–8%，`calculation` 必含数值 | 按域扫描后批量调 |

---

## 整体改进建议

1. **Vendor lint 卡点**：新增 `scripts/vendor-lint.ts`，grep `DeepSeek|Qwen\d|K3|vLLM|SGLang|Whisper|NVLink|GPTQ|AWQ` 于题干字段，CI 阻断。
2. **rubric 自动回退**：`mergeQuestionRubric` 已支持知识点层回退；下一步在 bank.test.ts 加校验"所有 open 题的 rubric.required 非空（含回退后）"。
3. **去重合并**：GQA 4→2、LatentMoE 3→2、Kafka 2→1，释放 ~5 题容量补"长上下文 lost-in-middle / 多租户权限下沉"等缺口。
4. **explanation 最小长度守护**：bank.test.ts 加 `expect(q.explanation.length).toBeGreaterThanOrEqual(60)`。

---

## 复现命令

```bash
# vendor 扫描
grep -RE "DeepSeek|Qwen[0-9]|K3|vLLM|SGLang|Whisper|NVLink|GPTQ|AWQ" src/data/questions/ --include="*.json" -l
# 解释过短
python3 -c "import json,glob; [print(q['id'],len(q['explanation'])) for f in glob.glob('src/data/questions/*.json') for q in json.load(open(f)) if len(q.get('explanation',''))<30]"
# rubric 缺失
python3 -c "import json,glob; c=0; [exec('c+=1') for f in glob.glob('src/data/questions/*.json') for q in json.load(open(f)) if q.get('formats',{}).get('open') and not q.get('rubric',{}).get('required')]; print(c)"
```

*更新时间 2026-08-25 · 覆盖 434 题 · 28 话题文件 · 对齐 taxonomy*
