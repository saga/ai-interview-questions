# Embedding 预选问题清单（Pre-selected Questions）

> 用途：汇总题库中已有的 embedding 相关题目，并针对"如何生成一个 embedding 模型"与"参数含义"两块**当前缺失**的角度，补充可直接入库的候选草稿。
> 状态：预选（pending）。草稿符合 `src/schemas/question.ts` 的 `questionSchema`，并入 `src/data/questions/embeddings.json` 即可被现有题库 / `QuestionSource` 消费，**无需改动引擎**。

---

## 一、题库现有 embedding 相关题（索引）

主文件 `src/data/questions/embeddings.json`（topic = `word-embedding`），共 6 题：

| id | 角度 | 难度 | 核心考点 |
|----|------|------|----------|
| `ai-code-002` | calculation | easy | 用 TS 实现 cosine similarity，并解释为何 cosine 常用于 embedding |
| `ai-fund-010` | definition | medium | Embedding 向量 vs LLM hidden state（两类模型、用途不可互换） |
| `emb-03` | mechanism | medium | 为何要做 L2 归一化；未归一化时模长干扰相似度 |
| `emb-04` | scenario | medium | 领域微调提升召回，但需评估通用能力退化（多选） |
| `emb-05` | tradeoff | medium | RAG 长文档单嵌入 vs 小 chunk 的检索权衡 |
| `emb-06` | comparison | hard | HNSW 近似检索 vs 精确最近邻的召回/延迟权衡 |

相邻题（topic = `vector-db`，在 `search.json`，含 embedding 操作）：
`ai-rag-007`（1536→3072 维迁移不停机）、`ai-rag-008`（换模型后 Recall 92%→65% 定位）、`ai-rag-010` / `search-02`（亿级向量降本）、`search-03`、`ai-eng-033`。

---

## 二、覆盖分析（按 taxonomy `embeddings` 白名单角度）

白名单：`definition / mechanism / comparison / calculation / scenario`

| 角度 | 已有 | 缺口 |
|------|------|------|
| definition | ai-fund-010 | — |
| calculation | ai-code-002 | — |
| mechanism | emb-03（归一化） | **缺"如何训练/生成模型"的专门机制题** |
| comparison | emb-06（检索索引对比） | 缺纯 embedding 模型间对比（如双塔 vs 交叉编码器） |
| scenario | emb-04 / emb-05 | — |

**结论**：你关心的两块——「如何生成一个 embedding 模型」「参数含义」——目前题库**没有直接覆盖**：
- 没有任何题讲训练目标（对比学习 / InfoNCE / in-batch negatives / triplet loss）；
- 没有任何题系统解释 `dimension / temperature / normalize / pooling / similarity` 等参数；
- 缺 Matryoshka、领域评测基线等进阶点。

下面第三节即为填补这些缺口的预选草稿。

---

## 三、预选新增清单（候选草稿，JSON 数组，可直接并入 embeddings.json）

