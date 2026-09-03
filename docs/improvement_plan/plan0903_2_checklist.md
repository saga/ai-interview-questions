# plan0903_2 · 外部评审反馈核查 + 行动清单

**对象**：`docs/添加题库prompt.md`（1033 行，消费者仅 `skills/article-to-questions/SKILL.md`）
**来源**：外部对 Canonical / Variant Prompt 的 12 条评审意见
**本轮动作**：**只核查、只建清单，不改任何源文件**（等确认后执行）
**核查日期**：2026-09-03

---

## 零、一句话结论

> 12 条里 **7 条成立、4 条部分成立（增强建议，非缺陷）、1 条论据不准**。
> 但**评审漏掉了更根本的问题**：`cognitiveTask` / `questionRole` / `variantOf` / `concepts`
> 四个字段在 `questionSchema` 里**根本不存在**，被 zod 静默丢弃 —— 评审花大力气讨论的
> 「统一 cognitiveTask 枚举」是在给一个**落库即丢的字段**定枚举。

---

## 一、逐条裁定

| # | 评审主张 | 裁定 | 代码/文档证据 |
|:--|:--|:--|:--|
| 1 | KV Cache Variant 示例自相矛盾 | **✅ 成立（且危害更大）** | 610-615 标注「合法：继承 cognitiveTask=explain、angle=mechanism」，但题干是「…根因是什么？」= `diagnose`（§6:225 定义「根据现象定位原因」）；629 行自己写 `diagnose/debugging` 是「换认知任务了、不是 Variant」 |
| 2 | cognitiveTask 枚举前后不一致 | **⚠️ 现象成立，前提错误** | 差异属实：§6(219-226) `definition…tradeoff/design` vs §26(962-969) `define…evaluate/design`。**但「实际 schema 是 define/…」是错的** —— `src/` 无 `cognitiveTask`，`questionSchema` 也无此字段（见 §二-A） |
| 3 | Concept→Canonical 定义歧义 | **✅ 成立** | 40 行「每个重要 Concept 首先生成一个 Canonical Question」vs 182-183「Canonical 数量不受本条限制：需要多少个不同的 angle / cognitiveTask，就建多少道」。确有「先一道、后补例外」的表述顺序问题 |
| 4 | Variant 数量应从 Prompt 解绑 | **⚠️ 部分成立** | 架构理由**已满足**：canonical 生成走本文档，offline oversampling 走 `src/ai/variant.ts` 的 `VARIANT_SYSTEM` v4，两者本就分离。真正的问题是文档内数字冲突：177 行「0～2 个表达变体」vs 739 行「配 1～2 条表达变体」 |
| 5 | 删除 Prompt 中的 Dice 具体阈值 | **✅ 成立** | 113-116 写了「选项级 CJK-Dice ≥ 88 / 轻改 ≈ 91 / 重述改写 ≈ 54」，属 `src/domain/variant.ts` 的实现细节，违反本文档自述的「机器裁决由代码负责」原则 |
| 6 | Evidence Boundary 过严 | **⚠️ 增强，非缺陷** | 367-369 现有「新增 context 不能成为决定正确答案的关键未知事实」已含「关键」限定，方向上等价于评审要的 `enrichment ✅ / injection ❌`。属表述澄清 |
| 7 | system-design 缺退出条件 | **✅ 成立** | 439「至少 3 个真正影响方案的维度」+ 451「每个约束都必须实际影响方案选择」，但**缺**「若文章/可靠背景不足以提供 3 个真实约束，则不要生成 system-design」 |
| 8 | Option Transformability 缺程度词 | **⚠️ 已部分覆盖** | 488-493 已禁「依赖某个特殊措辞 / 特殊形容词 / 某种语气」。程度词（通常/必然/可能）是其子集，只是未点名 |
| 9 | Multiple 正确项不得互推 | **✅ 成立** | 337 只有「每个正确选项独立成立」，**无**「不得是同一事实的重复表述 / 上下位改写 / 因果链拆分」 |
| 10 | 场景变化不得增加推理负担 | **✅ 成立** | 81 允许「换 scenario —— 换一个等价的工程情境」、638 要求「文字与情境应明显不同」，但**无**「不得引入额外推理步骤 / 背景知识 / 决策变量」。828 仅禁「引入新的独立核心知识」，不等价 |
| 11 | 自检句应升级为「推理路径相同」 | **✅ 成立** | 832 自检句确为「把 Variant 换成 Canonical 的原文，考察内容是否完全没变？」——只查内容、不查推理路径 |
| 12 | Prompt 太完整 / 规则重复 | **⚠️ 论点主观，论据不准** | 实际 **1033 行**（评审称 1400+）。重复属实：Variant 约束散布 §2(54) / §18(559) / §19(596) / §20(642) / §24-P(809) / §25(845) / §26(926) 共 7 处 |

