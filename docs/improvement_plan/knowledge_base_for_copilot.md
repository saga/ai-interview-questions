可以，而且从你当前代码看，**这是下一步最值得做的升级之一**。

关键点是：不要把它做成一个独立、复杂的“RAG 系统”。你现在已经有一套很好的 structured knowledge base：

```text
KnowledgeNode
    ↓
Concept Graph
    ↓
Question Bank
    ↓
Misconception / Angle / Difficulty / Evidence
```

现在 Copilot 只用了很少的上下文：当前题目、训练信息、薄弱主题；普通聊天最终只是把这些信息拼进 system prompt 后直接调用 LLM，**并没有真正从 knowledge base 检索内容**。

所以正确方向不是“重做题库”，而是增加一层：

```text
                    ┌─────────────────────┐
                    │ Knowledge Base      │
                    │                     │
                    │ Knowledge Nodes     │
                    │ Questions           │
                    │ Concept Graph       │
                    │ Misconceptions      │
                    │ Angles              │
                    └──────────┬──────────┘
                               │
                         Knowledge Index
                               │
                    ┌──────────▼──────────┐
User Query ────────►│ Knowledge Retriever │
                    │                     │
                    │ lexical             │
                    │ metadata            │
                    │ graph expansion     │
                    │ semantic(optional)  │
                    └──────────┬──────────┘
                               │
                         top N evidence
                               │
                    ┌──────────▼──────────┐
                    │ Copilot Prompt      │
                    │ + citations         │
                    └──────────┬──────────┘
                               │
                              LLM
```

## 1. 最重要的架构改变：把 Knowledge Base 从“数据文件”提升成一个真正的 domain capability

现在：

```text
src/data/knowledge/*.json
src/data/questions/*.json
conceptGraph.json
        ↓
各个地方直接 import
```

`knowledgeMap.ts` 和 `questionBank.ts` 本质上只是静态加载器。

我建议增加：

```text
src/domain/knowledge/
    documents.ts
    index.ts
    retrieve.ts
    context.ts
    types.ts
```

不要新建一个 `KnowledgeRepository`、`VectorStoreService`、`RagServiceFactory` 之类的复杂 abstraction。

核心接口保持很小：

```ts
type KnowledgeSearchQuery = {
  query: string;
  topic?: string;
  area?: string;
  knowledgeId?: string;
  limit?: number;
  mode?: 'answer' | 'hint' | 'quiz';
};

type KnowledgeHit = {
  id: string;
  kind: 'knowledge' | 'question' | 'graph';
  title: string;
  content: string;
  score: number;
  metadata: {
    topic?: string;
    knowledgeId?: string;
    questionId?: string;
  };
};

function searchKnowledge(
  query: KnowledgeSearchQuery
): KnowledgeHit[];
```

这样以后：

```text
Copilot
Agent
Question Generator
Question Challenger
课程学习
```

都可以共享同一个知识检索能力。

---

# 2. 不要直接把 JSON 当 RAG chunk

这里是关键设计。

你的 `KnowledgeNode` 已经不是普通 document chunk，而是高度结构化的知识单元：

```text
id
name
area
topic
priority
summary
required
misconceptions
angles
concepts
```

而 Question 又有：

```text
topic
difficulty
angle
question
explanation
misconceptions
knowledgeId
source
formats
```



所以最好在运行时把它们**投影成统一的 KnowledgeDocument**：

```ts
type KnowledgeDocument = {
  id: string;

  kind:
    | 'knowledge'
    | 'question'
    | 'misconception'
    | 'concept';

  title: string;
  text: string;

  metadata: {
    area?: string;
    topic?: string;
    knowledgeId?: string;
    questionId?: string;
    angle?: string;
    difficulty?: string;
    priority?: string;
  };
};
```

例如一个知识节点：

```text
[K001]
KV Cache

Inference > KV Cache

KV Cache stores attention key/value states from previous tokens
so decoding does not recompute them...

Required:
- attention
- autoregressive decoding

Misconceptions:
- KV Cache reduces total memory usage
- KV Cache changes model weights
```

一个问题：

```text
[Q812]
Why does KV Cache improve autoregressive decoding?

Topic: kv-cache
Angle: mechanism
Difficulty: medium

Question:
...

Explanation:
...
```

这样检索器面对的是统一的 evidence corpus。

---

