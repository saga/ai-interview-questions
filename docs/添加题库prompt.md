# AI / ML 技术文章 → 高质量 Canonical + Variant 面试选择题生成 Prompt

> **本文档是「生成 Prompt」，不是内容规范。**
>
> - **内容规范**在 [`docs/question-content-spec.md`](./question-content-spec.md)
>   —— 什么算一道好题、为什么这样要求。改规范改那里，不要改这里。
> - **数据契约**在 `src/schemas/` 与 `scripts/validate-questions.ts`、`scripts/add-question.ts`
>   —— 数据必须是什么形状，机器裁决。与本文档冲突时以契约为准。
> - 本文档只负责「怎么把规范翻译成 LLM 能执行的指令」，含 Canonical/Variant 流程与批量输出格式。
>
> 另有一份精简版 `docs/添加题库prompt精简.md`，用于 token 受限场景；两者同源，
> **改了这份就要同步检查那份**。

## 一、任务

你会收到一篇 AI / ML / LLM / Agent / AI Systems 技术文章。

你的任务不是总结文章，也不是测试读者是否记得文章内容，而是：

> 从文章中识别具有长期面试价值的 Knowledge / Concept / Subtopic，设计高质量的面试选择题，并在高价值 Concept 上生成少量具有真实诊断差异的题目变体。

题目用于：

* AI Engineer
* ML Engineer
* LLM Engineer
* Agent Engineer
* AI Systems Engineer

文章只是知识来源，不是题目的上下文来源。

考生默认没有读过原文章。

---

# 二、Canonical 与 Variant

## 1. Canonical Question

每个重要 Concept 首先生成一个 Canonical Question。

Canonical 是该 Concept 的：

* 标准考察方式
* 正确答案基准
* Explanation 基准
* Learner Evidence 基准
* Variant 的知识基准

Canonical 必须本身就是一道人类面试官可以直接使用的完整、高质量题目。

---

## 2. Variant Question（表达变体）

> ### 定义（硬边界）
>
> ```text
> Variant = 同一 assessment contract 的表达 / 情境变体
> ```
>
> 这不是措辞偏好，而是与 `src/schemas/variant.ts`、`src/ai/variant.ts`、`src/domain/variant.ts`
> 的实际行为**逐项对齐**的契约：
>
> * 生成变体时 LLM 只能看到 `topic / requiredConcepts / question / options`
>   （`buildUser`，`angle` 与 `cognitiveTask` 根本不进 prompt）；
> * 变体产出物只有 `question` + `options` 两个字段（`questionVariantSchema` 无其它内容字段）；
> * `topic / angle / difficulty / concepts / tags / answer / explanation`
>   **全部由程序从 canonical 继承**（`applyVariant` 的 `...canonical` 展开）。
>
> 因此：任何「变体换 angle / 换 cognitive task」的指令都不可执行，写了也是无效指令。

Variant 的作用只有一个：

> 在**不改变考察内容**的前提下改变题目的呈现方式，
> 使重复练习时无法靠记忆题干或选项的字面作答。

Variant **只能**改变：

* 换 framing —— 换提问方式、换句式、换叙述视角；
* 换 scenario —— 换一个等价的工程情境；
* 换问法 —— 直述改现象描述、陈述改疑问；
* 换选项表达 —— 每个选项逐项改写（换主语 / 换句式 / 换例证措辞）。

Variant **必须保持**不变：

* Core Concept；
* `cognitiveTask`；
* `angle`；
* `difficulty`；
* 正确答案逻辑（第 N 个选项仍对应原第 N 个选项，真假属性不变）；
* 核心技术事实与 required / prerequisite concepts；
* 主要诊断目标；
* 选项数量。

### 换 angle / 换认知任务 = 新建 canonical

| 你想做的事 | 正确做法 |
| --- | --- |
| 换措辞 / 换场景 / 换问法 / 换选项表达 | 生成 Variant，`variantOf` 指向 canonical |
| 换 `angle` | **新建一道 canonical 题**（`questionRole: "canonical"`，`variantOf: null`） |
| 换 `cognitiveTask` | **新建一道 canonical 题** |
| 需要考生额外掌握一个新的独立 Concept | **新建一道题**，不是 variant |

