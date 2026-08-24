可以。结合你现在的项目，我会**优先 Node.js/TypeScript**，而不是 Python。

原因很简单：你现有项目已经是 TS，`Question`、taxonomy、Zod、LLM provider、embedding、validation 都可以直接复用。Python 更适合后面做 IRT/统计分析，而这个 **course authoring pipeline 本质是 ETL + LLM structured generation + validation**，TS 很合适。

我建议不要写成一个巨大脚本，而是做成一个很小的 pipeline CLI：

```text
scripts/course/
├── ingest.ts
├── extract-knowledge.ts
├── build-blueprint.ts
├── generate-questions.ts
├── validate.ts
├── coverage.ts
└── pipeline.ts
```

---

# 1. 整体 Pipeline

我会设计成：

```text
course source
     │
     ▼
┌─────────────┐
│   ingest    │
└──────┬──────┘
       ▼
materials.json
       │
       ▼
┌─────────────────────┐
│ extract-knowledge   │ ← LLM
└──────────┬──────────┘
           ▼
knowledge.json
           │
           ▼
┌─────────────────────┐
│ build-blueprint     │ ← deterministic + LLM
└──────────┬──────────┘
           ▼
blueprint.json
           │
           ▼
┌─────────────────────┐
│ generate-questions  │ ← LLM
└──────────┬──────────┘
           ▼
questions.raw.json
           │
           ▼
┌─────────────────────┐
│ validate             │ ← Zod + rules + embedding
└──────────┬──────────┘
           ▼
questions.json
           │
           ▼
┌─────────────────────┐
│ coverage             │ ← deterministic
└─────────────────────┘
```

最重要的是：

> **每一步都有独立 artifact。**

不要：

```bash
npm run course:generate course.md
```

然后一次性生成最终 JSON。

---

# 2. 推荐目录

例如：

```text
data/
  courses/
    mit-6s191/
      course.json
      materials.json
      knowledge.json
      blueprint.json
      questions.raw.json
      questions.json
      coverage.json
      validation.json

scripts/
  course/
    types.ts
    schemas.ts
    ingest.ts
    extract-knowledge.ts
    build-blueprint.ts
    generate-questions.ts
    validate.ts
    coverage.ts
    pipeline.ts
```

这样非常容易 debug。

---

# 3. Course Manifest

首先：

```json
{
  "id": "mit-6s191",
  "title": "Introduction to Deep Learning",
  "provider": "MIT",
  "year": 2025,
  "language": "en",
  "sourceUrl": "...",
  "license": "...",
  "materials": [
    {
      "id": "lecture-01",
      "type": "lecture",
      "title": "Introduction",
      "path": "materials/lecture-01.md"
    }
  ]
}
```

---

# 4. 用 Zod 定义中间结构

你最近已经准备引入 Zod，这里正好非常适合。

```ts
import { z } from 'zod';

export const CourseSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string(),
  year: z.number().optional(),
  language: z.string(),
  sourceUrl: z.string().url(),
  license: z.string().optional(),
});

export const KnowledgeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  importance: z.enum(['core', 'important', 'supporting']),
  prerequisites: z.array(z.string()),
  sourceMaterialIds: z.array(z.string()),
});

export const KnowledgeMapSchema = z.object({
  courseId: z.string(),
  concepts: z.array(KnowledgeSchema),
});
```

---

# 5. 第一步：Extract Knowledge

这里才第一次调用 LLM。

输入：

```text
lecture-01.md
lecture-02.md
...
```

但不要把整个课程一次塞给 LLM。

应该：

```text
lecture
 ↓
chunk
 ↓
extract concepts
 ↓
merge
 ↓
deduplicate
 ↓
knowledge graph
```

---

# 6. Prompt

例如：

```ts
const SYSTEM_PROMPT = `
You are an expert curriculum designer.

Analyze the provided course material and identify
knowledge concepts that are actually taught.

Do not generate questions.

For each concept provide:

- id
- title
- description
- importance
- prerequisites
- sourceMaterialIds

Rules:

1. Only extract concepts supported by the material.
2. Do not introduce external knowledge.
3. Merge synonymous concepts.
4. Prefer meaningful technical concepts over keywords.
5. Do not create concepts for historical/background information
   unless it is explicitly taught as learning material.