# 3. 第一版 RAG，我建议甚至不要 Embedding

这一点很重要。

你的 corpus 现在规模并不大，而且结构非常强。

`knowledgeNodes + questions` 完全可以先做：

```text
Metadata filter
+
lexical retrieval
+
graph expansion
```

而不是马上：

```text
Embedding model
Vector DB
ANN
Reranker
```

你的 Concept Graph 已经存在，而且里面有明确的 `prerequisite` / `related` 边。比如 `inference-optimization → kv-cache`、`rag → reranking` 等。

因此第一版 retrieval 可以这样：

### 第一层：精确匹配

```text
query:
"KV cache 为什么能降低推理延迟？"

匹配：
topic = kv-cache
tag = inference
name = KV Cache
```

### 第二层：词法搜索

搜索：

```text
name
summary
required
misconceptions
question
explanation
tags
```

简单 BM25 / TF-IDF 都够。

### 第三层：Graph expansion

如果找到：

```text
kv-cache
```

自动补：

```text
inference-optimization
attention
context-window
inference-capacity
```

根据 graph 的：

```text
prerequisite
related
```

扩展 1 hop 即可。

因此：

```text
"KV cache 为什么占显存？"
```

不会只拿到 KV Cache 一条，而会得到：

```text
KV Cache
  ↑ prerequisite
Inference Optimization
  ↔ related
Inference Capacity
```

这比纯 embedding retrieval 更符合你现在这个知识库的性质。

---

# 4. 真正值得增加的是 Hybrid Retrieval

最终我建议变成：

```text
score =
    0.40 lexical
  + 0.25 metadata
  + 0.20 graph
  + 0.15 semantic
```

semantic 是最后加进去。

而且 semantic 不应该替代前三个。

因为你的数据不是普通 PDF，而是**已经带知识结构的数据**。

例如用户问：

> RAG 为什么通常需要 reranker？

metadata：

```text
topic = rag
```

graph：

```text
rag → reranking
```

已经提供了非常强的信号。

这时候 embedding 只是解决：

```text
"二阶段排序"
"cross encoder"
"candidate relevance refinement"
```

和 `reranking` 的语义匹配。

---

# 5. Copilot 应该从“Prompt-only”改成真正的 Retrieve → Generate

当前：

```ts
const sys = buildCopilotSystemPrompt({
  profile,
  activeQuestion,
  session,
});

const reply = await chatCopilot(config, sys, history, content);
```



建议改成：

```ts
const retrieval = retrieveKnowledge({
  query: content,
  context: {
    activeQuestion: chatQuestion,
    session,
    profile,
  },
  mode: 'answer',
});

const sys = buildCopilotSystemPrompt({
  profile,
  activeQuestion: chatQuestion,
  session,
  knowledge: retrieval,
});

const reply = await chatCopilot(
  config,
  sys,
  history,
  content,
);
```

形成：

```text
User
 ↓
Intent
 ↓
Retrieve Knowledge
 ↓
Prompt Assembly
 ↓
LLM
```

这已经是真正意义上的 RAG。

---

# 6. 但不要每句话都检索整个题库

应该有一个非常轻的 query planner。

例如：

```text
用户：
"什么是 GQA？"

        ↓

topic = gqa
knowledge = gqa
questions = top 3
graph = 1-hop
```

而：

```text
"我刚才那道题为什么错？"

        ↓

activeQuestion
evaluation
knowledgeId
misconception
```

这时候根本不用全局检索。

所以建议：

```ts
type RetrievalScope =
  | 'current_question'
  | 'topic'
  | 'knowledge'
  | 'global';
```

路由：

```text
当前题解释
    → current_question

概念解释
    → topic / knowledge

比较两个概念
    → global + graph

我的薄弱点
    → learner + knowledge

普通聊天
    → global
```

---

# 7. 特别重要：知识检索必须支持“答案安全模式”

这是你这个产品和普通 RAG 最大的区别。

因为 Question Bank 中直接存在：

```text
answer
referenceAnswer
explanation
```



因此：

```text
用户：
给我一点提示

不能直接 retrieve：

referenceAnswer
```

所以 retrieval 应该有：

```ts
mode:
  'answer'
  'hint'
  'quiz'
```

例如：

### answer mode

```text
knowledge summary
required concepts
questions
reference answer
explanation
misconceptions
```

### hint mode