> 为什么换 angle 必须建新 canonical：变体从 canonical 继承 `angle / difficulty / concepts`，
> 且**不参与覆盖率统计**。用变体去换 angle，等于对外宣称换了考察维度、
> 数据里 `angle` 字段却没变——覆盖矩阵被污染，缺口永远补不上
> （见 [`docs/question-content-spec.md`](./question-content-spec.md) §8）。

### 什么不算 Variant

仅改变同义词、语序、少量措辞或标点 —— 改写幅度太小，
会被 `findNearDuplicateVariants`（选项级 CJK-Dice ≥ 88）判为近重复整条丢弃，
**不算有效 Variant**。

正确幅度参考（选项级 Dice）：逐字照抄 100、轻改 ≈ 91、重述改写 ≈ 54。
目标落在重述改写区间：看起来像重新写过，技术结论一字不改。

---

# 三、题目数量

每篇文章目标生成 5～13 个独立 Assessment Items。

题目数量由高价值知识密度决定，而不是文章长度决定。

建议：

* 5～7：核心知识集中；
* 8～10：多个高价值 Concept；
* 11～13：多个 Concept 且存在多个独立认知任务。

不要为了达到数量：

* 重复题目；
* 重复 Concept；
* 制造低价值题；
* 机械生成换句话说的 Variant；
* 编造文章没有依据的事实。

如果真正高价值的独立题目不足 5 道，允许少于 5 道。

---

# 四、Concept 选择

每道题必须围绕一个明确的 Core Concept。

默认：

* 1 个 Core Concept；
* 0～2 个 Supporting / Prerequisite Concepts。

除非题目属于：

* comparison
* tradeoff
* design
* system-design

否则不要同时要求多个独立 Concept 才能作答。

判断：

> 这道题到底在测什么？

如果去掉某个 Concept 后题目仍然成立，该 Concept 通常不应该加入。

不要生成无法明确诊断具体知识缺口的大杂烩题。

---

# 五、Question Role

每道 Canonical 默认：

* 0～2 个表达变体（Variant）。

变体**不改变** `angle` / `cognitiveTask`，因此**不增加**诊断维度、
也**不计入**覆盖矩阵——它减少的是重复感，不是补知识缺口。

同一个 Core Concept 的 Canonical 数量不受本条限制：
需要多少个不同的 angle / cognitiveTask，就建多少道 Canonical。

只有当一道 Canonical 值得配「换个说法再来一次」时才生成 Variant。

输出字段：

```json
"questionRole": "canonical"
```

或：

```json
"questionRole": "variant"
```

Variant 必须：

```json
"variantOf": "canonical-question-id"
```

Canonical：

```json
"variantOf": null
```

---

# 六、Cognitive Task

**认知任务在 Canonical 层确定；Variant 不得改变它。**

可选：

* definition：准确识别概念
* explain：解释概念
* mechanism：解释内部机制和因果关系
* compare：比较不同方案
* apply：将知识应用到具体情境
* diagnose：根据现象定位原因
* tradeoff：判断工程取舍
* design：进行组件或系统设计

不需要覆盖所有类型。

同一个 Concept 需要多个认知任务时，建**多道 canonical**，每道各自带自己的表达变体：

```text
Canonical A  （cognitiveTask = explain,  angle = mechanism）
  ├── Variant A1（cognitiveTask = explain,  angle = mechanism）  ← 继承，不可改
  └── Variant A2（cognitiveTask = explain,  angle = mechanism）
Canonical B  （cognitiveTask = diagnose, angle = debugging）     ← 新建 canonical，不是 A 的变体
  └── Variant B1（cognitiveTask = diagnose, angle = debugging）
```

而不是把 A 的 variant 写成 `diagnose` —— 那样变体的 `cognitiveTask` 与 canonical 不一致，
是数据契约层面的错误，不是「更有诊断价值」。

也不要靠改几个字制造认知任务的变化：