`;
```

然后：

```ts
const result = await llm.generateStructured(
  SYSTEM_PROMPT,
  material
);

const concepts = KnowledgeMapSchema.parse(result);
```

---

# 7. 第二步：Merge Knowledge

这是一个**非常重要的 deterministic step**。

因为：

```text
Lecture 1:
"attention mechanism"

Lecture 3:
"self-attention"

Lecture 5:
"scaled dot-product attention"
```

LLM 可能产生三个 concept。

你需要：

```text
candidate concepts
       ↓
embedding similarity
       ↓
candidate clusters
       ↓
LLM merge decision
       ↓
canonical concept
```

这里可以：

```text
embedding
+
cosine similarity
```

先筛选。

不要让 LLM 对所有 concept 做 O(n²) 比较。

---

# 8. 第三步：Build Blueprint

这个阶段不要生成题。

例如：

```json
{
  "knowledgeId": "self-attention",
  "questionCount": 5,
  "angles": [
    "concept",
    "mechanism",
    "comparison",
    "application",
    "limitation"
  ]
}
```

但课程题库不需要你现在 AI Trainer 那套完整 `Concept × Angle`。

我建议课程只用：

```ts
type CourseQuestionAngle =
  | 'concept'
  | 'mechanism'
  | 'intuition'
  | 'application'
  | 'comparison'
  | 'limitation'
  | 'calculation';
```

然后 deterministic 分配：

```ts
function questionCount(k: Knowledge): number {
  switch (k.importance) {
    case 'core':
      return 4;
    case 'important':
      return 2;
    case 'supporting':
      return 1;
  }
}
```

再根据知识类型选择 angle。

---

# 9. Blueprint 可以长这样

```json
{
  "courseId": "mit-6s191",
  "items": [
    {
      "knowledgeId": "self-attention",
      "questionCount": 5,
      "angles": [
        "concept",
        "mechanism",
        "intuition",
        "comparison",
        "limitation"
      ]
    }
  ]
}
```

这样你以后非常容易检查：

> 为什么生成 5 道？

答案是：

> 因为它是 core concept，而且覆盖了 5 个不同认知角度。

---

# 10. 第四步：Generate Questions

这才是真正的题目生成。

但这里有一个关键设计：

### 一次只生成一个 Knowledge

不要：

```text
整个课程
 ↓
生成 100 道题
```

而是：

```text
knowledge
+
source evidence
+
blueprint
 ↓
LLM
 ↓
3~5 questions
```

例如：

```ts
for (const item of blueprint.items) {
  const knowledge = knowledgeMap.get(item.knowledgeId);

  const questions = await generateQuestions({
    knowledge,
    sourceMaterials: getSources(knowledge),
    angles: item.angles,
    count: item.questionCount,
  });

  await saveRawQuestions(questions);
}
```

---

# 11. Question Prompt

我会特别强调：

```text
You are generating assessment questions for a standalone
course question bank.

The learner may NOT have the original course material open.

Every question must be self-contained.

Do not use:
- "according to the lecture"
- "as discussed above"
- "the method described in the course"
- "the authors"
- "this approach"

If context from the course is necessary, include the minimum
necessary context directly in the question.

Do NOT test memorization of:
- exact wording
- lecture numbering
- arbitrary numerical values
- instructor phrasing

Test understanding, reasoning, application, comparison,
or calculation.
```

然后：

```text
Knowledge:
Self-Attention

Description:
...

Source evidence:
...

Required angles:
concept
mechanism
comparison
limitation

Generate 5 questions.
```

---

# 12. Question Schema

这里我建议你的 CourseQuestion **不要直接复用 InterviewQuestion**。

例如：

```ts
const CourseQuestionSchema = z.object({
  id: z.string(),

  courseId: z.string(),

  knowledgeId: z.string(),

  angle: z.enum([
    'concept',
    'mechanism',
    'intuition',
    'application',
    'comparison',
    'limitation',
    'calculation',
  ]),

  type: z.enum([
    'single',
    'multiple',
    'open',
  ]),

  question: z.string(),

  options: z.array(z.string()).optional(),

  answer: z.array(z.number()).optional(),

  explanation: z.string(),

  source: z.object({
    materialId: z.string(),
    section: z.string().optional(),
  }),

  difficulty: z.enum([
    'easy',
    'medium',
    'hard',
  ]),
});
```

