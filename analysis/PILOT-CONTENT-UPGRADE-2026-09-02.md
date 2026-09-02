# 题库内容提升 · 试点报告（2026-09-02）

试点文件：`src/data/questions/wiki-skill-evolution-2026-08.json`（21 题）
改造方向（按用户选定优先级）：**单选→多选改写 > topic×angle 覆盖缺口补齐 > 元数据增强**

---

## 一、全库基线（改造前）

| 指标 | 基线 | 目标 |
|---|---|---|
| 题数 / 知识节点 / 文件 | 1308 / 123 / 77 | — |
| 单选占比 | 636 / 1308 = **48.6%** | AGENTS.md §4.2 要求 ≤ 33.3% |
| 选项长度泄题（>1.8×） | **216 题**（最差 12.1×） | 0 |
| 缺 source（厂商/API 事实） | **103 题** | 0 |
| 缺 misconceptions | **1166 题**（覆盖率 10.9%） | 100% |
| misconceptionMap | **76 题**（5.8%） | 100% |
| topic×angle 覆盖 | 309/357 = 86.6%，**48 gap** / 152 sparse / 50 过热 | ≥ 95% |
| 仅选择形态（无开放题） | 80 题 | 0 |

---

## 二、试点成果（单文件 21 题，+266 / −83 行）

### 量化

| 指标 | 改前 | 改后 |
|---|---|---|
| 单选 / 多选 | 7 / 14 | **0 / 21** |
| 双形态（choice + open） | 14 / 21 | **21 / 21** |
| 有 misconceptions | 14 / 21 | **21 / 21** |
| 有 misconceptionMap | 0 / 21 | **21 / 21**（36 个干扰项已标注） |
| 选项长度比 > 1.8× | 0 | 0（最差 1.53×） |
| 该文件 topic 的 gap cell | 6 | **0** |

### 全库联动

- 单选 636 → **629**（多选 672 → 679，单选占比 48.6% → 48.1%）
- misconceptions 142 → **149**
- misconceptionMap 76 → **97**
- 覆盖格 309 → **315**，缺口 **48 → 42**

---

## 三、7 道单选题的改造方式

核心手法：**改写为多选 + angle 重定向填补覆盖缺口**。
早期 7 题与 supp 系列内容高度重叠，若只改题型会产生孪生冗余，因此同步把 angle 重定向到该文件 topic 下的空白格——同一道题既消除单选、又填上 gap，不新增冗余题。

| 题 id | 原 angle | 新 angle | 作用 | 干扰项处理 |
|---|---|---|---|---|
| `persistent-knowledge-rollback` | system-design | **debugging** | 补 gap | 删除「清空知识库/全量丢弃」稻草人，改为「知识库与版本一起回滚」「调严阈值代替诊断」 |
| `runtime-context-isolation` | tradeoff | **mechanism** | 补 gap | 删除「LLM 无法解析 Markdown」稻草人，改为「编译=截断填充」「编译写入权重」 |
| `meta-optimizer-context-overflow` | design | **tradeoff** | 补 gap | 改为「窗口足够大则全量拼接更优」「随机单条可代表系统性根因」 |
| `cross-model-skill-transfer` | fundamental | fundamental（保留） | 去重差异化 | 删除「要求相同 Tokenizer」稻草人，改为「发现模型验证通过即可免检」「局部提升=替代基座」 |
| `anti-looping-impact-tracker` | debugging | **design** | 补 gap | 删除「提高温度/清空历史」稻草人，改为「只落盘不注入上下文」「扩随机性代替结构化过滤」 |
| `model-scaling-synergy` | comparison | **fundamental** | 补 gap | 保留两个真实误区（负相关、百分比恒定），去除绝对化表述 |
| `three-layer-architecture-design` | system-design | **comparison** | 补 gap | 删除 LoRA/Cache 等无关架构选项，改为「主要收益是省存储」「执行时读全量避免遗漏」 |

每道题同步补：misconceptions（2–3 条真实误区）、open.referenceAnswer、misconceptionMap。

---

## 四、关键发现

### 1. 早期题与 supp 补充题存在系统性冗余