```text
为什么需要 X？
为什么使用 X？
X 为什么重要？
```

这三句是同一道 canonical 的同一认知任务，最多只能生成表达变体，不能算 3 个 Assessment Item。

---

# 七、Angle

每道题选择一个主要 Angle：

* definition
* fundamental
* mechanism
* comparison
* calculation
* tradeoff
* scenario
* debugging
* design
* system-design

同一个 Concept 的**多道 Canonical** 应尽量使用不同的 Angle。

**Variant 的 `angle` 必须与 Canonical 完全相同**（字段值逐字复制），不得「顺手换个角度」。

不要强制覆盖所有 Angle。

---

# 八、优先生成的知识

优先：

* 核心知识；
* 面试高频知识；
* 高区分度知识；
* 容易产生典型误解的知识；
* 机制和因果关系；
* 工程判断；
* 方案比较；
* trade-off；
* debugging；
* 架构设计。

不要：

* 平均覆盖文章；
* 按文章段落顺序出题；
* 因某段文字很长就增加题目；
* 因某 Concept 没有题就强行生成。

---

# 九、题目类型

所有输出必须是选择题。

优先 multiple，但不能强行多选。

每题：

* single：恰好 1 个正确答案；
* multiple：至少 2 个正确答案；
* 4～6 个选项；
* answer 使用 0-based integer array。

不得使用：

* A/B/C/D 作为 answer；
* 答案文本作为 answer。

---

# 十、Answer Determinism

正确答案必须能够由题干约束和可靠技术事实唯一确定。

## Single

必须：

* 恰好一个选项正确；
* 其它选项在给定条件下明确错误。

## Multiple

必须：

* 每个正确选项独立成立；
* 每个错误选项独立可排除；
* 正确答案集合唯一；
* 不依赖隐藏前提；
* 不使用模糊的“也可能成立”制造多解。

不能让答案依赖：

* 未写出的前提；
* 特殊行业约定；
* 模糊措辞；
* 主观偏好。

---

# 十一、Evidence Boundary

正确答案依赖的核心技术事实必须：

* 能从文章可靠推出；或
* 是文章明确提供的可靠专业背景。

禁止：

* 编造 benchmark；
* 编造性能数字；
* 编造产品行为；
* 编造文章没有依据的重要技术结论；
* 通过文章外的重要事实制造唯一答案。

允许增加少量 context 使题目 self-contained，但：

> 新增 context 不能成为决定正确答案的关键未知事实。

---

# 十二、Self-contained

考生完全没有读过文章。

删除原文章后，每道题仍必须能够独立理解。

禁止：

* 文中提到；
* 根据本文；
* 作者认为；
* 前文所述；
* 上述方法；
* 该模型；
* 这种方式。

如果需要文章背景：

> 把回答问题所需的最小 context 写进题干。

不要复制文章。

---

# 十三、Architecture / System Design

对于：

* RAG
* Agent
* Multi-Agent
* MCP
* Memory
* Context Engineering
* Model Serving
* AI Gateway
* AI Infrastructure
* Evaluation
* Observability
* Security

如果文章提供足够依据，可以使用：

* design
* system-design

不要因为文章提到某技术就强行生成架构题。

## Design

关注：

* 组件职责；
* chunking；
* retrieval；
* embedding；
* reranker；
* cache；
* queue；
* tool permission；
* evaluation。

## System-design

必须有明确工程场景和约束。

至少 3 个真正影响方案的维度，例如：

* latency；
* scalability；
* reliability；
* cost；
* security；
* state；
* observability；
* deployment；
* evaluation。

每个约束都必须实际影响方案选择。

---

# 十四、Option Design

## 1. 同一决策层级

所有选项应该：

* 处于相同抽象层级；
* 回答同一个问题；
* 表达同一种类型的判断。

不要让正确答案因为描述更完整而天然胜出。

---

## 2. 选项必须独立

每个选项：

* 独立可理解；
* 表达一个主要判断；
* 不依赖其它选项；
* 不引用“前者”“后者”“上述方案”。

---

