# AI / ML 技术文章 → 高质量面试选择题生成 Prompt

## 任务

你会收到一篇 AI / ML / LLM / Agent / AI Systems 技术文章。

你的任务不是总结文章，也不是测试读者是否记得文章内容，而是：

> **从文章中识别具有长期面试价值的 Knowledge / Concept / Subtopic，并将其转化为高质量、可独立理解的面试选择题。**

题目用于 AI Engineer / ML Engineer / LLM Engineer / Agent Engineer / AI Systems 等岗位的能力训练。

**文章只是知识来源，不是题目的上下文来源。考生默认没有读过原文章。**

---

## 一、生成数量

每篇文章生成 **5～13 道题**。

根据文章的知识密度决定数量：

- 内容较少：5～7 道
- 内容中等：8～10 道
- 内容丰富：11～13 道

不要为了凑数量而：

- 重复 Concept
- 重复 Angle
- 制造低价值基础题
- 人为增加选项
- 编造文章没有依据的专业结论

---

## 二、出题原则

先内部完成：

1. 阅读并理解文章。
2. 识别高价值 Knowledge / Concept / Subtopic。
3. 判断面试价值。
4. 为重要 Concept 选择合适的 Angle 和认知任务。
5. 生成题目并检查质量。

优先考察：

- 核心知识
- 机制与因果关系
- 典型误解
- 工程判断
- 方案比较与 trade-off
- 设计与系统架构
- Debugging
- 实际应用

不要平均覆盖文章，也不要按文章段落顺序机械出题。

每道题默认围绕 **1 个核心 Concept**，最多增加少量 supporting / prerequisite Concepts。题目应具有明确的诊断价值。

---

## 三、题目类型

全部生成选择题，**多选题优先，但不得强行多选**。

规则：

- `single`：恰好 1 个正确答案
- `multiple`：至少 2 个正确答案
- 4～6 个选项
- `answer` 使用 0-based integer array
- 不使用 A/B/C/D 或答案文本作为 `answer`

对于多选题，所有正确项必须在题干约束下成立，错误项必须能够明确排除，不能存在多个合理答案集合。

---

## 四、考察角度

每道题选择一个主要 `angle`：

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
````

不需要覆盖所有 Angle。

同一 Concept 生成多题时，应尽量使用不同 Angle 和不同认知任务。

例如：

```text
Concept = KV Cache

题 1 → mechanism
题 2 → tradeoff
题 3 → debugging
```

而不是重复定义。

---

## 五、架构设计题

当文章本身提供足够的工程信息时，可以优先生成 `design` / `system-design` 题，例如：

* RAG
* Agent / Multi-Agent
* MCP
* Memory
* Context Engineering
* Model Serving
* AI Gateway / Infrastructure
* Evaluation / Observability
* Security
* Multimodal
* Training / Post-training infrastructure

架构题必须通过场景约束考察工程判断，而不是简单问“哪个技术更好”。

可以包含：

* 业务目标
* 数据规模
* 流量
* 延迟
* 成本
* 一致性
* 可靠性
* 安全
* 状态
* 可观测性
* Evaluation

`system-design` 至少涉及 3 个**真正影响方案选择**的维度，不要机械罗列。

工程场景可以构造，但决定答案的核心技术事实必须能够从文章可靠推导，不能凭空加入 benchmark、产品行为、性能数字或关键专业结论。

---

## 六、Self-contained

删除原文章后，每道题仍必须能够独立理解。

避免：

* “文中提到……”
* “根据本文……”
* “作者认为……”
* “上述方法……”
* “前文所述……”

如果需要背景，将回答所需的最小 context 写进题干。

禁止生成阅读理解题，例如：

* “文章介绍了哪些技术？”
* “作者认为最大的挑战是什么？”
* “文中使用了什么方法？”

除非该事实本身就是不可替代的专业知识。

---

## 七、选项设计

正确答案不得因为形式特征明显暴露：

* 更长
* 更具体
* 更严谨
* 专业术语更多
* 限定条件更多
* 信息量更多
* 语气更谨慎

所有选项尽量处于相同决策层级。

错误选项应来自真实的技术误解或工程误判，例如：

* 混淆相邻概念
* 忽略必要条件
* 忽略 trade-off
* 忽略系统瓶颈
* 把局部优化当成系统优化
* 把 benchmark 当生产结论
* 把训练阶段结论迁移到推理阶段
* 把相关性当成因果关系

禁止明显荒谬的干扰项。

---

## 八、Explanation

每道题必须有简短但有技术含量的 `explanation`。

应说明：

* 为什么正确
* 核心原理
* 必要时的 trade-off 或典型 misconception

不要逐字复述文章，也不要写成完整教程。

---

## 九、Evidence 与 Diagnostic Value

每道题必须满足：

* 正确答案的核心技术依据能够从文章知识可靠推出。
* 不依赖文章之外未经说明的重要事实。
* 能较明确地反映考生缺失的 Concept、机制或工程判断。

不要因为某个 Concept 尚未覆盖就强行生成题目；**知识覆盖不是生成低价值题的理由。**

---

## 十、最终检查

输出前逐题检查：

1. **Self-contained**：脱离文章仍能理解。
2. **Concept**：有明确核心 Concept，范围不过大。
3. **Angle**：主要考察角度明确。
4. **Interview Value**：具有长期面试价值。
5. **Reasoning**：优先考察理解、判断、应用或工程能力，而非机械记忆。
6. **Evidence**：答案有可靠知识依据。
7. **Deterministic Answer**：正确答案唯一且无歧义。
8. **Option Balance**：正确答案没有形式优势。
9. **Wrong Options**：错误项技术上可信。
10. **Diagnostic Value**：答错能够反映明确的知识或能力缺口。
11. **Duplication**：与其他题不是简单换句话说。
12. **Multiple Validity**：多选题的正确选项集合明确。

发现问题，直接重新设计该题，不要解释。

---

## 十一、输出 JSON Schema

最终只输出一个 JSON Array：

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

### 字段规则

`difficulty`：

```text
easy
medium
hard
```

`angle`：

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

`choice.type`：

```text
single
multiple
```

`options`：4～6 个。

`answer`：0-based integer array。

`knowledgeId`：题目主要依赖的知识节点。

`concepts`：题目真正考察的 Concept，第一个元素必须是核心 Concept。

---

## 十二、输出要求

**最终必须生成 5～13 道题。**

最终只输出 JSON Array。

不得输出：

* 分析过程
* Concept 列表
* Markdown
* 代码围栏
* 题目统计
* 额外说明
* JSON 之外的任何内容

