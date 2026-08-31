# AI / ML 技术文章 → 高质量面试选择题生成 Prompt

## 任务

你会收到一篇 AI / ML / LLM / Agent / AI Systems 技术文章。

你的任务不是总结文章，也不是测试读者是否记得文章内容，而是：

> **从文章中识别具有长期面试价值的知识点（Concept / Subtopic），然后把这些知识点转化为高质量、可独立理解的面试选择题，注意多选题为主。**

题目用于 AI Engineer / ML Engineer / LLM Engineer / Agent Engineer / AI Systems 等岗位的能力训练。

文章只是**知识来源**，不是题目的上下文来源。

考生默认**没有读过原文章**。

---

## 一、出题原则

先内部完成以下过程，再输出最终题目：

1. 阅读并理解文章。
2. 识别其中值得考察的 Concept / Subtopic。
3. 判断哪些 Concept 具有较高的面试价值。
4. 优先选择：

   * 核心知识
   * 能区分理解深度的知识
   * 容易出现典型误解的知识
   * 能考察机制、因果关系的知识
   * 能考察工程判断的知识
   * 能考察方案比较和 trade-off 的知识
   * 能形成架构设计判断的知识
   * 能通过现象进行 debugging 的知识
5. 一个 Concept 可以生成多道题，但不同题必须考察不同角度。
6. 不要平均覆盖文章。
7. 不要按照文章段落顺序出题。
8. 不要因为文章某一段很长，就机械地产生更多题。
9. 不要为了凑题数而加入低价值基础题。

---

## 二、题目类型

所有输出必须是选择题，多选题为主。但也不要为了“多选优先”把本来更适合单选的问题强行改成多选。

每道题必须包含：

* 单选 `single`
* 或多选 `multiple`

规则：

* 最少 4 个选项
* 最多 6 个选项
* `single` 必须只有 1 个正确答案
* `multiple` 必须至少有 2 个正确答案
* 正确答案使用 **0-based option index**
* 不允许使用 A/B/C/D 作为最终 answer 值
* 不允许使用答案文本作为 answer 值

---

## 三、考察角度

每道题必须选择一个最主要的 `angle`：

* `definition`
* `fundamental`
* `mechanism`
* `comparison`
* `calculation`
* `tradeoff`
* `scenario`
* `debugging`
* `system-design`
* `design`

### definition

考察准确术语定义。

### fundamental

考察基础原理和核心概念。

### mechanism

考察内部机制、工作过程和因果关系。

### comparison

比较不同方法、架构、算法或方案。

### tradeoff

考察方案取舍、优缺点和适用边界。

### scenario

给出真实工程场景，要求进行判断。

### debugging

根据故障现象、指标或异常结果定位原因。

### design

组件 / 模块级设计。

### system-design

完整系统或较大范围架构设计，包括：

* 架构选型
* 组件边界
* 数据流
* 控制流
* 状态管理
* 扩展性
* 可靠性
* 性能
* 成本
* 安全
* 可观测性
* 运维
* 演进路径

### calculation

涉及计算、复杂度、显存、吞吐、token、延迟、概率、资源关系等定量判断。

不要强制覆盖所有 angle。

同一个 Concept 如果生成多题，应尽量使用互补角度。

例如：

错误：

* Transformer 是什么？
* Transformer 的核心是什么？
* Transformer 为什么重要？

正确：

* self-attention 的机制
* MHA / MQA / GQA 的区别
* KV cache 对显存和吞吐的影响
* 长上下文性能问题
* 实现中的常见错误
* serving architecture trade-off

---

## 四、特别增加：架构设计题

对于下面这些内容，只要文章中存在足够信息，应优先考虑生成 `design` 或 `system-design` 题：

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
* Multimodal
* Training / Post-training infrastructure
* AI application architecture

### 架构题不能只问“哪个方案更好”

必须建立一个完整的工程约束。

题干最好包含：

* 业务目标
* 输入规模
* 数据类型
* 延迟要求
* 成本约束
* 一致性 / 正确性要求
* 安全约束
* 可用性要求
* 流量规模
* 模型能力边界

然后让候选人选择：

* 架构
* 组件职责
* 数据流
* 控制流
* 状态管理
* fallback
* cache
* evaluation
* observability
* human-in-the-loop
* security boundary
* deployment strategy

### 架构题必须考“为什么”

