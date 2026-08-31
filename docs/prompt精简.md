## 任务

你会收到一篇 AI/ML 技术文章。请将其转化为 **5～13 道高质量面试选择题**，用于训练 AI Engineer / ML Engineer / LLM Engineer / Agent Engineer。

文章只是知识来源，不是题目上下文。目标是考察**理解、机制、工程判断和架构能力**，而不是测试候选人是否读过文章。

先识别文章中的核心 Concept / Subtopic，再选择最有面试价值的部分出题。不要按段落顺序，也不要平均覆盖文章。

优先：

* 核心且长期有效的知识
* 容易产生典型误解的知识
* mechanism / comparison / tradeoff / scenario / debugging / design / system-design
* 能区分理解深度的工程问题

不要为了凑数量生成低价值题。

---

## 考察角度

每题选择一个主要 `angle`：

`definition | fundamental | mechanism | comparison | calculation | tradeoff | scenario | debugging | design | system-design`

同一 Concept 可以有多题，但必须体现**不同认知角度**，不能只是换句话重复。

例如 Transformer：

* self-attention mechanism
* MHA/MQA/GQA comparison
* KV cache trade-off
* 长上下文 debugging
* serving architecture design

---

## Self-contained

考生看不到原文章。

因此每道题删除原文后仍必须独立理解。

禁止使用：

* “文中提到”
* “根据本文”
* “上述方法”
* “作者认为”
* “前文所述”
* 未在题干中定义的“该方案 / 该模型 / 这种方式”

如果必须依赖文章中特定背景，只加入**回答所需的最小 context**。

禁止阅读理解题，例如：

* 文章列出了哪些方法？
* 作者认为最大的挑战是什么？
* 文中使用了哪个指标？

除非该事实本身就是不可替代的专业知识。

---

## 选择题质量

全部使用选择题。

* 4～6 个选项
* `single`：1 个正确答案
* `multiple`：至少 2 个正确答案
* 多选优先，但只在内容自然适合时使用
* `answer` 使用 **0-based index array**

选项必须满足：

1. 正确答案不能因为更长、更严谨、更专业、更具体而暴露。
2. 所有选项保持相近的长度、信息密度、句式和专业程度。
3. 错误选项必须技术上可信，来自真实的概念混淆、条件遗漏或错误 trade-off。
4. 禁止荒谬、明显错误、故意绝对化的干扰项。
5. 正确答案位置随机，不形成固定模式。
6. 不允许通过选项长度、措辞、限定条件、专业术语密度猜答案。

---

## 架构题

文章涉及 RAG、Agent、MCP、Memory、Context Engineering、AI Infrastructure、Serving、Evaluation、Security 等主题时，优先考虑 `design` / `system-design`。

### `design`

考察单个组件或局部技术决策，例如：

* chunking
* embedding
* reranking
* cache
* tool permission
* model routing

### `system-design`

必须包含真实工程约束，例如：

* 规模
* latency
* cost
* reliability
* security
* consistency
* scalability
* state
* observability

要求候选人根据约束选择架构或方案，而不是回答“哪个技术更好”。

不要把某个架构方案写成绝对正确；正确答案应体现“**在给定约束下最合适**”。

---

## Explanation

每题必须有简短的 `explanation`：

* 说明正确答案的核心原因
* 必要时指出关键 trade-off
* 不复述文章
* 不引用“本文”

---

## 输出格式

最终只输出 JSON Array，不要输出分析过程或 Markdown。

```json
[
  {
    "id": "unique-question-id",
    "category": "taxonomy-domain",
    "topic": "topic-id",
    "tags": ["concept", "engineering"],
    "difficulty": "easy|medium|hard",
    "angle": "definition|fundamental|mechanism|comparison|calculation|tradeoff|scenario|debugging|design|system-design",
    "question": "题干",
    "explanation": "答案解释",
    "formats": {
      "choice": {
        "type": "single|multiple",
        "options": [
          "选项1",
          "选项2",
          "选项3",
          "选项4"
        ],
        "answer": [0]
      }
    }
  }
]
```

`options` 只能 4～6 个；`answer` 必须是 0-based index 数组。

---

## 最终检查

输出前逐题检查：

* 删除原文后是否仍能独立作答？
* 是否明确对应一个 Concept + 一个主要 Angle？
* 是否考察理解、应用、判断，而非文章记忆？
* 同一 Concept 的题目是否真正互补？
* 架构题是否包含明确约束？
* 错误选项是否技术上可信？
* 正确答案是否不存在长度、措辞、专业程度等形式优势？
* 是否可以仅凭选项形式猜答案？

发现问题就重写该题。

宁可少出题，也不要降低题目质量。
