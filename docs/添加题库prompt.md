# AI / ML 技术文章 → 高质量面试选择题生成 Prompt

## 任务

你会收到一篇 AI / ML / LLM / Agent / AI Systems 技术文章。

你的任务不是总结文章，也不是测试读者是否记得文章内容，而是：

> **从文章中识别具有长期面试价值的知识点（Knowledge / Concept / Subtopic），再把这些知识点转化为高质量、可独立理解的面试选择题。**

题目用于 AI Engineer / ML Engineer / LLM Engineer / Agent Engineer / AI Systems 等岗位的能力训练。

**文章只是知识来源，不是题目的上下文来源。**

考生默认**没有读过原文章**。

---

## 一、生成数量

**每篇文章必须生成 5～13 道题。**

根据文章的信息密度、知识价值和可形成的独立认知任务决定具体数量：

* 内容较少但质量足够：生成 5 道。
* 内容中等：生成 6～10 道。
* 内容丰富、覆盖多个高价值 Concept：生成 10～13 道。
* **必须在 5～13 道之间。**
* 不得通过重复 Concept、换句话说、制造低价值题来凑数量。
* 如果文章中真正高价值的内容不足以支持 5 道独立高质量题，仍然生成 5 道，但可以从核心 Concept 的不同认知角度进行合理扩展；不得编造文章没有依据的专业事实。

---

## 二、出题原则

先内部完成以下过程，再输出最终题目：

1. 阅读并理解文章。
2. 识别文章中的 Knowledge / Concept / Subtopic。
3. 判断每个 Concept 的面试价值。
4. 为高价值 Concept 识别适合的考察角度。
5. 为每道题建立：

   * 一个核心 Concept
   * 必要的 supporting concepts
   * 一个主要 Angle
   * 一个明确的认知任务
6. 再生成最终题目。

优先选择：

* 核心知识
* 面试高频知识
* 能区分理解深度的知识
* 容易出现典型误解的知识
* 能考察机制和因果关系的知识
* 能考察工程判断的知识
* 能考察方案比较和 trade-off 的知识
* 能形成架构设计判断的知识
* 能通过现象进行 debugging 的知识

不要：

* 平均覆盖文章
* 按文章段落顺序出题
* 因某一段很长就机械增加题目
* 为了覆盖所有 Concept 而牺牲质量
* 为了凑满 13 道题制造低价值问题

**未覆盖某个 Concept 本身不是生成题目的充分理由。只有当该 Concept 具有足够的知识重要性、面试价值，或能与已有题形成有意义的互补认知任务时，才生成题目。**

---

## 三、Knowledge / Concept 结构

每道题必须围绕**一个核心 Concept**。

默认：

* 1 个 core Concept
* 0～2 个 supporting / prerequisite Concepts

除非题目属于 `comparison`、`design` 或 `system-design`，否则不要同时要求考生掌握多个独立 Concept 才能作答。

每道题必须能够明确回答：

> **这道题到底在测什么？**

不要生成同时覆盖大量知识点、导致无法诊断考生具体缺口的“大杂烩题”。

**Concept Scope 约束**：每道题只测一个可通过作答结果诊断的核心 Concept；supporting / prerequisite Concepts 必须直接参与该核心 Concept 的判断，而不是把多个独立主题并列堆砌。判断方法：若去掉某个 Concept 后题干与选项仍然成立，说明该 Concept 属于多余混入，应当删除或拆题。

---

## 四、题目类型

所有输出必须是选择题。

**多选题优先，但不能强行多选。**

每道题：

* `single`：只有 1 个正确答案。
* `multiple`：至少 2 个正确答案。
* 最少 4 个选项。
* 最多 6 个选项。
* 正确答案使用 **0-based option index**。
* 不允许使用 A/B/C/D 作为最终 answer 值。
* 不允许使用答案文本作为 answer 值。

对于 `multiple`：

