可以，而且我建议你把它设计成 **“Course → Course Question Bank”独立生产管线**，不要把公开课程直接塞进当前 AI Trainer 的 `questionBank`。

核心思想是：

> **课程是知识来源（source），题库是课程知识的结构化评估层（assessment artifact），AI Trainer 是另一个消费方。**

这样可以避免你现在的“面试题 taxonomy / Concept×Angle”把课程内容强行面试化。

---

# 一、先确定最终产物

假设你发现一个 MIT / Harvard / Stanford 的公开课程：

```text
MIT 6.S191
Introduction to Deep Learning
```

不要直接：

```text
course
  ↓
LLM
  ↓
questions.json
```

而应该：

```text
                    Course
                      │
          ┌───────────┴───────────┐
          │                       │
      metadata                 materials
          │                       │
          │            ┌──────────┼──────────┐
          │            ▼          ▼          ▼
          │         lectures    notes      slides
          │
          └──────────────┬──────────────────┘
                         ▼
                 Knowledge Extraction
                         │
                         ▼
                 Course Knowledge Map
                         │
                         ▼
                Question Blueprint
                         │
                         ▼
                 Question Generation
                         │
                         ▼
                 Question Validation
                         │
                         ▼
              Course Question Bank
```

最终得到的是一个**独立的数据集**：

```text
data/courses/
  mit-6s191/
    course.json
    knowledge.json
    questions.json
    sources.json
    coverage.json
```

而不是：

```text
data/questions/
   ...
   mit-course-question-123.json
```

---

# 二、Step 1：先建立 Course Manifest

第一步不要生成题。

先把课程本身定义下来。

例如：

```json
{
  "id": "mit-6s191",
  "title": "Introduction to Deep Learning",
  "provider": "MIT",
  "year": 2025,
  "url": "...",
  "language": "en",
  "description": "...",
  "materials": [
    {
      "id": "lecture-01",
      "type": "lecture",
      "title": "Introduction to Deep Learning",
      "url": "..."
    },
    {
      "id": "lecture-02",
      "type": "lecture",
      "title": "Deep Sequence Modeling",
      "url": "..."
    }
  ]
}
```

这里最重要的是：

### 给每份 material 一个稳定 ID

例如：

```text
lecture-01
lecture-02
lecture-03
reading-01
assignment-01
```

以后题目一定要能够追溯：

```text
question
  ↓
knowledge point
  ↓
lecture-03
  ↓
original source
```

---

# 三、Step 2：不要直接对整个课程生成题

这是最容易犯的错误。

例如：

> “这是 MIT 的一门深度学习课，请生成 100 道题。”

这种 prompt 很容易产生：

```text
Transformer
Transformer
Transformer
Transformer
CNN
CNN
CNN
```

而且：

* lecture 之间比例失衡
* 基础概念缺失
* 课程中特殊知识点消失
* LLM 喜欢生成“常识题”
* 无法判断题目是否真的来自课程

---

# 四、先做 Course Knowledge Map

这是整个流程最重要的一步。

例如：

```text
Deep Learning
│
├── Neural Networks
│   ├── forward propagation
│   ├── backpropagation
│   ├── activation functions
│   └── optimization
│
├── CNN
│   ├── convolution
│   ├── receptive field
│   ├── pooling
│   └── equivariance
│
├── Sequence Models
│   ├── RNN
│   ├── LSTM
│   ├── attention
│   └── transformer
│
└── Generative Models
    ├── VAE
    ├── GAN
    └── diffusion
```

但是这里不要让 LLM 只输出：

```json
{
  "topic": "attention"
}
```

应该保存：

```json
{
  "id": "attention",
  "title": "Attention",
  "description": "...",
  "importance": "core",
  "sources": [
    "lecture-07"
  ],
  "prerequisites": [
    "sequence-models"
  ]
}
```

---

# 五、Step 3：区分“课程知识点”和“面试知识点”

这是你的新 Course Question Bank 和当前 AI Trainer **最重要的区别**。

当前 AI Trainer：

```text
Concept × Angle
```

例如 Transformer：

```text
transformer
├── fundamentals
├── architecture
├── implementation
├── optimization
├── tradeoff
├── debugging
└── scenario
```

课程题库则更应该：

```text
Course Concept
├── definition
├── intuition
├── mechanism
├── derivation
├── example
├── limitation
├── application
└── exercise
```

因为课程的目标是：

> **验证“学会了课程”**

而面试题的目标是：

> **验证“能不能在面试场景中证明能力”。**

不要混在一起。

---

# 六、Step 4：建立“Knowledge → Question Blueprint”

这里我强烈建议你**不要直接生成最终题目**。

先生成 blueprint。

例如：

```json
{
  "knowledgeId": "attention",
  "source": ["lecture-07"],
  "importance": "high",
  "questionTargets": [
    {
      "angle": "intuition",
      "value": "high"
    },
    {
      "angle": "mechanism",
      "value": "high"
    },
    {
      "angle": "comparison",
      "value": "medium"
    },
    {
      "angle": "limitation",
      "value": "high"
    }
  ]
}
```

