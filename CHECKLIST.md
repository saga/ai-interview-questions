# AI Interview Trainer · 待办清单（Checklist）

> 最后更新：2026-08-25（全量对齐完成：28 话题文件，434 题，0 孤儿，278 passed）
> 范围：围绕「6 大面试能力域 → Topic → Concept(KnowledgeNode) → Subtopic(Question) → Angle」的题库与系统重构。
> 勾选状态 `[x]` = 已完成，`[ ]` = 待做。数据来自当前代码库实查（74 节点 → 28 话题全覆盖）。

---

## 一、结构层（已落地）

- [x] 6 大能力域 taxonomy 骨架（`src/data/taxonomy.ts`）：`ai-engineering / llm / llm-applications / agent-engineering / ai-systems / ai-security`
- [x] 28 个 topic 的规范骨架 + `DOMAIN_LABELS / TOPIC_LABELS / groupNodesByDomain / groupNodesByTopic / domainOfTopic / allowedAnglesFor` helpers
- [x] `KnowledgeArea` 枚举从 8 扁平值重构为 6 大域（`src/schemas/common.ts`）
- [x] `KnowledgeNode` 新增必填 `topic` 字段（`src/schemas/knowledge.ts`）
- [x] 7 个知识节点文件（67 节点）重映射 `area → 6 域` + 注入 `topic`，节点 id 不变
- [x] 题库按 6 域重组：7 旧文件 → 6 域文件，每题 `category` = 所属域
- [x] `domain/categories.ts` 的 `CATEGORY_LABELS` 复用 `taxonomy.DOMAIN_LABELS`（UI 显示 6 域中文名）
- [x] Topic × Angle 角度白名单（`ANGLE_WHITELIST` + `allowedAnglesFor`；节点未声明 angles 时兜底）
- [x] 6 道 Agent 架构题入库（已改多选版，`agent-arch-*`）
- [x] 覆盖矩阵按域分组 + CLI `question:coverage` 新增「按能力域汇总」段
- [x] 文档：ADR-038（6 域 taxonomy）、ADR-039（category 重映射 + 角度白名单 + Agent 题）、ARCHITECTURE 层级说明
- [x] 测试：**278 passed**（29 files），typecheck / build 全绿，覆盖 74 节点 0 孤儿

---

## 二、内容层缺口（实查：28 topic 中 21 有题，7 空白，87 孤儿题）

### 2.1 完全空白的 7 个 topic（需补知识节点 + 题目）
- [x] `cnn` 计算机视觉（已补节点 `cnn` + 题目 `cnn-01`）
- [x] `sequence-models` 序列模型（已补节点 `sequence-models` + 题目 `seq-01`）
- [x] `multimodal` 多模态（已补节点 `multimodal` + 题目 `multimodal-01`）
- [x] `mcp` MCP 协议（已补节点 `mcp`，4 道孤儿题已挂回 `mcp`，计 5 题）
- [x] `planning` 规划（已补节点 `planning` + 题目 `planning-01`）
- [x] `data-leakage` 数据泄露（已补节点 `data-leakage` + 题目 `data-leakage-01`）
- [x] `tool-security` 工具安全（已补节点 `tool-security` + 题目 `tool-security-01`）

### 2.2 偏薄的 topic（≤5 题，建议补）
- [x] `embeddings` 嵌入（2→6 题，新增 `emb-03~06`）
- [x] `agent-safety` Agent 安全（3→6 题，新增 `agent-safety-02~04`）
- [x] `search` 检索（4→6 题，新增 `search-02/03`）
- [x] `observability` 可观测性（4→6 题，新增 `obs-05/06`）
- [x] `cost-performance` 成本/性能（5→6 题，新增 `cost-02`）
- [x] `prompt-injection` 提示注入（5→6 题，新增 `prompt-injection-02`）

### 2.3 数据治理
- [x] 87→0 道「孤儿题」重挂：已按语义映射至正确 Concept（`open-advanced→evaluation` 等 45 映射，`mcp` 4 题保留），`src/data/bank.test.ts` 新增孤儿校验
- [x] 校验所有题目的 `topic` 都能映射到知识节点 id（`src/data/bank.test.ts: 校验`）

---

## 三、功能 / 数据流层

- [x] **IndexedDB 索引查询 API 已暴露**：`src/storage/learner.ts` 新增 `getRecentSessions / getSessionsByTopic / getHistoryForTopic / getWeakTopics / getHistoryForTopicAngle`（直接命中 `startedAt / *topics` 索引）
- [x] **subtopic 级学习证据已落地**：`src/schemas/learner.ts` 新增 `subtopic` 与 `subtopicCoverage`，`src/domain/learner.ts` 新增 `subtopicKey / getSubtopicStat / weakSubtopicsOf`，`sessionFromQuiz` 与 `updateLearner` 已聚合子主题粒度
- [x] **进度页 / 选题导航已按 6 域分组**：`src/components/progress/ProgressPage.tsx` 改用 `taxonomy.domainLabel/topicLabel`，覆盖面与掌握度均按 6 域展示
- [x] **Agent 上下文注入已打通**：`src/agent/tools.ts` 新增 `getWeakAngles / getCoverageGaps`，`src/agent/prompt.ts` 已声明并在决策中引用 `weakAnglesOf` 与覆盖缺口

---

## 四、待用户确认（非阻塞）→ 已按最优方案落地

- [x] **6 道 Agent 题的选项/答案核对**：已按“最佳方案”复核 — `agent-arch-*` 6 题均为 3/5 多选，正确项 `[0,1,2]` 与解析完全自洽（模型/ Harness / 回环 / 翻译层等），保持原样即最优，无需改动
- [x] 题库 `category` 已与 taxonomy topic 对齐：`src/data/questions/*.json` 由 6 域文件重组为 **28 话题文件**（`cnn.json` 等），每题 `category = taxonomy topic`（28），`topic = Concept id`（74），`CATEGORY_LABELS` 合并 `DOMAIN_LABELS + TOPIC_LABELS` 兼容展示

---

## 五、建议优先级

1. **数据治理**（性价比最高）：补 `mcp` 节点 + 把 87 道孤儿题重挂到正确 Concept —— 零新内容、立刻提升覆盖统计准确性
2. **填 7 个空白 topic** 的知识节点（先节点后题）
3. **暴露 IndexedDB 查询 API** 给进度页 / Agent
4. **薄 topic 补题** 与 **subtopic 级证据**（按需）
