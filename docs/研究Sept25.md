有，而且你给的这篇 **CoLearn** 并不是孤立的。它实际上处在几个研究方向的交叉点：

> **Persistent Learner Model + Knowledge Tracing + Misconception Memory + Adaptive Question Selection + LLM Tutor/Agent**

我检索了 2025–2026 年的相关论文和开源实现后，发现有几篇与你这个方向非常接近，尤其适合你现在的 **AI Interview Trainer**。

## 一、和 CoLearn 最接近的论文

| 论文                                                                                   |                      时间 | 和 CoLearn 的关系                                                           | 开源      |
| ------------------------------------------------------------------------------------ | ----------------------: | ----------------------------------------------------------------------- | ------- |
| **ScaffoldLM: Planning-Guided Tutoring with Assessment-Driven Memory**               |                ACL 2026 | 非常接近：Assessment → Learner State → Memory → 下一步教学动作                      | ✅       |
| **TASA: Teaching According to Students' Aptitude**                                   | 2025/AAAI Workshop 2026 | Persona + Event Memory + Knowledge Tracing + Forgetting                 | ✅       |
| **IntelliCode: A Multi-Agent LLM Tutoring System with Centralized Learner Modeling** |               EACL 2026 | Persistent centralized learner state + 多 Agent + curriculum/hint/review | 有论文系统   |
| **GenMentor**                                                                        |                WWW 2025 | Goal → Skill Gap → Learner Model → Learning Path → Content/Tutor        | ✅       |
| **GraphMASAL**                                                                       |                    2025 | Learner model + Knowledge Graph + Diagnoser/Planner/Tutor               | 有研究代码迹象 |
| **CoLearn**                                                                          |                    2026 | 你给的原始论文：Mastery + Misconception → 下一题                                   | 论文 demo |
| **CLASS**                                                                            |              EMNLP 2023 | 学习科学驱动的 LLM Tutor 架构基础                                                  | ✅       |
| **MathTutorBench**                                                                   |              EMNLP 2025 | LLM Tutor evaluation，不是 runtime，但对你的项目非常有价值                             | ✅       |

### 1. ScaffoldLM

这是我认为你**最应该仔细看**的一篇。

**Planning-Guided Tutoring with Assessment-Driven Memory for Pedagogical LLM Tutors**

ACL 2026。它不是简单把历史对话塞进 prompt，而是：

```text
Problem
  ↓
Pedagogical Plan
  ↓
Step 1 / Step 2 / Step 3 ...
  ↓
Learner Response
  ↓
Assessment
  ↓
Learner State
  ↓
Memory Update
  ↓
决定继续 / hint / correction / transition
```

它明确把：

* pedagogical plan
* 当前 step
* step-level progress
* learner state
* dialogue history

放进一个显式 memory，而不是让 LLM 自己“记住”。([ACL Anthology][1])

这和你现在做的 **AI Interview Trainer** 很接近，因为一道面试题其实也可以拆成：

```text
Question
  ↓
Expected reasoning path
  ↓
candidate answer
  ↓
assessment
  ↓
detected gap
  ↓
learner state update
  ↓
next question / hint / follow-up
```

而且它已经有官方代码：