然后：

```text
Knowledge Map
      ↓
Question Blueprint
      ↓
Question Generation
```

这个中间层非常重要。

因为你以后可以检查：

> **这个课程的知识有没有被合理地转换成题目？**

而不是只检查：

> 生成了 100 道题。

---

# 七、Step 5：决定每个知识点生成多少题

不要：

```text
每个 knowledge point = 3题
```

应该根据：

```text
importance
complexity
source coverage
concept depth
```

动态决定。

例如：

| Knowledge             | Importance | Depth | Questions |
| --------------------- | ---------: | ----: | --------: |
| Backpropagation       |       High |  High |         5 |
| ReLU                  |     Medium |   Low |         2 |
| Transformer           |       High |  High |         6 |
| Historical background |        Low |   Low |         0 |
| Course logistics      |        Low |   Low |         0 |

最终可能：

```text
Course
  47 knowledge points
       ↓
  132 question candidates
       ↓
  validation
       ↓
  96 final questions
```

---

# 八、Step 6：题目必须有 Source Evidence

这是我认为**课程题库相比普通题库最应该增加的字段**。

例如：

```json
{
  "id": "mit-6s191-attention-001",

  "courseId": "mit-6s191",

  "knowledgeId": "attention",

  "source": {
    "materialId": "lecture-07",
    "section": "Self-Attention",
    "page": 23
  },

  "type": "multiple",

  "question": "...",

  "options": [
    "...",
    "...",
    "...",
    "..."
  ],

  "answer": [0, 2],

  "explanation": "...",

  "difficulty": "medium"
}
```

这样你以后可以问：

> 这道题到底来自课程哪里？

可以直接回答。

---

# 九、Step 7：特别注意“不要考文章措辞”

这点与你之前设计的 prompt 完全一致。

比如原课程说：

> Self-attention allows each token to attend to all other tokens...

不要生成：

> According to Lecture 7, what does self-attention allow?

这种题很差。

应该：

> 在一个序列模型中，每个 token 都可以根据序列中其他 token 的表示计算其相关性，并据此聚合信息。这种机制相比固定窗口的局部操作有什么核心优势？

然后选项。

这样：

```text
课程 context
      ↓
提炼
      ↓
题目自包含
```

而不是：

```text
题目
 ↓
“请记住原文”
```

---

# 十、Step 8：对于课程题，建议增加 6 种题型

你现在主要考虑：

```text
single
multiple
open
```

课程题库可以稍微不同。

我会考虑：

### ① Concept

> What is X?

### ② Mechanism

> Why does X work?

### ③ Compare

> X vs Y

### ④ Application

> Given scenario X, what happens?

### ⑤ Debugging

> Given this behavior, what is likely wrong?

### ⑥ Derivation / calculation

> Given X and Y, calculate Z.

特别是课程题：

**不要让选择题成为唯一形式。**

如果课程本身有数学推导，例如：

```text
loss
gradient
Bayes
attention
probability
```

可以生成：

```text
calculation
```

或者：

```text
short-answer
```

---

# 十一、Step 9：建立 Question Validator

这个步骤非常重要。

不要：

```text
LLM generate
↓
save
```

而是：

```text
LLM generate
      ↓
Schema validation
      ↓
Source validation
      ↓
Knowledge validation
      ↓
Answer validation
      ↓
Self-contained validation
      ↓
Duplicate validation
      ↓
Difficulty validation
      ↓
save
```

---

# 十二、至少检查这 8 件事情

### 1. Schema

用你之前考虑的 **Zod**：

```ts
CourseQuestionSchema.parse(question)
```

---

### 2. Knowledge consistency

题目声称：

```text
knowledgeId = attention
```

不能实际上考：

```text
positional encoding
```

---

### 3. Answer consistency

尤其是多选题：

```text
options
answer
explanation
```

三者必须一致。

---

### 4. Source grounding

题目中的核心事实必须能追溯到：

```text
course material
```

---

### 5. Self-contained

删除：

```text
according to the lecture
as discussed above
the proposed method
this approach
```

然后检查：

> 单独拿出来还能不能回答？

---

### 6. Duplicate

不要：

```text
Q1: What is attention?
Q2: What does attention do?
Q3: What is the purpose of attention?
```

看起来三道题，实际上是一道。

这里非常适合：

```text
embedding
+
cosine similarity
+
MMR
```

而不是 LLM。

---

### 7. Coverage

最终生成：

```text
Knowledge × Question
```

矩阵：

```text
                Concept Mechanism Application Compare
attention          ✓       ✓         ✓
CNN                ✓       ✓
RNN                ✓       ✓         ✓
GAN                ✓                 ✓
```

发现：

```text
GAN 只有 definition
```

就需要补题。

---

### 8. Difficulty

避免：

```text
80% easy
```

也不要强行：

```text
20% easy
40% medium
40% hard
```