```text
knowledge summary
required concepts
misconceptions
related concepts
```

禁止：

```text
referenceAnswer
choice.answer
完整 explanation
```

### quiz mode

甚至可以：

```text
question
metadata
concept target
```

但隐藏：

```text
answer
referenceAnswer
```

这个设计非常值得做，因为它把你之前的：

> LLM 不允许改变 assessment truth

进一步扩展成：

> Copilot 也不能因为检索而绕过 assessment boundary。

---

# 8. Retrieval 结果必须带 source

这是 RAG 最重要的可追溯性。

建议：

```ts
type KnowledgeHit = {
  id: string;
  ...
  source: {
    kind: 'knowledge' | 'question' | 'concept';
    id: string;
    label: string;
  };
};
```

然后最终回答：

```text
KV Cache 的核心作用是避免 decoder 每生成一个 token
时重新计算历史 token 的 K/V。

依据：
[K] KV Cache
[Q] KV Cache 原理题
[K] Inference Optimization
```

UI 可以变成可点击：

```text
依据 3 个知识节点
```

然后展开。

这会明显提升 Copilot 的可信度。

GitHub 自己的 Copilot Chat 也强调基于实际 repository context grounding，并提供所使用上下文的来源链接；MCP 也把 resources 设计成向模型提供结构化上下文的正式 primitive。([GitHub Docs][1])

---

# 9. 你的 Concept Graph 不要只服务于 adaptive selection

这是这次升级里一个很重要的架构收益。

现在：

```text
Concept Graph
    ↓
Adaptive Interview
```

升级后应该变成：

```text
             Concept Graph
             /           \
            /             \
 Adaptive Selection      Knowledge Retrieval
        ↓                      ↓
   下一道题               当前问题的上下文
```

也就是：

```text
Graph = Knowledge Backbone
```

而不只是：

```text
Graph = 出题算法辅助结构
```

这会让整个项目的架构逻辑变得更统一。

---

# 10. 可以进一步把 KnowledgeNode 变成真正的“知识锚点”

我非常建议你下一步加强 `KnowledgeNode`，而不是继续给 Question 加字段。

现在：

```ts
KnowledgeNode
summary
required
misconceptions
angles
concepts
```

其实已经非常接近 Knowledge Card。

可以再增加几个很小的字段：

```ts
{
  id,
  name,
  area,
  topic,
  summary,

  keyIdeas: [...],
  tradeoffs: [...],

  required: [...],
  misconceptions: [...],
  angles: [...],
  concepts: [...]
}
```

其中：

```text
summary
    = 是什么

keyIdeas
    = 真正应该理解什么

tradeoffs
    = 面试中最重要的设计权衡

misconceptions
    = 最容易错在哪里

angles
    = 怎么考
```

这样以后 Copilot 问：

> 给我系统讲一下 RAG

可以直接：

```text
knowledge node
+
prerequisite nodes
+
related nodes
+
representative questions
```

拼出一份非常完整的上下文。

---

# 11. Question 应该变成 Knowledge 的“evidence”，而不是主知识源

你的架构已经在往这个方向走：

```text
Knowledge
   ↓
Question
```

而不是：

```text
Question
   ↓
推断 Knowledge
```

这是对的。

所以未来检索：

```text
用户：
什么是 KV Cache？
```

优先：

```text
KnowledgeNode(kv-cache)
```

其次：

```text
related concepts
```

最后：

```text
representative questions
```

而不是直接把 10 道题塞给 LLM。

否则容易出现：

```text
Question 1 explanation
Question 2 explanation
Question 3 explanation
...
```

模型“从题库答案总结答案”，而不是从知识模型回答。

---

# 12. 我建议的最终模块结构

不需要大改现有结构，大概新增：

```text
src/
├── domain/
│   ├── knowledge/
│   │   ├── types.ts
│   │   ├── documents.ts
│   │   ├── index.ts
│   │   ├── retrieve.ts
│   │   └── graph.ts
│   │
│   ├── adaptive/
│   └── ...
│
├── application/
│   └── conversation/
│       ├── knowledgeCapability.ts   ← 新
│       ├── copilotPrompt.ts
│       ├── questionCapability.ts
│       └── router.ts
│
├── data/
│   ├── knowledge/
│   ├── questions/
│   ├── knowledgeMap.ts
│   ├── questionBank.ts
│   └── conceptGraph.json
```

