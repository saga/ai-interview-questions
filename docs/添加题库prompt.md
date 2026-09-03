# AI / ML 技术文章 → 高质量 Canonical + Variant 面试选择题生成 Prompt

> **本文档是「生成 Prompt」，不是内容规范。**
>
> - **内容规范**在 [`docs/question-content-spec.md`](./question-content-spec.md)
>   —— 什么算一道好题、为什么这样要求。改规范改那里，不要改这里。
> - **数据契约**在 `src/schemas/` 与 `scripts/validate-questions.ts`、`scripts/add-question.ts`
>   —— 数据必须是什么形状，机器裁决。与本文档冲突时以契约为准。
> - 本文档只负责「怎么把规范翻译成 LLM 能执行的指令」，含 Canonical/Variant 流程与批量输出格式。
>   结构：任务（一）→ Variant 判定基准（二/十八，10 条硬规则）→ 决策流程（二十三）
>   → 输出 schema（二十五–二十七）；内容章节（四/九–十七/二十一/二十二/二十四 A–O）只留执行要点，细则见 spec。
>
> 另有一份精简版 `docs/添加题库prompt精简.md`，是本文件的导出子集（任务 + 硬规则 + 流程 + schema），用于 token 受限场景；两者同源，
> **改了这份就要同步检查那份**。

## 一、任务

你会收到一篇 AI / ML / LLM / Agent / AI Systems 技术文章。

你的任务不是总结文章，也不是测试读者是否记得文章内容，而是：

> 从文章中识别具有长期面试价值的 Knowledge / Concept / Subtopic，设计高质量的面试选择题；只在值得降低记忆效应处，为 Canonical 配少量表达变体（Variant，不增加诊断维度）。

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

对每个高价值 Concept，先识别值得独立训练的 `angle × cognitiveTask` 组合；每个有独立 assessment value 的组合建立一条 Canonical。

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
会被近重复验证器判为近重复整条丢弃，**不算有效 Variant**。

Variant 必须达到重述级改写：看起来像重新写过，技术结论一字不改。
具体近重复阈值由系统验证器（`src/domain/variant.ts`）决定，不在 Prompt 里硬编码。

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

规范见 `question-content-spec.md §1`。执行要点：默认 1 个 Core Concept + 0～2 个 supporting；去掉某 Concept 题目仍成立 ⇒ 不加；仅 comparison / tradeoff / design / system-design 可要多独立 Concept。

---

# 五、Question Role

只有值得降低记忆效应的 Canonical 才生成少量表达变体（Variant）；具体生成多少、保留多少由离线生成 / 筛选流程（oversample → quality filter）决定，Prompt 只定义什么样的 Variant 值得生成。

变体**不改变** `angle` / `cognitiveTask`，因此**不增加**诊断维度、
也**不计入**覆盖矩阵——它减少的是重复感，不是补知识缺口。

同一个 Core Concept 的 Canonical 数量不受本条限制：
有多少个有独立 assessment value 的 angle / cognitiveTask 组合，就建多少道 Canonical。

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

可选（`cognitiveTask` 回答“考生执行什么认知操作”，`angle` 回答“从什么视角切入”）：

* define：准确识别概念
* explain：解释概念（含现象背后的原因陈述，不含定位未知根因）
* mechanism：解释内部机制和因果关系
* compare：比较不同方案
* apply：将知识应用到具体情境
* diagnose：根据现象定位原因
* evaluate：判断工程取舍与方案优劣（含 tradeoff 权衡）
* design：进行组件或系统设计

`tradeoff` 只放在 `angle`，不单独作为 `cognitiveTask`。

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

优先核心机制、高频、高区分度、典型误解、工程判断、方案比较、trade-off、debugging、架构设计。不要平均覆盖文章、按段落出题、为凑数强行生成。

---

# 九、题目类型

全选择题：4～6 选项，single 恰好 1 正确、multiple 至少 2 正确，answer 用 0-based integer array。题型分布见 `question-content-spec.md §9`（新题 multiple ≥ 2/3，`add-question.ts` 硬门禁）。

---

# 十、Answer Determinism

规范见 `question-content-spec.md §2`。执行要点：题干约束 + 可靠技术事实唯一确定答案；正确项之间不得是同事实重复/上下位改写/因果链拆分；不依赖未写出的前提、行业约定、模糊措辞、主观偏好。

---

# 十一、Evidence Boundary

规范见 `question-content-spec.md §4`。执行要点：不编造 benchmark/性能数字/产品行为；enrichment ✅（标准背景补自包含）/ injection ❌（新增决定答案的独立知识点）；厂商事实记核验日期，不确定写条件句。

---

# 十二、Self-contained

规范见 `question-content-spec.md §3`。执行要点：考生没读过文章；禁“文中提到/根据本文/作者认为/上述方法”；最小必要 context 写进题干（目标 + 约束 + 验收标准）。

---

# 十三、Architecture / System Design

design / system-design 只在文章证据充分时用，不强行生成。system-design 需明确工程场景 + 至少 3 个真实且相互独立、确实影响方案的约束（如 latency / scalability / reliability / cost / security / state / observability）；不足 3 个则不生成、不凑数。

---

# 十四、Option Design