```json
[
  {
    "id": "emb-preset-01",
    "category": "embeddings",
    "topic": "word-embedding",
    "tags": ["embedding", "training-objective", "contrastive"],
    "difficulty": "medium",
    "angle": "mechanism",
    "question": "要从零得到一个用于内部文档检索的 embedding 模型，核心训练范式是什么？它与训练生成式 LLM 的目标有何根本不同？",
    "explanation": "embedding 模型用表示学习/对比目标，让语义相近的文本向量靠近、不相近的推远；LLM 用 next-token 预测。二者训练目标不同，用途不可互换（呼应 ai-fund-010）。",
    "misconceptions": ["以为 embedding 模型用 next-token 预测训练"],
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "用对比学习（如 InfoNCE）：把语义相近的文本对拉近、不相近的推远；与 LLM 的 next-token 预测目标根本不同",
          "与 LLM 相同，都是 next-token 预测，只是输入更长",
          "用监督分类头直接预测文档类别即可，无需成对数据",
          "随机初始化后靠海量文本自回归即可涌现语义空间"
        ],
        "answer": [0]
      }
    }
  },
  {
    "id": "emb-preset-02",
    "category": "embeddings",
    "topic": "word-embedding",
    "tags": ["embedding", "parameters", "dimension", "temperature", "normalize"],
    "difficulty": "medium",
    "angle": "definition",
    "question": "关于 embedding 模型的关键参数，下列说法错误的是？",
    "explanation": "temperature 在 embedding 语境多指对比损失里的 logit 缩放（训练期），控制对难负样本的区分强度；它与 LLM 采样温度不是一回事。dimension 越大表达力越强但存储/延迟成本越高；normalize=True 后 cosine 等价于点积。",
    "misconceptions": ["把 embedding 的 temperature 与 LLM 采样温度混为一谈"],
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "dimension 决定向量维度：越大表达力越强，但存储与检索成本越高",
          "normalize=True 会把向量 L2 归一化，此时 cosine 相似度等价于点积",
          "temperature 是推理时控制输出随机性的采样参数，对向量空间无影响",
          "similarity 度量可选 cosine / dot / euclidean，需与归一化方式配套"
        ],
        "answer": [2]
      }
    }
  },
  {
    "id": "emb-preset-03",
    "category": "embeddings",
    "topic": "word-embedding",
    "tags": ["embedding", "in-batch-negatives", "infonce"],
    "difficulty": "medium",
    "angle": "calculation",
    "question": "InfoNCE 对比损失中的 'in-batch negatives' 指什么？它带来什么工程优势与风险？",
    "explanation": "in-batch negatives 把一个 batch 内其他样本的 Positive 当作当前 Anchor 的负例，零额外标注即可获得大量负样本；风险是同 batch 内本应相似的样本被误当负例（假阴性），需要去重/过滤。",
    "misconceptions": ["认为 in-batch negatives 需要额外人工标注"],
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "把一个 batch 内其他样本的 Positive 当作当前 Anchor 的 Negative：零额外标注即可获得大量负样本，但可能引入假阴性",
          "指人工标注的固定负样本集合，需随模型更新而重新标注",
          "指把 Anchor 自身也作为负样本以强化对比",
          "指丢弃 batch 内所有负样本、只用正样本训练"
        ],
        "answer": [0]
      }
    }
  },
  {
    "id": "emb-preset-04",
    "category": "embeddings",
    "topic": "word-embedding",
    "tags": ["embedding", "matryoshka", "dimension-tradeoff"],
    "difficulty": "hard",
    "angle": "comparison",
    "question": "Matryoshka Representation Learning 允许什么？相比固定维度 embedding 有何工程收益？",
    "explanation": "MRL 在单一模型内训练出可截断的嵌套子向量：可用前 d 维近似全维效果，从而在同一模型上灵活权衡精度与存储/延迟，一套模型服务多档需求。",
    "misconceptions": ["以为 embedding 维度一旦训练就不可改变"],
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "在单一模型内训练出可截断的嵌套子向量：可用前 d 维近似全维效果，灵活权衡精度与存储/延迟",
          "把多个独立模型堆叠起来分别处理不同语言",
          "要求每个知识点用不同维度编码以区分重要性",
          "只能在推理时线性放大维度，不能缩小"
        ],
        "answer": [0]
      }
    }
  },
  {
    "id": "emb-preset-05",
    "category": "embeddings",
    "topic": "word-embedding",
    "tags": ["embedding", "domain-adaptation", "evaluation"],
    "difficulty": "hard",
    "angle": "scenario",
    "question": "团队考虑对通用 embedding 模型做金融领域微调。下列哪些做法是稳健的？（多选）",
    "explanation": "领域微调需先在领域评测集测基线召回再决定；微调后用同一领域 bench 评估，并保留通用 bench 监控通用能力退化（呼应 emb-04）。单纯加维度不解决语义漂移，直接替换线上有风险。",
    "misconceptions": ["以为加维度=领域适配", "以为微调无需评估通用退化"],
    "formats": {
      "choice": {
        "type": "multiple",
        "options": [
          "先在领域评测集（如金融检索 bench）上测基线召回，再决定是否微调",
          "微调后用同一领域 bench 评估，同时保留通用 bench 监控通用能力退化",
          "直接替换线上模型，无需评估通用能力是否退化",
          "只增加向量维度就能解决领域术语区分不足，无需微调"
        ],
        "answer": [0, 1]
      }
    }
  },
  {
    "id": "emb-preset-06",
    "category": "embeddings",
    "topic": "word-embedding",
    "tags": ["embedding", "cosine", "similarity", "normalization"],
    "difficulty": "easy",
    "angle": "mechanism",
    "question": "为什么语义检索常选 cosine 相似度？在什么前提下 cosine 与 dot product 完全等价？",
    "explanation": "cosine 只比较方向不比幅度，消除文本长度/词频造成的模长干扰；当所有向量已 L2 归一化时，cosine 等价于点积，故向量库常用 IP 度量加速（呼应 emb-03）。",
    "misconceptions": ["以为 cosine 比较的是欧氏距离"],
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "cosine 只比较方向不比幅度，消除文本长度/词频造成的模长干扰；所有向量已 L2 归一化时，cosine 等价于点积",
          "cosine 比较的是欧氏距离，模长越大语义越强",
          "dot product 永远不等价于 cosine，必须二选一",
          "cosine 取值范围 [0,∞)，越大越相似"
        ],
        "answer": [0]
      }
    }
  }
]
```

---

## 四、落地建议

1. 将上述 JSON 数组**追加**到 `src/data/questions/embeddings.json`（该文件本身是数组）。
2. 运行题库校验（现有 `questionSchema.parse` / 测试）确认无重复 id、angle 合法、choice 的 `answer` 非空且无重复下标。
3. 无需改动引擎、`QuestionSource` 或评分逻辑——它们本就按 `Question[]` 参数化。
4. 若后续想让课程/Course 题库也复用这些题，可借助上一轮预埋的 `courseId` / `knowledgeId` / `source` 前瞻字段标注溯源，但面试题无需填。
