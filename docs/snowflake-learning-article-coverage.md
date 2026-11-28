# 教材一对一映射复核

更新日期：2026-11-28

当前知识库包含 **194 个 KnowledgeNode**，本次生成 **194 篇独立 Markdown 主教程**。每篇文章的 `article.id`、`article.nodeId`、`article.knowledgeId` 都等于对应 KnowledgeNode.id。

| Topic | KnowledgeNode / 教程数 |
|---|---:|
| `data-architecture` | 22 |
| `data-engineering` | 27 |
| `postgresql` | 20 |
| `snowflake` | 29 |
| `snowflake-agent-ml` | 36 |
| `snowflake-data-products` | 8 |
| `snowflake-devops` | 20 |
| `snowflake-genai` | 21 |
| `snowflake-lakehouse` | 11 |
| **合计** | **194** |

## 旧实现为什么只有 5 / 37 篇

- 教材最初只覆盖五个 P0 节点，POC 后没有扩展成完整教材工程。
- 后续扩张主要增加 KnowledgeNode、题目和 Roadmap，没有同步生成教材。
- 测试只保护最初五个教材节点，没有全量覆盖约束。
- 教材正文写在 TypeScript 中，缺少独立内容库和一对一索引。
- 后续按 topic 共享 37 篇文章，造成节点显示“有教材”但没有自己的教学内容。

## 本次修正

- 生成 194 篇 `articles/<knowledge-node-id>.md`。
- Article ID 与 KnowledgeNode ID 完全相同。
- 每个 Learning Pack 恰好只有一篇教程。
- 移除旧的 37 篇主题文章，不作为课程教材保留。
- 测试验证数量、ID、节点绑定、文章结构和来源资料。

新增 KnowledgeNode 时必须同时新增同 ID Markdown 文件和索引记录；缺失、重复、错误绑定或额外文章应使测试失败。