**统计**：✅ 成立 7 条（1/3/5/7/9/10/11） · ⚠️ 部分成立 4 条（2/4/6/8） · ❓ 论据不准 1 条（12，行数）

---

## 二、评审**没发现**的问题（优先级高于评审的多数条目）

### A. 四个字段被 zod 静默丢弃，相关规范全部空转 【P0】

`questionSchema`（`src/schemas/question.ts:71-95`）的字段只有：
`id / category / topic / subtopic / tags / difficulty / angle / question / explanation / aiGenerated / courseId / knowledgeId / source / misconceptions / formats`

**不含** `cognitiveTask`、`questionRole`、`variantOf`、`concepts`。

实测（可复现脚本 `temp/strip-probe.ts`）：

```
success = true
parsed keys = id, category, topic, tags, difficulty, angle, question, explanation, formats
  cognitiveTask: STRIPPED
  questionRole:  STRIPPED
  variantOf:     STRIPPED
  concepts:      STRIPPED
```

**后果**：
- §26 三处字段规则（957 `cognitiveTask` / 975 `questionRole` / 984 `variantOf`）→ **死规则**
- §24-P 检查项 815-818（要求这 4 项与 Canonical 完全相同）→ **检查一个落库即丢的字段**
- §25 输出 schema（872/877/878/883/891/895/899 等）要求输出这 4 个字段 → 产出即丢弃
- **不报错**（zod object 默认 strip），所以问题长期静默

> 这条直接解释了为什么 #1 的自相矛盾能一直存在：没有任何机器门禁碰得到它。

### B. 内容层漂移是唯一漏洞，且无机器兜底 【P0】

文档 62-71 行声称：

> 变体产出物只有 `question` + `options` 两个字段…其余全部由程序从 canonical 继承
> 因此：任何「变体换 angle / 换 cognitive task」的指令都不可执行

**字段层**确实如此（程序继承，改不了）。但**唯一还能漂移的通道**是：
模型把 `question` / `options` 的**内容**写成另一种认知操作 —— 这正是 KV Cache 示例（610-615）
示范的动作（题干写成「根因是什么」，把 explain 变成 diagnose）。

而落库后**没有任何字段记录 cognitiveTask**（见 A）→ **无法被任何机器门禁检测**。

所以 #1 不是「示例写错」这么轻，而是**示范了唯一能绕过代码强制的漏洞，且该漏洞无兜底**。

### C. 文档声称「与代码逐项对齐」，但引用了不存在的字段名 【P2】

65 行提到 LLM 只能看到 `topic / requiredConcepts / question / options`，
但 `grep -rn "requiredConcepts" src/schemas/*.ts` → **无结果**。

### D. 双份同源文档的已知漂移源 【P2，ADR-071 已记】

`docs/添加题库prompt.md`（1033 行）+ `docs/添加题库prompt精简.md`（269 行）。
评审 #12 提到这点是对的；ADR-071 已把后者列为漂移源。

---

## 三、行动清单

> 状态列：⬜ 待办 · 🟡 进行中 · ✅ 完成
> **执行前需确认**：§三-A 涉及数据契约变更（ADR 级），按 AGENTS.md 大原则 1 应先出设计文档。

### A 组 · 数据契约（先定这个，B/C 组的取舍取决于它）

- [ ] **A1** 决定 `cognitiveTask` 的存废，二选一：
  - **A1-a 落库**：加进 `questionSchema` + `questionAngleSchema` 同级枚举 → §26 规则与 §24-P 检查立刻生效，#2 的枚举统一才有意义
  - **A1-b 移除**：从 Prompt / spec / 精简版全删 → §24-E、§24-P 相应删项，认知任务只作为写作指引存在于 §6
  - 推荐 **A1-b**（理由：代码里 `angle` 已是 11 值治理主索引，`cognitiveTask` 与之正交但无消费者；加字段要连带覆盖矩阵、蓝图、adaptive 排序一起改，成本高收益低）
- [ ] **A2** 若选 A1-a：统一枚举为 `define/explain/mechanism/compare/apply/diagnose/evaluate/design`，并把 `tradeoff` 归位到 `angle`（`tradeoff` **已在** angle 白名单 `src/domain/coverage.ts:17`，评审 #2 的这条建议与代码一致）
- [ ] **A3** 决定 `questionRole` / `variantOf` / `concepts` 的处理（现状：Prompt 要求输出但被 strip）
  - 注：`variantOf` / `questionRole` 在**离线变体池** `src/schemas/variant.ts` 里另有定义，需先确认是否复用，不要重复建模
