# CoCo 辅助构建 Snowflake 数据与 AI 应用

## 先把一个业务问题拆成可验收的系统

客服希望输入订单号，就能看到订单状态、关联政策和处理建议。这个需求看起来只需要一个 Agent，但实际包含三类数据：订单数据库里的结构化记录、内部政策文档，以及必须经过权限控制的写操作。

Cortex Code（CoCo）适合参与代码和 SQL 的开发、调试和测试，但它不是一个会自动获得所有数据权限的总控服务。要构建这类应用，先把数据进入平台、结构化查询、文档检索、Agent 编排和最终动作拆成独立环节。每一环都要能单独验证。

## 数据入口先保证可追溯

结构化订单数据从应用数据库或对象存储进入 Snowflake。若上游以文件交付，可使用 COPY INTO 做受控批量加载，或用 Snowpipe 根据云存储通知持续摄取。若源系统直接输出事件行，可评估 Snowpipe Streaming。

选择方式时要看源端形态和延迟目标，不要为了“实时”把所有文件强改成 Streaming。Snowpipe 不保证固定加载延迟或文件顺序；文件路径/名称在 14 天加载元数据窗口内可能被视为已处理。入口必须保留稳定的 source_event_id、batch_id 和业务时间，后面才能去重、重放和审计。

政策文档走另一条路径。原文件可放在 Stage 或受控存储位置，抽取文本后进入 Cortex Search 服务。文档索引需要明确来源、版本、有效期和访问控制；政策文件更新后还要监控索引新鲜度，不能只看 Search 服务创建成功。

## 清洗、质量与语义定义不要交给同一个 Agent 一次完成

结构化数据进入 Raw 后，可以使用 Streams/Tasks、Dynamic Tables 或 dbt 完成转换。选择哪一种取决于是否需要显式编排、持续刷新或独立版本化的 SQL 项目。

在 Curated 层检查订单主键、客户关联、状态枚举和事件延迟。Data Metric Functions 可以测量 NULL、重复和行数等指标，Expectation 定义通过阈值；批次级行数和金额对账仍应由摄取任务直接执行。默认每小时 DMF 调度不是实时批次阻断机制。

再用 Semantic View 定义订单、客户、政策类别等业务实体及关键指标。主键和关系基数必须先由数据模型验证，尤其要防止一笔订单连接多条历史维表后放大金额。退款率、已付款订单数等指标要有明确过滤条件和时间口径，不能让 Agent 临时猜业务定义。

## Search 和 Analyst 解决不同问题

Cortex Search 面向非结构化检索，返回相关文档片段及其来源信息，适合政策条款、操作手册和故障文档。它需要评估召回、排序、新鲜度和权限过滤。

Cortex Analyst 面向结构化数据，通过 Semantic View 把自然语言问题转成 SQL。它适合“某客户上月有多少笔已付款订单”这类数据问题。Verified Queries 可以为常见问句提供经人工核验的 SQL Ground Truth，也可用于评测生成 SQL 是否得到正确结果。

两者不能互相替代：Search 找文档证据，不负责汇总结构化指标；Analyst 生成 SQL，不会自动证明文档政策仍然有效。

## Agent 负责组织工具，而不是拥有无限权限

Cortex Agent 可按需要调用 Cortex Analyst、Cortex Search 和自定义工具。订单查询可以由 Analyst 完成；政策解释由 Search 提供引用；若要更新订单状态，应调用一个受限 Stored Procedure 或外部业务 API，而不是让模型拼接任意 UPDATE。

Agent 运行时使用调用者的会话权限。调用者需要 Agent USAGE、Agent 所在 Database/Schema 的 USAGE、工具 Warehouse USAGE，以及实际工具访问的对象权限。使用 Analyst 时还需要相应的 CORTEX_ANALYST_USER；CORTEX_AGENT_USER 本身不包含 Analyst 权限。

默认情况下，若某个配置工具缺少调用者权限，Agent 可以继续使用其他可访问工具并返回警告。严格的生产场景可以设置 orchestration.tool_not_accessible = 'reject'，避免部分工具不可用时给出不完整答案。

## CoCo 的两种模式不是同一套工具环境

Cortex Code 的 Code mode 适合查看仓库、修改 SQL/Python/dbt、运行 Shell 命令和执行代码测试；该模式关闭 Snowflake 数据工具、MCP servers、Skills 和协作功能。Standard mode 用于需要 Snowflake 数据访问、MCP 工具或 Skills 的任务。

因此，CoCo 在 Code mode 中静态检查一份 SQL 文件，不等于已经用数据库执行过它；Standard mode 中能查询数据，也不代表修改后的代码已通过仓库测试。交付记录要区分静态分析、真实 SQL 执行和部署后的数据验收。

## 端到端验收需要覆盖失败路径

以“按订单号回答客服问题”为例，至少准备以下测试：

1. 订单存在且政策文档有效：检查订单字段、Search 引用和最终回答。
2. 订单不存在：Agent 应说明没有匹配记录，不要猜测。
3. 政策文档已过期：Search 结果必须带版本/有效期，Agent 应拒绝引用失效内容。
4. 调用者没有 Analyst 或 Search 权限：按预设策略整体拒绝或明确报告工具不可用。
5. 写操作请求不符合业务规则：受限 Procedure 拒绝更新，数据库保留审计记录。
6. 上游重复投递：source_event_id 和 batch_id 保证重放不重复创建订单。

监控至少关联 Batch ID、Query ID、Search 请求、Agent Thread/Run ID、调用角色和业务请求 ID。缺少某个环节的证据，就不能把端到端“回答成功”当成系统正确的证明。

## 容易混淆的职责边界

- Snowpipe、Dynamic Tables、Cortex Search、Cortex Analyst 和 Agent 各自解决不同阶段的问题。
- DMF 统计不能替代批次对账。
- Search 返回相关文档不等于文档仍然有效。
- Semantic View 不能修复底层数据重复和错误粒度。
- Agent USAGE 不代表调用者拥有所有工具和数据权限。
- Code mode 的静态代码能力不等于 Standard mode 的数据工具能力。

## 自测

1. 为什么同一个客服 Agent 需要分别使用 Cortex Search 和 Cortex Analyst？
2. Snowpipe 文件到达顺序不保证与业务事件顺序一致时，应该保留哪些字段支持去重和重放？
3. 为什么 Semantic View 需要先验证订单粒度和客户关系，再提供给 Analyst？
4. CoCo Code mode 运行静态 SQL 检查后，为什么仍需要 Standard mode 或独立测试角色执行真实查询？
5. 当 Agent 缺少某个工具的权限时，默认行为与严格拒绝模式有什么区别？

## 参考资料

- [Cortex Code code mode](https://docs.snowflake.com/en/user-guide/cortex-code/code-mode)
- [Cortex Agents access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Cortex Search overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
- [Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro)
- [Data quality checks](https://docs.snowflake.com/en/user-guide/data-quality-intro)
