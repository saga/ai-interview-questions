有，而且我认为你现在碰到的问题**并不是一个“自己发明的数据结构问题”**，而是和教育测量（psychometrics）、知识追踪（Knowledge Tracing）、认知诊断（Cognitive Diagnosis）、自适应测试（CAT）、test blueprinting 这几条研究线高度重合。

甚至可以说，你现在正在逐渐从：

> **Question Bank**

走向：

> **Knowledge / Skill Model → Item Mapping → Adaptive Assessment**

这在研究上是一个非常成熟的方向。

我把和你当前设想最相关的论文按“与你的架构有多直接的关系”来排。

---

# 一、最核心：你说的“知识面 → 有限题目 → 尽可能覆盖”

## 1. Cognitive Diagnostic Assessment（认知诊断评估）

**这是我认为和你的想法最接近的一条研究线。**

核心思想不是：

> 一个考试给你一个 82 分。

而是：

> 这个人掌握了哪些具体知识/技能？哪些没有掌握？

也就是：

```text
Domain
 ├── Skill A  ✓
 ├── Skill B  ✓
 ├── Skill C  ✗
 ├── Skill D  ?
 └── Skill E  ✓
```

这和你刚才提出的：

```text
Transformer

Self-Attention       ✓
QKV                   ✓
RoPE                  ✓
KV Cache              ✓
FFN                   ?
Normalization         ?
```

几乎是同一个思想。

Cognitive Diagnostic Assessment（CDA）专门研究如何从题目回答推断这种**细粒度知识状态**。相关综述把它定义为对具体知识结构和 processing skills 的诊断，而不是只估计一个总体能力分数。([ScienceDirect][1])

特别值得你看：