## 3. 选项必须适合 Variant

Canonical 的每个选项必须具有：

* 清晰稳定的技术含义；
* 明确正确/错误属性；
* 可自然语义改写的表达。

不要让选项正确性依赖：

* 某个特殊措辞；
* 某个特殊形容词；
* 某种语气；
* 某个难以保持的文字细节。

---

# 十五、Wrong Options

错误选项必须来自真实技术误解或工程误判。

优先：

* 混淆相邻概念；
* 遗漏必要条件；
* 把充分条件当必要条件；
* 忽略 trade-off；
* 忽略系统瓶颈；
* 将训练结论错误迁移到推理；
* 将 benchmark 结果错误迁移到生产；
* 把局部优化当成系统优化；
* 把理论最优当工程最优；
* 忽略状态、一致性、成本、可靠性或安全。

禁止明显荒谬的错误选项。

---

# 十六、Option Balance

同一题选项尽量：

* 长度接近；
* 信息密度接近；
* 专业程度接近；
* 语气接近；
* 句式接近；
* 抽象层级接近。

正确答案不得因为：

* 更长；
* 更具体；
* 更完整；
* 专业术语更多；
* 限定条件更多；

而天然暴露。

难度应该来自技术判断，而不是信息量。

---

# 十七、Answer Leakage

不能通过以下形式猜出答案：

* 长度；
* 专业术语数量；
* 限定词；
* 语气；
* 绝对化程度；
* 信息完整程度；
* 选项结构。

除非这些本身就是考察内容。

---

# 十八、Canonical 与 Variant 的知识一致性

Variant 可以改变（仅表达层）：

* 场景；
* 提问方式；
* framing；
* 选项措辞。

Variant 不能改变（考察内容层，一律从 Canonical 继承）：

* Core Concept；
* `angle`；
* `cognitiveTask`；
* `difficulty`；
* 核心技术事实；
* 正确答案逻辑（第 N 个选项的真假属性）；
* required concepts；
* 诊断目标。

不得为了生成 Variant 引入新的独立核心知识。

如果回答 Variant 必须额外掌握一个新的独立 Concept，则：

> 它应该成为新的 Canonical Question，而不是 Variant。

如果需要换 `angle` 或 `cognitiveTask`，同理：

> 新建 Canonical Question，再为它生成自己的表达变体 pool。

自检一句话：

> 把 Variant 的题干和选项换成 Canonical 的原文，这道题的考察内容是否完全没变？
> 变了，就说明它不是 Variant。

---

# 十九、Variant 必须抗记忆，但不得改变考察内容

Variant 的价值 = **同一考察内容的新呈现**，让考生无法凭字面记忆作答。

高价值（同一 `cognitiveTask` / 同一 `angle`，换情境 + 换问法 + 选项重述）：

```text
Canonical
Concept       = KV Cache
cognitiveTask = explain
angle         = mechanism
题干 = 为什么 KV Cache 能降低自回归解码阶段的计算开销？
选项 = [复用已算过的 Key/Value 投影，避免每步重算整个前缀 / …]

Variant（合法：继承 cognitiveTask=explain、angle=mechanism）
题干 = 某在线服务发现随着输出变长，每个新 token 的耗时持续增长，
       定位后发现每次生成都在重做同一段前缀的前向计算。根因是什么？
选项 = [每个解码步都在重复计算前缀的 Key/Value，没有缓存下来 / …]
       ↑ 结论相同（前缀 K/V 被重复计算），但叙述视角与句式完全重述
```

低价值（幅度太小，会被近重复门禁丢弃）：

```text
Canonical: 什么是 KV Cache？
Variant:   KV Cache 是什么？
Variant:   请说明 KV Cache 的含义。
```

越过边界（这已经不是 Variant，应拆成新 Canonical）：

```text
Canonical A  cognitiveTask = explain,  angle = mechanism
"Variant"    cognitiveTask = diagnose, angle = debugging   ← 换认知任务了
"Variant"    cognitiveTask = evaluate, angle = tradeoff    ← 换 angle 了
```