- [ ] **A4** 修正 65 行的 `requiredConcepts` → 改为实际字段名或改为 `concepts`

### B 组 · P0 文档缺陷（评审 #1，最高优先）

- [ ] **B1** 重写 §19 的 KV Cache Variant 示例（610-615），使题干保持 `explain + mechanism`
  - 评审给的替代写法可用：把题干改成「在自回归生成中，每生成一个新 token 都需要此前 token 的 Key/Value…KV Cache 在这里具体解决了什么问题？」
  - **同时**在示例后补一句：说明「字段继承 ≠ 内容未漂移」，因为落库无该字段（见 §二-B）
- [ ] **B2** 在 §19 或 §24-P 增加硬规则：**Variant 不得增加推理负担**（新场景不得引入额外推理步骤 / 额外背景知识 / 新的决策变量）——评审 #10
- [ ] **B3** 把 §24-P 自检句（832）升级为「推理路径是否相同」，而非仅「考察内容是否没变」——评审 #11
  - 建议判据：*若考生不知道 Canonical 存在，仅凭 Variant 完成作答，所需正确推理路径是否与 Canonical 相同？*

### C 组 · P1 文档修正

- [ ] **C1** 删除 113-116 的 Dice 具体阈值（88 / 91 / 54），改为「具体近重复阈值由系统验证器决定」——评审 #5
  - 保留「必须达到重述级改写，不能只是同义替换 / 局部换序 / 标点修改」的定性要求
- [ ] **C2** 统一 Variant 数量表述：177 行「0～2」与 739 行「1～2」冲突，且与 offline pipeline 的 oversample 策略解绑——评审 #4
- [ ] **C3** §10 Multiple（337）补：正确项之间不得是同一事实的重复表述 / 上下位改写 / 因果链拆分；错误项同理——评审 #9
- [ ] **C4** §13 System-design（439）补退出条件：若文章或可靠背景不足以提供 3 个真实且独立影响方案的约束，则不生成 system-design——评审 #7
- [ ] **C5** §5（40 行）改写 Concept→Canonical 的初始定义：从「每个 Concept 先生成一道 Canonical」改为「先识别值得独立训练的 `angle × cognitiveTask` 组合，每个有独立评估价值的组合建一条 Canonical」——评审 #3

### D 组 · P2 增强

- [ ] **D1** §14.3 / §24-Q 点名程度词：若选项真假依赖「通常 / 必然 / 可能 / 仅在某些情况下」等措辞强弱，则该选项不适合作为 Variant 基础——评审 #8
- [ ] **D2** §11 Evidence Boundary（367-369）改为 `context enrichment ✅ / knowledge injection ❌` 的对照表述——评审 #6
- [ ] **D3** 评估 Prompt 瘦身：1033 行、Variant 约束散布 7 处。若要动，按评审 #12 的三层切分（`question-content-spec.md` 承规范 / Prompt 留任务+决策流程+10~15 条 hard rules+输出 schema / validator 机器裁决）
  - **注意**：这是结构性改动，按 AGENTS.md 大原则 1 需先出设计文档确认
- [ ] **D4** 处理双份同源文档（`添加题库prompt.md` 1033 行 vs `添加题库prompt精简.md` 269 行）——评审 #12，ADR-071 已记为漂移源

### E 组 · 配套（改动落地时同步）

- [ ] **E1** `docs/question-content-spec.md:111-113` 引用了 `cognitiveTask`，A1 定案后需同步
- [ ] **E2** `docs/添加题库prompt精简.md:63,72,174,205,258` 同样引用 `cognitiveTask`，需同步
- [ ] **E3** ADR 记录：A1 若涉及字段增删，按 ADR-071「代码/文档/决策一致」要求补 ADR
- [ ] **E4** CHANGELOG 追加本轮 Prompt 修正

---

## 四、可复现验证

```bash
# 验证字段被 strip
node node_modules/vite-node/dist/cli.mjs temp/strip-probe.ts

# 验证 cognitiveTask 在代码中不存在
grep -rn "cognitiveTask" src/          # 应无结果

# angle 实际白名单（10 值，含 fundamental 与 tradeoff）
sed -n '11,22p' src/domain/coverage.ts
```

**注**：`temp/strip-probe.ts` 为本轮核查新增的证据脚本，A1 定案后可保留（回归验证用）或删除。
