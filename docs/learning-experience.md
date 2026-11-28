# 学习体验与内容质量

## 学习入口

每个 LearningTrack 统一从 `/study?track=<id>` 进入知识学习页面。页面以 KnowledgeNode 为基本单元：

- Snowflake / PostgreSQL 使用 194 篇一对一节点教程，另有 8 篇综合工程教程串联相关知识。
- 其他课程当前使用 KnowledgeNode 的 summary、required 和 misconceptions 作为结构化学习摘要；页面明确标记为摘要，不伪装成完整教程。
- 当前节点可以交给 Copilot 讲解。请求包含课程、节点 ID、摘要、必掌握内容、常见误区，以及已有教程正文（若存在）。
- 标记阅读完成或摘要已复习只更新 studyProgress，不更新 LearnerProfile 的考试掌握度。

## 学习和考核的边界

阅读完成、摘要复习、专项训练、间隔复习和掌握度是不同状态。答题后学习者可按真实回忆难度选择 Again / Hard / Good / Easy，系统据此设置下一次到期时间；到期队列按原题 ID 组卷。自评只安排复习，不会改变考试成绩或掌握度。studyProgress 记录学习资料活动；LearnerProfile 的 topicStats / knowledgeStats / misconceptionHits 记录评估证据。看过解释或标记完成不代表掌握。

## 教材质量门禁

文件数量、ID 映射、章节标题和正文长度只能证明结构覆盖，不能证明内容具有针对性。内容审计会检查必需章节、跨文档重复段落、已知通用模板残留、核心知识/工程步骤/场景/自测的最低实质内容，以及节点来源的核验状态。严格门禁只对本次改动的节点教程启用这些质量检查。

- 全库报告：`npm run learning:content-audit`
- 变更门禁：`node scripts/audit-learning-content.mjs --strict --base <base-commit>`

严格模式只审查本次提交修改的教程。历史内容可以先通过全库报告逐批修复，不会因为无关代码修改而阻断 CI。新教程若复制其他知识点的大段通用说明或场景、留下模板占位文字、缺少实质步骤或只有泛化场景，会被门禁拦截。

## 从学习内容到知识点检测

Snowflake 的节点教程以 KnowledgeNode 为单位。教程自测用于阅读后的主动回忆；页面上的“知识点检测”从题库中按 `knowledgeId` 取当前节点题目，再把精确的 question ID 列表交给现有组卷器。课程题的 `Question.topic` 与 `knowledgeId` 都指向唯一的 `KnowledgeNode.id`；`KnowledgeNode.topic` 才是可由多个节点共享的上级分类。

训练结束后，选择题按答案索引确定性评分；开放题使用已配置的 AI 评分。正式作答结果进入 Learner Profile，参与薄弱项和掌握度估计。阅读进度、摘要复习、Copilot 讲解与自评复习都不直接增加考试掌握度。

## 题目生产与事实核验

推荐的节点级生产顺序是：

1. 识别目标 KnowledgeNode 和需要测量的工程判断，先筛掉只有名词记忆价值的材料细节。
2. 建立 Assessment Blueprint：明确核心 Concept、`knowledgeId`、`cognitiveTask`、考察角度、难度、assessment target、关键误区和答案边界。
3. 从真实教学材料或官方资料生成自包含题目草稿。课程题必须填写 `courseId` 和精确 `knowledgeId`；并保证 `topic === knowledgeId === KnowledgeNode.id`。`KnowledgeNode.topic` 是共享上级分类，不填入课程题的 `Question.topic`。填写稳定的 `source.materialId`，并按课程要求记录 `section`、`page` 和 `relatedMaterials`；不得猜测或编造节点 ID、材料 ID 或官方来源 ID。
4. 通过现有题目写入流程执行 Schema、题型、答案索引、去重、语义重复、表达质量和覆盖缺口检查。
5. 独立解题并进行事实核验：先隐藏题库答案和解析，再逐项评估选项；使用来源摘录检查题干、选项、解析和开放题参考答案。
6. 有冲突或证据不足时保留 REVIEW / NEEDS_EVIDENCE，不以模型置信度替代来源证据。

现有生产入口为 `questions:manage -- blueprint`、`skills/article-to-questions/SKILL.md` 和 `skills/add-question-to-bank/SKILL.md`。事实核验入口为 `questions:manage -- verify --knowledge-id=<id> --evidence-file=<file> --gate`；按题目 ID 运行时使用 `--ids`。

CI 对本次新增/修改题目执行 `cognitiveTask`、`source.materialId` 门禁；课程题还检查 `courseId` 与 `knowledgeId`，Snowflake 题另外要求 `source.section` 和至少一个 `source.relatedMaterials`。题目转换器和 `question:add --check` 使用相同约束。CI 还运行题库身份、结构、质量、覆盖和变体检查。**这些元数据门禁不等于事实核验**：逐项事实核验会检查题目登记的主来源与补充来源是否提供了真实摘录、引用能否逐字匹配；未提供证据不能判为 VERIFIED。完整校验入口为 `npm run check`；题目专项审计可用 `npm run questions:manage -- validate`、`quality`、`coverage`、`verify`。

## 诊断能力边界

当前使用题目与知识节点映射、误区记录、作答分数和复习记录形成学习信号；尚未实现完整 IRT / Q-matrix 校准。题库数量或阅读完成率不能直接代表掌握度，诊断效果还取决于映射准确性、题目质量、误区区分度和重复测量。