正确写法是把上面三条写成三道 Canonical，各自再挂自己的表达变体。

一句话判据：

> 考生做这道题时执行的**认知操作**应与 Canonical 相同；
> 他看到的**文字与情境**应明显不同。

---

# 二十、Option Variant

对于 Variant 选择题：

* 可以重新表达选项；
* 可以根据新的题干调整选项措辞；
* 每个选项必须保持原有技术结论；
* 原正确项仍然正确；
* 原错误项仍然错误；
* 不增加新的核心知识；
* 不减少核心判断。

不要重新创造完全不同的 distractor 集合。

每个 Variant 的选项应保持与原题选项的一一对应关系。

最终选项顺序由程序处理。

最终 answer index 由程序根据 canonical answer 重新计算。

---

# 二十一、Explanation

每道题必须有简短但有技术含量的 explanation。

解释：

* 为什么正确；
* 核心机制；
* 必要时的 trade-off；
* 必要时的 misconception。

不要：

* 逐字复述文章；
* 写成教程；
* 引用“本文”；
* 引入题目本身没有要求的新关键知识。

Canonical 与 Variant 如果共享同一个 Knowledge Contract，Explanation 应保持对应技术结论一致，但必须能够解释当前题目的具体 framing。

---

# 二十二、Diagnostic Value

生成前判断：

> 如果考生答错，我是否能够判断他缺少哪个 Concept、机制、工程判断或典型 misconception？

优先：

* 能提供明确 Learner Evidence；
* 能区分术语记忆和真正理解；
* 能区分机制理解和工程应用；
* 能反映工程判断能力。

不要生成答错后无法定位缺口的题目。

---

# 二十三、Variant 设计流程

内部按以下流程完成：

```text
Article
  ↓
Knowledge
  ↓
Core Concepts
  ↓
Concept Priority
  ↓
Canonical Assessment
  ↓
判断该 Concept 是否需要多个 angle / cognitiveTask
  ├─ 是 → 建多道 Canonical（各自独立 questionRole = canonical）
  └─ 否
  ↓
对每道 Canonical：判断是否需要表达变体（同格内扩充题量、抗记忆）
  ↓
Canonical + Variant Candidates（Variant 复制 canonical 的 angle / cognitiveTask / difficulty / concepts）
  ↓
Quality Check
  ↓
Final Assessment Set
```

对每个重要 Concept，先判断：

> 除了 Canonical 之外，是否存在值得单独训练的其它 **angle / cognitiveTask**？

答案为“是” → **新增 Canonical**，不是生成 Variant。

再判断：

> 这道 Canonical 是否值得配 1～2 条表达变体来降低重复感？

只有答案为“是”时才生成 Variant。

---

# 二十四、最终强制检查

每道题逐项检查：

### A. Self-contained

删除文章后是否仍然可理解？

### B. Core Concept

是否只有一个明确 Core Concept？

### C. Concept Scope

是否避免混入多个独立 Concept？

### D. Angle

主要 Angle 是否明确？

### E. Cognitive Task

认知任务是否明确？

### F. Interview Value

是否真正适合作为面试题？

### G. Reasoning

是否主要考察理解、应用、判断或设计，而不是记忆？

### H. Architecture

若为 design/system-design，是否有真实工程约束？

### I. Evidence

核心事实是否可靠？

### J. Answer Determinism

答案是否唯一且稳定？

### K. Option Balance

正确答案是否没有形式优势？

### L. Wrong-option Quality

错误选项是否真实可信？

### M. Answer Leakage

是否可以通过形式猜答案？

### N. Duplication

是否与其它题只是换句话说？

### O. Diagnostic Value

答错后是否能够定位能力缺口？

### P. Variant Validity

如果是 Variant，**逐项对照 Canonical 检查**：

不变项（任一项变了 → 它应该是新 Canonical，不是 Variant）：

* `angle` 是否与 Canonical 完全相同？
* `cognitiveTask` 是否与 Canonical 完全相同？
* `difficulty` 是否与 Canonical 完全相同？
* `concepts` 是否与 Canonical 完全相同？
* 是否仍然考察同一 Core Concept？
* 是否保持相同核心技术结论？
* 第 N 个选项的真假属性是否仍对应 Canonical 第 N 个选项？
* 选项数量是否与 Canonical 一致？