* 所有正确选项必须在当前题干约束下同时成立。
* 所有错误选项必须能够被明确排除。
* 不得因为“通常也可能有帮助”就把有条件成立的选项加入正确答案。
* 不得制造多个合理但无法区分的正确答案集合。

**Answer Determinism 约束**：在题干给出的约束范围内，正确答案（或正确答案集合）必须唯一且稳定，不存在“在某种未写出的前提下也成立”的模糊项。对于 `single`，必须恰好有一个选项在任何合理技术解释下都正确，其余选项必须在该题干下明确错误。对于 `multiple`，每个正确选项都必须**独立成立**（不是只在“所有正确项捆绑”时才成立），每个错误选项都必须能被**独立、可解释地排除**（不是仅仅“不在正确答案集合里”）。不得依赖题干未写出的隐藏前提来制造唯一答案。

---

## 五、考察角度

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

只在术语定义本身具有明显面试价值、容易产生典型误解，或是后续知识的必要基础时使用。

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

组件 / 模块级设计，例如：

* chunking strategy
* embedding model selection
* reranker placement
* cache strategy
* tool permission
* queue choice

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

不要强制覆盖所有 angle。

同一个 Concept 如果生成多题，应尽量使用**不同认知任务 + 互补 Angle**。

例如：

```text
Concept = KV Cache

题 1 → mechanism
题 2 → tradeoff
题 3 → debugging
```

而不是：

```text
什么是 KV Cache？
KV Cache 是什么？
KV Cache 的定义是什么？
```

---

## 六、架构设计题

对于以下主题，当文章本身提供了足够的机制、工程约束、架构关系或 trade-off 时，优先考虑 `design` 或 `system-design`：

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

**不要因为文章提到了某项技术，就强行制造架构题。**

### 架构题不能只问：

> 哪个方案更好？

必须建立工程约束。

题干可以包含：

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

### 关键约束

**工程场景可以构造，但决定正确答案的核心技术事实不能凭空构造。**

允许：

> 为了测试 RAG 架构判断，构造一个合理的企业知识库场景。

不允许：

> 文章没有任何依据，却自行加入未经说明的产品特性、benchmark、具体性能数字或专业结论，并让这些新事实决定答案。

架构题必须让候选人根据约束进行工程判断，而不是背诵名词。

错误：

> RAG 应该使用什么组件？

正确：

> 一个企业知识库每天新增 100 万文档，查询要求 p95 < 2 秒，同时需要保证引用可追溯。以下哪种架构最合理？

---

## 七、system-design 的特殊要求

`system-design` 题必须：

1. 有明确工程场景和约束。
2. 至少涉及 **3 个真正影响最终方案选择的工程维度**。

可选维度：

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

不要为了满足数量机械罗列 3 个维度。

每个维度都必须实际影响方案选择。

---

## 八、不要把“架构正确”写成唯一绝对真理

AI 系统通常存在多个合理方案。

正确答案必须表达：

> **在给定约束下，这个方案为什么最合适。**

不要写：

> RAG 一定应该这样设计。

应该通过明确约束，使一个方案明显比其它方案更匹配。

---

## 九、题目必须 Self-contained

假设考生完全没有阅读原文章。

删除原文章后，每道题仍然必须能够独立理解。

禁止：

* “文中提到……”
* “根据本文……”
* “作者认为……”
* “前文所述……”
* “上述方法……”
* “这个方案……”
* “该模型……”
* “这种方式……”

除非对象已经在当前题干中明确描述。

如果必须依赖文章中特定背景：

> 把回答所需的最小 context 写进题干。

但不要复制文章。

---

## 十、不要生成“阅读理解题”

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

## 十一、选择题选项设计

### 1. 正确答案不能有形式优势

正确选项不得因为以下因素明显暴露：

* 更长
* 更具体
* 更严谨
* 专业术语更多
* 限定条件更多
* 语气更加谨慎
* 信息量更多

选项应尽量处于**同一决策层级**。

禁止这种结构：

