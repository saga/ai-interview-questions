继续处理当前浏览器标签页中的网页。

在上一轮回复中，你已经为当前网页生成了 **Question Blueprint**。

现在：

**严格根据你刚刚生成的 Blueprint，把它们写成最终的中文 AI/ML 技术面试题。**

不要重新规划 Knowledge。
不要重新决定 canonical / variant。
不要重新设计 Blueprint。

你上一轮生成的 Blueprint 是本轮的设计依据。

---

# 一、最重要的语言要求

**所有最终题目内容必须使用自然、专业、准确的中文。**

以下字段必须中文：

* `category`
* `topic`
* `concepts`
* `tags`
* `assessmentTarget`
* `question`
* `explanation`
* `options[].text`

`angle`、`cognitiveTask`、`difficulty`、`questionRole`、`variantOf`、`knowledgeId`、`formats[].type`、`options[].key` 等机器字段保持英文枚举或 ID 格式。

技术领域中的标准英文术语可以保留，例如：

* Transformer
* Attention
* Softmax
* MoE
* KV Cache
* CUDA
* FlashAttention
* Batch Size
* Throughput
* Latency
* Token
* Embedding

第一次出现时，可采用：

> 中文 + 英文术语

例如：

> 因果掩码（Causal Mask）

之后可以直接使用行业通用英文简称。

不要把标准技术术语强行翻译成生硬中文。

---

# 二、中文表达要求

最终题目必须像真正的中文技术面试题，而不是英文翻译稿。

避免：

* 生硬直译
* 大量英文句法
* “which of the following”式机械句式
* 无意义的括号堆叠
* 过度书面化
* 为了显得专业而堆术语

优先使用自然表达，例如：

> “以下哪种解释最准确？”

> “最可能的根本原因是：”

> “在该约束下，哪种设计更合理？”

> “若将 X 提高到原来的两倍，最可能出现什么变化？”

---

# 三、严格执行 Blueprint

对于每道题：

必须保持：

* 相同 `knowledgeId`
* 相同核心 Knowledge
* Blueprint 指定的 angle
* Blueprint 指定的 cognitiveTask
* Blueprint 指定的 difficulty
* Blueprint 指定的 assessmentTarget
* Blueprint 指定的 reasoningGoal

不要擅自改变这些内容。

你可以自由设计：

* question
* scenario
* options
* explanation
* 数值
* 代码
* 示例

但只能服务于 Blueprint。

---

# 四、Canonical

Canonical 是这个 Knowledge 的稳定主问题。

它应该：

* 自包含
* 长期有效
* 不依赖网页
* 不依赖原文
* 体现核心知识
* 有明确最佳答案
* 具有面试价值

优先测试：

* 核心机制
* 因果关系
* 重要判断
* 常见误区
* 工程 trade-off
* 边界条件

避免单纯定义背诵。

---

# 五、Variant

Variant 必须：

**和 canonical 测试同一个 Knowledge，但使用不同的 reasoning path。**

可以通过改变：

* observable evidence
* reasoning direction
* constraint
* engineering context
* angle
* cognitiveTask

实现。

不能只是：

* 换数字
* 换公司
* 换人物
* 换代码
* 换背景
* 同义改写

写完 variant 后，内部检查：

> 如果学习者已经答对 canonical，他是否还需要进行明显不同的思考才能答对 variant？

如果不需要：

**重新设计 variant。**

---

# 六、题目设计

题目必须：

* 自包含
* 信息充分
* 逻辑明确
* 不依赖原文
* 不依赖上下文
* 真正需要思考

优先让学习者：

* 从现象推断机制
* 根据条件预测行为
* 比较方案
* 分析 trade-off
* 定位故障
* 判断边界
* 识别错误解释
* 根据约束选择架构

避免：

> “X 是什么？”

除非这个定义本身就是该知识最重要的面试目标。

---

# 七、选择题

默认：

`single-choice`

只有 Blueprint 明确需要多个同时成立的条件时，才使用：

`multiple-choice`

单选必须只有一个最佳答案。

---

# 八、Distractor

这是高优先级要求。

每个错误选项必须是：

**合理但错误。**

优先来源：

* 常见误解
* 概念混淆
* 因果倒置
* 条件遗漏
* 适用范围错误
* trade-off 判断错误
* plausible engineering mistake