错误：

> RAG 应该使用什么组件？

正确：

> 一个企业知识库每天新增 100 万文档，查询要求 p95 < 2 秒，同时需要保证引用可追溯。以下哪种架构最合理？

题目必须让候选人根据约束进行工程判断，而不是背诵名词。

---

## 五、题目必须 Self-contained

假设考生完全没有阅读原文章。

删除原文章后，每道题仍然必须能够独立理解。

必须避免：

* “文中提到……”
* “根据本文……”
* “上述方法……”
* “作者认为……”
* “前文所述……”
* “这个方案……”
* “该模型……”
* “这种方式……”

除非前文对象已经在当前题干中明确描述。

如果必须依赖文章中特定背景：

> 把回答所需的最小 context 写进题干。

但不要复制文章。

---

## 六、不要生成“阅读理解题”

禁止：

* “文章中提到了哪三个方法？”
* “作者认为最大的挑战是什么？”
* “文中使用了哪个指标？”
* “这篇文章介绍了哪些技术？”
* “下面哪项是文章中的结论？”

除非该事实本身就是不可替代的专业知识。

题目应该考：

* 为什么
* 怎么工作
* 什么情况下成立
* 什么情况下失败
* 如何选择
* 如何设计
* 如何 debug
* 如何扩展
* 有什么 trade-off

---

## 七、选择题选项设计

这是非常重要的约束。

### 1. 正确答案不能有形式优势

正确选项不得因为以下因素而明显暴露：

* 更长
* 更具体
* 更严谨
* 专业术语更多
* 限定条件更多
* 语气更加谨慎
* 信息量更多

错误答案也必须是：

> **技术上看起来可信，但存在明确错误或条件缺失的工程判断。**

---

### 2. 错误选项必须来源于真实误解

优秀的错误选项通常来自：

* 混淆两个相邻概念
* 把必要条件遗漏
* 把充分条件当成必要条件
* 忽略系统瓶颈
* 忽略 trade-off
* 把训练阶段结论错误迁移到推理阶段
* 把 benchmark 结果误认为生产结果
* 把局部优化误认为系统优化
* 把理论最优方案误认为工程最优方案
* 把安全措施和功能控制混在一起
* 把概率相关性误认为因果关系

禁止明显荒谬的错误答案。

---

### 3. 所有选项保持平衡

同一题中的选项尽量：

* 长度接近
* 信息密度接近
* 专业程度接近
* 句式接近
* 语气接近

例如不要：

正确：

> 在检索后通过 reranking 重新排序候选文档，并结合 query intent 和 latency budget 动态选择 top-K……

错误：

> 直接使用向量检索。

这种差异会暴露答案。

---

## 九、解释 explanation

每道题必须给出简短但有技术含量的 `explanation`。

解释应该：

* 说明为什么正确
* 指出核心原理
* 必要时指出关键 trade-off
* 不要逐字复述文章
* 不要写成完整教程
* 不要引用“本文”

解释应该帮助训练者理解答案，而不是只是说：

> “因为 B 是正确的。”

---

## 十、Concept 与题目选择策略

生成之前，在内部识别 Concept。

优先级：

### P0

必须掌握、面试高频、具有强区分度。

### P1

重要工程能力或典型实践。

### P2

补充性知识。

最终题目优先来自 P0 和 P1。

不要为了覆盖所有 Concept 而牺牲题目质量。

---

## 十一、同一个 Concept 必须多维考察

如果一个 Concept 很重要，可以生成 2～3 道题，但必须满足：

```text
同一个 Concept
+
不同 Angle
+
不同认知任务
```

例如：

```text
Concept = KV Cache

题 1 → mechanism
题 2 → tradeoff
题 3 → debugging
```

而不是：

```text
题 1 → 什么是 KV Cache
题 2 → KV Cache 是什么
题 3 → KV Cache 的定义
```

---

## 十二、架构设计问题的特殊要求

如果题目属于：

```text
angle = design
```

重点应该是：

> 单个组件或局部技术决策。

例如：

* chunking strategy
* embedding model selection
* reranker placement
* cache strategy
* tool permission
* queue choice

如果题目属于：

```text
angle = system-design
```

必须至少涉及其中 3 个维度：

* architecture
* data/control flow
* scalability
* latency
* reliability
* cost
* security
* observability
* state
* deployment
* evaluation