---

# 13. 第五步：Validation

这里不要再让 LLM 做所有事情。

先：

```ts
CourseQuestionSchema.parse(question);
```

然后 deterministic validation：

```ts
validateAnswer(question);
validateOptions(question);
validateSource(question);
validateReferences(question);
```

例如：

```ts
function validateAnswer(q: CourseQuestion) {
  if (q.type === 'single' && q.answer?.length !== 1) {
    throw new Error('Single choice must have exactly one answer');
  }

  if (q.type === 'multiple' && !q.answer?.length) {
    throw new Error('Multiple choice must have answers');
  }

  for (const index of q.answer ?? []) {
    if (index < 0 || index >= (q.options?.length ?? 0)) {
      throw new Error('Invalid answer index');
    }
  }
}
```

---

# 14. 第六步：Source Grounding

这里我建议加入一个非常简单但非常重要的字段：

```json
"source": {
  "materialId": "lecture-07",
  "section": "Self-Attention",
  "evidence": "..."
}
```

注意：

**evidence 不一定要最终发布。**

可以存在：

```text
questions.raw.json
```

最终：

```text
questions.json
```

只保留：

```json
"source": {
  "materialId": "lecture-07",
  "section": "Self-Attention"
}
```

这样既能审计，又不会把课程原文大量复制到题库。

---

# 15. 第七步：Embedding 去重

这是非常值得自动化的。

流程：

```text
questions
    ↓
embedding
    ↓
cosine similarity
    ↓
similarity > 0.90
    ↓
candidate duplicate
```

然后：

```text
Q1
Q2
Q3
```

如果：

```text
Q1 ↔ Q2 = 0.94
Q1 ↔ Q3 = 0.63
Q2 ↔ Q3 = 0.61
```

只需要人工检查 Q1/Q2。

**不要让 LLM 检查全部组合。**

---

# 16. 第八步：Coverage

最后生成：

```text
knowledge × angle
```

例如：

```text
                    concept mechanism application comparison limitation
attention              ✓        ✓          ✓           ✓          ✓
CNN                    ✓        ✓          ✓
RNN                    ✓        ✓                      ✓
GAN                    ✓                   ✓
```

发现：

```text
RNN → comparison 缺失
```

就自动产生：

```json
{
  "knowledgeId": "rnn",
  "missingAngle": "comparison"
}
```

然后：

```text
coverage gap
     ↓
generate question
     ↓
validate
```

形成闭环。

---

# 17. 最后做一个 CLI

最终使用体验应该非常简单：

```bash
npm run course:create mit-6s191
```

或者：

```bash
npm run course:extract mit-6s191
npm run course:blueprint mit-6s191
npm run course:generate mit-6s191
npm run course:validate mit-6s191
npm run course:coverage mit-6s191
```

以及一个总命令：

```bash
npm run course:build mit-6s191
```

内部：

```text
ingest
 → extract
 → merge
 → blueprint
 → generate
 → validate
 → dedupe
 → coverage
```

---

# 18. 我甚至建议支持 `--resume`

因为 LLM pipeline 很容易中途失败。

比如：

```bash
npm run course:generate mit-6s191
```

生成：

```text
attention       ✓
transformer     ✓
cnn             ✓
rnn             ✗ API error
```

重新：

```bash
npm run course:generate mit-6s191
```

应该：

```text
attention       SKIP
transformer     SKIP
cnn             SKIP
rnn             RETRY
```

所以每个 artifact 都应该是**增量可重建**的。

---

# 19. 最重要的：不要做成一个 Agent

你之前希望 AI Trainer 本身 AI-native，我觉得没问题。

但这个 **Course Authoring Pipeline** 我反而不建议用 Agent。

不要：

```text
Agent
 ↓
自己决定
 ↓
读取课程
 ↓
生成知识
 ↓
生成题
 ↓
自己检查
 ↓
自己发布
```

因为这是一个**内容生产 pipeline**，不是交互任务。

应该是：

```text
Deterministic Pipeline
        │
        ├── LLM extraction
        ├── LLM generation
        ├── deterministic validation
        ├── embedding dedup
        └── coverage analysis
```

