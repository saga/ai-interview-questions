# Cortex Analyst 与数据问答应用：从 Text-to-SQL 到 Agent 编排

## 本节要解决的问题

财务经理问：“2026 年第三季度，日本地区的净销售额是多少？与去年同期相比增长多少？”系统需要把自然语言问题转换为 SQL，选择正确的业务指标、地区过滤和日期范围，再展示查询结果和所用口径。

如果只是把问题交给 LLM 并让它自由编写 SQL，模型可能把订单头与订单明细按错误粒度 Join，也可能把毛销售额当成净销售额。Cortex Analyst 的作用是让自然语言查询受 Semantic View 中已定义的逻辑表、关系、指标和同义词约束。

截至 2026 年 8 月，Snowflake 已建议新建的自然语言数据分析应用评估 Cortex Agents。独立 Cortex Analyst REST API 仍然可用；从 Analyst API 迁移到 Agents，通常是调用和编排层的变化，不需要重建 Semantic Views 或 Verified Queries。

## 先把业务语义准备好，再接入自然语言

### Cortex Analyst 依赖 Semantic View，不应从物理表名猜业务含义

假设订单系统有三张表：

| 物理表 | 粒度 | 示例字段 |
|---|---|---|
| ORDERS | 一行一张订单 | ORDER_ID、CUSTOMER_ID、ORDER_DATE |
| ORDER_LINES | 一行一条订单明细 | ORDER_ID、LINE_NO、NET_AMOUNT |
| CUSTOMERS | 一行一个客户 | CUSTOMER_ID、REGION |

用户问“净销售额”，并不意味着模型知道应该汇总 ORDER_LINES.NET_AMOUNT。业务需要先确认净销售额是否扣除了折扣、退款和取消订单；订单日期按创建日还是交付日；日本地区按客户注册地址还是销售组织；同比是否使用相同币种和汇率口径。

这些定义应落到 Semantic View 的 Logical Tables、Relationships、Facts、Dimensions 和 Metrics。逻辑模型还必须标明主键和关系基数，避免一对多 Join 将订单头事实重复累计。

Cortex Analyst 根据问题和 Semantic View 生成 SQL。若模型只看到字段名和物理表结构，“净销售额”“客户地区”“订单季度”可能被映射到不同字段；SQL 即使能执行，也不代表符合财务定义。

### 指标描述和同义词决定用户说法能否正确映射

Semantic View 中的 Metric 应写清聚合定义，Dimension 应有业务描述和同义词。例如“销售额”“净收入”“net sales”不能只靠语言相似度认定为同一个指标。

净销售额要明确收入字段、折扣/退款扣减、取消状态和币种；订单数要按唯一 ORDER_ID 计数，而不是按明细行数；平均订单金额要明确采用订单头金额，还是净销售额除以订单数。若底层有多对多、重复键或历史维度，先修复数据模型和 Relationship，再让 Analyst 生成 SQL。

### Verified Query Repository 用已验证问题和 SQL 约束高频问法

Verified Query Repository（VQR）保存真实业务问题和经过验证的 SQL。Analyst 遇到相似问题时可以参考这些查询，减少常见问法中的歧义。

VQR 必须使用 Semantic View 中的逻辑表和逻辑列名称，而不是底层物理表或列名。比如逻辑表叫 sales_data，VQR 应引用模型里的 sales_data 和逻辑列，而不是绕过语义模型直接引用原始表字段。

适合加入 VQR 的问题包括经常重复的管理指标、涉及日期边界或复杂过滤的问题，以及历史上多次生成错误 SQL 的业务问法。不要把每个用户请求自动加入 VQR；只有业务 owner 核对 SQL、结果和适用范围后，才应标记为 Verified。错误的已验证查询会持续误导相似请求。

## 选择独立 Cortex Analyst API，还是 Cortex Agents

### 只需要结构化 Text-to-SQL 时，独立 Analyst API 仍可用

独立 Cortex Analyst REST API 的主要入口是：

~~~http
POST /api/v2/cortex/analyst/message
Authorization: Bearer <snowflake-token>
Content-Type: application/json
~~~

请求提供自然语言问题和 Semantic View（或兼容语义模型）。API 可以返回生成的 SQL、解释、查询结果或澄清信息，也支持多轮对话和流式事件。

当应用已有自己的 UI、身份会话和流程控制，只需要结构化数据问答时，独立 API 仍然是可行选择。Snowflake 在 2026 年 8 月的建议迁移，并不代表现有 API 立即停用。

