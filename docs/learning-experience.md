# 学习体验与内容质量

## 学习入口

每个 LearningTrack 统一从 `/study?track=<id>` 进入知识学习页面。页面以 KnowledgeNode 为基本单元：

- Snowflake / PostgreSQL 使用 194 篇一对一节点教程，另有 8 篇综合工程教程串联相关知识。
- 其他课程当前使用 KnowledgeNode 的 summary、required 和 misconceptions 作为结构化学习摘要；页面明确标记为摘要，不伪装成完整教程。
- 当前节点可以交给 Copilot 讲解。请求包含课程、节点 ID、摘要、必掌握内容、常见误区，以及已有教程正文（若存在）。
- 标记阅读完成或摘要已复习只更新 studyProgress，不更新 LearnerProfile 的考试掌握度。

## 学习和考核的边界

阅读完成、摘要复习、专项训练和掌握度是不同状态。studyProgress 记录学习资料活动；LearnerProfile 的 topicStats / knowledgeStats / misconceptionHits 记录评估证据。看过解释或标记完成不代表掌握。

## 教材质量门禁

文件数量、ID 映射、章节标题和正文长度只能证明结构覆盖，不能证明内容具有针对性。内容审计会检查节点教程与综合教程的必需章节，并检测同类章节中的跨文档重复段落。

- 全库报告：`npm run learning:content-audit`
- 变更门禁：`node scripts/audit-learning-content.mjs --strict --base <base-commit>`

严格模式只审查本次提交修改的教程。历史内容可以先通过全库报告逐批修复，不会因为无关代码修改而阻断 CI。新教程若复制其他知识点的大段通用说明或场景，会被门禁拦截。

## 题目生产与事实核验

新题必须提供 cognitiveTask 和 source.materialId。历史题的 schema 兼容性保留，不要求一次性回填历史数据。新题发布前应独立求解，再依据真实来源摘录核验每个选项、答案和解析；无证据的题目保持待复核，不以模型自报置信度作为 VERIFIED。