每一步都是明确的 contract。

---

# 20. 如果让我直接在你当前 repo 里实现

我不会新建 Python 项目。

直接：

```text
scripts/course/
```

然后第一版只做 **6 个文件**：

```text
scripts/course/
├── types.ts
├── schemas.ts
├── extract.ts
├── generate.ts
├── validate.ts
└── build.ts
```

而不是一开始搞十几个模块。

第一版：

```text
course.md
   ↓
extract.ts
   ↓
knowledge.json
   ↓
generate.ts
   ↓
questions.raw.json
   ↓
validate.ts
   ↓
questions.json
   ↓
coverage.ts
```

等你真的有：

```text
MIT course #1
MIT course #2
Harvard course #1
```

以后再抽象：

```text
CourseSource
QuestionGenerator
QuestionValidator
CoverageAnalyzer
```

**我认为这是最适合你当前项目的 MVP 边界：足够系统化，又不会为了“以后可能支持 100 门课”提前把 authoring system 做成一个平台。**





--------------------------







有，而且我认为**真正值得增强的地方，不是再增加更多 LLM，而是把 `course → knowledge → questions` 做成一个“可追溯、可验证、可迭代”的内容编译器**。

你现在的方向已经对了，但如果准备长期拿 MIT/Harvard/Stanford 这类课程做题库，我会重点补下面这些。

---

## 1. 最大增强：不要只有 `knowledge`，增加 `evidence`

现在：

```text
Course
  ↓
Knowledge
  ↓
Questions
```

我建议变成：

```text
Course
  ↓
Material
  ↓
Evidence
  ↓
Knowledge
  ↓
Question Blueprint
  ↓
Question
```

也就是：

```text
course
 ├── lecture-01
 │     ├── evidence-001
 │     ├── evidence-002
 │     └── ...
 │
 └── lecture-02
       └── ...
```

例如：

```json
{
  "id": "ev-012",
  "materialId": "lecture-07",
  "section": "Multi-Head Attention",
  "text": "...",
  "concepts": ["multi-head-attention"]
}
```

然后 knowledge：

```json
{
  "id": "multi-head-attention",
  "evidence": ["ev-012", "ev-018"]
}
```

题目：

```json
{
  "knowledgeId": "multi-head-attention",
  "sourceEvidence": ["ev-012"],
  "question": "..."
}
```

这样以后你可以回答：

> **这道题为什么存在？**

直接追溯：

```text
Question
 → Knowledge
 → Evidence
 → Lecture
 → Course
```

这是整个系统长期可维护性的核心。

---

# 2. Knowledge 不应该只是一个 list，而应该形成 graph

尤其是大学课程。

例如：

```text
Linear Algebra
      ↓
Probability
      ↓
Neural Networks
      ↓
Attention
      ↓
Transformer
      ↓
LLM
```

所以：

```ts
interface Knowledge {
  id: string;
  title: string;
  description: string;

  prerequisites: string[];

  importance: 'core' | 'important' | 'supporting';

  evidence: string[];
}
```

这和你现在 AI Trainer 的 `conceptGraph` 非常契合。

**但注意：**

不要让课程 pipeline 直接修改你的全局 `conceptGraph`。

课程应该拥有：

```text
CourseKnowledgeGraph
```

最后如果以后想合并到主 Trainer，再做：

```text
Course Knowledge
       ↓
Knowledge Mapping
       ↓
Global Knowledge
```

这样课程题库和你的主题库仍然隔离。

---

# 3. 增加一个非常重要的东西：Learning Objective

这是我认为你现在 pipeline 最大的潜在缺口。

不要：

```text
Knowledge
 ↓
Question
```

而应该：

```text
Knowledge
 ↓
Learning Objective
 ↓
Question
```

例如：

```json
{
  "id": "transformer-mha-objective-01",
  "knowledgeId": "multi-head-attention",
  "objective": "Explain why multiple attention heads can capture different relationships",
  "level": "understand"
}
```

然后：

```text
Learning Objective
      ↓
Question
```

这样一个概念可以产生多个真正不同的问题：

```text
MHA
├── Explain
├── Compare
├── Apply
├── Diagnose
└── Trade-off
```