应用端仍要管理认证与当前 Role、Semantic View 权限、SQL 状态和 warning、Query ID、用户反馈，以及多轮对话上下文。生成 SQL 不是自动批准的业务结论；对高风险指标，应展示 SQL 或口径，并检查时间范围、过滤条件和结果。

### 新建多步骤数据应用时，按当前建议评估 Cortex Agents

2026 年 8 月 28 日的 Snowflake 发布说明建议将 Cortex Analyst 应用迁移到 Cortex Agents。Agents 保留 Analyst 的结构化查询能力，同时可以组合 Cortex Search、Custom Tools、Thread 上下文和多步骤编排。

典型分工：
- Cortex Analyst：读取结构化业务指标，生成 SQL；
- Cortex Search：检索非结构化政策、合同、报告和说明文件；
- Custom Tool：调用受控的业务服务或存储过程；
- Agent：根据请求选择工具、组织证据和判断何时停止。

一个复合问题可能是：“第三季度净销售额下降，是哪些地区贡献的？是否与某项生效政策有关？”Agent 可以先调用 Analyst 查询地区趋势，再用 Search 检索政策版本和生效日期。回答应分别列出结构化数据和文档证据，不能把政策相关性直接说成因果关系。

如果用户只问销售额，不应为了使用 Search 而调用文档检索；多工具编排必须由业务问题驱动，而不是为了增加技术组件。

### 迁移通常不需要重建语义层

从独立 Analyst API 迁移到 Agent 时，主要变化在调用和编排层：
1. 保留现有 Semantic View；
2. 保留其中的 Verified Queries；
3. 创建 Cortex Agent 并将 Analyst 配置为工具；
4. 有文档证据需求时增加 Search；
5. 调整 Thread、反馈、权限和响应 UI；
6. 用现有问题集比较迁移前后的结果。

存量纯 Analyst 应用可以继续运行；新建的多步骤数据分析应用则应优先评估 Agents。不要把推荐迁移误解为旧 API 已停用。

## 用评测验证 SQL 与业务结果

### 先建立固定问题集和金标准

评测集应来自真实业务问法，覆盖正常、歧义、边界和不可回答问题。例如季度边界、时区、空值、取消订单、多表 Join、历史维度，以及 Semantic View 中没有定义的指标。

每条测试要保存 Ground Truth SQL 或核对过的结果、业务日期、数据快照和适用条件。尽量使用绝对日期；“去年同期”会随测试时间变化，容易造成评测结果漂移。

### Cortex Analyst Evaluation 的范围是 SQL Correctness

Cortex Analyst Evaluations 可以使用 Semantic View 中的 Verified Queries 作为测试数据，支持 SQL Correctness 指标，比较生成 SQL 的执行结果与金标准结果，而不是要求 SQL 字符串逐字相同。

被选作 Ground Truth 的 Verified Query 会在该次评测的临时 Semantic View 副本中移除，避免 Analyst 直接命中正在测试的查询，从而高估 SQL 生成能力。未被选作 Ground Truth 的 Verified Queries 仍可在评测期间作为指导。

VQR 使用 last quarter、last month 等相对日期时，预期结果会随时间改变。长期回归应固定日期和数据快照。

## 一次数据问答请求如何被验证

1. 用户问：“2026 年第三季度，日本地区净销售额同比增长多少？”
2. Analyst 根据 Semantic View 选择净销售额、地区和日期维度。
3. Analyst 生成 SQL，并返回 SQL 和执行结果。
4. 应用检查返回状态、warning、request_id 和 SQL；对关键指标执行必要的业务校验。
5. 用户追问“是否与某项政策调整有关”时，Agent 再调用 Search 检索政策文件，核对发布日期和生效日期。
6. 最终回答分别展示结构化数据结果和文档证据，不把相关性写成因果。
7. 保存问题、Agent/Analyst 版本、工具调用、Query ID、引用和用户反馈，纳入后续评测。

最常见的错误是把 SQL 执行成功当成业务结果正确。例如订单明细和客户表可以顺利 Join，但历史客户表可能存在多个有效版本，导致净销售额重复累计。应检查 Join 基数、指标表达式、过滤条件和控制数，而不只是检查 SQL 有没有报错。

## 工程实施步骤

