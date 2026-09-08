继续处理上一轮生成的 Question Blueprint。

上一轮的输出是你本轮的**唯一设计依据**。

你的任务只有一个：

**严格把 Blueprint 实例化成最终的中文 AI/ML 技术面试题。**

你现在不是重新设计题库。

不要重新规划 Knowledge。
不要重新选择 Assessment Target。
不要重新决定 Canonical / Variant。
不要重新设计 reasoning path。
不要重新发明题型。

上一轮 Blueprint 已经完成设计。

你现在负责：

**Blueprint → Final Item → Adversarial Review → Final JSON**

---

# 一、最高优先级原则

Blueprint 是设计约束。

生成最终题目时必须保持：

* `knowledgeId`
* Knowledge
* `type`
* `angle`
* `cognitiveTask`
* `difficulty`
* `assessmentTarget`
* `reasoningGoal`

与 Blueprint 一致。

你可以自由决定：

* question
* scenario
* options
* explanation
* numbers
* examples
* code

但这些只能服务于 Blueprint。

**不要通过修改题目来悄悄改变 Blueprint。**

---

# 二、不要重新阅读或依赖原网页

本轮不需要重新理解上一轮网页。

上一轮 Blueprint 是唯一设计依据。

如果上一轮 Blueprint 中没有的信息：

* 不要自行从当前网页重新补充
* 不要自行重新设计 Knowledge
* 不要自行扩展 assessment scope
* 不要为了“让题目更完整”加入新的核心知识

题目必须根据 Blueprint 自身构造。

---

# 三、如果 Blueprint 内部存在轻微缺失怎么办

允许你：

* 补充题目表达所必需的自然语言
* 补充数字
* 补充必要的局部场景
* 补充不改变 Knowledge 的常识性细节

但不得改变：

* Knowledge
* Assessment Target
* ReasoningGoal
* CognitiveTask
* Angle
* Difficulty
* Type

如果一个 Blueprint 无法在不改变上述内容的情况下合法生成：

**优先生成最接近 Blueprint 原意的题目，不要重新设计整个 Knowledge。**

---

# 四、Canonical 的生成原则

Canonical 必须：

* 自包含
* 长期有效
* 专业
* 准确
* 真正体现 Blueprint
* 不依赖网页上下文
* 不依赖“作者认为”
* 不要求读者看过原文

题目应该像真实技术面试中的高质量问题，而不是文章理解题。

---

# 五、Question 必须真正测 Assessment Target

生成完成后内部检查：

> 如果一个学习者只知道 Knowledge 名称，但没有理解 Blueprint 描述的能力，他能否轻易蒙对？

如果可以：

**重新设计题目。**

题目不能只是：

> “什么是 X？”

除非 Blueprint 明确要求 recall。

---

# 六、Question 必须体现 ReasoningGoal

不要让 ReasoningGoal 只是写在 JSON 里的装饰字段。

题目必须真的要求学习者执行 Blueprint 指定的推理链。

例如：

ReasoningGoal：

> 先识别 memory pressure，再判断 KV Cache 的 scaling behavior，最后比较优化方向。

那么题目就必须让学习者完成这些判断。

不能最终退化成：

> “KV Cache 是什么？”

---

# 七、Evidence Criterion 必须真实可观察

虽然最终 JSON 不增加新的 Evidence 字段，但你必须根据 Blueprint 中的：

* `assessmentTarget`
* `reasoningGoal`

判断：

> **什么样的正确答案才足以证明学习者真的完成了目标？**

题目的正确答案和 explanation 必须支持这种判断。

不要出现：

Assessment Target 很高阶：

> 能解释机制并判断边界。

但实际题目：

> “以下哪一个定义正确？”

这种情况视为 Blueprint 没有被真正实例化。

---

# 八、只允许两种题型

允许：

* `multiple-choice`
* `single-choice`

禁止：

* open
* fill-in-the-blank
* true/false
* matching
* essay

如果 Blueprint 指定 multiple-choice：

**必须生成 multiple-choice。**

如果 Blueprint 指定 single-choice：

**必须生成 single-choice。**

不要擅自换题型。

---

# 九、Multiple-choice

默认多选。

高质量多选必须满足：

### 1. 至少两个真正独立的正确选项

每个正确项：

* 都能独立成立
* 都有 assessment value
* 都对应一个独立判断

### 2. 正确项不能是同义重复

禁止：

A. X 可以减少通信

B. X 可以降低通信开销

这种实际只有一个判断。

### 3. 不能把一个正确答案拆成两半

禁止：

A. 因为 Q/K/V 可以缓存

B. 所以历史 token 不需要重新计算

如果二者只是一个完整 reasoning chain 的上下两句，而不是两个独立判断，就不应作为两个正确选项。

### 4. 错误选项必须 plausible