并且必须包含明确约束。

---

## 十三、不要把“架构正确”写成唯一答案的绝对真理

AI 系统通常存在多个合理方案。

因此架构题的正确答案必须体现：

> 在给定约束下，这个方案为什么最合适。

不要写成：

> “RAG 一定应该这样设计。”

而应该通过场景约束让一个方案明显更匹配。

---

## 十四、AI / LLM / Agent 类题目特别关注

对于文章涉及以下主题时，优先考虑工程判断：

### LLM

* tokenization
* context window
* sampling
* scaling
* reasoning
* hallucination
* training
* post-training
* inference

### RAG

* chunking
* retrieval
* reranking
* hybrid search
* context construction
* citation
* evaluation
* ingestion architecture

### Agent

* agent loop
* tool calling
* planning
* memory
* state
* multi-agent
* MCP
* human-in-the-loop
* failure recovery

### Context Engineering

* context selection
* compaction
* dynamic context
* tool context
* memory/context boundary
* context budget
* prompt caching
* long-horizon state
* untrusted context

### AI Systems

* model gateway
* provider abstraction
* routing
* fallback
* caching
* streaming
* queue
* observability
* evaluation
* reliability
* cost
* latency
* deployment

### AI Security

* prompt injection
* indirect injection
* data leakage
* tool authorization
* sandboxing
* agent permissions
* supply chain
* auditability

---

## 十五、输出 JSON Schema

最终只输出一个 JSON Array。

每道题使用以下结构：

```json
[
  {
    "id": "unique-question-id",
    "category": "taxonomy-domain",
    "topic": "topic-id",
    "tags": [
      "concept-tag",
      "engineering-tag"
    ],
    "difficulty": "medium",
    "angle": "tradeoff",
    "question": "题目的核心知识问题。",
    "explanation": "解释为什么正确，并说明关键原理或 trade-off。",
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "选项 1",
          "选项 2",
          "选项 3",
          "选项 4"
        ],
        "answer": [2],
        "question": "如果选择题需要特殊题干，可填写；通常与顶层 question 相同或省略。"
      }
    }
  }
]
```

### 格式规则

`difficulty` 只能是：

```text
easy
medium
hard
```

`angle` 只能是：

```text
definition
fundamental
mechanism
comparison
calculation
tradeoff
scenario
debugging
system-design
design
```

`choice.type` 只能是：

```text
single
multiple
```

`options`：

```text
4～6 个
```

`answer`：

```text
0-based integer array
```

例如第三个选项正确：

```json
"answer": [2]
```

如果第 1、3、4 项正确：

```json
"answer": [0, 2, 3]
```

---

## 十六、可选 open format

默认任务是生成选择题，因此不要主动生成 `open`。

只有当一道题明显具有很高的开放题价值，并且参考答案能够明确、客观地定义时，才可以同时输出：

```json
"open": {
  "referenceAnswer": "..."
}
```

但不要为了“完整”而给每道选择题都生成 open。

---

## 十七、如果文章只适合生成少量高质量题

宁可输出：

```text
5 道高质量题
```

也不要为了达到某个数量：

* 重复 Concept
* 重复 angle
* 制造低价值定义题
* 人为增加选项
* 编造文章没有依据的重要结论

---

## 十八、最终强制检查

在输出之前，对每一道题逐项检查：

### A. Self-contained

删除原文章后，题目是否仍然可以理解？

### B. Concept

是否明确考察一个核心 Concept？

### C. Angle

是否有明确且唯一的主要考察角度？

### D. Interview value

是否真的适合作为面试题？

### E. Reasoning

是否需要理解、判断或推理，而不是记忆？

### F. Architecture

如果是 design / system-design，是否存在明确工程约束？

### G. Option balance

正确答案是否在长度、语气、专业程度上没有明显优势？

### H. Wrong-option quality

错误选项是否技术上可信？

### I. Answer leakage

考生是否可以通过：

* 长度
* 专业术语数量
* 限定词
* 语气
* 绝对化程度
* 选项结构

猜出答案？

### J. Duplication

同一个 Concept 的其他题是否只是换句话说？

### K. Evidence

是否能够从文章中的知识可靠推导出答案？

发现任何问题：

> 不要解释问题，直接重新设计该题。

最终只输出 JSON Array，不输出分析过程、不输出 Markdown 代码围栏、不输出额外说明。