其中：

```text
domain/knowledge
```

负责：

```text
buildDocuments()
buildIndex()
search()
expandGraph()
```

而：

```text
application/conversation/knowledgeCapability.ts
```

负责：

```text
根据 Copilot 当前上下文决定：
查什么
查多少
允许暴露什么
```

UI `CopilotSidebar.tsx` 最终只剩：

```text
input
→ router
→ capability
→ provider
→ render
```

你现在已经在往“UI 薄、capability 厚”的方向走，这个改法会继续保持这个原则。当前 `CopilotSidebar` 已经调用 `questionCapability`、`evaluationCapability`、`router`、`interviewCapability`，因此新增 `knowledgeCapability` 与现有架构是自然接合的。

---

# 13. 第一阶段我建议只做这些

不要一口气上真正的 Vector DB。

### Phase 1

```text
KnowledgeDocument
        ↓
In-memory index
        ↓
metadata + lexical search
        ↓
graph expansion
        ↓
top 5 evidence
        ↓
Copilot prompt
        ↓
citation
```

这一阶段已经能得到：

```text
真正的 RAG
```

而且：

```text
无服务器
无 DB
无 embedding
无新外部依赖
```

非常适合你现在的 SPA 架构。

### Phase 2

再增加：

```text
embedding
    ↓
semantic retrieval
```

但仍然：

```text
hybrid = lexical + metadata + graph + semantic
```

### Phase 3

再考虑：

```text
reranking
query expansion
multi-hop retrieval
```

目前都没必要。

---

# 14. 更进一步：让 Copilot 真正“会学习”，而不只是“会查”

完成上面的 RAG 后，你的 Copilot 会从：

```text
“解释当前题目”
```

升级成：

```text
User Question
      ↓
Knowledge Retrieval
      ↓
Learner Memory
      ↓
Knowledge Graph
      ↓
Current Question / Evidence
      ↓
LLM
```

于是：

> “为什么我总是答不好 RAG？”

可以检索：

```text
Learner:
  rag mastery = 0.71

Weak angles:
  architecture
  tradeoff

Misconceptions:
  retrieval = vector search only

Knowledge:
  rag
  reranking
  hybrid-search

Prerequisites:
  embedding
  vector-search
```

然后 Copilot 才真正成为：

> **基于个人学习状态 + 结构化知识库的 AI Coach**

而不是一个普通的聊天框。

这其实与你现在已有的 `LearnerProfile`、`KnowledgeNode`、`Concept Graph`、Question Bank 是天然兼容的，不需要再引入新的“大脑”。当前题目选择本身已经通过 `questionCapability → rankCandidatePool(profile)` 使用 Learner Profile；现在只是把同一份结构化知识也提供给 Copilot。

## 我的建议

**现在不要做“Vector RAG”。先做“Structured Knowledge RAG”。**

你的项目最合适的第一版其实是：

```text
                  ┌──────────────┐
                  │ Learner      │
                  │ Memory       │
                  └──────┬───────┘
                         │
                         ▼
User → Intent → Knowledge Retriever
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
       Knowledge  Questions  Graph
          └─────────┼─────────┘
                    ▼
              Evidence Pack
                    ▼
             Copilot Prompt
                    ▼
                   LLM
                    ▼
          Answer + Citations
```

**这比单纯加 embedding 更适合你目前这套知识库。**

另外，若后面要把这套 Knowledge Base 暴露给外部 Agent/Copilot，MCP 也非常契合：`resources` 本身就是用于向模型提供结构化上下文，`tools` 则适合暴露 `search_knowledge` 这类模型可调用能力。MCP 2026-07-28 规范也继续强化了 resources、tools 的缓存与可追踪性。([Model Context Protocol][2])

最合理的长期形态会是：

```text
Knowledge Base
      │
      ├── App Copilot
      ├── Interview Agent
      ├── Question Generator
      └── MCP / External Agents
```

也就是说，**Knowledge Base 最终应该成为整个项目的基础设施，而不是 Copilot 专用功能。**

[1]: https://docs.github.com/en/copilot/tutorials/explore-a-codebase?utm_source=chatgpt.com "Using GitHub Copilot to explore a codebase - GitHub Docs"
[2]: https://modelcontextprotocol.io/specification/2025-06-18/server/index?utm_source=chatgpt.com "Overview - Model Context Protocol"