应该根据课程内容自然分布。

---

# 十三、Step 10：最后才生成 Question Bank

最终结构我建议：

```text
data/
  courses/
    mit-6s191/
      course.json
      materials.json

      knowledge/
        concepts.json

      blueprint/
        blueprint.json

      questions/
        questions.json

      quality/
        coverage.json
        validation.json
```

而你的现有：

```text
data/questions/
```

完全不动。

---

# 十四、运行时也不要和 Trainer QuestionBank 混

这是非常重要的一点。

我会让 application 层看到：

```ts
interface QuestionSource {
  getQuestions(): Question[];
}
```

然后：

```text
QuestionSource
      │
      ├── InterviewQuestionBank
      │
      └── CourseQuestionBank
```

以后 UI：

```text
Practice
│
├── Interview Trainer
│
└── Courses
    ├── MIT 6.S191
    ├── CS50
    └── ...
```

甚至：

```text
Course
  ↓
Lecture
  ↓
Practice
```

和：

```text
Interview
  ↓
Adaptive Interview
```

是两种不同体验。

---

# 十五、我尤其建议增加 Course Progress

这是课程题库非常自然的功能。

例如：

```text
MIT 6.S191

████████████░░░░ 75%

Neural Networks       92%
CNN                   85%
RNN                   61%
Attention             47%
Generative Models     20%
```

这时候你的：

```text
LearnerProfile
```

可以继续复用很多东西，但**不要把课程 mastery 和 interview mastery 混成一个分数**。

应该：

```text
CourseLearnerState
        │
        ├── concept mastery
        ├── lecture progress
        ├── question history
        └── weak concepts

InterviewLearnerState
        │
        ├── interview ability
        ├── concept × angle
        ├── adaptive evidence
        └── interview performance
```

底层可以共享：

```text
QuestionResult
Attempt
LearnerEvidence
```

但上层模型不同。

---

# 十六、整个实际生产流程

如果你明天就拿一门 MIT 公开课开始做，我会这样操作：

```text
① 找课程
       ↓
② 下载 / 获取官方 lecture / slides / notes
       ↓
③ 建 course manifest
       ↓
④ 文档解析 / chunk
       ↓
⑤ 提取 knowledge concepts
       ↓
⑥ 建 prerequisite / related graph
       ↓
⑦ 给 concept 标 importance
       ↓
⑧ 生成 question blueprint
       ↓
⑨ 每个 concept 生成候选题
       ↓
⑩ Zod schema validation
       ↓
⑪ Source grounding validation
       ↓
⑫ Answer validation
       ↓
⑬ Self-contained validation
       ↓
⑭ Embedding duplicate detection
       ↓
⑮ Coverage analysis
       ↓
⑯ 补缺口
       ↓
⑰ 人工 spot check
       ↓
⑱ 发布 Course Question Bank
```

其中 **⑨～⑯ 可以高度自动化**。

---

# 十七、最关键的一点：不要把“课程内容”全部交给 LLM

我会采用：

```text
             Course Material
                    │
                    ▼
             deterministic
             extraction
                    │
                    ▼
             Knowledge Map
                    │
                    ▼
              LLM planning
                    │
                    ▼
          Question Blueprint
                    │
                    ▼
             LLM generation
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
    Zod/schema    embedding    rules
        │           │            │
        └───────────┼────────────┘
                    ▼
              Question Bank
```

也就是：

> **LLM 负责“理解和生成”，算法负责“约束、验证、覆盖和去重”。**

这与你现在 AI Trainer 的整体设计其实非常一致。

---

## 最后一个非常重要的问题：版权

如果你说的 MIT / Harvard 开放课程，**“公开可访问”不等于“可以任意再发布课程内容的衍生题库”**。

尤其要区分：

* 课程视频
* slides
* lecture notes
* assignment
* textbook
* 课程网页
* 题目本身

每个材料的许可可能不同。

所以你的 `course.json` 最好从一开始就记录：

```json
{
  "license": "...",
  "sourceUrl": "...",
  "redistribution": "allowed|restricted|unknown"
}
```

而且**尽量不要把原课程全文/大量原文复制进题库**。题目应该是你基于课程知识生成的 assessment artifact，并保留 source attribution。

---

### 如果结合你现在的项目，我会把它定义成一个独立的 **Course Authoring Pipeline**

而不是给现有 `question-blueprint` 再加十几个参数：

```text
                     Knowledge Sources
                           │
             ┌─────────────┴──────────────┐
             ▼                            ▼
       Interview Bank              Course Bank
             │                            │
     Concept × Angle                Course Concept
             │                            │
     Adaptive Interview             Course Practice
             │                            │
        AI Trainer                    Course App
```

**共享底层基础设施：**

```text
Zod
Question schema
Embedding
Duplicate detection
Learner evidence
IndexedDB
LLM provider
```

**但不共享 taxonomy / blueprint / adaptive policy。**

这会是我认为最干净、同时又不会过度设计的边界。