变化项（至少要有实质变化，否则会被近重复门禁丢弃）：

* 题干是否换了 framing / 情境 / 问法？
* 每个选项是否做了**重述级**改写（不是只换同义词）？
* 是否没有引入新的独立核心知识？

自问：

> 把 Variant 换成 Canonical 的原文，考察内容是否完全没变？
> 直视两道题，考生能否一眼看出「这是同一题换了个说法」？（能 → 改写幅度不够）

### Q. Option Transformability

选项在自然语义改写后，是否仍能保持原来的正确/错误属性？

发现问题：

> 不要解释问题，直接重新设计该题。

---

# 二十五、输出 JSON Schema

最终只输出一个 JSON Array。

> **Variant 条目（下方第 2 个元素）的 `angle` / `cognitiveTask` / `difficulty` / `concepts`
> 必须与它 `variantOf` 指向的 Canonical 逐字相同**——这是表达变体的定义决定的。
> 只有 `question` / `options` 可以不同。

```json
[
  {
    "id": "unique-question-id",
    "questionRole": "canonical",
    "variantOf": null,
    "category": "taxonomy-domain",
    "topic": "topic-id",
    "knowledgeId": "knowledge-id",
    "concepts": [
      "core-concept",
      "supporting-concept"
    ],
    "tags": [
      "concept-tag",
      "engineering-tag"
    ],
    "difficulty": "medium",
    "angle": "mechanism",
    "cognitiveTask": "explain",
    "question": "题目的核心知识问题。",
    "explanation": "解释为什么正确，并说明关键原理或必要的 trade-off。",
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "选项 1",
          "选项 2",
          "选项 3",
          "选项 4"
        ],
        "answer": [2]
      }
    }
  },
  {
    "id": "variant-question-id",
    "questionRole": "variant",
    "variantOf": "unique-question-id",
    "category": "taxonomy-domain",
    "topic": "topic-id",
    "knowledgeId": "knowledge-id",
    "concepts": [
      "core-concept",
      "supporting-concept"
    ],
    "tags": [
      "concept-tag",
      "engineering-tag"
    ],
    "difficulty": "medium",
    "angle": "mechanism",
    "cognitiveTask": "explain",
    "question": "换情境、换问法、选项重述后重新呈现同一考察内容。",
    "explanation": "解释该 Variant 呈现下仍然成立的同一技术结论。",
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "选项 1",
          "选项 2",
          "选项 3",
          "选项 4"
        ],
        "answer": [1]
      }
    }
  }
]
```

---

# 二十六、字段规则

## difficulty

只能：

```text
easy
medium
hard
```

## angle

只能：

```text
definition
fundamental
mechanism
comparison
calculation
tradeoff
scenario
debugging
design
system-design
```

Variant 的 `angle` 必须**等于**其 Canonical 的 `angle`。需要不同 angle → 新建 Canonical。

## cognitiveTask

只能：

```text
define
explain
mechanism
compare
apply
diagnose
evaluate
design
```

Variant 的 `cognitiveTask` 必须**等于**其 Canonical 的 `cognitiveTask`。
需要不同认知任务 → 新建 Canonical。

## questionRole

只能：

```text
canonical
variant
```

## variantOf

Canonical：

```json
null
```

Variant：

```json
"canonical-question-id"
```

## concepts

* 第一个必须是 Core Concept；
* 默认 1 个 Core Concept；
* 必要时增加少量 supporting / prerequisite Concept；
* 不要把普通 tags 放进 concepts。

## options

4～6 个。

## answer

0-based integer array。

---

# 二十七、最终输出要求

最终只输出：

```text
JSON Array
```

不得输出：

* 分析过程；
* Concept 列表；
* 题目设计说明；
* Variant 设计说明；
* Markdown；
* 代码围栏；
* 统计；
* 额外解释；
* JSON 之外的任何内容。
