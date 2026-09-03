继续处理当前浏览器标签页中的网页。

在上一轮回复中，你已经为当前网页生成了 **Question Blueprint**。

现在：

**严格根据你刚刚生成的 Blueprint，把它们写成最终的中文 AI/ML 技术面试题。**

不要重新规划 Knowledge。
不要重新决定 canonical / variant。
不要重新设计 Blueprint。
不要擅自改变 Blueprint 指定的题型。

你上一轮生成的 Blueprint 是本轮唯一的设计依据。

---

# 一、语言要求

所有最终内容必须使用自然、专业、准确的中文。

这些字段必须使用中文：

* `category`
* `topic`
* `concepts`
* `tags`
* `assessmentTarget`
* `question`
* `explanation`
* `options[].text`

以下机器字段保持英文：

* `id`
* `questionRole`
* `variantOf`
* `knowledgeId`
* `difficulty`
* `angle`
* `cognitiveTask`
* `formats[].type`
* `options[].key`

标准技术术语可以保留英文：

Transformer、Attention、Softmax、MoE、KV Cache、CUDA、FlashAttention、Embedding、Batch Size、Throughput、Latency 等。

首次出现时可以使用：

> 因果掩码（Causal Mask）

之后直接使用行业通用术语即可。

不要把英文教材机械翻译成中文。

---

# 二、严格执行 Blueprint

每道题必须保持：

* `knowledgeId`
* 核心 Knowledge
* `type`
* `angle`
* `cognitiveTask`
* `difficulty`
* `assessmentTarget`
* `reasoningGoal`

与 Blueprint 一致。

你可以自由设计：

* question
* scenario
* options
* explanation
* examples
* code
* numbers

但这些只能服务于 Blueprint。

---

# 三、题型规则

只允许：

* `multiple-choice`
* `single-choice`

**禁止 open。**

默认应生成：

`multiple-choice`

只有 Blueprint 已明确指定 `single-choice` 时才生成单选。

---

# 四、Multiple-choice

这是默认题型。

高质量多选题必须满足：

1. 至少存在两个彼此独立的正确选项。
2. 每个正确选项都可以独立判断为正确。
3. 正确选项之间不能只是同一个意思的重复表达。
4. 错误选项必须具有 plausibility。
5. 不能通过选项长度或语气判断正确答案。
6. 不得出现“两个选项合起来才正确”的情况。
7. 不得因为选项太多而增加无意义复杂度。

优先让不同选项分别代表不同的：

* 正确机制
* 因果关系
* 约束
* trade-off
* 工程判断
* 边界条件

例如一个优秀多选题可以要求同时识别：

> 哪些因素会导致该系统吞吐下降？

A、B 是两个独立正确原因，C、D 是 plausible 但错误的原因。

不要把一个事实拆成：

A：完整正确解释
B：同一个解释的后半句

这种多选没有价值。

---

# 五、Single-choice

仅在 Blueprint 指定时使用。

必须只有一个最佳答案。

适合：

* 唯一最佳机制解释
* 唯一正确诊断
* 唯一正确架构选择
* 明确的因果判断
* 无法自然拆成多个独立正确条件的知识

如果一个知识可以自然形成多个彼此独立的正确判断：

**优先 multiple-choice。**

---

# 六、Variant

Variant 必须：

**和 canonical 测试相同 Knowledge，但使用不同 reasoning path。**

可以通过改变：

* observable evidence
* reasoning direction
* constraint
* engineering context
* angle
* cognitiveTask
* question type

实现。

不能只是：

* 换数字
* 换公司
* 换人物
* 换代码
* 换背景
* 同义改写

完成后内部检查：

> 如果学习者已经答对 canonical，他是否仍然需要进行明显不同的思考才能答对 variant？

如果不需要：

**重新设计 variant。**

---

# 七、Canonical

Canonical 是该 Knowledge 的稳定主问题。

它应该：

* 最核心
* 长期有效
* 自包含
* 不依赖原文
* 有清晰答案
* 真正测试理解

---

# 八、Distractor

这是高优先级要求。

错误选项必须：

**合理但错误。**

优先来自：

* 常见误解
* 概念混淆
* 因果倒置
* 条件遗漏
* 适用范围错误
* trade-off 判断错误
* plausible engineering mistake

禁止：

* 虚构技术机制
* 虚构 framework 行为
* 明显错误的 GPU / CUDA 行为
* 与题目无关的概念
* 一眼就能排除的荒谬答案

错误选项应该像：

> 一个懂一些但理解不完整的工程师可能做出的判断。

---

# 九、Multiple-choice 的正确项设计

多选题不要默认：

> “A、B、C 都差不多是同一个正确答案。”

应该让每个正确项覆盖一个独立 reasoning point。

例如：

知识：

> 为什么某 MoE 设计会出现通信瓶颈？

好的正确项可能分别涉及：

