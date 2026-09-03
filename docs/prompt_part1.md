阅读当前浏览器标签页中的网页内容。

你现在只负责完成一个任务：

**规划一组高质量、适合中文 AI/ML 技术面试题库的 Question Blueprint。**

不要写最终题目。
不要写选择项。
不要写 explanation。

你的输出会被下一轮 Prompt 继续使用。

---

# 一、总体目标

从当前网页中识别真正值得测试的稳定知识，并规划：

* 1 个 canonical question
* 0～2 个真正有价值的 variant

核心原则：

**知识价值 > 认知区分度 > 工程价值 > 数量。**

宁可少规划，也不要为了数量制造重复题。

---

# 二、语言要求

**最终题目面向中文技术面试场景。**

因此本轮规划也必须使用中文描述：

* `knowledgeSummary`
* `assessmentTarget`
* `reasoningGoal`

可以保留行业中通用的英文技术术语，例如：

* Transformer
* Attention
* Softmax
* MoE
* KV Cache
* Batch Size

但不要输出整段英文描述。

最终题目必须能够自然地写成：

**专业、准确、自然的中文技术面试题。**

不要生成中式直译腔，也不要为了“中文化”强行翻译已经成为行业标准的英文技术术语。

---

# 三、识别 Knowledge

只选择真正重要、稳定、可验证、具有面试价值的知识。

不要把：

* 名词
* 普通事实
* 文章中的例子
* 同一个机制的不同说法
* 一个公式中的单个符号

机械地分别当成 Knowledge。

每个 Knowledge 应能回答：

> 学习者真正理解这个知识以后，能够做出什么判断？

如果多个概念只有组合起来才构成真正有意义的知识，应保持在同一个 Knowledge 中。

如果一个知识包含多个彼此独立的机制，可以拆分。

---

# 四、选择测试角度

优先考虑：

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

不要为了形式上的多样性机械轮换 angle。

真正的判断标准是：

**学习者是否因此需要采用不同的 reasoning path。**

---

# 五、选择 Cognitive Task

使用最能描述实际认知行为的：

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

不要因为题目带有工程背景就自动设为 `diagnose`。

---

# 六、Canonical

每个重要 Knowledge 默认只规划一个 canonical。

Canonical 应代表：

**这个知识最核心、最稳定、最有面试价值的一种测试方式。**

优先：

* 核心机制
* 因果关系
* 重要 trade-off
* 高频工程判断
* 常见误解
* 重要边界条件

不要为了显得高级而加入无关背景。

---

# 七、Variant

Variant 不是改写，也不是“换场景”。

Variant 必须：

**保持同一个 Knowledge，但采用明显不同的测量方式。**

优先改变以下至少两个：

* angle
* cognitiveTask
* reasoning direction
* observable evidence
* constraint
* engineering context

仅仅修改：

* 数字
* 人物
* 公司
* 代码
* 场景名称
* 表达方式

不算 variant。

---

# 八、如何判断真正不同

如果 canonical 和 variant：

* 核心 reasoning path 基本相同
* assessment target 基本相同
* angle 基本相同
* cognitiveTask 基本相同

则视为重复。

特别注意：

**不能因为题目背景不同，就认为是不同题。**

只有当背景改变了学习者实际需要进行的推理，才算真正不同。

---

# 九、Variant 不得偷换 Knowledge

Variant 只允许改变：

> 怎么测这个知识。

不能改变：

> 到底在测什么知识。

如果某个结论依赖：

* 某篇论文的具体实现
* framework
* kernel
* routing implementation
* numerical precision
* hardware
* training strategy

必须保留这种上下文限制。

不要把特定实现的行为泛化成所有实现都必然如此。

---

# 十、什么时候不要生成 Variant

以下情况直接不生成：

1. 只能换背景
2. 只能换数字
3. 只能换代码
4. 仍然使用相同 reasoning path
5. 只是把题目写得更长
6. 只能通过制造一个新的知识命题来产生差异
7. 第二个测量方式明显弱于 canonical

如果不存在自然、高价值的 variant：

**`variants` 直接为空数组。**

---

# 十一、Difficulty

difficulty 表示认知难度，不表示题目长度。

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

* 多约束推理
* trade-off
* 边界条件
* 复杂诊断
* 架构选择
* 综合推理

不要通过堆术语和背景制造 hard。

Variant 不要求比 canonical 更难。

---

# 十二、Quantitative

如果知识包含公式：

优先规划：

* 参数变化后的趋势
* 比例关系
* 多参数同时变化
* 边界条件
* 反事实分析

不要连续规划：

> 给数字 → 套公式 → 算结果

简单计算题可以存在，但应控制比例。

---

# 十三、工程场景

只有在工程场景真正改变推理过程时才使用。

好的约束包括：

* latency
* throughput
* memory
* bandwidth
* sequence length
* batch size
* GPU count
* communication
* deployment constraints

不要为了“工程感”添加：

> 某公司工程师发现……

但问题最终仍然只是定义题。

---

# 十四、Concept 数量

通常：

**1 个核心 Concept + 1～3 个辅助 Concept。**

不要为了显得丰富而堆很多 Concept。

如果一道题实际上测试多个彼此独立的知识，应拆成多道题。

---

# 十五、Blueprint 必须体现真实测试目标

`assessmentTarget` 必须描述：

> 学习者需要完成什么行为，才能证明理解了这个知识。

不要写成：

> “理解 Attention、Softmax、Gradient Vanishing。”

应该写成类似：

> “能根据 attention 分布变尖锐和梯度异常减小的现象，定位未进行缩放导致 Softmax 饱和的机制。”

`reasoningGoal` 要描述：

> 这道题要求学习者执行哪一条核心推理链。

而不是复述题目主题。

---

# 十六、最终自检

输出之前检查：

### Knowledge

* 是否稳定？
* 是否值得测试？
* 是否真正具有面试价值？

### Diversity

* variant 是否真正不同？
* 是否只是换背景？
* reasoning path 是否不同？

### Validity

* variant 是否仍然属于同一个 Knowledge？
* 是否偷偷引入新的知识命题？

### Difficulty

* 难度是否来自推理？
* variant 是否被机械地设成 hard？

### Coverage

* 是否已经覆盖最值得测试的部分？
* 是否为了数量制造重复？

不合格的 variant：

**直接删除。**

---

# 十七、输出格式

严格输出合法 JSON Array。

不要输出 Markdown。
不要输出 ```json。
不要输出额外说明。

所有自然语言字段使用中文。

JSON key 保持下面的英文格式：

[
{
"knowledgeId": "...",
"knowledgeSummary": "...",
"canonical": {
"angle": "...",
"cognitiveTask": "...",
"difficulty": "easy | medium | hard",
"assessmentTarget": "...",
"reasoningGoal": "...",
"keyConcepts": ["..."]
},
"variants": [
{
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

最终原则：

**少而精。**

**真正不同的测量方式 > 换场景改写。**

**稳定 Knowledge > 文章表面信息。**

**认知价值 > 题目数量。**
