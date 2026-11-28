# Agent 中 Search 与 Analyst 的区别

## 本节要解决的问题

为 Agent 选择正确的工具：查询业务指标、检索企业文档、执行计算或调用外部系统时，不能只按用户问题的表面措辞选择工具。Cortex Search 和 Cortex Analyst 的数据来源、输入方式和输出证据不同，混用会造成 SQL 错误、检索漏项或无来源回答。

## 核心知识

### Cortex Search 面向非结构化文本检索

Cortex Search Service 从文本列建立检索索引，适合政策、手册、合同、产品说明、客服记录等文本资料。调用者提供自然语言查询以及可选过滤条件，服务返回相关文本片段和指定属性。

典型问题是“退货政策允许哪些情况”“合同中的提前终止条件是什么”。Search 返回的是相关证据片段，不负责聚合订单金额，也不负责判定完整业务指标。结果要带文档 ID、章节、页码或来源 URI，才能在最终回答中引用。

### Cortex Analyst 面向结构化业务数据问答

Cortex Analyst 根据 Semantic View 或 Semantic Model，把自然语言问题转换为 SQL。它适合“本季度各地区净收入”“上个月退款率最高的产品”等需要查询表格数据和业务指标的问题。

Analyst 依赖逻辑表、关系、Facts、Dimensions 和 Metrics 的语义定义。底层表的粒度或主键错误仍会影响查询结果；生成 SQL 后也需要检查关系路径、过滤条件、权限和结果正确性。

### Agent 可以组合工具，但不能把工具返回当最终事实

一个用户问题可能同时需要文档证据和结构化数据。例如“哪些产品退款率升高，并且是否违反退款政策？”需要 Analyst 计算退款率，再用 Search 查询政策文本。Agent 可以先后调用两个工具，或者在独立步骤中综合结果。

工具选择要考虑数据类型、证据形式、延迟和权限。Search 的过滤属性必须由可信服务端根据身份生成；Analyst 执行 SQL 使用 Snowflake Role 和语义对象权限。Agent 的自然语言指令只能引导选择，不能代替权限。

其它工具包括 Code Execution、Custom Tools、MCP 和 Web Search。Code Execution 用于对已取得数据做计算；Custom Tool/MCP 用于受控业务操作或外部系统；Web Search 用于公共网络信息。工具越多，越要明确输入 Schema、副作用、错误和停止条件。

## 工程实施步骤

1. 先判断问题对象是文本文件、结构化表、纯计算还是外部动作，避免按自然语言表面词汇直接选工具。
2. 文档依据问题使用 Cortex Search，建立来源字段、章节/页码和访问过滤。
3. 业务指标或维度分析使用 Cortex Analyst，确认 Semantic View 含有所需逻辑表、关系和 Metric。
4. 需要两类证据的问题，将 Search 和 Analyst 拆成独立调用步骤，并明确每一步的输入、输出和证据字段。
5. 需要计算时仅将工具返回的最小必要数据交给 Code Execution；不要让代码绕过 Snowflake 的访问授权读取原始表。
6. 需要业务写入时使用独立 Custom Tool 或 MCP 工具，定义请求 ID、幂等键、用户授权和可逆操作。
7. 对每个工具设置最小权限，分别检查 Search Service USAGE、Semantic View/表权限、MCP Integration 权限和外部凭证。
8. 保存工具调用参数、返回状态和来源定位；对空结果、超时、权限不足和相互矛盾证据定义停止或降级行为。
9. 建立测试集，覆盖纯文档问题、纯 SQL 问题、组合问题、需要计算问题和需要写入的问题。
10. 评估工具选择准确率、调用参数、返回证据、最终答案质量、延迟和成本；工具变更后执行回归。

## 场景分析

业务用户询问“日本区域本月退款率是否上升？主要原因是否符合退款政策？”系统需要从订单数据计算退款率，并从企业政策文档中检索适用条款。

Cortex Analyst 查询本月和上月日本区域的订单与退款数据，返回指标和 SQL 证据；Cortex Search 检索退款政策相关章节，保留文档版本和段落。Agent 综合两类证据时，应分别标记统计结论和政策原文，不把模型解释伪装成政策本身。若数据查询没有结果或政策版本不明确，应说明限制而不是推断。

验收使用已知退款率数据和政策文档样本，检查 Analyst 生成的 SQL、Search 命中片段、地区过滤、引用准确率以及两类证据是否被正确区分。

## 常见误区

- **用 Cortex Search 计算业务汇总指标。** Search 是检索文本片段，不是结构化 SQL 分析引擎。
- **用 Cortex Analyst 检索合同原文。** Analyst 主要根据语义模型查询结构化数据。
- **认为 Search 返回的 Top-K 就是全部相关资料。** 需要评估 Recall@K 和索引更新状态。
- **认为 Analyst 生成的 SQL 结果自动正确。** 语义定义和底层粒度仍需验证。
- **将 Search/Analyst 的返回结果直接拼成一个结论。** 应保留两种工具的来源和证据类型。
- **允许 Agent 自己决定租户过滤值。** 过滤条件应由已验证身份和后端授权策略生成。

## 完成标准

- [ ] 能区分 Cortex Search 的文本检索和 Cortex Analyst 的结构化 SQL 问答。
- [ ] 能判断问题需要文档、表数据、计算还是外部操作。
- [ ] 能设计 Search 与 Analyst 的组合步骤和证据字段。
- [ ] 能说明两类工具各自的权限边界。
- [ ] 能评估工具选择、召回、SQL 正确性和最终回答。

## 自测

1. “合同是否允许提前终止”应该优先使用 Search 还是 Analyst？为什么？
2. “本季度退款率按地区排名”为什么应该使用 Analyst？
3. 一个问题既要计算退款率又要说明政策依据，应如何组合工具并区分证据？
4. Search 服务有 tenant_id 属性，是否可以让浏览器决定查询哪个 tenant_id？
5. Analyst 返回了语法正确的 SQL，但结果金额重复累计，应该检查哪些语义建模问题？

## 参考资料

- [Cortex Agents tools](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-tools)
- [Cortex Search overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [Cortex Analyst overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst)
- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