这比单纯的：

```text
Transformer → 10 questions
```

质量高很多。

---

# 4. Bloom's Taxonomy 可以适量使用

不用复杂化，但可以增加：

```ts
type CognitiveLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate';
```

然后控制题目：

```text
core concept
   ↓
understand × 1
apply × 2
analyze × 2
evaluate × 1
```

这样你之前担心的：

> 一个 Transformer 题库最后全部都是“Transformer 是什么？”

会明显减少。

---

# 5. Question generation 最好变成“两阶段”

不要：

```text
Knowledge
 ↓
Generate final question
```

建议：

```text
Knowledge
      ↓
Question Blueprint
      ↓
Question
```

例如 Blueprint：

```json
{
  "knowledge": "kv-cache",
  "objective": "Explain the memory/computation tradeoff",
  "angle": "tradeoff",
  "cognitiveLevel": "analyze",
  "scenario": "long-context inference",
  "difficulty": "hard"
}
```

然后 LLM 才生成：

```text
题干
选项
答案
解析
```

这非常重要。

因为：

> **LLM 应该负责语言实现，而不是决定整个题库结构。**

---

# 6. 增加 Question Quality Gate

生成之后不要直接进入：

```text
questions.json
```

而是：

```text
generated
   ↓
schema validation
   ↓
structural validation
   ↓
source validation
   ↓
semantic validation
   ↓
duplicate detection
   ↓
coverage validation
   ↓
quality score
   ↓
accepted / rejected
```

例如：

```json
{
  "questionId": "q-123",
  "quality": {
    "selfContained": true,
    "sourceGrounded": true,
    "hasSingleCorrectAnswer": true,
    "duplicateScore": 0.12,
    "conceptAlignment": 0.94,
    "qualityScore": 0.91
  }
}
```

---

# 7. 特别注意“课程知识 ≠ 面试知识”

这是非常重要的一点。

MIT 课程可能讲：

```text
Fourier Transform
```

但课程题库不应该自动认为：

```text
Fourier Transform = 面试高价值
```

建议 Knowledge 增加：

```json
{
  "importance": "core",
  "courseImportance": 0.95,
  "assessmentValue": 0.72
}
```

甚至：

```text
course importance
        ≠
interview importance
```

因为你的课程题库以后可能有两种用途：

### Course mastery

```text
“这门课有没有学懂？”
```

### Interview preparation

```text
“这个知识点面试价值高不高？”
```

不要把两者混在一起。

---

# 8. 题目应该允许“course-specific”

这是和你主 Trainer 最大的区别之一。

例如：

```json
{
  "scope": "course",
  "courseId": "mit-6s191"
}
```

意味着：

> 这道题只属于这个课程。

而不是：

```text
global question bank
```

以后可以存在：

```text
Course Question
      ↓
Knowledge Mapping
      ↓
Global Knowledge
```

但不要反过来强制所有课程题目进入 global bank。

---

# 9. 课程内部也应该防止“重复考察”

例如：

```text
Lecture 3:
What is self-attention?

Lecture 7:
What is self-attention?

Lecture 9:
What is self-attention?
```

embedding similarity 可以发现。

但更进一步：

应该比较：

```text
Knowledge
+
Objective
+
Angle
+
CognitiveLevel
```

而不是只比较 question text。

例如：

```text
Q1:
self-attention / definition / understand

Q2:
self-attention / definition / understand
```

即使文字不同，也应该认为：

> **assessment duplicate**

而：

```text
Q3:
self-attention / memory complexity / analyze
```

则不是。

这个比单纯 embedding 去重更重要。

---

# 10. 课程题库应该有“覆盖矩阵”

最终最好能看到：

```text
                         Understand Apply Analyze Evaluate
Attention                   ✓         ✓       ✓
MHA                         ✓         ✓       ✓       ✓
GQA                         ✓         ✓       ✓
KV Cache                    ✓         ✓       ✓       ✓
Positional Encoding         ✓         ✓
```

然后系统告诉你：

```text
Missing:
- KV Cache / evaluate
- Positional Encoding / analyze
```

这比：

```text
已经生成 120 道题
```

有价值得多。

---

# 11. 不要过早引入 BKT / IRT

