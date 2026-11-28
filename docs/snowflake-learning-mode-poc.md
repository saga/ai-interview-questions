# Snowflake 学习模式 POC

## 范围

本 POC 在现有 Snowflake LearningTrack 上增加课程导览、知识点教材、参考资料、阅读进度和知识点专项训练入口。不另建一份知识体系，也不把阅读状态混入考试掌握度。

## 内容结构

- `KnowledgeNode` 仍是唯一知识索引，文章包通过 `nodeId` 精确关联。
- `SNOWFLAKE_LEARNING_OVERVIEW` 保存课程介绍、适用对象、学习目标和课程路线。
- `SNOWFLAKE_LEARNING_CONTENT` 保存每个节点的一篇或多篇文章以及对应资料。
- 文章以 Markdown 存储，支持 Mermaid、表格和 SQL 代码块。
- 参考资料区分官方文档、论文、标准、工程实践、案例和书籍；每条资料记录其与知识点的关系及核对日期。

## 本轮教材覆盖

先为五个基础主干 P0 知识节点提供核心教材：

| KnowledgeNode | 核心教材 |
|---|---|
| `snowflake-architecture` | 存储、计算和 Cloud Services 的架构边界 |
| `virtual-warehouse` | 容量、并发、隔离与成本控制 |
| `snowflake-data-loading` | COPY、Snowpipe 与 Snowpipe Streaming |
| `change-capture-processing` | Streams、Tasks 与 CDC 事务语义 |
| `dynamic-tables` | 声明式转换、TARGET_LAG 和刷新模式 |

教材采用官方资料作为产品事实来源。对于不需要论文支持的产品基础知识，不为了凑数量加入无关论文。除教学案例外，当前还引用了两条官方公开客户故事：Order.co 的工作负载隔离，以及 Chocolate Finance 的近实时数据摄取。案例指标注明为客户特定结果，不作为普遍性能承诺。

其他 Snowflake 知识节点仍完整展示在课程树中。当前没有教材的节点展示知识摘要、需要掌握的要点和常见误区，并明确标记为“教材待建设”。

## 学习和考试的边界

Dexie 数据库增加 `studyProgress` 表，记录课程、知识节点、已读文章、最后阅读位置和更新时间。

阅读进度与 `LearnerProfile.knowledgeStats` 分开：

- 打开文章只更新最后阅读位置。
- 显式标记完成才记入已读文章。
- 阅读完成不会提高考试掌握度。
- 专项训练继续使用现有 Interview Engine 和 Question Bank。
- 从教材页面进入训练时，使用 `InterviewDefinition.topic` 将题池限制为当前 KnowledgeNode；常规组卷和自适应下一题使用同一过滤条件。

当前课程页面在 Snowflake 选择后进入 `/study?track=snowflake`。其他课程的现有入口不变。

## 当前边界

- 当前交付的是课程导览与五篇核心教材，不代表 100% 知识节点均已有文章。
- 文章末尾的检查题以阅读内容中的自检问题呈现；交互式逐题自测和章节综合考试后续复用现有训练引擎建设。
- 本轮未引入在线抓取或动态生成教材；课程资料由仓库版本控制。
- 论文、标准和第三方工程案例只在确实能解释该知识点时添加，并保留来源和适用范围。

## 验证

新增内容测试检查课程目标、五个核心节点覆盖、文章 ID 唯一性、参考资料有效 URL 格式，以及教材与题库节点的关联。学习进度测试覆盖打开、完成去重和课程隔离。

本次代码通过 GitHub 文件接口直接提交；当前执行环境无法运行项目的本地 Node/Vitest 构建。合并前仍需执行：

```bash
npm run build
npm run test
```
