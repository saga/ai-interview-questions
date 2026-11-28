# KnowledgeNode 一对一教材

本目录严格采用 **一个 KnowledgeNode 对应一篇独立 Markdown 主教程** 的模式。

- KnowledgeNode：**194**
- 独立 Markdown 主教程：**194**
- 绑定：`article.id === article.nodeId === article.knowledgeId === KnowledgeNode.id`
- 不按 topic 共用文章；每个知识点只有自己的主教程。
- 新增知识点必须同时新增同 ID 教程，CI 检查缺失、重复和多余文章。

## 按主题统计

- `data-architecture`：22 篇
- `data-engineering`：27 篇
- `postgresql`：20 篇
- `snowflake`：29 篇
- `snowflake-agent-ml`：36 篇
- `snowflake-data-products`：8 篇
- `snowflake-devops`：20 篇
- `snowflake-genai`：21 篇
- `snowflake-lakehouse`：11 篇

正文为 `articles/<knowledge-node-id>.md`；`index.json` 只保存文章索引、元数据和参考资料。