该文件 7 道早期题与 14 道 supp 题在 7 个 topic 上**一一对应**，其中 5 个是同 topic×angle 同格重复。早期题质量明显更低（单形态、无 misconceptions、干扰项含稻草人）。

试点选择「改写+angle 重定向」而非删除，理由：同一格保持 2–3 题属 healthy/deep（审计中 ≥4 题才算 oversaturated），且早期题经改写后定位为「基础认知层」，与 supp 的「设计/机制层」互补。

**放量时需逐个文件判断**：若某文件的早期题与补充题在改写后仍无法拉开切面差异，应按 AGENTS.md 去冗余原则直接删除，而不是凑数改写。

### 2. misconceptionMap 自动回填覆盖率低是脚本固有局限

`scripts/backfill-misconceptions.ts` 用字符 2-gram Dice 相似度匹配「选项文本 vs 误解文本」，默认阈值 0.40。对试点文件 42 个干扰项只自动配出 **5 条（12%）**——因为 misconceptions 是「以为…」句式，选项是陈述句，字面重合天然低。

全库 5.8% 的覆盖率与此一致。**结论：该字段靠脚本无法达标，只能人工语义标注**（试点文件中人工标注后 21/21 全覆盖，耗时可控）。

### 3. 环境依赖损坏（非本次改动引入）

`node_modules/.bin` 目录缺失、`@rolldown/pluginutils` 未安装，导致 **`npx vitest run` 无法启动**。
`zod`、`typescript`、`node` 均可用，因此改用「`validate:questions` 结构校验 + zod 独立 schema 校验」双通道验证，21 题 schema 全通过。
**建议执行 `npm install` 修复后补跑 `npm test`。**

---

## 五、放量建议

### 下一批优先级队列（按单选改写杠杆 × 元数据缺口）

| 优先级 | 文件 | 题数 | 单选 | 缺 mis | 备注 |
|---|---|---|---|---|---|
| 1 | `foundational-and-intermediate.json` | 64 | 63 | 64 | 单选杠杆最大，ML 基础题，改写风险低 |
| 2 | `training.json` | 66 | 39 | 66 | 元数据缺口最大 |
| 3 | `inference.json` | 60 | 27 | 60 | — |
| 4 | `ai-architecture.json` | 56 | 26 | 56 | — |
| 5 | `evaluation.json` | 42 | 26 | 40 | 该 topic 已过热（scenario 27 / system-design 25），改写时优先做 angle 重定向而非加题 |
| 6 | `rag.json` | 35 | 22 | 35 | — |
| 7 | `transformer.json` | 41 | 19 | 41 | — |
| 暂缓 | `aws-genai-developer-pro.json` | 50 | 43 | 48 | 认证题库，题目依赖 AWS 特定事实，改写需保留知识点边界 |
| 暂缓 | `claude-blog-2026-08.json` | 40 | 35 | 33 | 来源为厂商博客，需先按 §4.1 校验是否可脱离原文自包含 |

### 工作量预估

- 单选→多选精改（含 misconceptions + open + map）：**约 5–10 分钟/题**（人工）
- 下一批（文件 1，63 题）：约 5–8 小时
- 全库剩余 629 道单选：约 50–100 小时，**不建议一次性全量**，按文件分批、每批跑门禁复核

### 每批执行清单（已验证可复用）

1. `python3 analysis/question_audit.py` → 取该文件 P2 与题型基线
2. `node scripts/question-coverage.ts` → 取该文件 topic 下的 gap cell
3. 逐题改写：多选化 + angle 重定向到 gap + 补 misconceptions/open/misconceptionMap
4. `node scripts/validate-questions.ts` → 结构校验
5. zod 独立 schema 校验（vitest 不可用时）
6. 选项长度比脚本复核（目标 ≤ 1.8×）
7. `node scripts/question-coverage.ts` → 确认 gap 净减少

---

## 六、未纳入本次试点的方向

用户未选，如后续需要可另行启动：

- **消除长度泄题 + 补 source**（319 处 P2：216 长度 + 103 source）—— 纯内容修复，不改考点
- **全库元数据增强**（1166 题缺 misconceptions、80 题仅选择形态）