1. 盘点现有 Semantic Views、Metrics、Relationships、Verified Queries 和用户常用问法。
2. 为每个指标记录事实粒度、聚合方式、过滤条件、日期口径和适用范围。
3. 检查主键、外键、重复行和多对多关系；为核心指标建立可复核的 Golden SQL。
4. 判断请求类型：纯结构化问数、文档检索，还是需要跨工具的多步骤任务。
5. 对存量纯 Analyst 应用保留独立 API；新建多工具应用时评估 Cortex Agents。
6. 创建 Agent 时先配置 Analyst 工具和已治理 Semantic View；确有文档证据需求时再添加 Search。
7. 在实际调用 Role 下验证 Agent、Semantic View、Search Service、Database、Schema 和 Warehouse 权限。
8. 建立固定问题集和 Ground Truth SQL/结果，覆盖正常、歧义、边界和不可回答问题。
9. 使用 Cortex Analyst Evaluations 执行 SQL Correctness 回归；避免将相对日期作为长期金标准。
10. 监控生成 SQL、Query ID、工具 warning、权限拒绝、用户反馈和查询成本；语义模型变更后重跑受影响问题集。

## 常见误区

- **把自然语言问数当成普通文档 RAG。** 结构化指标应由 Semantic View 和 Cortex Analyst 处理，而不是靠检索段落猜数值。
- **让 Analyst 从物理列名自行推断业务指标。** 指标、Relationship、粒度和同义词必须先在语义层定义。
- **只检查 SQL 能否执行。** 还要比较指标口径、Join 基数、时间边界和结果控制数。
- **把 VQR 当作任意 SQL 收藏夹。** SQL 必须使用逻辑表/逻辑列，且由业务 owner 验证问题和结果。
- **认为使用 Cortex Agents 就要重建 Semantic View。** Analyst 工具沿用已有 Semantic Views 和 Verified Queries。
- **认为 Cortex Analyst REST API 已经停用。** Snowflake 推荐新应用转向 Agents，但旧 API 仍然可用。
- **所有问数都调用 Search 或多个工具。** 只查询结构化指标时没有必要增加文档检索。
- **把政策文本和趋势同时出现当成因果证据。** 必须核对发布日期、生效范围、业务日期和其他影响因素。
- **用 last quarter 等相对日期长期评估 SQL 正确性。** 固定绝对日期和数据快照更适合回归。

## 完成标准

- [ ] 能解释 Cortex Analyst 如何使用 Semantic View 生成结构化 SQL。
- [ ] 能说明 Facts、Dimensions、Metrics、Relationships 和业务同义词如何影响 Text-to-SQL。
- [ ] 能判断独立 Analyst API 与 Cortex Agents 的职责和迁移边界。
- [ ] 能说明 Cortex Agents 使用 Analyst 工具查询结构化数据，并可组合 Search/Custom Tools。
- [ ] 能解释 Verified Query Repository 如何帮助高频问题，并说明逻辑表/列命名要求。
- [ ] 能用 SQL Correctness Evaluation 验证生成 SQL 的执行结果。
- [ ] 能设计覆盖歧义、边界和不可回答问题的测试集。
- [ ] 能在回答中展示 SQL/结果/引用和失败状态，并保留可追溯证据。

## 自测

1. 一个问题只要求计算日本地区的季度净销售额。为什么不需要 Cortex Search？Semantic View 还需要定义哪些内容？
2. 用户问“净销售额”，但订单头和明细表都有金额字段。如何避免模型选错指标或在一对多 Join 后重复累计？
3. Snowflake 于 2026-08-28 推荐将 Cortex Analyst 应用迁移到 Agents。对已有 Semantic View 和 Verified Query，需要重建吗？为什么？
4. 现有应用只需要 Cortex Analyst REST API 生成 SQL。是否必须立即停止使用独立 Analyst API？
5. 一个 VQR SQL 直接引用底层表的物理列名。为什么应改用 Semantic View 中的逻辑表和逻辑列？
6. 一条 Verified Query 被选作 Evaluation Ground Truth 后，为什么该查询不能同时在评测期间继续指导 Analyst？
7. 某用户追问“销售额下降是否由政策变更导致”。应该怎样组合 Analyst 与 Search 的结果，避免将相关性写成因果？

## 参考资料

- [Aug 28, 2026: Snowflake recommends transitioning from Cortex Analyst to Cortex Agents](https://docs.snowflake.com/en/release-notes/2026/other/2026-08-28-cortex-analyst-transition-cortex-agents)
- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Cortex Analyst REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api)
- [Semantic Views overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
- [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