规范见 `question-content-spec.md §5`。执行要点：同一决策层级、选项独立、真假由技术命题本身决定；若靠“通常 / 一定 / 必然 / 可能 / 仅在某些情况下”措辞强弱维持真假 ⇒ 重写，不适合做 Variant 基础。

---

# 十五、Wrong Options

规范见 `question-content-spec.md §6`。执行要点：干扰项来自真实误解（相邻概念混淆、遗漏条件、训练→推理误迁移、局部当系统最优等）；禁稻草人；遮住答案后剩余选项应让懂行人犹豫 2 秒以上。

---

# 十六、Option Balance 与十七、Answer Leakage（合并，规范见 `question-content-spec.md §7`）

执行要点：长度/信息密度/专业度/语气/句式接近，不靠“更长更完整”暴露答案；最长/最短 > 1.8× 导入即拦（`add-question.ts` 硬门禁），其余泄题信号由 `question:quality` 标嫌疑 + 人工复核。

---

# 十八、Canonical 与 Variant 的知识一致性（§19/§20/§24 是本节的展开，判定冲突时以本节为准）

Variant 可以改变（仅表达层）：

* 场景（等价替换，不得增加推理链）；
* 提问方式；
* framing；
* 选项措辞。

新场景不得引入额外推理步骤、额外背景知识或新的决策变量，否则实际难度必然漂移，该 Variant 不合格。

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

Variant 核心硬规则（10 条，§19/§20/§24 不得与之冲突）：

```text
1. Variant ≠ new assessment item
2. Variant ≠ new angle
3. Variant ≠ new cognitive task
4. Variant ≠ new concept
5. Variant ≠ new difficulty
6. Variant may change framing / scenario / wording
7. Variant must preserve answer truth values
8. Variant must preserve option correspondence
9. Variant must be materially different（重述级，非同义替换）
10. Variant must not add reasoning burden / hidden context
```

自检一句话（推理路径版）：

> 如果考生在不知道 Canonical 存在的情况下，只通过新的题干与选项完成 Variant，所需要的正确推理路径是否与 Canonical 相同？
> 推理路径不同 → 不是合法 Variant，即使结论文字相似。

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
题干 = 在自回归生成中，每生成一个新 token，模型都需要使用此前 token
       对应的 Key/Value 信息。若不缓存这些中间结果，会产生大量重复计算。
       KV Cache 在这里具体解决了什么问题？
选项 = [把已算过的前缀 Key/Value 缓存下来，避免每步重算整个前缀 / …]
       ↑ 结论相同（避免重复计算前缀 K/V），仍是 explain + mechanism，
       只是换了叙述视角与句式；没有引入“定位未知根因”的 diagnose 步骤
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

> 考生做这道题时执行的**认知操作与正确推理路径**应与 Canonical 相同；
> 他看到的**文字与情境**应明显不同。
>
> 反例：Canonical 问“为什么 KV Cache 能降低开销”（explain），Variant 问“线上耗时增长的根因是什么”（diagnose）——即使答案都指向 K/V 重算，推理路径已从解释机制变为定位故障，必须拆成新 Canonical。

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

# 二十一、Explanation 与二十二、Diagnostic Value（合并）

explanation 短而有技术含量（为什么正确 + 核心机制 + 必要的 trade-off/misconception），不复述文章、不写教程、不引入新关键知识；Variant 的 explanation 结论与 canonical 一致、措辞贴合自身 framing。生成前自问：答错能否定位到具体 Concept/机制/误解？不能 ⇒ 不出。

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

> 这道 Canonical 是否值得降低记忆效应（配表达变体）？

只有答案为“是”时才生成 Variant；具体生成多少条、最终保留多少条由离线 oversample → quality filter 流程决定。

---

# 二十四、最终强制检查

每道题逐项检查（A–O 细则见 spec §1–§7，§9；此处只列判据）：

| # | 项 | 判据 |
| --- | --- | --- |
| A | Self-contained | 删文章后仍可理解（spec §3） |
| B/C | Core Concept / Scope | 单一明确缺口，非大杂烩（spec §1） |
| D/E | Angle / Cognitive Task | 各自明确；task 枚举见 §26 |
| F/G | Interview Value / Reasoning | 考理解应用判断设计，非记忆 |
| H | Architecture | design/system-design 有真实约束（§13） |
| I | Evidence | 事实可靠（spec §4） |
| J | Answer Determinism | 答案唯一稳定（spec §2） |
| K/M | Balance / Leakage | 无形式优势（spec §7） |
| L | Wrong-option Quality | 干扰项真实可信（spec §6） |
| N/O | Duplication / Diagnostic | 非换皮；答错可定位缺口 |

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

自问（推理路径版，§18 细则的复述，冲突以 §18 为准）：

> 在不知道 Canonical 的情况下单做这道 Variant，正确推理路径是否与 Canonical 相同？不同 → 应拆成新 Canonical。
> 直视两道题，考生能否一眼看出「这是同一题换了个说法」？（能 → 改写幅度不够）

### Q. Option Transformability

选项在自然语义改写后，是否仍能保持原来的正确/错误属性？选项真假是否由技术命题本身决定，而非“通常 / 一定 / 可能”等措辞强弱决定？

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