这里和你之前 AI Trainer 的设计不同。

Course authoring pipeline 第一阶段根本不需要：

```text
BKT
DKT
IRT
Bandit
```

这些属于：

```text
Runtime learner model
```

而不是：

```text
Content authoring
```

课程 pipeline 先解决：

```text
知识完整
+
题目质量
+
题目多样性
+
source grounding
```

之后才进入 Trainer：

```text
Course Question Bank
        ↓
AI Trainer
        ↓
Learner telemetry
        ↓
BKT / IRT
```

---

# 12. 加一个“人工审核入口”

即使你希望高度自动化，我仍然建议：

```text
questions.raw.json
```

不要直接发布。

提供：

```bash
npm run course:review mit-6s191
```

显示：

```text
┌──────────────────────────────────────┐
│ Knowledge: KV Cache                  │
│ Objective: Analyze memory tradeoff   │
│ Angle: tradeoff                      │
│                                      │
│ Question:                            │
│ ...                                  │
│                                      │
│ A. ...                               │
│ B. ...                               │
│ C. ...                               │
│ D. ...                               │
│                                      │
│ Answer: B                            │
│                                      │
│ Source: Lecture 8 / KV Cache         │
│                                      │
│ [Accept] [Edit] [Reject]             │
└──────────────────────────────────────┘
```

对于高质量课程题库，这个价值非常大。

---

# 13. 版权 / License 要单独处理

如果你真的开始抓 MIT / Harvard / Stanford 的课程，这个问题一定要注意。

你的 pipeline 可以保存：

```json
{
  "source": {
    "provider": "MIT",
    "url": "...",
    "license": "...",
    "retrievedAt": "..."
  }
}
```

而且：

**不要默认把课程全文 / lecture transcript 复制进最终题库。**

最好：

```text
原始课程材料
     ↓
内部 processing
     ↓
知识抽取
     ↓
题目
```

最终公开 artifact 只保留必要的 source attribution。

---

# 14. 最后我会把整个系统定型成这个结构

我认为这是比较成熟、但又没有 over-design 的版本：

```text
                 COURSE
                    │
                    ▼
              ┌──────────┐
              │ Materials│
              └────┬─────┘
                   │
                   ▼
              ┌──────────┐
              │ Evidence │
              └────┬─────┘
                   │
                   ▼
             ┌────────────┐
             │ Knowledge  │
             │   Graph    │
             └─────┬──────┘
                   │
                   ▼
          ┌──────────────────┐
          │ Learning         │
          │ Objectives       │
          └────────┬─────────┘
                   │
                   ▼
          ┌──────────────────┐
          │ Question         │
          │ Blueprint        │
          └────────┬─────────┘
                   │
                   ▼
              ┌─────────┐
              │   LLM   │
              │ Generate│
              └────┬────┘
                   │
                   ▼
       ┌────────────────────────┐
       │ Quality Gate           │
       │                        │
       │ Zod                    │
       │ Source grounding       │
       │ Answer validation      │
       │ Semantic similarity    │
       │ Duplicate detection    │
       │ Coverage               │
       └───────────┬────────────┘
                   │
             ┌─────┴─────┐
             ▼           ▼
          ACCEPT       REJECT
             │
             ▼
      COURSE QUESTION BANK
             │
             ▼
        AI INTERVIEW
             │
             ▼
       LEARNER TELEMETRY
             │
             ▼
        BKT / IRT / ...
```

### 我认为最值得你现在马上加的只有 5 个

按优先级：

1. **Evidence layer** —— 解决“题目到底来自哪里”
2. **Learning Objective** —— 解决“同一个 concept 如何从不同角度考”
3. **Question Blueprint** —— 把“出什么题”与“怎么写题”分离
4. **Quality Gate** —— 生成 ≠ 合格
5. **Coverage Matrix** —— 防止课程最后变成一堆重复的定义题

反而 **BKT、IRT、Agent、复杂知识图谱算法**现在都不用加。

这样做出来的 `course → knowledge → questions`，其实会成为你现有 AI Trainer 很漂亮的一个**独立内容生产系统**：课程题库保持独立，但通过 `knowledgeId` 可以在需要时与 Trainer 的知识体系建立映射，而不会污染你当前的 global question bank。