优先来源：

* 常见 misconception
* 概念混淆
* 因果倒置
* 条件遗漏
* 适用范围错误
* trade-off 判断错误
* plausible engineering mistake

不要故意制造荒谬选项。

---

# 十、Single-choice

必须：

**只有一个最佳答案。**

尤其检查：

* 是否存在第二个同样合理的方案？
* 是否题目条件不足以排除第二个方案？
* 是否多个选项只是不同表述但都成立？

如果存在两个 equally-best answer：

**重新设计题目条件。**

不要靠模糊语言强行制造唯一答案。

---

# 十一、Distractor

错误选项不是“随机错误答案”。

理想 distractor 应该是：

> 一个懂一些、但理解存在具体缺陷的工程师可能做出的判断。

优先从这些来源构造：

* misconception
* 概念混淆
* 因果倒置
* 条件遗漏
* 适用范围误判
* trade-off 判断错误
* plausible implementation mistake

禁止：

* 虚构 framework 行为
* 虚构 CUDA 行为
* 虚构硬件事实
* 与题目无关的概念
* 一眼荒谬的答案

---

# 十二、正确答案长度公平

不要通过长度泄题。

所有选项尽量：

* 长度接近
* 信息密度接近
* 语法结构接近
* 专业度接近

禁止：

> 正确答案写完整理论链，错误答案只有一句半话。

尤其不要让：

**最长 = 正确**

或者：

**最严谨 = 正确**

成为答案提示。

---

# 十三、不要为了多选而牺牲逻辑质量

如果 Blueprint 指定 multiple-choice，但最终发现这个 Knowledge 在当前 assessment target 下只能形成：

> 一个真正独立的正确判断

不要人工凑第二个正确项。

此时首先尝试通过更准确地实现 Blueprint 来形成多个独立判断。

只有确实无法形成多个独立正确判断时，才重新审查 Blueprint 的实现是否存在误解。

不要生成低质量“伪多选”。

---

# 十四、Variant

Variant 必须与 Canonical：

**测试同一个 Knowledge，但采用实质不同的 reasoning path。**

判断标准：

> **一个已经答对 Canonical 的学习者，是否仍然需要进行明显不同的思考才能答对 Variant？**

如果不需要：

**重新设计 Variant。**

---

# 十五、Variant 不得只是这些变化

以下通常不构成真正 Variant：

* 换数字
* 换公司
* 换人物
* 换变量
* 换代码
* 换背景
* 换场景名称
* 同义改写
* 增加句子
* 调整选项顺序

只有表面变化，没有 reasoning change：

**不合格。**

---

# 十六、Variant 可以改变什么

可以改变：

* observable evidence
* reasoning direction
* constraint
* engineering context
* angle
* cognitiveTask
* question type

但变化必须服务于：

**新的 reasoning path。**

例如：

Canonical：

> 判断核心机制为什么成立。

Variant：

> 根据系统异常现象反推机制。

或者：

Canonical：

> 解释策略。

Variant：

> 在新约束下判断策略是否仍然成立。

或者：

Canonical：

> 判断机制。

Variant：

> 比较两个方案的 trade-off。

---

# 十七、Variant 不能改变 Knowledge Identity

Variant 可以改变：

* 测试方法
* 场景
* 推理方向
* cognitiveTask
* angle

但必须继续锚定 Blueprint 的：

* 核心 Knowledge
* 知识边界
* 主要 Knowledge Attribute
* 语义范围

禁止通过 Variant 偷偷引入新的主要知识。

---

# 十八、Difficulty

必须与 Blueprint 一致。

### easy

* 核心概念
* 直接关系
* 基础判断

### medium

* 条件变化
* 比较
* 基础应用
* 常见故障

### hard

* 多约束
* trade-off
* 边界
* diagnosis
* architecture
* 综合推理

不要通过：

* 题目变长
* 背景变复杂
* 增加术语
* 增加无意义数字

伪造难度。

---

# 十九、Quantitative

如果 Blueprint 指定 quantitative：

优先测试：

* 参数变化
* 比例关系
* 趋势
* 多变量
* 边界
* 反事实
* 工程含义

不要把所有相关题都变成：

> 给数字 → 套公式 → 算答案。

如果计算本身是核心 skill，可以保留。

---

# 二十、Engineering Context

只有工程条件真正改变 reasoning 时才加入。

可使用：

* latency
* memory
* throughput
* bandwidth
* sequence length
* batch size
* GPU count
* communication
* deployment constraints

不要加入没有作用的：

* 公司名称
* 人名
* 产品故事
* 无关业务背景

---

# 二十一、Explanation

Explanation 必须与题目和 Blueprint 严格对应。

必须做到：

### 正确项

解释：

> 为什么成立。

### 错误项

解释：