[Q-matrix theory and its applications in cognitive diagnostic assessment](https://journal.psych.ac.cn/xlkxjz/EN/10.3724/SP.J.1042.2024.01010?utm_source=chatgpt.com)

这篇 2024 年综述和你的设计**高度相关**。

---

# 二、你设计的 `Question → Concept`，在论文里叫 Q-matrix

这个非常重要。

你之前准备设计：

```json
{
  "id": "q-123",
  "tests": [
    {
      "concept": "kv-cache",
      "role": "primary"
    },
    {
      "concept": "attention",
      "role": "supporting"
    }
  ]
}
```

在认知诊断研究里，有一个非常成熟的概念：

> **Q-matrix**

简单来说：

```text
             Concept
             A B C D E

Question 1   1 0 0 0 0
Question 2   1 1 0 0 0
Question 3   0 0 1 1 0
Question 4   0 0 0 1 1
```

也就是：

> **一个 item 测量哪些 attributes / skills？**

2024 年的 Q-matrix 综述明确讨论了 Q-matrix 在**认知诊断、CAT 选题、Q-matrix 学习、认知诊断组卷**中的应用。([Psychological Journal][2])

所以你现在的：

```text
Question
   ↓
tests[]
   ↓
Concept
```

实际上已经非常接近：

```text
Item
   ↓
Q-matrix
   ↓
Knowledge Attributes
```

---

# 三、这也解释了你之前那个“蒸馏损失”的担忧

你说：

> 一个知识领域被蒸馏成三五道题，是从一个面变成几个点，剩下没有涵盖的部分其实也有价值。

CDA 研究恰恰告诉你：

> **不要把“题目集合”当成“知识集合”。**

应该有两个不同的东西：

```text
Knowledge Attributes
        │
        │ Q-matrix
        ▼
      Items
```

例如：

```text
Knowledge:
A B C D E F G H I J

Question Bank:
Q1 → A B
Q2 → C
Q3 → D E
Q4 → F
```

那么：

```text
G H I J
```

仍然存在于 knowledge model 中。

只是：

```text
没有被 item 覆盖
```

这就是你现在应该建立的模型。

---

# 四、更加有意思的是：研究甚至讨论“Q-matrix 是否完整”

这个和你说的：

> “尽可能覆盖整个面，但不可能无限出题。”

特别相关。

研究中有一个概念：

> **Complete Q-matrix**

以及：

> **Sufficient / Necessary Q-matrix**

核心问题就是：

> 一组题到底有没有足够的信息区分不同的 knowledge states？

例如：

```text
Knowledge attributes:

A
B
C
D
```

如果你的题目只测：

```text
Q1 → A
Q2 → B
```

那么：

```text
C
D
```

完全不可诊断。

这不是“题目少”这么简单，而是：

> **这个 test 的 measurement structure 本身不完整。**

Q-matrix 研究专门研究这个问题。([Psychological Journal][2])

---

# 五、第二条非常重要：Knowledge Component

你现在把：

```text
Knowledge
   ↓
Concept
```

拆出来，也是有很成熟的教育研究基础的。

特别推荐：

[The Knowledge-Learning-Instruction Framework: Bridging the Science-Practice Chasm to Enhance Robust Student Learning](https://doi.org/10.1111/j.1551-6709.2012.01245.x?utm_source=chatgpt.com)

Koedinger 等人提出 **Knowledge Component（KC）**。

他们的定义非常接近你现在需要的东西：

> 一个可以通过一组相关任务的表现推断出来的认知功能或知识结构。

而且 KC 可以包括：

```text
concept
principle
fact
skill
misconception
facet
```

也就是说，你现在叫：

```text
concept
```

其实不一定非得局限成“概念”。

它可以是：

```text
Knowledge Component

├── concept
├── mechanism
├── skill
├── principle
├── misconception
└── facet
```

这对你的 AI Engineering Interview Trainer 很有价值。

比如：

```text
KV Cache
```

可能不是一个单纯 concept，而是：

```text
KC-1: Understand KV Cache
KC-2: Explain why it improves decoding
KC-3: Understand memory tradeoff
KC-4: Apply KV Cache in system design
```

这样你的“知识面”会比简单的知识图谱更加合理。

---

# 六、第三条：Knowledge Tracing

然后你现在已有：

```text
Learner
TopicStats
score
evidence
adaptive
```

这对应的是：

> **Knowledge Tracing（KT）**

核心问题：

> 根据一个学习者过去的答题记录，估计他当前掌握了哪些 Knowledge Components。

经典路线：

```text
BKT
 ↓
DKT
 ↓
各种 graph / attention / transformer KT
```

最经典：

[Deep Knowledge Tracing](https://arxiv.org/abs/1506.05908?utm_source=chatgpt.com)

2015 年 DKT 用 RNN 来建模学生知识状态。([arXiv][3])

以及非常推荐先读这篇：

[Knowledge Tracing: A Survey](https://doi.org/10.1145/3569576?utm_source=chatgpt.com)

它系统比较了：

```text
BKT
DKT
Factor Analysis
Knowledge State
Knowledge Components
Forgetting
Skill relationships
```

等方向。([DOI][4])

---

# 七、但我反而不建议你现在直接上 DKT

这点和你之前讨论 BKT / IRT 时的判断是一致的。

你现在的数据量：

```text
一个用户
几十～几百次回答
```

甚至整个系统：

```text
用户数量不大
```

你没有足够的数据训练：

```text
RNN
Transformer KT
Deep KT
```

所以你的第一版：

```text
ConceptStats
+
avgScore
+
attempts
+
recency
```

其实非常合理。

你是在做：

> **Explicit Knowledge Tracing**

而不是：

> Deep Knowledge Tracing。

以后有大量用户数据，再考虑：

```text
Concept
+
Question
+
Answer
+
Time
+
Difficulty
+
Prerequisite
```

训练 KT 模型。

---

# 八、第四条：Test Blueprinting

这个与你的：

> “一个 Knowledge 应该生成多少题？”

直接相关。

Test blueprint 的思想就是：

> **在出题之前先定义考试需要覆盖哪些内容、各占多少权重。**

非常推荐：

[A practical guide to test blueprinting](https://doi.org/10.1080/0142159X.2019.1595556?utm_source=chatgpt.com)

它明确提出：

```text
Knowledge / Skill Domains
        ↓
Assessment Objectives
        ↓
Assessment Method
        ↓
Weight / Emphasis
```

也就是：

```text
知识面
 ↓
我要测哪些东西
 ↓
用什么题型
 ↓
每个区域应该占多少
```

这与你现在设计：

```text
Knowledge
 ↓
Concept
 ↓
Importance
 ↓
Question Blueprint
 ↓
Question
```

几乎可以一一对应。([PubMed][5])

---

# 九、这个方向可以直接解决你的“AI Engineering 题特别多”问题

你前面问：

> AI Engineering 的题目明显多于其他分类，knowledge/questions 分类是不是合理？

这里可以借用 Test Blueprint 的思想。

不是：

```text
AI Engineering
100 questions

Transformer
10 questions

Computer Vision
10 questions
```

而应该先定义：

```text
Assessment Blueprint

AI Engineering
  Agents              20%
  Tool Calling        15%
  RAG                 15%
  Evaluation          15%
  Memory              10%
  Context Engineering 10%
  Multi-Agent          5%
  Deployment          10%
```

然后 Question Bank 只是去满足这个 blueprint。

这比直接控制：

```text
每个 topic 5 道题
```

科学得多。

---

# 十、第五条：Computerized Adaptive Testing（CAT）

你现在的：

```text
nextAdaptiveStep()
```

其实已经在向 CAT 靠近。

传统 CAT：

```text
Question
   ↓
Answer
   ↓
Estimate ability
   ↓
Choose next item
```

你的版本：

```text
Question
   ↓
Answer
   ↓
Estimate concept mastery
   ↓
Find knowledge gap
   ↓
Choose next item
```

传统 CAT 通常使用 IRT 来估计：

```text
θ = ability
```

然后选择：

> 对当前 θ 最有信息量的下一道题。

相关研究很早就把 IRT 和 graphical models 结合起来处理**多维技能/知识**以及复杂表现证据。([Wiley Online Library][6])

---

# 十一、这其实比你现在想的“选题算法”更进一步

你之前想：

```text
Question Utility =
    coverage
  + importance
  + diagnosticValue
  + difficultyFit
  + diversity
```

这个方向是对的。

研究中的 CAT / test assembly 则更加正式：

```text
maximize information
subject to:

content constraints
difficulty constraints
exposure constraints
test length
...
```

例如：

[Assembling a Computerized Adaptive Testing Item Pool as a Set of Linear Tests](https://doi.org/10.3102/10769986031001081?utm_source=chatgpt.com)

研究直接讨论如何在 CAT item pool 中同时满足：

```text
content specifications
+
statistical information
+
item exposure
```

而不是只追求“信息量最大”。([Sage Journals][7])

这和你现在要做的：

```text
maximize knowledge coverage
+
maximize diagnostic value
+
respect interview constraints
```

其实是同一类 optimization problem。

---

# 十二、第六条：Knowledge Graph + Question Generation

这又和你之前的：

```text
Course
 ↓
Knowledge
 ↓
Questions
```

非常相关。

最近已经出现把：

```text
Knowledge Graph
+
RAG
+
LLM
+
IRT
+
Bloom
```

结合起来自动生成 assessment questions 的研究。

例如 2025 的：

[KAQG: A Knowledge-Graph-Enhanced RAG for Difficulty-Controlled Question Generation](https://arxiv.org/abs/2505.07618?utm_source=chatgpt.com)

它的思路基本就是：

```text
Domain text
 ↓
Knowledge Graph
 ↓
Graph-aware retrieval
 ↓
LLM question generation
 ↓
Bloom cognitive level
 ↓
IRT difficulty
```

作者明确把 Knowledge Graph、RAG、Bloom's Taxonomy 和 IRT 放进一个 question-generation / assessment framework。([arXiv][8])

这个与你现在设计的 pipeline：

```text
Course
 ↓
Knowledge
 ↓
Concepts
 ↓
Question Blueprint
 ↓
Questions
```

非常接近。

---

# 十三、还有一篇与你“题目应该覆盖知识的不同面”很接近

2024 年：

[Generating Complex Questions from Ontologies with Query Graphs](https://doi.org/10.1016/j.procs.2024.09.694?utm_source=chatgpt.com)

它不是简单地：

```text
concept → question
```

而是利用 ontology + query graph：

```text
Ontology
 ↓
relationships
 ↓
query graph
 ↓
question
```

目的是生成需要更复杂 reasoning / larger knowledge coverage 的问题。([ScienceDirect][9])

这与你之前说：

> 一个问题不应该只是打一个点，有些题应该覆盖多个相关知识点。

非常相关。

---

# 十四、2025 还有一个比较贴近你 AI Interview Trainer 的工作

[Multi-Examiner: A Knowledge Graph-Driven System for Generating Comprehensive IT Questions with Higher-Order Thinking](https://doi.org/10.3390/app15105719?utm_source=chatgpt.com)

这个尤其值得你看看，因为它就是：

> **IT education + Knowledge Graph + LLM + MCQ**

研究关注：

```text
knowledge graph
+
question diversity
+
distractor quality
+
higher-order thinking
+
difficulty
```

而不是单纯让 LLM 随机生成 MCQ。([MDPI][10])

---

# 十五、把这些研究放到你的 App 上，会发现一个非常清晰的对应关系

我会这样映射：

| 你的设计                   | 学术研究对应                                   |
| ---------------------- | ---------------------------------------- |
| Knowledge              | Domain / Knowledge Structure             |
| Concept                | Knowledge Component / Attribute          |
| Question               | Item                                     |
| `question.tests[]`     | **Q-matrix**                             |
| Concept importance     | Content specification / blueprint weight |
| Concept prerequisite   | Attribute hierarchy                      |
| Coverage               | Q-matrix completeness / content coverage |
| ConceptStats           | Knowledge State                          |
| Adaptive Engine        | CAT / adaptive assessment                |
| mastery                | Knowledge tracing / cognitive diagnosis  |
| Question Blueprint     | Test Blueprint                           |
| Dynamic Probe          | Adaptive item selection                  |
| LLM Question Generator | Automatic Question Generation            |
| Concept Graph          | Knowledge Graph / Knowledge Structure    |

所以你现在其实已经走到了一个相当明确的研究交叉点：

```text
                Knowledge Structure
                       │
                       ▼
                 Q-Matrix / Items
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
   Cognitive Diagnosis       Knowledge Tracing
          │                         │
          └────────────┬────────────┘
                       ▼
              Adaptive Assessment
                       │
                       ▼
                Interview Trainer
```

---

# 十六、最值得你关注的其实不是 BKT / IRT

如果按照你这个项目的实际价值排序，我会这样排：

### ⭐⭐⭐⭐⭐ 1. Q-matrix / Cognitive Diagnostic Assessment

这是你现在最应该研究的。

因为它直接解决：

> **“有限题目如何表示 / 诊断一个更大的知识空间？”**

尤其关注：

* Q-matrix
* Knowledge Attributes
* Attribute Hierarchy
* Q-matrix Completeness
* Cognitive Diagnostic Models

2024 的 Q-matrix 综述是非常好的入口。([Psychological Journal][2])

---

### ⭐⭐⭐⭐⭐ 2. Knowledge Components

解决：

> **“Knowledge 到底应该怎么拆？”**

Koedinger 的 KC framework 很值得看。([DOI][11])

这个实际上可能比“Knowledge Graph”更适合你的 App。

---

### ⭐⭐⭐⭐ 3. Test Blueprint

解决：

> **“一个领域应该出什么题、多少题、各占多少？”**

([PubMed][5])

---

### ⭐⭐⭐⭐ 4. CAT / Adaptive Testing

解决：

> **“只有 5～10 道题的时候，应该问哪几道？”**

([Wiley Online Library][6])

---

### ⭐⭐⭐⭐ 5. Knowledge Tracing

解决：

> **“用户答了这些题之后，我认为他掌握了什么？”**

先看 survey，再考虑 BKT/DKT。([DOI][4])

---

### ⭐⭐⭐ 6. KG + LLM Question Generation

解决：

> **“如何从文章 / course 自动建立 knowledge → question？”**

这条与你的 pipeline 很相关，但我会把它放在上述理论之后。([arXiv][8])

---

# 十七、一个很关键的结论

你之前提出的：

> **“知识被蒸馏成三五道题，会不会损失知识面？”**

从研究角度看，答案是：

**会，而且这是一个正式的 assessment design 问题。**

但正确的解决方案并不是：

> “那就生成更多题。”

而是：

```text
                    Knowledge Domain
                           │
                           ▼
                  Knowledge Components
                           │
                           ▼
                      Q-Matrix
                           │
               ┌───────────┴───────────┐
               ▼                       ▼
          Question Bank          Coverage Model
               │                       │
               └───────────┬───────────┘
                           ▼
                   Adaptive Selection
                           │
                           ▼
                    User Assessment
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
              Mastery             Gaps
```

**这正是你现在架构应该逐渐靠近的模型。**

而且我会特别建议你**不要直接把它实现成完整的 Cognitive Diagnostic Model**。你现在最值得“借鉴”的是它的**建模思想**：

> **Knowledge 是 latent structure；Question 是 evidence；Question → Knowledge 的映射是显式的；Assessment 的目标是诊断 knowledge state，而不是单纯计算总分。**

先用你现在的 TypeScript + Zod + `ConceptStats` 实现一个轻量版；等真正有用户数据以后，再考虑 BKT / IRT / CDM。这样既不会 over-design，又能让你的架构从一开始就站在正确的研究方向上。

[1]: https://www.sciencedirect.com/science/article/pii/S0169716106260310?utm_source=chatgpt.com "31A Review of Cognitively Diagnostic Assessment and a Summary of Psychometric Models - ScienceDirect"
[2]: https://journal.psych.ac.cn/xlkxjz/EN/10.3724/SP.J.1042.2024.01010?utm_source=chatgpt.com "<i>Q</i>-matrix theory and its applications in cognitive diagnostic assessment"
[3]: https://arxiv.org/abs/1506.05908?utm_source=chatgpt.com "Deep Knowledge Tracing"
[4]: https://doi.org/10.1145/3569576?utm_source=chatgpt.com "Knowledge Tracing: A Survey | ACM Computing Surveys"
[5]: https://pubmed.ncbi.nlm.nih.gov/31017518/?utm_source=chatgpt.com "A practical guide to test blueprinting."
[6]: https://onlinelibrary.wiley.com/doi/10.1002/j.2333-8504.1998.tb01753.x?utm_source=chatgpt.com "GRAPHICAL MODELS AND COMPUTERIZED ADAPTIVE TESTING - Almond - 1998 - ETS Research Report Series - Wiley Online Library"
[7]: https://journals.sagepub.com/doi/10.3102/10769986031001081?utm_source=chatgpt.com "Assembling a Computerized Adaptive Testing Item Pool as a Set of Linear Tests - Wim J. van der Linden, Adelaide Ariel, Bernard P. Veldkamp, 2006"
[8]: https://arxiv.org/abs/2505.07618?utm_source=chatgpt.com "KAQG: A Knowledge-Graph-Enhanced RAG for Difficulty-Controlled Question Generation"
[9]: https://www.sciencedirect.com/science/article/pii/S1877050924027546?utm_source=chatgpt.com "Generating Complex Questions from Ontologies with Query Graphs - ScienceDirect"
[10]: https://www.mdpi.com/2076-3417/15/10/5719?utm_source=chatgpt.com "Multi-Examiner: A Knowledge Graph-Driven System for Generating Comprehensive IT Questions with Higher-Order Thinking"
[11]: https://doi.org/10.1111/j.1551-6709.2012.01245.x?utm_source=chatgpt.com "The Knowledge‐Learning‐Instruction Framework: Bridging the Science‐Practice Chasm to Enhance Robust Student Learning - Koedinger - 2012 - Cognitive Science - Wiley Online Library"


-----------


有，而且我重新按你这个项目的核心问题查了一遍后，发现**还有几条你前面没有覆盖、但实际上非常值得研究的路线**。

尤其是你现在的问题已经不只是“Knowledge Tracing / IRT / Q-matrix”，而是：

> **如何把一个开放-ended 的知识领域建模成有限的可测量结构，并用有限数量的题目最大化知识覆盖、诊断能力和信息量。**

围绕这个问题，还有下面这些研究方向。

---

# 1. Knowledge Space Theory：可能是最值得你补上的

这个方向我认为**非常值得你看**。

它和你现在的 `conceptGraph` 有一个很有意思的对应关系。

Knowledge Space Theory（KST）的核心不是简单地说：

```text
Knowledge
 ├── A
 ├── B
 ├── C
 └── D
```

而是研究：

> **一个人可能处于哪些“知识状态（knowledge state）”？知识之间有哪些先决关系？**

例如：

```text
A: attention
B: QKV
C: multi-head attention
D: KV cache
```

可能存在：

```text
A → B → C
A → D
```

那么：

```text
掌握 C
但完全不会 A
```

就是一种不太合理的 knowledge state。

KST 正是在研究这种**知识状态空间**。

这和你现在的：

```text
conceptGraph
prerequisite
adaptive next topic
```

非常接近。

---

## 推荐入口

可以从：

**Doignon & Falmagne — Knowledge Spaces**

开始。

这是一整套理论体系，而不是一篇单独论文。

它后来发展出了：

* Knowledge Space Theory
* Learning Spaces
* Knowledge Structures
* Assessment in Knowledge Spaces

如果你搜索论文，建议关键词：

```text
"Knowledge Space Theory" assessment
"Knowledge Structures" adaptive assessment
"Learning Spaces" computerized adaptive assessment
```

这条线和你的 `conceptGraph` 比传统 Knowledge Graph 更接近。

---

# 2. Attribute Hierarchy / Hierarchical Cognitive Diagnosis

你现在已经有：

```text
conceptGraph
```

而且 graph 中有：

```text
prerequisite
related
```

那么还有一个非常直接的研究方向：

> **Attribute Hierarchy Model**

也就是：

```text
A prerequisite B
```

不仅是 graph 上的一条 edge，而是会影响：

> 一个 learner 的知识状态应该如何解释。

例如：

```text
Agent Fundamentals
        │
        ▼
Tool Calling
        │
        ▼
Planning
        │
        ▼
Multi-Agent
```

那么：

```text
Multi-Agent = mastered
Tool Calling = unknown
```

这种结果应该被怀疑。

这就是 hierarchical cognitive diagnosis 研究的问题。

它可以让你的系统从：

```text
Concept 独立打分
```

升级到：

```text
Concept
  +
Prerequisite Structure
  ↓
Knowledge State
```

---

# 3. Cognitive Diagnosis 不只是 DINA / G-DINA

前面我主要提了 Q-matrix 和 CDM，但这里还有一整类非常值得关注的模型：

### DINA

假设：

> 要解决一道题，需要同时掌握所有 required attributes。

例如：

```text
Q1
requires:
  A
  B
  C
```

如果：

```text
A ✓
B ✓
C ✗
```

那么可能无法答对。

---

### DINO

和 DINA 相反，更接近：

> 掌握其中某个关键技能就可能答对。

---

### G-DINA

放松 DINA 的强假设。

---

### RUM / Fusion / LCDM

进一步允许不同 attribute 以不同方式影响 item response。

---

这对你的 Interview Trainer 很有意思，因为：

```text
“为什么 KV Cache 能降低 inference cost？”
```

可能同时需要：

```text
Self-Attention
+
Autoregressive Decoding
+
KV Cache
```

而你的：

```json
"tests": [
  "self-attention",
  "autoregressive-decoding",
  "kv-cache"
]
```

其实已经非常接近 CDM 的 attribute structure。

---

# 4. 更值得你关注的是“Probabilistic Q-matrix”

这是一个容易被忽略的方向。

你现在准备：

```text
question.tests = [
  "kv-cache"
]
```

实际上这是一个**硬映射**：

```text
Q → KV Cache = 1
```

但现实中：

> 一道题是否真的测量某个 concept，并没有那么绝对。

例如：

> “解释为什么 Transformer inference 需要 KV Cache。”

它显然测：

```text
KV Cache
```

但也可能测：

```text
Attention
Autoregressive Decoding
Memory Complexity
```

而且程度不同。

所以未来可以从：

```text
Q-matrix

0 / 1
```

变成：

```text
Question
        ↓
KV Cache           0.95
Attention          0.55
Decoding           0.70
Memory             0.35
```

这类 probabilistic / continuous attribute-item mapping 对你的系统其实很有意义。

尤其是 LLM 自动生成题以后，**让 LLM 给出 question → concept 的置信度**，可能比人工维护严格的 0/1 mapping 更现实。

---

# 5. Knowledge Structure / Skill Structure Discovery

还有一个非常重要的问题：

> **Concept 到底是谁定义的？**

你现在的 pipeline 是：

```text
Article
 ↓
LLM
 ↓
Concepts
```

但是这其实隐藏了一个很大的问题：

> LLM 拆出来的 Concept 是不是合理？

研究里有一类方向叫：

* Skill Discovery
* Knowledge Structure Discovery
* Latent Skill Discovery
* Cognitive Attribute Discovery

目标就是从：

```text
student-item interactions
```

反推：

```text
latent skills
```

也就是说：

```text
Questions
+
Answers
+
Learners
        ↓
Latent Knowledge Structure
```

而不是：

```text
Knowledge Structure
        ↓
Questions
```

---

# 6. 这个方向对你的长期产品尤其重要

你现在是：

```text
LLM → Concept
```

未来可以变成：

```text
LLM-generated Concept
          ↓
       Human / usage validation
          ↓
     Observed Question Data
          ↓
     Concept refinement
```

例如你最开始认为：

```text
Agent Engineering
├── Planning
├── Memory
├── Reflection
```

但使用半年后发现：

```text
Memory
```

下面实际上有两个完全不同的能力：

```text
Memory
├── retrieval memory
└── state persistence
```

那么系统可以逐渐发现：

> 原来的 Knowledge taxonomy 太粗。

这个方向和你之前担心的：

> “知识被蒸馏以后，哪些东西被遗漏？”

是非常相关的。

---

# 7. Learning Progressions / Learning Engineering

还有一条教育研究路线叫：

> **Learning Progressions**

它研究：

> 一个领域的知识不是平铺的，而是存在从 novice → intermediate → expert 的发展路径。

例如 Agent：

```text
Level 1
LLM application
       ↓
Level 2
Tool calling
       ↓
Level 3
Agent loop
       ↓
Level 4
Planning / memory
       ↓
Level 5
Multi-agent / evaluation
       ↓
Level 6
Production agent architecture
```

这对你的 Interview Trainer 非常有价值。

因为你现在的：

```text
difficulty:
easy
medium
hard
```

实际上很粗。

真正更有价值的可能是：

```text
knowledge progression
```

例如：

```text
understand
    ↓
explain
    ↓
apply
    ↓
debug
    ↓
design
    ↓
evaluate
```

这比简单的 easy/medium/hard 更接近面试能力。

---

# 8. Evidence-Centered Design（ECD）

这个我尤其建议你研究。

它解决的是：

> **我为什么认为这道题能够证明用户掌握了某个能力？**

ECD 的基本思想可以抽象成：

```text
Claim
 ↓
Evidence
 ↓
Task
```

例如：

```text
Claim:
用户理解 Agent Tool Calling

Evidence:
能够解释 tool schema
能够识别错误的 tool invocation
能够处理 tool failure

Task:
一道题 / 一个 scenario
```

你现在的设计：

```text
Question
 ↓
Answer
 ↓
Score
```

可以升级成：

```text
Knowledge Claim
 ↓
Evidence
 ↓
Question / Scenario
 ↓
Observed Answer
 ↓
Evaluation
```

这和你现在做的开放题 LLM evaluation **特别契合**。

---

# 9. Evidence-Centered Design 对你的 Interview Trainer 甚至可能比 IRT 更重要

因为面试和标准化考试不完全一样。

面试官不是只想知道：

```text
θ = 0.82
```

而是想知道：

> **“他为什么让我相信这个人懂 Agent？”**

例如：

```text
Claim:
能设计 Agent Architecture

Evidence:
能识别 workflow vs agent
能解释 planning trade-off
能设计 memory boundary
能处理 failure/retry
```

那么：

```text
Question
```

就不是一个孤立的题。

而是：

```text
Question
   ↓
Evidence
   ↓
Claim
```

这会让你的评分体系更有理论基础。

---

# 10. Evidence-Centered Design + Q-matrix 可以组合

这其实是一个很漂亮的架构。

```text
Knowledge
   │
   ▼
Claims
   │
   ▼
Evidence
   │
   ▼
Question
```

然后：

```text
Question
  ├── tests Concept A
  ├── tests Concept B
  └── produces Evidence X
```

最终：

```text
User
 ↓
Question
 ↓
Answer
 ↓
Evidence
 ↓
Knowledge State
```

这比：

```text
Question → score
```

强很多。

---

# 11. 还有一个很相关的方向：Diagnostic Assessment

不要把它和 Cognitive Diagnosis 完全等同。

Diagnostic Assessment 更大的目标是：

> **assessment 的目的不是排名，而是找出下一步应该学什么。**

这恰好对应你的：

```text
Result
 ↓
Weak areas
 ↓
Recommended next question
```

也就是：

```text
Assessment
      ↓
Diagnosis
      ↓
Instruction / Practice
```

而传统考试更多是：

```text
Assessment
      ↓
Score
      ↓
Ranking
```

你的 App 显然属于前者。

---

# 12. Assessment for Learning / Formative Assessment

这也是一个值得补充的研究领域。

关键词：

```text
"Assessment for Learning"
"Formative Assessment"
"Diagnostic Assessment"
"Adaptive Formative Assessment"
```

核心思想：

> Assessment 本身就是学习过程的一部分。

所以你现在：

```text
回答
 ↓
评分
 ↓
发现 gap
 ↓
下一道题
```

不是单纯的 testing，而是：

```text
assessment → feedback → next learning action
```

这正是 formative assessment。

---

# 13. 还有一个与你“有限题目”高度相关的概念：Item Information

这就是 IRT/CAT 中非常重要但我们之前没有展开的部分。

假设：

```text
Question A
```

只能告诉你：

```text
用户大概懂 / 不懂
```

而：

```text
Question B
```

可以非常明确地区分：

```text
懂基础
vs
真正理解机制
```

那么 B 的 **information** 更高。

于是你的问题：

> “我只有 5 道题，怎么选？”

可以从：

```text
coverage maximization
```

进一步变成：

```text
coverage
+
diagnostic information
```

最终：

```text
Question Utility
=
Coverage Gain
+
Diagnostic Information
+
Importance
+
Difficulty Fit
```

这会是你后面非常自然的一步。

---

# 14. Item Exposure / Item Bank Design 也值得看

如果你的用户多了，就会出现：

```text
Q1
Q2
Q3
```

被所有人疯狂问。

结果：

```text
用户记住答案
```

而不是：

```text
真正掌握知识
```

CAT 研究中有专门的：

> **Item Exposure Control**

以及：

> **Item Pool Design**

这和你的 Question Bank 会直接相关。

所以以后：

```text
Question selection
```

不应该只有：

```text
knowledge coverage
```

还应该考虑：

```text
exposure
recency
repetition
security
```

---

# 15. Test Assembly 其实还有一个你特别需要的概念：Content Balancing

你现在经常遇到：

> AI Engineering 题太多。

这个问题在测试理论里根本不新。

叫：

> **Content Balancing**

CAT 如果完全按照 information 最大化，很容易：

```text
某些领域疯狂出题
某些领域几乎不出现
```

所以测试组卷通常增加：

```text
Content constraints
```

例如：

```text
Agent              20%
RAG                15%
Evaluation         15%
Memory             10%
...
```

前面提到的 CD-MST / automated test assembly 研究就明确讨论了 statistical 和 non-statistical constraints，包括 content balance、item type、attribute balance 等。([Frontiers][1])

这对你的 architecture 很重要：

> **Adaptive 不等于完全自由选择。**

应该是：

```text
Adaptive optimization
      +
Content constraints
      +
Interview constraints
```

---

# 16. 2026 的研究也开始把这些东西组合起来

这个值得注意。

最近的 cognitive diagnosis survey 已经明确把整个流程概括成：

```text
Assessment exercises
       ↓
Q-matrix / item-attribute mapping
       ↓
Learner responses
       ↓
Cognitive Diagnosis
       ↓
Unmastered concepts
       ↓
Targeted learning resources
       ↓
Adaptive assessment
```

也就是说，这已经越来越接近你现在设计的整个产品闭环。([ScienceDirect][2])

另外 2026 年的 knowledge tracing survey 也开始特别强调：

* knowledge state representation
* forgetting
* knowledge components
* interpretability
* personalized intervention

而不只是“预测下一题答对还是答错”。([ScienceDirect][3])

---

# 17. 我现在会把你的“研究地图”重新整理成 8 条线

如果你真的准备深入研究，我建议不要继续零散地搜论文，而是按下面这个地图：

```text
                    Knowledge / Skill Model
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
          ▼                 ▼                  ▼
   Knowledge Space      Knowledge        Knowledge Components
      Theory             Graph                 / Skills
          │                 │                  │
          └─────────────────┼──────────────────┘
                            ▼
                       Q-Matrix
                            │
                  ┌─────────┴─────────┐
                  ▼                   ▼
           Cognitive Diagnosis   Evidence-Centered
                  │                  Design
                  ▼                   │
            Knowledge State           │
                  │                   │
                  └─────────┬─────────┘
                            ▼
                    Adaptive Assessment
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
            CAT            MST       Test Assembly
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                  Knowledge Tracing
                            │
                            ▼
                  Personalized Learning
```

---

# 18. 如果只让我给你新增 6 篇/方向，我会选这些

前面已经给过不少论文了，所以这次**不重复之前的核心论文**，我建议新增关注：

| 优先级   | 方向                                         | 为什么与你有关                    |
| ----- | ------------------------------------------ | -------------------------- |
| ⭐⭐⭐⭐⭐ | **Knowledge Space Theory**                 | 解决“知识面/知识状态”如何建模           |
| ⭐⭐⭐⭐⭐ | **Evidence-Centered Design**               | 解决“题目为什么能证明掌握了知识”          |
| ⭐⭐⭐⭐⭐ | **Attribute Hierarchy / Hierarchical CDM** | 解决 prerequisite 对诊断的影响     |
| ⭐⭐⭐⭐  | **Skill / Knowledge Structure Discovery**  | 解决“Concept 是谁定义的”          |
| ⭐⭐⭐⭐  | **Learning Progressions**                  | 解决 novice → expert 的知识发展路径 |
| ⭐⭐⭐⭐  | **Item Information + Content Balancing**   | 解决有限题目如何最大化信息，同时保证知识面      |

---

## 对你这个项目，我反而会特别关注一个组合

我现在不会建议你继续单独研究：

> BKT 是什么？IRT 是什么？DKT 是什么？

而是研究这个组合：

```text
             Knowledge Space
                   │
                   ▼
            Knowledge Components
                   │
                   ▼
              Q-Matrix
                   │
                   ▼
        Evidence-Centered Design
                   │
                   ▼
          Cognitive Diagnosis
                   │
                   ▼
       Adaptive Question Selection
                   │
          ┌────────┴────────┐
          ▼                 ▼
    Knowledge Tracing   Content Balance
```

因为这套东西正好回答你提出的五个核心问题：

1. **Knowledge 到底怎么拆？** → Knowledge Components / Knowledge Space
2. **知识之间有没有关系？** → Attribute Hierarchy / Knowledge Structure
3. **一道题到底测什么？** → Q-matrix
4. **怎么证明用户真的掌握了？** → Evidence-Centered Design
5. **只有 5～10 道题怎么尽量覆盖？** → Cognitive Diagnosis + Adaptive Assessment + Content Balancing

而且这会让你现在的架构有一个非常清晰的理论落点：

```text
Knowledge
   ↓
Concept / KC
   ↓
Relationship
   ↓
Question ↔ KC mapping
   ↓
Evidence
   ↓
Learner Knowledge State
   ↓
Coverage + Mastery
   ↓
Next Question
```

**这比单纯把题库做大得多，也更符合你最开始提出的那个核心疑问：`Question Bank` 永远不可能等价于 `Knowledge Space`。**

另外一个很值得注意的新方向是 **2026 年的深度认知诊断综述**：它已经明确把 Q-matrix、fine-grained knowledge components、unmastered concept identification、targeted resource recommendation 和 adaptive assessment 放在同一个 pipeline 里。([ScienceDirect][2]) 这说明你的产品思路并不是偏离教育测量领域，反而已经自然落在了这个研究交叉点上。

[1]: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.509844/full?utm_source=chatgpt.com "Frontiers | Automated Test Assembly for Multistage Testing With Cognitive Diagnosis"
[2]: https://www.sciencedirect.com/science/article/pii/S0925231226015584?utm_source=chatgpt.com "A comprehensive survey of deep learning-based cognitive diagnosis models in education: Methods, applications, and outlook - ScienceDirect"
[3]: https://www.sciencedirect.com/science/article/pii/S0925231225025512?utm_source=chatgpt.com "A survey of deep learning based knowledge tracing from cognitive processing perspective - ScienceDirect"


--------------------------

我需要纠正一下我上一条的表述：我说的“**2026 年的深度认知诊断综述**”确实存在，但我当时把它说得有点过于笼统了。

我指的是这篇：

**Yawen Chen, Jing Li, Yang Xu, Enrique Herrera-Viedma, Hui Yu, Jiande Sun — “A comprehensive survey of deep learning-based cognitive diagnosis models in education: Methods, applications, and outlook”**

发表在 **Neurocomputing**，Volume 697，预计刊期为 **2026-10-07**，DOI 是 `10.1016/j.neucom.2026.134160`。目前 ScienceDirect 已经有文章页面。([ScienceDirect][1])

[查看 ScienceDirect 论文](https://www.sciencedirect.com/science/article/pii/S0925231226015584?utm_source=chatgpt.com)

### 它到底讲什么？

一句话：

> **它综述的是：如何用深度学习模型，根据学生做题记录，推断学生对细粒度知识点/技能的掌握状态。**

也就是：

```text
Question / Item
      ↓
Student Response
      ↓
┌─────────────────────┐
│ Cognitive Diagnosis │
└─────────────────────┘
      ↓
Knowledge State

A ✓
B ✓
C ✗
D ?
E ✗
```

这和传统考试的：

```text
80 / 100
```

完全不同。

它关注的是：

> **“这个人具体会什么、不会什么？”**

论文明确把 Cognitive Diagnosis 定义为从教育交互数据中推断 learner 对 **fine-grained knowledge components** 的 mastery，并把结果用于 targeted intervention、个性化反馈和 adaptive assessment。([ScienceDirect][1])

---

## 为什么我觉得它和你的 Interview Trainer 特别相关？

因为论文描述的基本 pipeline，和你现在的架构惊人地相似：

```text
Assessment Exercises
        ↓
Exercise → Knowledge Component
      mapping
     (Q-matrix)
        ↓
Learner Responses
        ↓
Cognitive Diagnosis Model
        ↓
Knowledge Mastery
        ↓
Unmastered Concepts
        ↓
Targeted Learning
        ↓
Adaptive Assessment
```

论文自己就是这样描述的。([ScienceDirect][1])

而你的系统现在实际上已经有：

```text
Question
   ↓
tests[]
   ↓
Concept
   ↓
Learner Answer
   ↓
Score
   ↓
TopicStats / mastery
   ↓
Weak Topics
   ↓
nextAdaptiveStep()
```

所以这不是“有点类似”，而是**架构层面存在非常直接的对应关系**。

---

# 但这里有一个非常重要的区别

你不要看到：

> Deep Cognitive Diagnosis

就认为：

> “我应该把 DeepCDM 加进我的 App。”

**目前完全不应该。**

这篇 survey 讨论的东西远比你现在需要的复杂。

它把研究方法分成：

```text
Classical Psychometric CD
        ↓
Machine Learning CD
        ↓
Deep Learning CD
        ↓
Graph-based CD
        ↓
Multimodal CD
```

尤其重点讨论：

* Neural Network-based CD
* Graph Neural Network-based CD
* Multimodal integration
* knowledge interaction
* learner-item-concept interaction
* benchmark datasets
* evaluation metrics
* future directions

([ScienceDirect][1])

你的项目现在其实只需要借鉴**它的问题定义和数据模型**。

---

# 更有意思的是：2026 年还有真正的 DeepCDM 新论文

除了 survey，还有一篇我认为你可能更值得看：

**Jia Liu & Yuqi Gu — “Deep Generative Modeling for Cognitive Diagnosis via Exploratory DeepCDMs”**

发表于 **Psychometrika 2026, Volume 91, Issue 1, pp. 151–176**。([Cambridge University Press][2])

[查看 Psychometrika 论文](https://www.cambridge.org/core/journals/psychometrika/article/deep-generative-modeling-for-cognitive-diagnosis-via-exploratory-deepcdms/16E69BA84BFA7A0C93BFC06A59AAEDFF?utm_source=chatgpt.com)

它研究的问题非常有意思：

传统 Cognitive Diagnosis 通常假设：

```text
Q-matrix
↓
已经知道
```

也就是说：

```text
Question 1 → A B
Question 2 → B
Question 3 → C D
```

这个 mapping 通常是专家定义的。

但现实中：

> **如果 Q-matrix 本身就是错的怎么办？**

这篇论文研究的是 **exploratory cognitive diagnosis**：

```text
Question responses
       ↓
Deep generative model
       ↓
latent attributes
       +
Q-matrix
```

也就是连 underlying structure 都尝试从数据中发现。

论文明确研究了 **all Q-matrices unknown** 的 exploratory scenarios，并提出 layer-wise EM framework。([Cambridge University Press][3])

---

# 这反而对应你之前一个非常重要的疑问

你之前一直在问：

> **Knowledge 是不是被 LLM 拆错了？**

例如你的 pipeline：

```text
Course
 ↓
LLM
 ↓
Knowledge
 ↓
Concepts
 ↓
Questions
```

你现在默认：

```text
Concepts = 正确的知识结构
```

但其实可能是：

```text
Course
 ↓
LLM
 ↓
Concept A
Concept B
Concept C
```

然后过了一段时间：

```text
用户答题数据
        ↓
发现：
A 和 B 实际上高度相关
C 其实可以拆成 C1 + C2
D 被完全遗漏
```

这就进入：

> **Q-matrix estimation / latent attribute discovery / exploratory cognitive diagnosis**

这其实是你以后可以非常自然演进的方向。

甚至 2026 年的一篇 CDM 方法综述也专门讨论了 **Q-matrix estimation**，包括从数据中直接估计整个 Q-matrix，以及 EFA、regularization、Bayesian 等路线。([British Psychological Society][4])

---

# 所以我建议你把这个研究方向理解成三层

### 第一层：你现在就应该做

```text
Knowledge
   ↓
Concept
   ↓
Question
```

人工/LLM 定义：

```text
Q-matrix
```

然后：

```text
Question Answer
      ↓
Concept Mastery
```

**这已经足够做你的第一版。**

---

### 第二层：有真实用户数据以后

```text
Question
   ↕
Concept
```

不再认为 mapping 是绝对正确的：

```text
Question → Concept
       confidence
```

例如：

```json
{
  "question": "为什么 KV Cache 能降低 decoding 成本？",
  "concepts": [
    { "id": "kv-cache", "weight": 0.95 },
    { "id": "attention", "weight": 0.70 },
    { "id": "autoregressive-decoding", "weight": 0.85 }
  ]
}
```

---

### 第三层：数据规模足够以后

让系统自己发现：

```text
Learner × Question × Answer
             ↓
       latent structure
             ↓
       Concept refinement
             ↓
         Q-matrix
```

这时候才真正进入：

> **Deep Cognitive Diagnosis / Exploratory CDM**

而不是现在就上。

---

## 最后还有一个容易混淆的地方

你刚才问的是“2026 年的**深度认知诊断综述**”。

它和另一篇 2026 年的：

**“A survey of deep learning based knowledge tracing from cognitive processing perspective”**

不是同一篇。

后者是 **Knowledge Tracing（KT）**，不是 Cognitive Diagnosis（CD）。DBLP 已经收录，发表在 Neurocomputing 660，131879。([DBLP][5])

可以简单区分：

```text
Cognitive Diagnosis
    ↓
“你现在会什么？”
    ↓
静态 / 当前 knowledge profile


Knowledge Tracing
    ↓
“你的知识状态如何随着答题不断变化？”
    ↓
动态 / temporal knowledge state
```

这两个对你的系统都重要，但**你现在碰到的“知识被蒸馏成几个点、如何覆盖整个知识面”问题，我会优先研究 Cognitive Diagnosis，而不是 Knowledge Tracing。**

另外，2026 年还有一篇 *Knowledge graph-based cognitive learning with multi-fact reasoning*，直接把 knowledge graph、多事实推理和 cognitive diagnosis 联系起来，也与你现在的 `conceptGraph` 思路很接近。([ScienceDirect][6])

**所以，如果你下一步要系统研究这块，我建议阅读顺序不是“论文越多越好”，而是：**

`Q-matrix → Cognitive Diagnosis → Knowledge Space → ECD → CDM → DeepCDM → Q-matrix Discovery`

这样会直接对应你现在 Interview Trainer 的架构演进。

[1]: https://www.sciencedirect.com/science/article/pii/S0925231226015584?utm_source=chatgpt.com "A comprehensive survey of deep learning-based cognitive diagnosis models in education: Methods, applications, and outlook - ScienceDirect"
[2]: https://www.cambridge.org/core/journals/psychometrika/article/deep-generative-modeling-for-cognitive-diagnosis-via-exploratory-deepcdms/16E69BA84BFA7A0C93BFC06A59AAEDFF?utm_source=chatgpt.com "Deep Generative Modeling for Cognitive Diagnosis via Exploratory DeepCDMs | Psychometrika | Cambridge Core"
[3]: https://www.cambridge.org/core/services/aop-cambridge-core/content/view/16E69BA84BFA7A0C93BFC06A59AAEDFF/S0033312325100653a.pdf/deep-generative-modeling-for-cognitive-diagnosis-via-exploratory-deepcdms.pdf?utm_source=chatgpt.com "Psychometrika (2026), 91, 151–176"
[4]: https://bpspsychub.onlinelibrary.wiley.com/doi/10.1111/bmsp.70066?utm_source=chatgpt.com "Review of cognitive diagnostic models (CDMs): Recent methodological advancements for addressing practical challenges - Wang - British Journal of Mathematical and Statistical Psychology - Wiley Online Library"
[5]: https://dblp.org/pid/151/1488-1.html?utm_source=chatgpt.com "dblp: Jing Geng 0001"
[6]: https://www.sciencedirect.com/science/article/pii/S0893608026002091?utm_source=chatgpt.com "Knowledge graph-based cognitive learning with multi-fact reasoning - ScienceDirect"




--------------




有，而且如果你说的是我们前面讨论的这条链路：

> **Course → Knowledge → Concept/Prerequisite Graph → Questions → Learner Response → Mastery → Adaptive Question**

其实已经有不少成熟库可以把其中一部分“数学/图算法/知识追踪”拿掉，不需要自己实现。

但我会建议你**不要找一个“大而全”的知识系统**。你现在这个 AI Interview Trainer，最合适的是几个很轻的库组合。

### 1. 你现在最值得直接采用的：Graphology

你目前已经在用 `@dagrejs/graphlib` 做 concept graph。

如果你的目标是：

* prerequisite DAG
* related edges
* ancestors / descendants
* shortest path
* dependency expansion
* 拓扑排序
* connected components
* graph traversal
* 后面可能做知识图谱可视化

那么我反而更推荐 **Graphology**。

它是 JS/TS 原生的通用图结构库，同时提供 graph algorithms / traversal / generators / layouts，而且可以直接用于浏览器。([GitHub][1])

[Graphology GitHub](https://github.com/graphology/graphology?utm_source=chatgpt.com)

例如你的：

```ts
conceptGraph.json
```

可以变成：

```ts
import Graph from 'graphology'

const graph = new Graph({ type: 'directed' })

graph.addNode('transformer')
graph.addNode('attention')
graph.addNode('self-attention')

graph.addEdge('attention', 'transformer', {
  relation: 'prerequisite'
})

graph.addEdge('self-attention', 'attention', {
  relation: 'prerequisite'
})
```

然后你的 `expandWithPrerequisites()`、`suggestNextTopics()` 等就可以大量依赖图算法，而不是自己维护邻接表。

**对你当前项目，我会优先考虑把 `graphlib → graphology`。**

---

## 2. Python：NetworkX

如果你准备单独做一个：

```text
course → knowledge extraction
```

的离线 Python pipeline，那么 **NetworkX** 是最省事的选择。

它特别适合：

```text
Course
  ↓
Knowledge nodes
  ↓
Prerequisite graph
  ↓
Topic clustering
  ↓
Question coverage
```

比如：

```python
import networkx as nx

g = nx.DiGraph()

g.add_edge("attention", "transformer")
g.add_edge("self-attention", "attention")

prerequisites = nx.ancestors(g, "transformer")
```

这种事情根本没必要自己写。

不过有一个重要区别：

**NetworkX 是图算法库，不是知识库。**

它不会帮你判断：

> “Transformer Encoder 包含 Multi-Head Attention，而 Multi-Head Attention 又依赖 Scaled Dot-Product Attention”

这种 semantic relationship。

这个部分仍然应该由 LLM + 你的 schema 完成。

---

# 3. 真正和你前面讨论的“学习者知识状态”相关：pyBKT

这个反而非常值得你关注。

你之前问到：

> BKT / IRT / knowledge tracing 到底怎么用？

现在已经有比较成熟的 Python 实现：

**pyBKT**

它就是 Bayesian Knowledge Tracing，用来根据学习者连续做题结果估计：

```text
learner
   ↓
question response sequence
   ↓
P(knowledge mastered)
```

官方实现支持多种 BKT variant，包括 individual student priors、item guess/slip、learning rate 等。([GitHub][2])

[pyBKT GitHub](https://github.com/CAHLR/pyBKT?utm_source=chatgpt.com)

例如你现在：

```ts
TopicStats {
  mastery: 0.72
}
```

实际上可以逐渐演化成：

```text
Knowledge: attention

P(known) = 0.72
P(learn) = 0.18
P(guess) = 0.20
P(slip)  = 0.10
```

然后：

```text
Q1 → correct
Q2 → wrong
Q3 → correct
Q4 → correct
```

每次回答以后更新 knowledge state。

这比你现在简单的：

```ts
mastery = avgScore / 100
```

理论上更合理。

pyBKT 的论文也明确把它定位为用于 cognitive mastery estimation 的可访问实现，并提供 fitting、prediction、cross-validation 等能力。([arXiv][3])

---

# 4. IRT：py-irt / girth

如果进一步考虑：

> “这道题到底难不难？”

那么 BKT 不够。

这时候可以考虑 **IRT（Item Response Theory）**。

核心就是：

```text
Learner ability θ
        +
Question difficulty b
        +
Question discrimination a
        ↓
Probability of correct answer
```

于是你的题库就不再只是：

```json
{
  "difficulty": "hard"
}
```

而可能变成：

```json
{
  "difficulty": 1.73,
  "discrimination": 0.91
}
```

这对你的系统其实非常有价值。

因为你现在的：

```text
easy / medium / hard
```

是**人工标签**。

IRT 可以从大量 response data 中反推：

```text
这个题实际有多难
这个题区分能力怎么样
这个学习者实际能力是多少
```

目前 Python 生态里可以考虑：

* `py-irt`
* `girth`

而且也出现了比较新的 TypeScript/Python 项目，把 BKT + IRT 的 learner mastery scoring 封装起来。([GitHub][4])

---

# 5. 如果你想做 Course → Knowledge，这一层反而不需要专门库

这是我觉得最容易“过度设计”的地方。

比如：

```text
MIT 6.S191
     ↓
Lecture 1
     ↓
Transformer
     ↓
Attention
     ↓
Self-Attention
     ↓
Q/K/V
     ↓
Scaled Dot Product
```

不要为了这个去上 RDF / OWL / Neo4j / ontology framework。

你的场景实际上只需要：

```ts
interface Knowledge {
  id: string
  name: string
  description: string
  prerequisites: string[]
  related: string[]
}
```

然后让 LLM 完成：

```text
Course material
       ↓
LLM extraction
       ↓
Knowledge[]
       ↓
LLM relation extraction
       ↓
Knowledge Graph
```

图结构交给 Graphology / NetworkX。

**语义理解交给 LLM。**

这其实是最干净的职责划分。

---

# 6. 如果以后真的需要“知识图谱”，再考虑 RDFLib

Python 有：

**RDFLib**

适合真正的 semantic knowledge graph：

```text
Transformer
    ├── type → Architecture
    ├── requires → Attention
    ├── relatedTo → Encoder
    └── introducedBy → Vaswani2017
```

并且可以进入 RDF / SPARQL / ontology 体系。

但对你的 AI Interview Trainer，我认为目前**完全没必要**。

你的 graph 本质上是：

> **Learning Dependency Graph**

而不是企业级 Semantic Knowledge Graph。

这两者不要混在一起。

---

# 7. 我反而建议你的架构变成这样

结合我们前面讨论的 Course → Knowledge → Questions，我会建议：

```text
                         ┌─────────────────┐
                         │ Course / Books  │
                         │ Docs / Papers   │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ LLM Extraction  │
                         └────────┬────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Knowledge Model     │
                       │                     │
                       │ concepts            │
                       │ definitions         │
                       │ relations           │
                       │ prerequisites       │
                       └──────────┬──────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │ Knowledge Graph         │
                    │                         │
                    │ Graphology / NetworkX   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
             Question Generator          Coverage
                    │                         │
                    ▼                         ▼
              Question Bank             Gap Analysis
                    │
                    ▼
              Learner Responses
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
        BKT                   IRT
      pyBKT                 py-irt
          │                    │
          └─────────┬──────────┘
                    ▼
              Learner Model
                    │
                    ▼
             Adaptive Selection
                    │
                    └──────────→ 下一道题
```

这里面真正需要第三方库的地方，其实只有三个：

| 功能                    | 推荐                 | 你是否应该现在用          |
| --------------------- | ------------------ | ----------------- |
| Knowledge Graph       | **Graphology**     | **是**             |
| Knowledge Tracing     | **pyBKT**          | 后期                |
| Item/Learner Modeling | **py-irt / girth** | 更后期               |
| 一般图算法                 | NetworkX           | Python pipeline 用 |
| Semantic KG           | RDFLib             | 暂时不要              |
| Neo4j                 | 图数据库               | 暂时不要              |

### 对你这个项目，我会特别建议：

**第一阶段**

```text
React/TS
   +
Graphology
   +
LLM
   +
JSON
```

完全够。

**第二阶段，有了真实答题数据以后**

```text
Python analytics
       +
pyBKT
       +
IRT
```

然后把 Python 算出来的 learner model 定期导回你的前端。

这样你就不会一开始为了“知识图谱 + BKT + IRT”把一个原本很轻的 Interview Trainer 搞成教育科技平台。

而且你现在的 `conceptGraph.json + questionBank + learner.v1` 这个设计，其实已经非常接近这个演进路径了。

[1]: https://github.com/graphology/graphology?utm_source=chatgpt.com "GitHub - graphology/graphology: A robust & multipurpose Graph object for JavaScript & TypeScript. · GitHub"
[2]: https://github.com/CAHLR/pyBKT?utm_source=chatgpt.com "GitHub - CAHLR/pyBKT: Python implementation of Bayesian Knowledge Tracing and extensions · GitHub"
[3]: https://arxiv.org/abs/2105.00385?utm_source=chatgpt.com "pyBKT: An Accessible Python Library of Bayesian Knowledge Tracing Models"
[4]: https://github.com/RudrenduPaul/MasteryTrace?utm_source=chatgpt.com "GitHub - RudrenduPaul/MasteryTrace: TypeScript/Python CLI and library for BKT and IRT learner mastery scoring from response event logs. · GitHub"