[ScaffoldLM GitHub](https://github.com/BNU-ERC-ITEA/ScaffoldLM?utm_source=chatgpt.com)

---

### 2. TASA

**Teaching According to Students' Aptitude: Personalized Mathematics Tutoring via Persona-, Memory-, and Forgetting-Aware LLMs**

这篇非常值得你看，因为它解决了 CoLearn 一个重要问题：

> learner state 不只是“现在掌握多少”，还要考虑 **时间导致的遗忘**。

TASA 把：

```text
Student Persona
+
Event Memory
+
Knowledge Tracing
+
Forgetting Curve
        ↓
Updated Mastery
        ↓
Difficulty-calibrated Question
```

组合起来。([arXiv][2])

论文和代码：

[TASA 论文](https://arxiv.org/abs/2511.15163?utm_source=chatgpt.com)
[TASA GitHub](https://github.com/YANGWU001/TASA?utm_source=chatgpt.com)

这个对你的面试训练尤其有意义，因为一个人的：

```text
Java
↓
熟练
↓
两个月没做
↓
可能重新下降
```

和单纯记录 `score=85` 完全不是一回事。

---

### 3. IntelliCode

**IntelliCode: A Multi-Agent LLM Tutoring System with Centralized Learner Modeling**

这篇从系统架构角度非常有意思。

它不是让多个 Agent 各自维护自己的“记忆”，而是：

```text
              ┌─ Skill Assessment
              ├─ Learner Profiler
              ├─ Hint Agent
              ├─ Curriculum Agent
Learner State ├─ Spaced Repetition
              └─ Engagement Agent
```

所有 agent 都围绕一个：

> **centralized, versioned learner state**

运行。([ACL Anthology][3])

论文特别强调：

* mastery
* misconceptions
* review schedules
* engagement signals
* versioned learner state
* single-writer policy

这一点其实和你之前一直在讨论的 **Business State 不应该放在 Agent Memory 里** 非常类似。

这里对应成：

```text
LLM memory ≠ learner state

Learner State
    ↓
deterministic state transition
    ↓
LLM uses the state
```

论文：

[IntelliCode – ACL/EACL paper](https://aclanthology.org/2026.eacl-demo.10/?utm_source=chatgpt.com)

---

### 4. GenMentor

**LLM-powered Multi-agent Framework for Goal-oriented Learning in Intelligent Tutoring System**

这是另一个很值得读的项目。

它关注的不仅是“下一道题”，而是：

```text
Learning Goal
      ↓
Skill Gap
      ↓
Learner Model
      ↓
Learning Path
      ↓
Content
      ↓
Tutor
```

论文明确包含：

* Skill Gap Identifier
* Adaptive Learner Modeler
* Learning Path Scheduler
* Tailored Content Generator
* AI Chatbot Tutor

([arXiv][4])

而且有完整开源实现：

[GenMentor GitHub](https://github.com/GeminiLight/gen-mentor?utm_source=chatgpt.com)

这个项目目前 GitHub 仍然在更新，仓库是 TypeScript，比较适合直接拿来研究工程实现。([GitHub][5])

---

## 二、开源项目里，有几个特别值得看

### 1. Tutor MCP

这个我反而认为对你现在的项目**最有参考价值**。

它的设计思想非常明确：

> LLM 不拥有 learner model，runtime 才拥有。

它把：

```text
Algorithmic State
    ├── mastery
    ├── retention
    ├── ability
    ├── transfer
    ├── misconceptions
    └── review timing

Episodic Memory
    └── session history

Narrative Memory
    └── stable learner facts

Pedagogical Runtime
    └── decides next activity
```

分开。

它甚至用了多种模型：

* BKT
* individualized BKT
* FSRS
* IRT
* PFA
* KST
* transfer assessment

而 LLM 负责：

* explanation
* hint
* question wording
* narrative memory

不是负责决定 learner state。([Tutor MCP][6])

GitHub：

[Tutor MCP GitHub](https://github.com/ArnaudGuiovanna/tutor-mcp?utm_source=chatgpt.com)

这个项目和你之前讨论的 **“deterministic workflow + probabilistic agent”** 思路非常相似。

---

### 2. OATutor

这个项目虽然不是 LLM-first，但是非常值得看，因为它把传统 ITS 的核心部分做得非常清楚：

```text
Skill Model
    ↓
BKT
    ↓
Mastery
    ↓
Adaptive Item Selection
```

它明确支持：

* BKT mastery
* adaptive item selection
* weakest-skill targeting
* hint/scaffolding
* logging
* A/B testing

而且是比较成熟的开源 ITS。([GitHub][7])

[OATutor GitHub](https://github.com/CAHLR/OATutor?utm_source=chatgpt.com)

这个项目的重要价值在于：

> 你可以把它当成 **“LLM Tutor 之前几十年的 deterministic ITS 基础设施”** 来看。

CoLearn/TASA/LLM Tutor 实际上是在往这个方向加上 LLM。

---

### 3. MathTutorBench

它不是 tutor runtime，而是：

> **如何评估一个 LLM 到底会不会当老师。**

它提供：

* datasets
* metrics
* teacher-grounded evaluation
* reward model
* open benchmark
* leaderboard

而且研究结果明确指出：

> “会做题”和“会教题”并不是同一个能力。([ACL Anthology][8])

代码：

[MathTutorBench GitHub](https://github.com/eth-lre/mathtutorbench?utm_source=chatgpt.com)

这个对你的 **AI Interview Trainer evaluation** 很有价值，因为你的评价也不应该只是：

```text
answer correctness
```

而应该测试：

```text
Did the agent diagnose the real weakness?
Did it ask a useful follow-up?
Did difficulty adapt?
Did it avoid repeating known weaknesses?
Did the candidate actually improve?
```

---

### 4. Tutorbot-Spock / CLASS

这是另外一条路线。

CLASS 的核心思想是：

> 不要只给 LLM 一个 “You are a tutor” prompt，而是把 learning science principles 变成明确的 tutor architecture。

GitHub：

[Tutorbot-Spock / CLASS GitHub](https://github.com/luffycodes/Tutorbot-Spock?utm_source=chatgpt.com)

论文：

[CLASS: A Design Framework for Building Intelligent Tutoring Systems Based on Learning Science Principles](https://arxiv.org/abs/2305.13272?utm_source=chatgpt.com)

它更偏：

```text
Pedagogical Policy
+
LLM
```

而 CoLearn 更偏：

```text
Learner Model
+
LLM
```

这两个方向最好结合起来看。

---

## 三、还有几个论文值得放进你的阅读列表

### 学习者建模 / Knowledge Tracing

经典但必须看：

**Deep Knowledge Tracing**
Piech et al., NeurIPS 2015。
这是现代 learner modeling 很重要的基础工作。

**Knowledge Tracing: A Survey**
Abdelrahman et al., ACM Computing Surveys 2023。
CoLearn 也直接引用了这篇。([arXiv][9])

---

### LLM Tutor 本身

**BIPED: Pedagogically Informed Tutoring System for ESL Education**

它不是 persistent learner-state 系统，但非常适合研究：

```text
student utterance
    ↓
tutor dialogue act
    ↓
pedagogical action
    ↓
LLM response
```

论文：

[BIPED](https://arxiv.org/abs/2406.03486?utm_source=chatgpt.com)

([Hugging Face][10])

---

**LearnLM: Improving Gemini for Learning**

这是 Google 针对 learning 场景做的模型/训练方向，CoLearn 也把它作为相关工作引用。([arXiv][9])

[LearnLM 论文](https://arxiv.org/abs/2412.16429?utm_source=chatgpt.com)

---

**The AI Teacher Test**

更早，但非常重要，因为它开始回答一个问题：

> 怎么科学评价 AI teacher，而不是只测回答正确率？

它提出比较 AI teacher 和真实教师教育对话的 evaluation 思路。([arXiv][11])

[AI Teacher Test](https://arxiv.org/abs/2205.07540?utm_source=chatgpt.com)

---

## 四、还有一个 2026 年的新方向值得特别关注

我还搜到一个与你的方向非常接近的新工作：

### Beyond ID Embeddings: Process-Grounded Language Modeling for Cognitive Diagnosis

arXiv:2609.12403。

它已经不满足于：

```text
student_id → embedding
```

而是试图让 LLM 从：

```text
concept schema
+
cognitive process graph
+
historical responses
```

构造更语义化的 learner cognitive representation。

也就是：

```text
Student
 ↓
Historical responses
 ↓
Cognitive process
 ↓
Concept graph
 ↓
Current cognitive state
```

这条路线比传统 BKT 更接近 LLM Agent。它和 CoLearn 的方向不同，但很适合你继续往下追。

---

# 五、如果针对你的 AI Interview Trainer，我会重点看这 6 个

结合你现在的项目，我不会平均看所有论文，而是按下面这个顺序：

| 优先级   | 项目/论文           | 你主要应该看什么                                             |
| ----- | --------------- | ---------------------------------------------------- |
| **1** | **CoLearn**     | `answer → diagnosis → learner state → next question` |
| **2** | **ScaffoldLM**  | `assessment-driven memory + structured progression`  |
| **3** | **Tutor MCP**   | `deterministic learner state + LLM separation`       |
| **4** | **TASA**        | `memory + forgetting + mastery evolution`            |
| **5** | **IntelliCode** | `centralized/versioned learner state + multi-agent`  |
| **6** | **GenMentor**   | `goal → skill gap → curriculum → adaptive learning`  |

然后再用：

> **MathTutorBench + AI Teacher Test**

补你的 evaluation。

---

## 六、其实这批工作给你的项目透露出一个非常明确的架构

把这些论文放在一起后，已经可以看出一个相当稳定的模式：

```text
                 ┌─────────────────────┐
                 │     Learner         │
                 └──────────┬──────────┘
                            │ answer
                            ▼
                 ┌─────────────────────┐
                 │    Assessment       │
                 │ correctness         │
                 │ misconception       │
                 │ reasoning quality   │
                 │ confidence          │
                 └──────────┬──────────┘
                            │
                            ▼
             ┌─────────────────────────────┐
             │       Learner Model         │
             │                             │
             │ mastery                     │
             │ misconceptions              │
             │ difficulty                  │
             │ retention / forgetting      │
             │ skill dependencies          │
             │ history                     │
             └─────────────┬───────────────┘
                           │
                           ▼
             ┌─────────────────────────────┐
             │     Pedagogical Policy      │
             │                             │
             │ next skill                  │
             │ next question               │
             │ hint level                  │
             │ review timing               │
             │ challenge level             │
             └─────────────┬───────────────┘
                           │
                           ▼
                    ┌────────────┐
                    │    LLM     │
                    │ generation │
                    └─────┬──────┘
                          │
                          ▼
                    next question
```

这里面最重要的思想其实不是“用 LLM 出题”。

而是：

> **把 Learner State 从 LLM 的 conversation memory 中独立出来。**

CoLearn、ScaffoldLM、TASA、Tutor MCP、IntelliCode 虽然实现不同，但都不同程度地在往这个方向走。CoLearn 自己也明确承认，目前它的 mastery estimate 是“agent belief”而不是 learner 的真实知识，并且对低水平 learner 的 diagnosis 仍然明显较弱。([arXiv][9])

这点对你的项目尤其重要：**不要直接把 `score / mastery / weakness` 当事实，而应该把它们当带证据和不确定性的 learner state。**

### 我建议你下一步直接研究这一组

我可以继续给你做一轮更深入的检索，专门找：

> **“2025–2026 年与 AI Interview Tutor / Coding Interview Agent / personalized interview coaching / learner modeling + coding education 最接近的论文和 GitHub 项目”**

这一轮会比泛教育 ITS 更贴近你现在的 `ai-interview-questions`，并且可以直接整理成 **“哪些思想值得移植到你当前代码、对应改哪些模块”**。

[1]: https://aclanthology.org/2026.acl-long.325/?utm_source=chatgpt.com "Planning-Guided Tutoring with Assessment-Driven Memory for Pedagogical LLM Tutors - ACL Anthology"
[2]: https://arxiv.org/abs/2511.15163?utm_source=chatgpt.com "Teaching According to Students' Aptitude: Personalized Mathematics Tutoring via Persona-, Memory-, and Forgetting-Aware LLMs"
[3]: https://aclanthology.org/2026.eacl-demo.10/?utm_source=chatgpt.com "IntelliCode: A Multi-Agent LLM Tutoring System with Centralized Learner Modeling - ACL Anthology"
[4]: https://arxiv.org/abs/2501.15749?utm_source=chatgpt.com "LLM-powered Multi-agent Framework for Goal-oriented Learning in Intelligent Tutoring System"
[5]: https://github.com/GeminiLight/gen-mentor?utm_source=chatgpt.com "GitHub - GeminiLight/gen-mentor: [WWW '25 Oral - GenMentor] Official code of our paper \"LLM-powered Multi-agent Framework for Goal-oriented Learning in Intelligent Tutoring System\", accepted by WWW 2025 (Industry Track) as an Oral Presentation. · GitHub"
[6]: https://www.tutor-mcp.dev/ "https://www.tutor-mcp.dev/"
[7]: https://github.com/CAHLR/OATutor?utm_source=chatgpt.com "GitHub - CAHLR/OATutor: Open Source Intelligent Tutoring System w/ BKT (ReactJS and Firebase) · GitHub"
[8]: https://aclanthology.org/2025.emnlp-main.11/?utm_source=chatgpt.com "MathTutorBench: A Benchmark for Measuring Open-ended Pedagogical Capabilities of LLM Tutors - ACL Anthology"
[9]: https://arxiv.org/html/2609.21154v1 "https://arxiv.org/html/2609.21154v1"
[10]: https://huggingface.co/papers/2406.03486 "https://huggingface.co/papers/2406.03486"
[11]: https://arxiv.org/abs/2205.07540?utm_source=chatgpt.com "The AI Teacher Test: Measuring the Pedagogical Ability of Blender and GPT-3 in Educational Dialogues"



---------------


2025–2026 年与 AI Interview Tutor / Coding Interview Agent / personalized interview coaching / learner modeling + coding education 最接近的论文和 GitHub 项目

---------------

我把范围限定为 **2025-01-01 到 2026-09-25**，重点看四类东西：

1. **AI Interview Tutor / Mock Interview Agent**
2. **Coding Interview / DSA Tutor**
3. **Learner Modeling / Knowledge Tracing for programming**
4. **跨 session 的弱项记忆 + 自适应下一题**

结论比较明确：**真正把“AI interviewer + 长期 learner model + adaptive question selection”三者完整结合起来的公开研究还不多，但 2025–2026 已经出现了一批非常接近的工作。** 其中有几项对你现在的 `ai-interview-questions` 直接有参考价值。

---

# 1. 最值得看的论文

## A. Coding Tutor 方向：和你最接近

### 1. Coding-Tutor / TRAVER — ACL Findings 2025

**Training Turn-by-Turn Verifiers for Dialogue Tutoring Agents: The Curious Case of LLMs as Your Coding Tutors**

这是目前我看到的、和你项目在“**AI 出题 → 候选人回答 → 诊断 → 再追问 → 再评估**”这条链上最接近的研究之一。

核心不是单纯让 LLM 当 coding tutor，而是：

```text
Student
  ↓
Tutor asks / guides
  ↓
Student response
  ↓
Knowledge tracing
  ↓
Turn-by-turn verification
  ↓
Next tutoring action
```

作者提出了 **Trace-and-Verify (TRAVER)**，并且配套做了 **DICT (Dialogue for Coding Tutoring)**，使用学生模拟器 + coding tests 来评估 tutoring agent，而不是只评价回答文本。论文发表于 ACL Findings 2025。([arXiv][1])

这个项目的 GitHub 不是“概念 demo”，里面直接有：

* student engine
* tutor engine
* verifier training
* simulated tutoring dialogues
* pre/post coding tests
* tutoring outcome evaluation
* human evaluation

而且有 `traver/`、`benchmark/EvoCodeBench-2403/`、`scripts/eval/` 等实际代码。([GitHub][2])

[Coding-Tutor GitHub](https://github.com/iwangjian/Coding-Tutor?utm_source=chatgpt.com)

[论文：Training Turn-by-Turn Verifiers...](https://arxiv.org/abs/2502.13311?utm_source=chatgpt.com)

### 对你最有价值的地方

你当前项目里最值得借鉴的不是“怎么生成题”，而是：

```text
candidate answer
      ↓
assessment
      ↓
learner state update
      ↓
question / follow-up decision
      ↓
evaluation
```

尤其值得把 **verifier** 和 **question generator** 分开。

你的 AI Interview Trainer 可以进一步变成：

```text
Interviewer
   │
   ├── Question Generator
   ├── Answer Assessor
   ├── Learner Model
   ├── Follow-up Policy
   └── Interview Evaluator
```

这比一个大 prompt 包办全部工作更接近这批研究的发展方向。

---

## 2. CoderAgent — IJCAI 2025

**CoderAgent: Simulating Student Behavior for Personalized Programming Learning with Large Language Models**

这篇不是 interviewer，而是 **模拟学习者**。但是对你的 learner model 非常重要。

它把 learner 拆成：

```text
Memory
Tools
Planning & Action
Reflection
```

Memory 又分成：

```text
Programming knowledge mastery
+
Coding skill / application ability
```

并且使用 ACT-R 思路模拟学习者在编程问题中的认知状态，用 **Programming Tree of Thought (PTOT)** 描述：

```text
why
 ↓
how
 ↓
where
 ↓
what
```

这使它能够模拟“某个学生为什么会犯这种错”，而不只是模拟最终答错。([DOI][3])

[CoderAgent 论文](https://arxiv.org/abs/2505.20642?utm_source=chatgpt.com)

论文明确给出了官方代码仓库：

[CoderAgent GitHub](https://github.com/USTChandsomeboy/CoderAgent?utm_source=chatgpt.com)

这个对你的项目有一个很重要的启发：

> learner model 不应该只记录 `score=72`，还应该记录“知识理解”和“应用能力”之间的差异。

例如：

```text
Binary Search
  conceptual_understanding: 0.92
  implementation_skill:     0.58
  debugging_skill:          0.31
  explanation_skill:        0.77
```

对于 AI 面试，这比单一 `topic_score` 有用得多。

---

## 3. SageJavon — 2026

**SageJavon: A scalable AI tutor for personalized programming learning**

这篇已经进入非常接近你目标的范畴：

```text
Learn
 ↓
Practice
 ↓
Evaluate
 ↓
Support
 ↓
next activity
```

它把：

* LLM
* RAG
* heuristic/follow-up questions
* adaptive knowledge tracing
* recommendation
* code evaluation

结合起来，而且做了 12 周、85 名学生的课程部署。论文 2026 年发表于 *Information Processing & Management*。([ScienceDirect][4])

它尤其值得看的是：

> **knowledge tracing → exercise recommendation → code evaluation**

也就是：

```text
Student state
     ↓
What should I ask next?
```

这正是你现在项目应该逐渐从“题目生成器”迈向的部分。

目前我能确认其官方 GitHub 组织存在，但没有在公开检索中确认到一个清晰的、独立发布的 SageJavon 主代码仓库，所以这里建议以论文为主。([ScienceDirect][4])

[SageJavon 论文](https://doi.org/10.1016/j.ipm.2025.104605?utm_source=chatgpt.com)

---

## 4. SP-TeachLLM — 2025

**SP-TeachLLM: An LLM-Driven Framework for Personalized and Adaptive Programming Education**

这篇更偏 framework，而不是面试系统。

它把：

* curriculum decomposition
* multi-strategy generation
* reflective learning
* memory augmentation

结合起来，用于个性化计算机科学/编程教学。([MDPI][5])

你可以重点看它的：

```text
curriculum
+
memory
+
reflection
+
adaptive teaching
```

如何从单轮 tutor 变成持续学习系统。

[SP-TeachLLM 论文](https://www.mdpi.com/2078-2489/16/12/1045?utm_source=chatgpt.com)

---

# 2. Interview / Mock Interview 方向

这一批和 coding tutor 论文不是完全相同的问题，但对你的 **Interviewer Agent** 部分特别有价值。

---

## 5. PolyInterview — 2026

**PolyInterview: An LLM-based Platform for Immersive Mock Interview Practice with Comprehensive Multimodal Assessment**

这是 2026 年比较新的 mock interview 工作。

核心：

```text
CV + JD
   ↓
Question generation
   ↓
Multi-turn interview
   ↓
Answer-aware follow-up
   ↓
parallel evaluators
   ↓
behavioral evidence
   ↓
actionable recommendations
```

它不是 coding interview 专项，而是通用求职面试，但它很明确地解决了：

> **下一道问题应该根据上一道回答变化。**

同时还评估：

* response content
* vocal delivery
* non-verbal behavior

通过多个 evaluator 汇总成行为/能力维度。([arXiv][6])

而且这不是只有论文：

2026 年 4 月已经上线 PolyU 的真实平台，学校披露它基于 CV/JD 生成问题、多轮面试并给出反馈；论文 7 月进一步公开了系统和使用数据。([arXiv][6])

目前公开资料里我没有确认到官方源码仓库，所以它更适合你研究 **interview-loop / evaluation architecture**，不是直接 fork 的工程项目。

[PolyInterview 论文](https://arxiv.org/abs/2607.10310?utm_source=chatgpt.com)

[PolyInterview 实际平台介绍](https://www.polyu.edu.hk/iherd/news-and-events/news/2026/20260427-polyinterview/?utm_source=chatgpt.com)

---

## 6. SimInterview — 2025

**SimInterview: Transforming Business Education through Large Language Model-Based Simulated Multilingual Interview Training System**

这篇更偏：

```text
CV
+
Job Description
+
RAG
+
LLM interviewer
+
multilingual voice
```

而不是 learner modeling。

但它非常值得你研究的是 **personalized interview generation**：

```text
Resume
    +
Job
    +
Interview history
       ↓
Question generation
       ↓
follow-up
```

并且同时考虑英语/日语场景。([arXiv][7])

[SimInterview 论文](https://arxiv.org/abs/2508.11873?utm_source=chatgpt.com)

---

## 7. MockLLM — 2025

**MockLLM: A Multi-Agent Behavior Collaboration Framework for Online Job Seeking and Recruiting**

这个和你的“agent”研究有一个很有意思的区别：

它不是把 interviewer 看成一个 prompt，而是把：

```text
Interview generation
+
Evaluation
+
Reflection memory
+
Strategy modification
```

作为持续闭环。

其中：

```text
previous interview
       ↓
reflection
       ↓
modified questioning strategy
       ↓
next interview
```

也就是 **interviewer 自己也会根据历史经验修改策略**。([IEEE Xplore][8])

不过它研究的是招聘/匹配，和你的 candidate training 不完全一样。

[MockLLM 论文](https://doi.org/10.1145/3711896.3737051?utm_source=chatgpt.com)

---

## 8. Adaptive Technical Interview Preparation via LLM — 2026

这一篇虽然学术信号明显弱于 ACL/IJCAI/EMNLP/EACL 这些会议，但工程思路和你的项目非常接近。

它做：

```text
Resume
 ↓
Skill extraction
 ↓
Initial questions
 ↓
Answer
 ↓
Evaluation
 ↓
Regenerate next question
```

特别值得注意的是，它不是生成一套固定题目，而是：

> 每回答一道题，就重新生成下一题。

同时分别评估：

* confidence
* technical correctness
* communication clarity

而且论文报告了自适应问题相对于静态问题的 relevance 对比。([DOI][3])

[论文 PDF](https://ijirt.org/publishedpaper/IJIRT203494_PAPER.pdf?utm_source=chatgpt.com)

这个更像一个“和你当前项目同类的工程原型”，而不是你应该重点依赖的学术基础。

---

# 3. Learner Model / DSA Tutor 方向

## 9. IntelliCode — EACL 2026

这个其实和你的项目架构非常接近。

**IntelliCode: A Multi-Agent LLM Tutoring System with Centralized Learner Modeling**

它的核心设计：

```text
             Central Learner State
                     │
      ┌──────────────┼──────────────┐
      ↓              ↓              ↓
Skill Assessment  Hinting       Curriculum
      ↓              ↓              ↓
      └──────────────┼──────────────┘
                     ↓
               State Update
```

Learner state 里明确包括：

* mastery
* misconceptions
* review schedule
* engagement signals

同时使用：

> centralized + versioned learner state

并要求多个 agent 作为 state transformation，而不是各自拥有一份 learner memory。([arXiv][6])

尤其值得你关注的是它的例子就是 **DSA problem**：

```text
attempt problem
  ↓
get stuck
  ↓
conceptual hint
  ↓
correct solution
  ↓
mastery update
  ↓
personalized review interval
```

这个已经非常接近：

> **AI Interview Trainer → DSA Interview Mode**

论文：

[IntelliCode — ACL Anthology](https://aclanthology.org/2026.eacl-demo.10/?utm_source=chatgpt.com)

[IntelliCode — arXiv](https://arxiv.org/html/2512.18669?utm_source=chatgpt.com)

我没有找到作者明确公开的 GitHub 源码仓库；有 live system，但这部分目前更适合研究架构而不是直接 fork。

---

## 10. TASA — AAAI 2026 Workshop

**Teaching According to Students' Aptitude**

这篇对 learner model 特别重要。

它把：

```text
Persona
+
Event Memory
+
Knowledge Tracing
+
Forgetting
```

组合起来。

尤其是：

> learner state 不是一个静态 profile，而是会随着时间衰减。

例如：

```text
Algorithm
  mastery = 0.86
  last_practice = 2 days ago

↓

30 days later

  effective mastery = lower
```

代码是公开的，而且实现了：

* LPKT
* DKT
* AKT
* SimpleKT
* forgetting model
* BGE-M3 retrieval
* student bank

([GitHub][9])

[TASA GitHub](https://github.com/YANGWU001/TASA?utm_source=chatgpt.com)

[TASA 论文](https://arxiv.org/abs/2511.15163?utm_source=chatgpt.com)

---

## 11. CoderAgent

除了论文自身，它还有一个很重要的特点：

> 它试图把“学习者怎么写代码”本身建模出来。

而不是：

```text
topic → score
```

更接近：

```text
student model
 ├── conceptual knowledge
 ├── coding ability
 ├── error pattern
 ├── coding style
 └── problem-solving trajectory
```

因此它特别适合你未来做：

```text
Interview Learner Model
```

而不是简单：

```text
Interview Score
```

([DOI][3])

---

# 4. 真正值得你直接研究的开源项目

这里反而出现了一些非常有意思的 2026 项目。

## 12. Interviewer MCP

这个我认为和你现在的项目非常贴近。

**girik-chadha/interviewer-mcp**

它不是简单的 mock interview。

它会：

```text
GitHub repository
      ↓
Code map
      ↓
Teach code
      ↓
Explain
      ↓
Mock Interview
      ↓
Score
      ↓
Weakness
      ↓
Persistent state
      ↓
下一次从 weakest point 开始
```

它有明确的持久 learner state：

```text
strong / okay / weak
per-section weakness
interview history
coverage
```

并且可以检测：

* API calls
* auth/secrets
* SQL
* concurrency
* TODO
* large functions

然后问题直接针对候选人的真实代码。([GitHub][10])

这点非常重要：

> 它把“项目代码理解”本身变成 interview curriculum。

而不是简单出一道：

> “请设计一个 URL Shortener”。

[Interviewer MCP GitHub](https://github.com/girik-chadha/interviewer-mcp?utm_source=chatgpt.com)

它特别适合你的 **Copilot Side Panel + Interview Trainer** 思路。

---

# 5. interview-forge

这里有两个值得看的实现。

### saadshahidit/interview-forge

这个更像完整产品：

```text
Resume
 ↓
ChromaDB
 ↓
LangGraph
 ↓
Question
 ↓
Answer
 ↓
Evaluate
 ↓
Mem0
 ↓
weak areas
 ↓
下一次 interview
```

它明确实现了：

* resume RAG
* coding / behavioral questions
* cross-session memory
* weak areas
* session resume
* FastAPI
* PostgreSQL
* Redis
* LangGraph

([GitHub][11])

[saadshahidit/interview-forge](https://github.com/saadshahidit/interview-forge?utm_source=chatgpt.com)

这个对你的项目最值得看的部分是：

> **Mem0 weak-area memory 如何影响下一次 question generation。**

---

### andrei-skorik/interview-forge

另一个项目更偏 interview training pipeline，支持：

* persistent session history
* JD vector analysis
* question deduplication
* LLM-as-a-judge
* Supabase / pgvector

([GitHub][12])

[andrei-skorik/interview-forge](https://github.com/andrei-skorik/interview-forge?utm_source=chatgpt.com)

---

# 6. SmartAIInterviewer

**AnupDangi/SmartAIInterviewer-SAI-**

这是一个很典型的：

```text
Coordinator Agent
        ↓
Coding Agent
        ↓
code execution
```

架构。

它已经实现：

* Resume/JD ingestion
* adaptive difficulty
* coding execution
* session persistence
* Postgres
* Google ADK
* Gemini
* Piston sandbox

其中：

```text
Coordinator
   ↓
Coding Agent
   ↓
execute_code
```

这个结构对于你的 coding interview agent 很有参考意义。([GitHub][13])

[SmartAIInterviewer GitHub](https://github.com/AnupDangi/SmartAIInterviewer-SAI-?utm_source=chatgpt.com)

但它的 learner modeling 还没有做到 CoLearn/IntelliCode/TASA 那种程度。

---

# 7. Coding-tutor skill

**zeufack/coding-tutor**

这个更偏 agent skill，而不是完整平台。

但里面已经直接把：

```text
tutor
challenger
debugger
explainer
reviewer
lecture
course-builder
interviewer
```

统一成一个 coding-learning skill family。([GitHub][14])

尤其是：

```text
/interviewer
```

已经支持技术面试模拟。

[coding-tutor GitHub](https://github.com/zeufack/coding-tutor?utm_source=chatgpt.com)

这个与你在研究的 **Skill / Agent / Copilot SDK** 方向很接近。

---

# 8. 另外几个值得快速看一下的开源工程

### Iteratr

它把：

* adaptive Elo
* coding questions
* Socratic hinting
* sandbox execution
* interview scorecard
* performance history

组合起来。([GitHub][15])

[Iteratr GitHub](https://github.com/Premshaw23/iteratr?utm_source=chatgpt.com)

它特别适合研究：

> **Elo / difficulty adaptation 是否可以作为你 learner model 的一个简单 baseline。**

---

### Intelligent Learning Assistant for Coding based on ITS

这个项目名字很直接：

> **coding interview tutor**

它已经实现：

* learner model
* recommendation engine
* revision scheduler
* topic weakness
* progress analytics
* coding problem bank
* AI tutor

([GitHub][16])

[Intelligent Learning Assistant GitHub](https://github.com/anshusinha26/Intelligent-Learning-Assistant-for-Coding-based-on-ITS?utm_source=chatgpt.com)

这个更接近传统 ITS + AI tutor 的工程实现。

---

### SmartCode

这是 2026 的编程 tutor 工程：

```text
diagnostic
 ↓
skill profile
 ↓
curriculum
 ↓
code submission
 ↓
deterministic grading
+
LLM qualitative grading
```

它非常强调：

> **deterministic code grading + LLM explanation**

([GitHub][17])

[SmartCode GitHub](https://github.com/mohddarwix/SmartCode?utm_source=chatgpt.com)

---

# 9. 还有一类项目特别值得你注意：Agent 本身就是 Tutor

### Upstack

它不是 interview-only，但方向很接近：

> 不让 coding agent 直接给答案，而是让它成为 tutor。

核心是：

```text
Guide
≠
Answer

Productive struggle
+
learning journal
+
adaptive difficulty
```

([GitHub][18])

[Upstack GitHub](https://github.com/ishands/upstack?utm_source=chatgpt.com)

---

### personal-tutor

这个项目的理念也很接近：

> “Turn your coding agent into a tutor that learns how you learn.”

它强调：

```text
mistake
→
reflection
→
learner history
→
future tutoring
```

([GitHub][19])

[personal-tutor GitHub](https://github.com/briannajzhang/personal-tutor?utm_source=chatgpt.com)

---

# 10. 如果把这些项目放一起，你的项目实际上缺的不是“更多题目”

目前这批 2025–2026 工作已经非常明显地形成了一个结构：

```text
                   Candidate
                       │
                       ▼
                ┌───────────────┐
                │ Answer/Action │
                └───────┬───────┘
                        │
                        ▼
              ┌───────────────────┐
              │    Assessment     │
              │ correctness       │
              │ reasoning         │
              │ misconception     │
              │ confidence        │
              │ communication     │
              └─────────┬─────────┘
                        │
                        ▼
              ┌───────────────────┐
              │   Learner Model   │
              │                   │
              │ concept mastery   │
              │ coding skill      │
              │ explanation       │
              │ misconception     │
              │ weak areas        │
              │ difficulty        │
              │ retention         │
              │ interview history │
              └─────────┬─────────┘
                        │
                        ▼
              ┌───────────────────┐
              │ Question Policy   │
              │                   │
              │ next skill        │
              │ next difficulty   │
              │ follow-up         │
              │ hint              │
              │ review            │
              └─────────┬─────────┘
                        │
                        ▼
                 Question Generator
                        │
                        ▼
                   Next Question
```

这比传统：

```text
question bank
   ↓
LLM
   ↓
next question
```

已经是完全不同的系统。

---

# 11. 对你的 `ai-interview-questions`，我认为最值得吸收的是这 7 个思想

不是照搬这些项目，而是把它们拼成你自己的架构。

### ① TRAVER：增加独立的 Answer Verifier

不要：

```text
LLM:
  answer → score → next question
```

而应该：

```text
answer
 ↓
Verifier
 ↓
structured assessment
 ↓
Learner Model update
 ↓
Question Policy
```

Coding-Tutor 已经验证了这种拆分方式。([GitHub][2])

---

### ② CoderAgent：把“会不会”拆开

不要只有：

```text
algorithm mastery = 0.73
```

至少拆：

```text
concept
implementation
debugging
reasoning
communication
```

CoderAgent 的“知识 mastery + coding ability”思路非常适合拿来做基础模型。([DOI][3])

---

### ③ IntelliCode：Learner State 必须是独立对象

这一点我认为尤其重要：

```text
Agent Memory
       ≠
Learner State
```

而是：

```text
LearnerState
  ↓
question selection
  ↓
LLM generation
```

这样以后换：

* OpenAI
* Claude
* Gemini
* DeepSeek
* local model

learner model 都不需要重建。

IntelliCode 的 centralized/versioned learner state 正好验证了这个方向。([arXiv][6])

---

### ④ TASA：加入时间

你现在如果：

```text
System Design = 0.81
```

这个值是不够的。

至少还应该有：

```text
last_seen
attempt_count
recent_success
retention_estimate
```

然后允许：

```text
mastery_now
```

和

```text
historical_mastery
```

不同。

TASA 对这一点处理得非常明确。([GitHub][9])

---

### ⑤ Interviewer MCP：让题目来自“真实项目”

对于 AI interview，纯 DSA 题库其实只是其中一类。

另一个非常有价值的模式是：

```text
candidate repo
      ↓
code map
      ↓
interview targets
      ↓
weak explanation
      ↓
下一次继续追
```

Interviewer MCP 已经把这件事做成了一个可运行 MCP server。([GitHub][10])

这与你之前希望 **Copilot SidePanel 不要和 Interview Trainer 割裂** 的思路尤其一致。

---

### ⑥ MockLLM / PolyInterview：Follow-up 本身应该成为独立能力

不要把：

```text
follow-up
```

当成 prompt 里的一个小要求。

可以变成：

```text
FollowUpPolicy
```

输入：

```text
candidate_answer
current_skill
learner_state
interview_stage
question_history
```

输出：

```text
probe_type
target
depth
difficulty
```

然后才交给 LLM 写自然语言。

---

### ⑦ Coding-Tutor / SageJavon：一定保留 deterministic signal

例如代码题：

```text
tests_passed = 7/10
runtime = 430ms
complexity = O(n²)
hint_count = 3
```

这些不要让 LLM “判断”。

LLM 负责：

```text
为什么错
哪里理解错
如何追问
怎么给 hint
```

而 deterministic evaluator 负责：

```text
事实
```

这也是 TRAVER、SageJavon 这类系统值得借鉴的共同点。([GitHub][2])

---

# 12. 我会把阅读路线压缩成这一条

针对你自己的项目，不需要把几十篇都读完。

### 第一层：直接决定架构

**1. Coding-Tutor / TRAVER**
看 `knowledge tracing + verifier + tutoring loop`。([GitHub][2])

**2. IntelliCode**
看 `centralized learner state + multi-agent orchestration`。([arXiv][6])

**3. CoLearn**
看 `persistent learner state + misconception + adaptive next question`。

**4. TASA**
看 `event memory + forgetting + mastery over time`。([GitHub][9])

**5. CoderAgent**
看 `conceptual knowledge vs coding ability + simulated learner`。([DOI][3])

### 第二层：直接研究工程

**6. Interviewer MCP**
研究 repo-aware interview + persistent weak spots。([GitHub][10])

**7. saadshahidit/interview-forge**
研究 RAG + Mem0 + LangGraph + cross-session weakness。([GitHub][11])

**8. SmartAIInterviewer**
研究 Coordinator + Coding Agent + code execution + persistence。([GitHub][13])

**9. Iteratr**
研究 adaptive difficulty / Elo + coding execution。([GitHub][15])

**10. coding-tutor**
研究如何把 interviewer/tutor/debugger/course-builder 做成 Agent Skill。([GitHub][14])

---

## 最值得你注意的一个变化

2025–2026 的研究已经开始从：

> **“LLM 能不能当 interviewer？”**

转向：

> **“如何维护一个持续更新的 candidate model，并让每一次 interview 都改变下一次训练内容？”**

而这正好与你现在的 AI Interview Trainer 下一阶段演进方向高度重合。

真正值得研究的核心对象已经不是 `Question`，而是：

```text
Candidate
  ↓
Evidence
  ↓
Learner State
  ↓
Assessment
  ↓
Interview Policy
  ↓
Question
```

这也是我认为你现有项目最值得继续往下改的方向。

[1]: https://arxiv.org/abs/2502.13311?utm_source=chatgpt.com "Training Turn-by-Turn Verifiers for Dialogue Tutoring Agents: The Curious Case of LLMs as Your Coding Tutors"
[2]: https://github.com/iwangjian/Coding-Tutor "GitHub - iwangjian/Coding-Tutor: [ACL 2025 Findings] Training Turn-by-Turn Verifiers for Dialogue Tutoring Agents: The Curious Case of LLMs as Your Coding Tutors · GitHub"
[3]: https://doi.org/10.48550/arXiv.2505.20642?utm_source=chatgpt.com "[2505.20642] CoderAgent: Simulating Student Behavior for Personalized Programming Learning with Large Language Models"
[4]: https://www.sciencedirect.com/science/article/pii/S0306457325005461?utm_source=chatgpt.com "SageJavon: A scalable AI tutor for personalized programming learning - ScienceDirect"
[5]: https://www.mdpi.com/2078-2489/16/12/1045?utm_source=chatgpt.com "SP-TeachLLM: An LLM-Driven Framework for Personalized and Adaptive Programming Education"
[6]: https://arxiv.org/abs/2607.10310?utm_source=chatgpt.com "PolyInterview: An LLM-based Platform for Immersive Mock Interview Practice with Comprehensive Multimodal Assessment"
[7]: https://arxiv.org/abs/2508.11873?utm_source=chatgpt.com "SimInterview: Transforming Business Education through Large Language Model-Based Simulated Multilingual Interview Training System"
[8]: https://ieeexplore.ieee.org/document/11005032/?utm_source=chatgpt.com "AI Based Mock Interview System Using Natural Language Processing | IEEE Conference Publication | IEEE Xplore"
[9]: https://github.com/YANGWU001/TASA?utm_source=chatgpt.com "GitHub - YANGWU001/TASA: [AAAI 2026 workshop] Teaching According to Students’ Aptitude: Personalized Mathematics Tutoring via Persona-, Memory-, and Forgetting-Aware LLMs · GitHub"
[10]: https://github.com/OneMore07/skill-interview-forge?utm_source=chatgpt.com "GitHub - OneMore07/skill-interview-forge: Claude Code skill: skill-interview-forge · GitHub"
[11]: https://github.com/saadshahidit/interview-forge "GitHub - saadshahidit/interview-forge: Full-stack AI mock interview platform with RAG. Indexes your resume into ChromaDB and uses GPT-4o + LangGraph to generate personalised interview questions. Supports voice mode with Web Speech API, tracks weak areas across sessions with Mem0, and produces detailed feedback reports. React, TypeScript, FastAPI, Python, PostgreSQL, Redis. · GitHub"
[12]: https://github.com/andrei-skorik/interview-forge?utm_source=chatgpt.com "GitHub - andrei-skorik/interview-forge: AI-powered mock interview trainer for EU IT market. Built with Streamlit, OpenRouter LLMs, Supabase, and pgvector. · GitHub"
[13]: https://github.com/liutaocode/talking-face-arxiv-daily?utm_source=chatgpt.com "GitHub - liutaocode/talking-face-arxiv-daily: 🎓 Update Talking-Face Research Papers Daily · GitHub"
[14]: https://github.com/zeufack/coding-tutor "GitHub - zeufack/coding-tutor: A skill to turn you coding agent into conding instructor, tutor. · GitHub"
[15]: https://github.com/saadshahidit/interview-forge?utm_source=chatgpt.com "GitHub - saadshahidit/interview-forge: Full-stack AI mock interview platform with RAG. Indexes your resume into ChromaDB and uses GPT-4o + LangGraph to generate personalised interview questions. Supports voice mode with Web Speech API, tracks weak areas across sessions with Mem0, and produces detailed feedback reports. React, TypeScript, FastAPI, Python, PostgreSQL, Redis. · GitHub"
[16]: https://github.com/anshusinha26/Intelligent-Learning-Assistant-for-Coding-based-on-ITS "GitHub - anshusinha26/Intelligent-Learning-Assistant-for-Coding-based-on-ITS: An intelligent web-based coding interview tutor that analyzes your practice and errors to recommend optimal next problems, track topic-level weaknesses, schedule spaced-repetition reviews, and deliver interpretable progress analytics. · GitHub"
[17]: https://github.com/mohddarwix/SmartCode?utm_source=chatgpt.com "GitHub - mohddarwix/SmartCode: Adaptive AI-powered Python programming tutor with personalized diagnostics, hints, and a code sandbox · GitHub"
[18]: https://github.com/ishands/upstack?utm_source=chatgpt.com "GitHub - ishands/upstack: An open-source framework that configures AI as a genuine tutor — not an answer machine. · GitHub"
[19]: https://github.com/briannajzhang/personal-tutor/blob/main/README.md?utm_source=chatgpt.com "personal-tutor/README.md at main · briannajzhang/personal-tutor · GitHub"


------------------

数据集

------------------

有，而且这次检索后我认为 **Hugging Face 比 Kaggle 更有价值**。尤其是已经出现了几份与你的 `AI Interview Trainer` / `CoLearn` 思路高度贴近的数据。

## 先给结论

我会把可用资源分成四层：

| 层     | 资源                                                     | 适合你做什么                                                 |
| ----- | ------------------------------------------------------ | ------------------------------------------------------ |
| **A** | PACT / synthetic-coding-tutor / ROTUT                  | 训练“会追问、会给 hint”的 Tutor                                 |
| **B** | coding-interview-sft-100k / ML Systems Interview Bench | 训练/构造 Interview Question + Rubric                      |
| **C** | KodCode                                                | 题目、标准答案、单元测试、难度                                        |
| **D** | EdNet / ASSISTments / Kaggle KT                        | Learner Model / Knowledge Tracing / Adaptive Selection |

真正比较有价值的是把 **A+B+C+D 拼起来**，而不是找一个“万能 AI Interview Dataset”。

---

# 一、最值得看的 Hugging Face 数据集

## 1. PACT — Personal AI Coding Tutor Dataset

这个非常值得你直接下载研究。

**AndreiSobo/PACT-Socratic-Coding-Tutor**

它不是普通 coding QA，而是：

```text
Coding Problem
+
Student's wrong code
        ↓
Socratic Tutor
        ↓
Hint
        ↓
Student continues
```

目前是 **227 条高质量 synthetic examples**，专门训练 coding tutor 的 Socratic 行为。每条数据是多轮 ChatML，可以直接用于 Qwen/Llama 类模型微调。([huggingface.co](https://huggingface.co/datasets/AndreiSobo/PACT-Socratic-Coding-Tutor?utm_source=chatgpt.com))

更有意思的是它不是简单让 LLM 自己生成：

> Generator → Student attempt → Tutor hint

而是又用了一个独立的 **pedagogical critic** 做筛选，最终从 287 条保留 227 条。([huggingface.co](https://huggingface.co/datasets/AndreiSobo/PACT-Socratic-Coding-Tutor?utm_source=chatgpt.com))

而且已经有人基于它训练了：

**`AndreiSobo/pact-qwen-tutor`**

以及一个 Granite Socratic Tutor。([huggingface.co](https://huggingface.co/datasets/AndreiSobo/PACT-Socratic-Coding-Tutor?utm_source=chatgpt.com))

[PACT Dataset](https://huggingface.co/datasets/AndreiSobo/PACT-Socratic-Coding-Tutor?utm_source=chatgpt.com)

---

# 2. synthetic-coding-tutor

这个甚至比 PACT 更接近你的目标数据结构：

**hbudhi36/synthetic-coding-tutor**

它包含：

```text
task_id
personality
knowledge_level
strategy
problem_text
test_cases
conversation
solved
tests_passed
total_tests
turns
quality_bucket
timestamp
```

尤其值得注意的是：

> `knowledge_level`
>
> `strategy`
>
> `tests_passed`
>
> `turns`

这意味着它已经不只是：

```text
question → answer
```

而更接近：

```text
learner state
    +
problem
    +
tutor strategy
    ↓
interaction
    ↓
outcome
```

这和你现在想做的 learner model 非常接近。

数据量是约 **500 个 task**，每个 task 有不同对话轮次。

[synthetic-coding-tutor](https://huggingface.co/datasets/hbudhi36/synthetic-coding-tutor?utm_source=chatgpt.com)

---

# 3. ROTUT — Synthetic Socratic Tutoring Conversations

**breitburg/rotut**

这个更偏通用 tutoring，但机制非常值得借鉴：

```text
Student misconception
        ↓
Tutor detects mental model
        ↓
one question
        ↓
student responds
        ↓
next question
```

它明确要求 tutor：

> **不要直接告诉答案，而是一问一问把学生带到答案。**

每段对话大约 4–6 个 tutor turns，而且 assistant 数据还包含：

```text
reasoning
content
```

也就是说，它已经在显式记录：

> Tutor 为什么要问这个问题。

这对你的：

```text
Why this question?
Why follow-up?
Why this hint?
```

非常有用。([Hugging Face][1])

[ROTUT](https://huggingface.co/datasets/breitburg/rotut?utm_source=chatgpt.com)

---

# 4. Eedi Question-Anchored Tutoring Dialogues

这个比 synthetic 数据更重要，因为它是**真实 tutoring interaction**。

**Eedi/Question-Anchored-Tutoring-Dialogues-2k**

目前 HF 上：

* 约 **68.7K rows**
* train 约 **55.3K**
* 每条对应真实 tutor/student dialogue
* 有 question metadata
* 有 subject/topic/subtopic
* 有 tutor/student turn
* 有 Talk Move annotation。([Hugging Face][2])

这类数据特别适合训练：

```text
answer
 ↓
identify misunderstanding
 ↓
choose pedagogical move
 ↓
ask follow-up
```

唯一需要注意：

> 它是数学 tutor，不是 coding tutor。

但是 **“如何追问”** 本身很容易迁移到 coding interview。

许可证目前是 CC BY-NC-SA 4.0，明确偏非商业研究用途。([Hugging Face][2])

[Eedi Tutoring Dialogues](https://huggingface.co/datasets/Eedi/Question-Anchored-Tutoring-Dialogues-2k?utm_source=chatgpt.com)

---

# 5. MathMentorDB

另一个很有价值的真实 tutoring 数据集：

**mathmentordb/MathMentorDB**

完整语料有：

* 5.4M messages
* 200,332 conversations
* 43,249 users

目前 HF 发布的是经过标注的子集：

* 7,000 conversations
* 165,275 messages
* 24-move discourse taxonomy
* resolution labels。([Hugging Face][3])

它的意义在于：

> 可以研究 **Tutor Action Sequence**。

比如：

```text
explain
→ ask
→ probe
→ hint
→ challenge
→ verify
```

对于你的 Interview Agent，这可能比简单的“标准答案数据”更有价值。

[MathMentorDB](https://huggingface.co/datasets/mathmentordb/MathMentorDB?utm_source=chatgpt.com)

---

# 6. TutorBench

**tutorbench/tutorbench**

这个更适合做 evaluation。

数据中包括：

```text
PROMPT
INITIAL_EXPLANATION
FOLLOW_UP_PROMPT
RUBRICS
Bloom taxonomy
```

完整集合 1,490 samples / 15,220 rubric criteria，HF 上目前有一个 30 条 preview。([Hugging Face][4])

这和你自己的 evaluator 很接近：

```text
question
candidate answer
       ↓
rubric
       ↓
assessment
```

所以你可以把它作为 **interview evaluator 的设计参考**，而不是训练数据本身。

---

# 7. EduAgentBench

这个是我建议你额外关注的 benchmark：

**eduagentbench/eduagentbench**

它是：

> **150-task benchmark for AI tutor agents**

专门测试：

* pedagogical judgment
* multi-turn tutoring
* teaching workflow execution

而且已经有 synthetic course state / domain policy / task manifest。([Hugging Face][5])

这个方向和你一直在研究的：

```text
Agent
+
Workflow
+
State
+
Policy
+
Evaluation
```

非常接近。

[EduAgentBench](https://huggingface.co/datasets/eduagentbench/eduagentbench?utm_source=chatgpt.com)

---

# 二、Interview 专用数据集

## 8. coding-interview-sft-100k

这个在数量上非常有吸引力：

**stindardlogic/coding-interview-sft-100k**

约 **100,000 conversations**，覆盖：

* algorithms
* data structures
* system design
* behavioral
* multiple difficulty levels

其中比较重要的是每条回答不仅有答案，还有：

* pattern identification
* reasoning
* complexity
* edge cases
* follow-up
* STAR

也就是说：

```text
Question
+
Expected reasoning
+
Answer
+
Follow-up
+
Complexity
```

这个很适合给你的 **Question Generator / Answer Coach** 打底。

但有一个区别：

> 它更像 **expert answer / SFT dataset**，不是 learner trajectory dataset。

所以不要直接把它当 CoLearn 那种 learner model 数据。

[coding-interview-sft-100k](https://huggingface.co/datasets/stindardlogic/coding-interview-sft-100k?utm_source=chatgpt.com)

---

# 9. ML Systems Interview Bench

这个反而非常适合你的项目结构：

**Max00035/ml-systems-interview-bench**

每个 record 有：

```text
question
domain
difficulty
question_type
expected_concepts
reference_answer
evaluation_rubric
follow_up_questions
skills
answer_dimensions
max_score
```

这已经几乎是你现在项目想要的：

```text
Question
   ↓
expected concepts
   ↓
answer
   ↓
rubric
   ↓
follow-up
```

特别是：

> `expected_concepts`

非常适合作为 **Learner Model 的 concept evidence**。

例如：

```text
Q:
设计一个高并发订单系统

expected_concepts:
  - idempotency
  - consistency
  - queue
  - sharding
  - caching
```

候选人回答之后，不应该只是得到：

```text
score = 76
```

而是：

```text
idempotency = strong
queue = strong
sharding = weak
cache invalidation = missing
```

然后下一题针对：

```text
cache invalidation
```

这就是你需要的 learner state。

[ML Systems Interview Bench](https://huggingface.co/datasets/Max00035/ml-systems-interview-bench?utm_source=chatgpt.com)

---

# 三、Coding 题目 / 标准答案 / Test 数据

## 10. KodCode

这个不是 tutor dataset，但是对于你的 **Question Bank** 非常强。

**KodCode/KodCode-V1-SFT-R1**

包含多个子集：

```text
LeetCode
Codeforces
Apps
Taco
Code Contests
Algorithm
Data Structure
Docs
...
```

而且每条有：

```text
question
solution
test
test_info
difficulty signal
conversation
```

最重要的是：

> solution 和 test 是配对验证的。

所以你的：

```text
question generation
+
code execution
+
objective evaluation
```

可以建立在这类数据上，而不是完全依赖 LLM judge。([huggingface.co](https://huggingface.co/datasets/KodCode/KodCode-V1-SFT-R1?utm_source=chatgpt.com))

[KodCode-V1-SFT-R1](https://huggingface.co/datasets/KodCode/KodCode-V1-SFT-R1?utm_source=chatgpt.com)

---

# 四、Learner Model 最值得用的：EdNet

## 11. EdNet

如果你想真正实验：

> **“candidate skill state 怎么随 interaction 更新？”**

EdNet 仍然是非常好的 baseline。

HF 上已经有人镜像：

**mgor/EDNet**

规模非常大：

* KT1：95.3M rows
* KT2：56.4M
* KT3：89.3M
* KT4：131M
* 13.2K questions。([Hugging Face][6])

原始 EdNet 是 Riiid 的真实教育系统 interaction 数据。

其中最重要的是：

```text
user
timestamp
question
answer
elapsed_time
...
```

而 KT2–KT4 更进一步记录行为：

```text
enter
respond
submit
```

因此它特别适合研究：

```text
Learner state
     ↓
next question
```

而不是只训练一个 chatbot。

Kaggle 也有对应的 Riiid Answer Correctness Prediction competition/data，目标就是 **Knowledge Tracing**。([Kaggle][7])

[EdNet on Hugging Face](https://huggingface.co/datasets/mgor/EDNet?utm_source=chatgpt.com)

[Riiid / EdNet Kaggle](https://www.kaggle.com/competitions/riiid-test-answer-prediction?utm_source=chatgpt.com)

---

# 五、Kaggle：有，但用途不太一样

Kaggle 上真正对你的项目有价值的，不太是“AI Interview Dataset”，而是 **learner interaction / adaptive learning**。

## 12. Riiid Answer Correctness Prediction

这是 Kaggle 中我最推荐你看的：

```text
student
+
question
+
answer
+
time
        ↓
Knowledge Tracing
        ↓
future performance
```

它的目标就是预测学生下一次表现。([Kaggle][7])

这正是你将来可以拿来做：

```text
candidate
+
interview question
+
answer history
        ↓
estimated skill
        ↓
next question
```

的 baseline。

---

## 13. Data Structures learning dataset

Kaggle 还有一些直接针对 Data Structures 学习的数据，例如：

**College Data Structures Learning Dataset**

包含：

* programming experience
* module
* difficulty
* quiz
* assignment
* comprehension
* previous module
* next module
* reward

这种数据特别适合研究：

```text
next best topic
```

而不是 LLM 本身。

---

## 14. CNC Learner Interaction Dataset

这个比较有意思：

**CNC Virtual Simulation Learner Interaction and Performance Dataset**

它有：

```text
code entry
error correction
hint request
idle time
confidence
quiz
task completion
```

这个思路其实非常适合 coding education。

因为它记录的不是：

```text
correct / incorrect
```

而是：

```text
coding behavior
```

这恰好是你后面 learner model 可以进一步吸收的东西。

---

# 六、如果要做你的 AI Interview Trainer，我不会直接拿一个数据集训练

我会构造一个组合数据集：

```text
                     ┌─────────────────┐
                     │ Interview Bank  │
                     │                 │
                     │ 100K SFT        │
                     │ ML Systems      │
                     │ KodCode         │
                     └────────┬────────┘
                              │
                              ▼
                     Question Generator
                              │
                              ▼
                    ┌─────────────────┐
                    │ Candidate Model │
                    │                 │
                    │ mastery         │
                    │ misconceptions  │
                    │ difficulty      │
                    │ confidence      │
                    │ communication   │
                    └────────┬────────┘
                             │
                             ▼
                    Candidate Simulator
                             │
                             ▼
                     Answer / Code
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
       deterministic                  LLM assessor
       code evaluator                       │
              │                             │
              └──────────────┬──────────────┘
                             ▼
                       State Update
                             │
                             ▼
                       Next Question
```

这样可以产生你目前最缺少的一种数据：

```text
candidate_id
session_id
question_id

learner_state_before
question
answer
assessment
mistakes
misconceptions

learner_state_after

next_question
```

这个数据结构才真正接近 **CoLearn + Coding-Tutor + CoderAgent + IntelliCode**。

---

# 七、如果你还想找“可以直接拿来跑的模型”

这里反而要注意：

**目前 Hugging Face 上专门针对“AI coding interview tutor + persistent learner modeling”的成熟开源大模型非常少。**

目前比较现实的路线是：

```text
Qwen / Llama / Gemma
       +
PACT / ROTUT / coding-tutor data
       +
your own interview trajectory data
```

而不是去找一个叫：

> `CodingInterviewTutor-7B`

然后直接拿来用。

PACT 已经有一个实际 fine-tune：

**`AndreiSobo/pact-qwen-tutor`**

这是目前我看到与你需求最直接匹配的公开模型之一。([Hugging Face][8])

---

# 八、对你这个项目，我会实际采用这几个资源

| 用途                        | 数据/模型                          | 建议                         |
| ------------------------- | ------------------------------ | -------------------------- |
| Tutor 行为                  | **PACT**                       | 非常值得直接使用                   |
| Socratic follow-up        | **ROTUT**                      | 用来训练/评估追问                  |
| 真实 tutoring 行为            | **Eedi Dialogues**             | 非常适合学习 turn-level pedagogy |
| Interview Question        | **coding-interview-sft-100k**  | 扩充题库                       |
| Interview rubric          | **ML Systems Interview Bench** | 强烈建议研究 schema              |
| Coding Question           | **KodCode**                    | 强                          |
| Coding evaluation         | **KodCode tests**              | 强                          |
| Learner model baseline    | **EdNet**                      | 强                          |
| Programming learner model | **CoderAgent data/code**       | 强                          |
| Tutor agent evaluation    | **EduAgentBench / TutorBench** | 很有价值                       |
| 小模型 Tutor                 | **pact-qwen-tutor**            | 可以直接试                      |

---

## 最关键的一点

对于你现在的项目，我其实**不建议第一步去 fine-tune 一个 Tutor 大模型**。

你现在缺的主要不是：

> “模型不会当面试官。”

而是：

> **没有足够结构化的 `candidate trajectory → learner state → next question` 数据。**

所以最有价值的实验反而是：

```text
PACT
+
coding-interview-sft-100k
+
ML Systems Interview Bench
+
KodCode
+
EdNet/CoderAgent

             ↓

Synthetic Candidate Simulator

             ↓

10k / 100k interview trajectories

             ↓

learner_state dataset

             ↓

Question Policy / Learner Model
```

然后再决定是否需要 fine-tune。

这样会比直接拿一个 coding LLM 做 SFT 更接近 **CoLearn** 的核心思想。

另外，**Kaggle 上真正“AI interview tutor”数据目前明显少于 Hugging Face；Kaggle 的优势反而是 Riiid/EdNet 这一类大规模 learner-interaction 数据**。([Kaggle][7])

[1]: https://huggingface.co/datasets/breitburg/rotut?utm_source=chatgpt.com "breitburg/rotut · Datasets at Hugging Face"
[2]: https://huggingface.co/datasets/Eedi/Question-Anchored-Tutoring-Dialogues-2k?utm_source=chatgpt.com "Eedi/Question-Anchored-Tutoring-Dialogues-2k · Datasets at Hugging Face"
[3]: https://huggingface.co/datasets/mathmentordb/MathMentorDB?utm_source=chatgpt.com "mathmentordb/MathMentorDB · Datasets at Hugging Face"
[4]: https://huggingface.co/datasets/tutorbench/tutorbench?utm_source=chatgpt.com "tutorbench/tutorbench · Datasets at Hugging Face"
[5]: https://huggingface.co/datasets/eduagentbench/eduagentbench?utm_source=chatgpt.com "eduagentbench/eduagentbench · Datasets at Hugging Face"
[6]: https://huggingface.co/datasets/nooruiit-864/hinglish-ai-ml-tutor-dataset?utm_source=chatgpt.com "nooruiit-864/hinglish-ai-ml-tutor-dataset · Datasets at Hugging Face"
[7]: https://www.kaggle.com/competitions/riiid-test-answer-prediction/overview?utm_source=chatgpt.com "Riiid Answer Correctness Prediction | Kaggle"
[8]: https://huggingface.co/datasets/AndreiSobo/PACT-Socratic-Coding-Tutor?utm_source=chatgpt.com "AndreiSobo/PACT-Socratic-Coding-Tutor · Datasets at Hugging Face"