```text
A. 使用向量检索。
B. 使用混合检索。
C. 使用混合检索，再通过 reranking、query intent 和 latency budget 动态决定 top-K，并加入缓存和 fallback。
D. 随机抽取文档。
```

C 不能因为“描述得最完整”自然成为答案。

**Option-level consistency 约束**：所有选项应处于同一决策层级与抽象粒度。正确答案不能因为“更完整 / 包含更多组件 / 列出更多条件”而自然胜出；难度应来自技术判断（判断哪个方案 / 机制在给定约束下成立），而不是来自正确选项承载了更多信息量。若去除某一选项多出来的信息量后它不再明显优于其它选项，说明该题难度建立在信息量而非判断上，应当重写。

---

### 2. 错误选项必须来源于真实误解

优秀的错误选项通常来自：

* 混淆两个相邻概念
* 遗漏必要条件
* 把充分条件当成必要条件
* 忽略系统瓶颈
* 忽略 trade-off
* 把训练阶段结论迁移到推理阶段
* 把 benchmark 结果当成生产结论
* 把局部优化当成系统优化
* 把理论最优当成工程最优
* 把安全措施和功能控制混在一起
* 把概率相关性当成因果关系
* 忽略状态、一致性、成本、可观测性等实际约束

禁止明显荒谬、幼稚的错误选项。

---

### 3. 选项平衡

同一题中的选项尽量：

* 长度接近
* 信息密度接近
* 专业程度接近
* 句式接近
* 语气接近

正确答案不应天然具有更高的信息量。

---

### 4. 不得依赖“绝对化措辞”制造答案

不要通过：

* 一定
* 永远
* 完全
* 任何情况下
* 必然
* 从不

让错误答案变得过于容易识别。

除非绝对化本身就是被考察的错误认知。

---

## 十二、Explanation

每道题必须有简短但有技术含量的 `explanation`。

解释应该：

* 说明为什么正确
* 指出核心原理
* 必要时指出关键 trade-off
* 必要时指出典型错误选项代表的 misconception
* 不要逐字复述文章
* 不要写成完整教程
* 不要引用“本文”

不要写：

> 因为 B 是正确答案。

优先使用：

> 核心原因 + 关键机制 + 必要时的 trade-off / misconception。

---

## 十三、Concept 与题目选择策略

内部为 Concept 建立优先级：

### P0

* 必须掌握
* 面试高频
* 强区分度
* 对理解后续知识很重要

### P1

* 重要工程能力
* 典型实践
* 常见工程判断

### P2

* 补充性知识

最终题目优先来自 P0 和 P1。

不要为了覆盖所有 Concept 而牺牲题目质量。

**“这个 Concept 还没有题”不是单独生成题目的理由。**

---

## 十四、同一个 Concept 必须多维考察

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

题目之间必须存在真实的诊断差异。

---

## 十五、AI / LLM / Agent 特别关注

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

## 十六、Evidence Boundary

这是强制约束。

正确答案依赖的核心技术事实必须：

* 能够从文章可靠推出；或
* 是该文章明确提供的专业知识背景。

不能：

* 编造 benchmark
* 编造性能数字
* 编造产品行为
* 编造未提及的技术结论
* 通过文章之外的重要事实强行制造唯一答案

允许为了 Self-contained 增加解释性背景，但**新增背景不得成为决定正确答案的关键未知事实**。

---

## 十七、Diagnostic Value

每道题都应该有明确的诊断价值。

生成前判断：

> 如果考生答错，我是否能够 reasonably 判断他缺少哪个 Concept、机制、工程判断或典型 misconception？

高价值：

```text
考察 GQA 与 MQA 的机制差异
```

低价值：

```text
考察是否记得某个博客用了哪个术语
```

优先生成能够提供 Learner Evidence 的题目。

如果一道题做错了，但考生和出题者都无法判断具体缺在哪（哪个 Concept、机制或工程判断），说明该题诊断价值较低。

---

## 十八、Question Value

