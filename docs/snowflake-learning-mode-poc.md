# Snowflake 学习模式

## 范围

学习页面复用现有 LearningTrack、KnowledgeNode、Question Bank 和 Interview Engine。课程资料、阅读进度和考试掌握度分开管理；学习活动不会因为阅读或点击完成而自动提高掌握度。

## 内容结构

- `KnowledgeNode` 是课程知识点的唯一索引。
- 当前有 **194 个 KnowledgeNode，对应 194 篇独立 Markdown 主教程**。每篇教程的 ID 与 KnowledgeNode ID 相同，不按 topic 共享文章。
- 另有 **8 篇综合工程教程**，以端到端场景串联多个节点；它们不伪装成 KnowledgeNode，也不计入 194 篇节点教程的阅读进度。
- 教程支持 Markdown、Mermaid、表格和 SQL 代码块；每个节点维护自己的参考资料。
- 其他 LearningTrack 暂时提供结构化知识摘要，界面明确标注“知识摘要”，不把摘要包装成完整教材。

具体覆盖和一对一映射见 [教材覆盖复核](./snowflake-learning-article-coverage.md)，课程范围见 [课程路线](./snowflake-course-roadmap.md)。

## 学习入口与页面

选择学习体系后进入 `/study?track=<id>`。课程内导航提供“学习”“课程训练”“进度”和“学习地图”等入口。

学习页包含课程知识树、独立节点教程、参考资料、阅读完成记录、Copilot 讲解和知识点专项检测。综合教程可跳转到其关联的 KnowledgeNode，继续阅读节点教材或进行检测。

## 学习与考核边界

阅读资料和考试测量的是不同活动：

- 打开教程只记录最近阅读活动。
- 显式标记已读，更新 `studyProgress`；不写入 `LearnerProfile` 的考试掌握度。
- 结构化摘要的“标记已复习”也只属于学习资料进度。
- 专项检测复用现有 Interview Engine。学习页按 `knowledgeId` 找到当前节点的题目，并将精确的题目 ID 列表传给组卷器；不再把 KnowledgeNode ID 错当成题目 `topic`。
- 选择题按题库答案确定性评分；开放题在 AI 配置可用时按现有评分规则评分。训练记录进入 Learner Profile，作为掌握度和薄弱项分析的依据。
- 题目自评与间隔复习只安排复习，不替代正式答题记录。

## 题目生产流程

题目不是从教程段落直接改写成问句。按节点补充时，先确认需要测量的知识或工程判断，再建立 Assessment Blueprint，至少明确：

- 目标 KnowledgeNode / `knowledgeId` 和主题；
- 核心 Concept、考察角度、难度和 `cognitiveTask`；
- 题目要测量的判断或操作，以及可接受答案的依据；
- 来源材料 ID（`source.materialId`）和适用章节；
- 应覆盖的关键误区，以及题目能否区分这些误区。

随后生成题目草稿，映射到现有 Question Schema，再进入新增题流程。候选 Concept 应先按工程价值筛选，不能因为材料中出现某个术语就机械出题。题目应能脱离原文独立作答；版本敏感事实需要明确范围。

现有入口：

- `npm run questions:manage -- blueprint`：整理题目蓝图。
- `skills/article-to-questions/SKILL.md`：材料到候选知识点、Blueprint 和题目草稿的流程。
- `skills/add-question-to-bank/SKILL.md`：题目写入前的 schema、去重、质量和元数据检查。

## 题目验证流程

验证分层进行，不能用一个“AI 检查通过”替代全部检查：

1. **结构验证**：Schema、字段、答案索引、题型约束和 ID 唯一性。
2. **内容质量**：自包含性、考察边界、干扰项、难度、表达和知识点覆盖；使用 Question Challenger 与现有审计脚本。
3. **事实核验**：先不看存储答案独立作答，再逐项检查题干、每个选项、解析和开放题参考答案；核验必须提供真实来源摘录，系统逐字检查引用是否存在于登记材料中。
4. **发布门禁**：CI 对本次新增或修改题目检查 `cognitiveTask` 和 `source.materialId`，并运行题库结构/质量审计、题目身份检查和变体校验。**这只证明来源元数据已填写，不等于题目事实已经自动核验。**
5. **人工裁决**：独立作答与题库答案冲突、来源不足、事实有条件或多个选项可能成立时，保留 REVIEW / NEEDS_EVIDENCE，不强行标成 VERIFIED。

事实核验的执行入口：

```bash
npm run questions:manage -- verify --knowledge-id=<KnowledgeNode-id> \
  --evidence-file=<source-excerpts.json> --gate
```

需要单题时使用 `--ids=id1,id2`。旧题库仍可用 `--topic` 按历史 topic 字段筛选。

## 学习诊断的边界

当前系统能把训练结果按知识点和主题记录，显示薄弱项并安排复习；尚未实现完整的 IRT / Q-matrix 校准，也不能仅凭阅读完成或少量题目得分宣称达到统计意义上的掌握度。诊断质量取决于题目与 KnowledgeNode 的映射质量、误区覆盖、题量和重复测量。

DeepTutor 的可借鉴点是把课程阅读、知识路径、来源依据、练习和学习证据放在同一学习上下文里，同时区分“看过解释”和“独立作答”。本项目已有节点教材、Copilot 讲解、精确节点专项训练和独立学习进度；没有必要照搬多引擎知识库、复杂 Agent 编排或全套学习工作台。

## 验证

回归测试应覆盖：

- 194 个节点与 194 篇独立教程严格一对一；
- 8 篇综合教程独立于节点教材；
- 专项检测只选择当前 KnowledgeNode 的题目，不混入同一 topic 下的其他节点；
- 阅读进度与考试掌握度相互隔离；
- 新增题目来源元数据、结构质量和事实核验流程。

本轮通过 GitHub 文件接口直接更新仓库；当前执行环境没有可运行的项目 checkout，因此未声称本地执行了 Node/Vitest 构建。CI 结果以该提交触发的 GitHub Actions 为准。