> 为什么错误，以及它错在什么地方。

多选必须逐项解释关键判断。

Explanation 不要：

* 泛泛介绍整个 Knowledge
* 重复题干
* 堆无关背景
* 引入题目没有提供的重要假设
* 用错误内容来“解释正确答案”

---

# 二十二、Accuracy

必须检查：

* 事实
* 公式
* 复杂度
* 因果关系
* 条件
* 数值
* 单位
* 工程行为

尤其注意：

### 理论事实

不要被写成绝对实现规律。

### 特定实现

不要写成：

> 所有 framework 都如此。

### 特定硬件

不要写成：

> 所有 GPU 都如此。

### 特定论文

不要写成领域普遍定理。

必要时保留限定：

* 在该实现中
* 在该条件下
* 通常
* 在典型情况下
* 对该架构而言

---

# 二十三、Self-contained

最终题目必须脱离网页独立成立。

禁止：

* “根据文章”
* “根据上文”
* “作者认为”
* “上述方法”
* “前文提到”
* “文中提到的方案”

所有完成推理需要的信息：

**必须出现在题目本身。**

---

# 二十四、中文质量

最终题目必须像：

**真正的中文 AI/ML 技术面试题。**

避免：

* 英文句式直译
* 大量中英混杂
* 无意义括号
* 术语堆砌
* 翻译腔
* 为了显得专业而写很长

可以保留行业通用术语：

Transformer、Attention、Softmax、MoE、KV Cache、CUDA、FlashAttention、Embedding、Batch Size、Latency、Throughput 等。

首次出现复杂术语时，可以用：

> 中文名（English）

之后使用行业通用表达。

---

# 二十五、最终输出前必须进行 Adversarial Review

这一步非常重要。

题目生成完成后，不要立即输出。

内部暂时站到“挑剔审稿人 / 面试官”的角度重新检查：

### Knowledge

* 题目是否仍然测 Blueprint 的 Knowledge？
* 是否偷偷引入新的核心 Knowledge？

### Assessment Target

* 题目是否真的测 target？
* 还是只测了 Knowledge 名称/定义？

### Evidence

* 一个答对该题的人，是否真的提供了 Blueprint 要求的 evidence？
* 是否可以靠关键词/表面记忆通过？

### Reasoning

* 是否真的需要 Blueprint 指定的 reasoning path？

### Multiple-choice

* 每个正确项是否独立？
* 是否有同义重复？
* 错误项是否 believable？
* 是否只有一个选项因为更长而暴露答案？

### Single-choice

* 是否真的只有一个最佳答案？
* 题目条件是否足够？

### Variant

* 已答对 Canonical 的人，是否仍需要明显不同的思考？
* 是否只是换背景？

### Difficulty

* 难度是否来自 cognitive requirement？
* 是否只是增加文字？

### Accuracy

* 有没有隐藏错误？
* 有没有过度绝对化？

### Self-contained

* 不看网页还能不能独立作答？

发现关键问题：

**先重写题目，再输出。**

绝对不要把明显发现的问题直接交给下游。

---

# 二十六、最终输出格式

严格输出合法 JSON Array。

不要输出 Markdown。

不要输出：

```json
```

不要输出分析。

不要输出任何额外解释。

格式：

[
{
"id": "stable-id",
"questionRole": "canonical | variant",
"variantOf": "canonical-id | null",
"category": "...",
"topic": "...",
"knowledgeId": "...",
"concepts": ["..."],
"tags": ["..."],
"difficulty": "easy | medium | hard",
"angle": "...",
"cognitiveTask": "...",
"assessmentTarget": "...",
"question": "...",
"explanation": "...",
"formats": [
{
"type": "multiple-choice | single-choice",
"options": [
{
"key": "A",
"text": "..."
}
],
"answer": ["A", "C"]
}
]
}
]

对于：

`multiple-choice`

`answer` 必须是至少包含两个 key 的数组。

例如：

"answer": ["A", "C"]

对于：

`single-choice`

`answer` 必须是单个 key：

"answer": "B"

---

# 二十七、最终原则

**Blueprint 决定测什么。**

**Question 决定如何把它变成可观察的 task。**

**Assessment Target 决定证明什么。**

**ReasoningGoal 决定需要怎样推理。**

**Distractor 应代表 plausible misconception，而不是随机错误。**

**Multiple-choice 只有多个独立正确判断时才真正有价值。**

**Single-choice 必须存在唯一最佳判断。**

**Variant 必须产生真正不同的 reasoning path。**

**Variant 数量不是 KPI。**

**理解、应用、诊断、比较、trade-off > 单纯记忆。**

**准确性 > 复杂度。**

**Self-contained > 依赖原文。**

**高价值少量题 > 大量重复题。**

**发现问题先修复，再输出。**