不要制造：

* 虚构的技术机制
* 明显不符合事实的 GPU / CUDA 行为
* 不存在的 framework 行为
* 与题目无关的名词
* 一眼就知道是错的答案

错误选项应该像：

> 一个“懂一些，但理解不完整”的工程师可能做出的判断。

---

# 九、正确答案公平性

所有选项尽量：

* 长度接近
* 信息密度接近
* 语法结构接近

特别禁止：

> 正确答案完整解释整个理论链，而错误答案只是半句话。

不要让：

> “最长的就是正确答案”。

完整理论放进 `explanation`，不要全部塞进正确选项。

---

# 十、Explanation

`explanation` 必须：

1. 解释正确答案为什么成立。
2. 指出关键错误项为什么错误。
3. 与题目严格一致。
4. 不引入题干没有提供的关键假设。
5. 不为了显得专业而堆公式。
6. 区分理论结论、具体实现和工程实践。

涉及：

* 论文
* framework
* kernel
* routing
* hardware
* numerical precision
* training strategy

时，必须保留必要限定。

不要把某个特定实现的行为写成所有实现都必然如此。

避免无依据的绝对表述：

* 一定
* 必然
* 完全
* 自动
* 永远
* 只能

只有在题目条件足以保证该结论时才使用。

---

# 十一、数学与公式

需要公式时可以使用 LaTeX。

例如：

`$O(n^2d)$`

或：

`$\sqrt{d_k}$`

公式必须准确。

不要为了显得高级而加入不必要的公式。

---

# 十二、工程场景

只有当场景真正参与推理时才使用。

好的：

> 给出 sequence length、显存和 bandwidth，让候选人判断架构。

不好的：

> “某公司的工程师发现问题”，但最后仍然只是问定义。

---

# 十三、Quantitative

如果 Blueprint 是 quantitative：

优先：

* 趋势
* 比例
* 多变量变化
* 边界条件
* 反事实

不要让多个 variant 都只是“换一组数字重新计算”。

可以有直接计算题，但要控制比例。

---

# 十四、Difficulty

### easy

核心概念和直接机制。

### medium

条件变化、比较、基础工程应用、常见故障。

### hard

多约束、trade-off、边界、复杂诊断、架构选择、综合推理。

**不要用题目长度制造 hard。**

Variant 不要求比 canonical 更难。

---

# 十五、Concept 数量

通常：

**1 个核心 Concept + 1～3 个辅助 Concept。**

不要堆砌十几个概念。

---

# 十六、Self-contained

最终题目必须脱离当前网页独立成立。

禁止：

* “根据文章”
* “根据上文”
* “作者认为”
* “上述方法”
* “前文所述”

完成作答所需的信息必须存在于题目本身。

---

# 十七、最终质量检查

每道题输出前内部检查：

### Knowledge

是否仍然测试 Blueprint 指定 Knowledge？

### Reasoning

是否真的需要推理，而不是换一种形式背诵？

### Variant

是否真的不同？
还是只是换场景？

### Accuracy

事实、公式、因果关系是否准确？

### Distractors

错误项是否 believable？
是否存在荒谬选项？

### Fairness

正确答案是否明显更长？

### Difficulty

难度是否来自认知要求？

### Chinese Quality

中文是否自然？
是否像真正的中文技术面试题？
是否存在明显翻译腔？

### Self-contained

脱离网页是否仍然能够独立作答？

发现关键问题时：

**重新设计该题，不要输出明显有问题的版本。**

---

# 十八、输出格式

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
"type": "single-choice | multiple-choice | open",
"options": [
{
"key": "A",
"text": "..."
}
],
"answer": "A"
}
]
}
]

必须满足：

* 所有面向用户的自然语言内容使用中文
* 标准技术术语可以使用英文
* canonical 的 `variantOf` = `null`
* variant 的 `variantOf` 指向真实 canonical id
* canonical 与 variant 使用相同 `knowledgeId`
* 所有 id 唯一
* answer 对应真实 option
* JSON 合法
* 不产生 Blueprint 之外的新 Knowledge
* 不产生伪 variant

最终原则：

**准确、自然的中文 > 直译**

**真正不同的测量方式 > 换场景改写**

**合理错误项 > 荒谬错误项**

**理解与迁移 > 定义背诵**

**高价值少量题 > 大量重复题**