* Token dispatch 的通信量
* 跨节点带宽限制
* Expert placement
* Batch aggregation

而不是四种方式重复描述“通信多”。

---

# 十、答案长度公平

所有选项尽量：

* 长度接近
* 信息密度接近
* 语法结构接近

特别禁止：

正确答案写完整理论链，而错误项只是半句话。

不要让：

> 最长答案 = 正确答案。

---

# 十一、Explanation

Explanation 必须：

1. 说明正确项为什么成立。
2. 说明错误项为什么错误。
3. 对多选逐项解释关键判断。
4. 与题目严格一致。
5. 不引入题目没有提供的关键假设。
6. 不为了显得专业而堆公式。

严格区分：

* 理论事实
* 特定实现
* 常见工程实践

涉及：

* framework
* kernel
* hardware
* routing
* numerical precision
* training implementation
* specific paper implementation

时，必须保留必要限定。

不要把特定实现行为写成：

> 所有实现都一定如此。

---

# 十二、Accuracy

数学公式、复杂度、因果关系必须准确。

如果 source 存在：

* 不同论文定义
* 多种实现
* 理论与工程差异

优先使用最准确、且能被题目条件支持的版本。

不要把过度简化的说法直接当作严格定理。

---

# 十三、中文质量

最终题目必须像真正的中文 AI/ML 技术面试题。

避免：

* 英文句式直译
* 大量中英混杂
* 无意义括号
* 术语堆砌
* 长句过多
* 生硬翻译腔

优先自然表达：

> “以下哪些判断正确？”

> “以下哪些因素最可能导致该现象？”

> “在该约束下，哪些方案是合理的？”

> “以下关于该机制的描述中，哪些成立？”

---

# 十四、Difficulty

### easy

核心概念和直接关系。

### medium

条件变化、比较、基础应用、常见故障判断。

### hard

多约束、trade-off、边界、复杂 diagnosis、架构选择、综合推理。

不要靠题目长度制造 hard。

Variant 不要求比 canonical 更难。

---

# 十五、Quantitative

如果 Blueprint 指定 quantitative：

优先测试：

* 参数变化
* 比例关系
* 趋势
* 多变量变化
* 边界
* 反事实

不要让多个 variant 都只是换数字套公式。

---

# 十六、工程场景

只有工程背景真正参与推理时才加入。

可使用：

* latency
* memory
* throughput
* bandwidth
* sequence length
* batch size
* GPU count
* communication
* deployment constraint

不要为了“工程感”写没有作用的公司和人物故事。

---

# 十七、Concept

通常：

**1 个核心 Concept + 1～3 个辅助 Concept。**

不要堆砌大量术语。

---

# 十八、Self-contained

题目必须脱离当前网页独立成立。

禁止：

* “根据文章”
* “根据上文”
* “作者认为”
* “上述方法”
* “前文提到”

所有完成推理所需的信息必须出现在题目本身。

---

# 十九、最终质量检查

每道题输出前内部检查：

### Knowledge

是否仍然测试 Blueprint 指定 Knowledge？

### Type

题型是否与 Blueprint 完全一致？

### Multiple-choice

如果是多选：

* 是否至少有两个真正独立的正确项？
* 每个正确项是否都有独立价值？
* 是否存在同义重复正确项？
* 是否存在明显荒谬错误项？

### Single-choice

如果是单选：

* 是否真的只有一个最佳答案？

### Reasoning

是否真的需要理解和推理，而不是换一种方式背诵？

### Variant

是否真的不同？
还是仅仅换场景？

### Accuracy

事实、公式、复杂度、因果关系是否准确？

### Distractors

错误项是否 believable？

### Fairness

正确答案是否因为更长、更完整而暴露？

### Difficulty

难度是否来自认知要求？

### Chinese Quality

中文是否自然？
是否存在明显翻译腔？

### Self-contained

脱离网页是否仍然能够独立作答？

发现关键问题：

**重新设计该题。**

---

# 二十、最终输出格式

严格输出合法 JSON Array。

不要输出 Markdown。
不要输出 ```json。
不要输出任何额外说明。

字段：

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

对于 `multiple-choice`：

`answer` 必须是包含至少两个 key 的数组，例如：

"answer": ["A", "C"]

对于 `single-choice`：

`answer` 使用单个 key，例如：

"answer": "B"

---

# 二十一、最终原则

**默认多选。**

**只有天然唯一最佳判断时才单选。**

**禁止 open。**

**题型服从知识，而不是知识服从题型。**

**多个独立正确判断 → multiple-choice。**

**唯一最佳判断 → single-choice。**

**真正不同的 reasoning path > 换场景。**

**合理 plausible distractor > 荒谬错误项。**

**理解、应用、诊断、比较、trade-off > 单纯记忆。**

**高价值少量题 > 大量重复题。**

**宁可没有 variant，也不要伪 variant。**
