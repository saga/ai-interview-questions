阅读当前浏览器标签页中的网页内容。

你现在只负责完成一个任务：

**从当前网页中识别真正有价值的 AI/ML 知识，并规划一组高质量的 Question Blueprint。**

不要写最终题目。
不要写最终选项。
不要写最终 explanation。

你的输出会在下一轮继续使用。

---

# 一、总体目标

把当前网页中的知识转化成：

* 高价值的 Knowledge
* 每个 Knowledge 最合适的测试方式
* 1 个 canonical question
* 0～2 个真正有价值的 variant

核心原则：

**知识价值 > 认知区分度 > 工程价值 > 数量。**

宁可少规划，也不要为了数量制造重复题。

---

# 二、语言

整个 Blueprint 使用中文描述。

以下机器字段保持英文：

* `knowledgeId`
* `angle`
* `cognitiveTask`
* `difficulty`
* `type`

`knowledgeSummary`、`assessmentTarget`、`reasoningGoal`、`keyConcepts` 使用中文。

标准技术术语可以保留英文，例如：

Transformer、Attention、Softmax、MoE、KV Cache、CUDA、FlashAttention、Embedding、Batch Size 等。

不要把专业术语强行翻译成生硬中文。

---

# 三、识别稳定 Knowledge

只选择：

* 稳定
* 独立
* 可验证
* 有明确学习价值
* 有面试价值

的 Knowledge。

不要把：

* 名词
* 普通事实
* 文章中的例子
* 同一个机制的不同表述
* 公式中的单个符号

机械地分别作为 Knowledge。

一个 Knowledge 应能够回答：

> 学习者真正理解这个知识以后，能够做出什么判断？

如果多个概念只有组合起来才构成真正有意义的知识，应保留为一个 Knowledge。

如果一个 Knowledge 中存在多个独立机制，可以拆分。

---

# 四、选择最佳 assessment angle

优先从下面选择：

* `mechanism`
* `causal`
* `diagnosis`
* `prediction`
* `comparison`
* `tradeoff`
* `architecture`
* `debugging`
* `boundary`
* `misconception`
* `design`
* `quantitative`
* `implementation`
* `synthesis`

不要机械轮换。

真正标准是：

**这种 angle 是否能测出一个清晰、重要、可验证的能力？**

---

# 五、选择 Cognitive Task

可使用：

* `recall`
* `explain`
* `identify`
* `diagnose`
* `compare`
* `predict`
* `apply`
* `evaluate`
* `design`
* `troubleshoot`
* `infer`
* `synthesize`

优先使用需要理解和推理的任务。

尽量减少纯 `recall`。

---

# 六、题型必须由知识决定

**禁止 open question。**

可使用的题型只有：

* `multiple-choice`
* `single-choice`

默认使用：

**`multiple-choice`**

只有在以下情况下才使用 `single-choice`：

* 知识天然要求一个唯一最佳判断
* 多个同时正确的判断无法自然拆分
* 如果强行多选会造成选项逻辑重叠或重复
* 单选能够更准确地测量该 Knowledge

不要因为“单选更简单”而默认单选。

也不要为了“增加难度”机械使用多选。

核心原则：

> **默认多选；只有知识本身更适合单一最佳判断时才单选。**

---

# 七、Canonical

每个重要 Knowledge 默认只规划一个 canonical。

Canonical 应代表：

**这个 Knowledge 最核心、最稳定、最有面试价值的测量方式。**

优先：

* 核心机制
* 因果关系
* 高频工程判断
* 重要 trade-off
* 常见误解
* 关键边界

不要为了显得高级加入无关背景。

---

# 八、Variant

Variant 不是改写。

Variant 必须：

**保持同一个 Knowledge，但采用明显不同的测量方式。**

优先改变以下至少两个：

* angle
* cognitiveTask
* reasoning direction
* observable evidence
* constraint
* engineering context
* question type

仅仅修改：

* 数字
* 人物
* 公司
* 代码
* 场景名称
* 表达方式

不算 variant。

---

# 九、Variant 可以改变题型

Canonical 和 Variant 可以使用不同题型。

例如：

* canonical = multiple-choice
* variant = single-choice

或者：

* canonical = single-choice
* variant = multiple-choice

前提是：

**二者仍然测试同一个 Knowledge，但需要不同 reasoning path。**

不要为了形式变化而改变题型。

---

# 十、什么时候不要生成 Variant

以下情况直接不生成：

1. 只能换背景
2. 只能换数字
3. 只能换代码
4. 仍然使用相同 reasoning path
5. 只是把题目写得更长
6. 只能通过制造新的知识命题来产生差异
7. 第二个测量方式明显弱于 canonical

如果不存在自然、高价值的 variant：

`variants = []`

完全允许。

---

# 十一、判断重复

两个题即使文字完全不同，如果：