优先生成能够区分：

> “知道术语”
> 和
> “真正理解机制 / 能应用 / 能做工程判断”

的题目。

高价值题通常让：

* 不理解核心机制的人容易被一个合理错误项吸引；
* 真正理解的人可以稳定排除干扰项；
* 不能仅凭长度、术语数量、绝对化措辞或答案完整程度猜出答案。

---

## 十九、不要把文章变成题目列表

不要采用：

```text
文章第 1 节 → 题 1
文章第 2 节 → 题 2
文章第 3 节 → 题 3
```

应该采用：

```text
Article
 ↓
Knowledge
 ↓
Core Concepts
 ↓
Interview Value
 ↓
Concept × Angle × Cognitive Task
 ↓
Questions
```

---

## 二十、最终强制检查

输出之前逐题检查：

### A. Self-contained

删除原文章后，题目是否仍然可以理解？

### B. Core Concept

是否明确考察一个核心 Concept？

### C. Concept Scope

是否避免混入过多独立 Concept？

### D. Angle

是否存在明确且唯一的主要考察角度？

### E. Interview Value

是否真的适合作为面试题？

### F. Reasoning

是否优先考察理解、判断、应用、比较或工程判断，而不是机械记忆？

### G. Architecture

如果是 `design` / `system-design`，是否存在明确工程约束？

### H. Evidence

正确答案的关键技术依据是否来自文章知识或文章明确提供的可靠背景？

### I. Answer Determinism

正确答案或正确答案集合是否唯一、稳定、无歧义？

### J. Option Balance

正确答案是否在长度、语气、专业程度、信息量上没有明显优势？

### K. Wrong-option Quality

错误选项是否技术上可信，并代表真实 misconception 或工程误判？

### L. Answer Leakage

考生是否可以通过：

* 长度
* 专业术语数量
* 限定词
* 语气
* 绝对化程度
* 选项结构
* 信息完整程度

猜出答案？

### M. Duplication

与其它题相比，是否只是换句话说？

### N. Diagnostic Value

答错后是否能够较明确地反映知识或能力缺口？

### O. Multiple-choice Validity

多选题的所有正确选项是否在题干约束下同时成立，所有错误选项是否都能明确排除？

发现任何问题：

> 不要解释问题，直接重新设计该题。

---

# 二十一、输出 JSON Schema

最终只输出一个 JSON Array。

```json
[
  {
    "id": "unique-question-id",
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
        "answer": [2]
      }
    }
  }
]
```

---

## 二十二、字段规则

### `difficulty`

只能是：

```text
easy
medium
hard
```

### `angle`

只能是：

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

### `choice.type`

只能是：

```text
single
multiple
```

### `options`

4～6 个。

### `answer`

0-based integer array。

例如第三个选项正确：

```json
"answer": [2]
```

例如第 1、3、4 项正确：

```json
"answer": [0, 2, 3]
```

### `knowledgeId`

对应题目主要依赖的知识节点。

### `concepts`

列出题目真正考察的 Concept。

要求：

* 第一个元素必须是核心 Concept。
* 默认 1 个核心 Concept。
* 必要时增加少量 supporting / prerequisite Concept。
* 不要把普通标签全部放进 `concepts`。

### `tags`

用于分类和检索，不代替 `concepts`。

---

## 二十三、关于题目数量

**最终必须输出 5～13 道。**

推荐分布：

```text
5～7 题：
文章较短 / 核心知识集中

8～10 题：
文章内容中等 / 多个高价值 Concept

11～13 题：
文章内容丰富 / 多个高价值 Concept + 多种认知角度
```

题目数量由**高价值知识密度**决定，而不是文章长度决定。

---

## 二十四、输出格式

最终只输出：

```text
JSON Array
```

不得输出：

* 分析过程
* Concept 列表
* 设计说明
* Markdown
* 代码围栏
* 题目统计
* 额外解释
* JSON 之外的任何内容

**必须生成 5～13 道题。**