* 核心 reasoning path 相同
* assessment target 相同
* angle 基本相同
* cognitiveTask 基本相同

也应该视为重复。

不要被：

* 新背景
* 新数字
* 新代码

欺骗。

---

# 十二、Variant 不能偷换 Knowledge

Variant 只能改变：

> 怎么测试这个知识。

不能改变：

> 到底在测试什么知识。

如果结论依赖：

* 特定论文实现
* framework
* kernel
* routing implementation
* hardware
* numerical precision
* training strategy

必须保留相应上下文。

不要把某个特定实现的行为泛化成：

> 所有实现都必然如此。

---

# 十三、Difficulty

难度来源于认知要求，不来源于题目长度。

### easy

* 核心概念
* 直接关系
* 基础判断

### medium

* 条件变化
* 比较
* 常见故障
* 基础工程应用

### hard

* 多约束
* trade-off
* 边界条件
* 复杂诊断
* 架构选择
* 综合推理

不要通过增加背景、术语和公式制造 hard。

Variant 不要求比 canonical 更难。

---

# 十四、Quantitative

如果知识包含公式：

优先规划：

* 趋势预测
* 比例关系
* 多参数变化
* 边界条件
* 反事实分析

不要把多个 variant 都设计成：

> 给数字 → 套公式 → 算结果。

简单计算题可以存在，但不应成为主要变体形式。

---

# 十五、工程题

只有在工程条件真正参与推理时才使用工程场景。

可使用：

* latency
* throughput
* memory
* bandwidth
* sequence length
* batch size
* GPU count
* distributed communication
* deployment constraint

不要为了“工程感”添加无意义故事。

---

# 十六、AssessmentTarget

必须描述：

> 学习者需要完成什么行为，才能证明理解了这个知识。

不要写成概念清单。

差：

> “理解 Attention、Softmax、Gradient Vanishing。”

好：

> “能根据 Attention 分布变尖锐和梯度异常减小的现象，定位未缩放 Dot Product 导致 Softmax 饱和的机制。”

---

# 十七、ReasoningGoal

`reasoningGoal` 必须描述：

> 学习者实际需要经过什么推理链才能答对。

而不是复述 Knowledge 名称。

例如：

> “先根据专家 Token 分配不均判断 Load Imbalance，再区分 Importance 与 Load 两种平衡指标，最后判断为什么仅加入 L_importance 无法解决 OOM。”

---

# 十八、Open 禁止

不要规划 open question。

即使知识本身涉及：

* 系统设计
* 架构设计
* debugging
* trade-off

也必须将其转换成最适合的：

* multiple-choice
* single-choice

形式。

对于复杂知识：

优先使用高质量多选，让多个选项分别代表：

* 正确机制
* 正确约束
* 正确 trade-off
* 正确工程判断

而不是降低成简单单选。

---

# 十九、Concept 数量

通常：

**1 个核心 Concept + 1～3 个辅助 Concept。**

不要为了显得丰富而堆十几个概念。

---

# 二十、输出 Blueprint

严格输出合法 JSON Array。

不要输出 Markdown。
不要输出 ```json。
不要输出额外解释。

格式：

[
{
"knowledgeId": "...",
"knowledgeSummary": "...",
"canonical": {
"type": "multiple-choice | single-choice",
"angle": "...",
"cognitiveTask": "...",
"difficulty": "easy | medium | hard",
"assessmentTarget": "...",
"reasoningGoal": "...",
"keyConcepts": ["..."]
},
"variants": [
{
"type": "multiple-choice | single-choice",
"angle": "...",
"cognitiveTask": "...",
"difficulty": "easy | medium | hard",
"assessmentTarget": "...",
"reasoningGoal": "...",
"keyConcepts": ["..."]
}
]
}
]

---

# 二十一、最终检查

输出之前逐项检查：

### Knowledge

* 是否稳定？
* 是否值得测试？
* 是否有面试价值？

### Measurement

* 是否真的需要推理？
* 题型是否适合该 Knowledge？
* 默认是否可以使用 multiple-choice？
* 如果使用 single-choice，是否真的存在唯一最佳判断？

### Diversity

* variant 是否真正不同？
* 是否只是换背景？
* reasoning path 是否不同？

### Validity

* variant 是否仍然属于同一个 Knowledge？
* 是否偷偷引入新的知识命题？

### Difficulty

* 难度是否来自认知复杂度？

### Coverage

* 是否覆盖这个 Knowledge 最值得测试的部分？
* 是否为了数量制造重复？

不合格的 variant：

**直接删除。**

最终原则：

**默认多选。**

**只有天然唯一最佳判断时才单选。**

**不生成开放题。**

**真正不同的 reasoning path > 换场景。**

**知识价值 > 题型统一。**

**高价值少量题 > 大量重复题。**
