# 生成 SQL 的权限、成本与结果校验

## SQL 能执行，不代表它应该执行

分析师问：“上季度各地区的退款率是多少？”模型生成了一条 SQL，并且语法正确。问题在于 SQL 访问了包含个人资料的表，还扫描了多年的明细数据。数据库执行成功，只能说明语句通过了解析和当前权限检查，不能证明它满足用户意图、数据权限或成本预算。

安全的生成式 SQL 流程要把自然语言转成候选查询、把查询送入受限执行环境、再验证结果。不要让模型的输出直接继承管理员连接的权限。

## 先把生成和执行拆开

在 Cortex Agents 中，工具使用调用者的 Snowflake 会话权限；对 Agent 的 USAGE 本身并不等于拥有所有工具所需权限。调用者还需要访问 Agent 所在 Database/Schema、工具 Warehouse，以及 Analyst、Search 或自定义工具使用的对象。使用 Cortex Analyst 时，还要单独配置所需的 Analyst 数据库角色。

生产环境可以将 SQL 执行角色设为只读，并限制其能访问的 Semantic View、Schema 和表。对自然语言分析，优先让模型基于经过治理的 Semantic View 生成查询，而不是允许它任意猜测物理对象名。

权限设计至少分成三层：

1. Agent 调用权限：谁能运行这个 Agent。
2. 工具调用权限：调用者能否使用配置的 Warehouse、Cortex Analyst、Search 和其他工具。
3. 数据对象权限：生成 SQL 最终能读哪些 Database、Schema、表和 View。

不要以提示词中的“只能查询”代替数据库权限。提示词可以说明目标，但不能阻止模型错误地产生 DML 或访问不该访问的对象。

## 在执行前做独立 SQL 检查

应用侧应先解析 SQL，再检查语句类型、对象引用、函数和查询范围。生产读分析入口可以拒绝 INSERT、UPDATE、DELETE、MERGE、DDL、CALL、USE ROLE 等不符合策略的语句；对于 WITH，要检查完整 AST 中是否含有写操作，而不是只看第一个 token 是否为 SELECT。

对象 allowlist 应解析 Database、Schema 和对象名，拒绝未批准对象及未限定引用。多语句请求、外部函数、阶段文件访问和高风险系统函数需要单独处理。语法检查只是第一道门，真正的数据访问还由 Snowflake Role 再次约束。

## 用 Warehouse 与查询限制控制费用

给分析查询指定专用 Warehouse，避免和 ETL 或生产应用共用资源。设置合理的 AUTO_SUSPEND、Resource Monitor 和查询超时；对单次请求记录 Query ID、Warehouse、扫描字节、排队和执行时间、返回行数及 Credit 估算。

示例执行策略可以包含：

- SQL 只允许访问审核过的 Semantic View。
- 限制查询时间范围和最大返回行数。
- 拒绝无过滤的大型事实表扫描，或要求用户补充时间/租户条件。
- 对超时、扫描量过大和异常结果设置明确的拒绝或二次确认流程。
- 对重复问题使用经过验证的查询样例，而不是每次重新生成自由 SQL。

这些约束应由 SQL 解析器、权限、Warehouse 和执行层共同实现。一个 LIMIT 100 并不保证扫描成本很低；聚合和排序仍可能读取大量底层数据。

## 执行后的结果仍需校验

查询成功之后，检查结果 Schema、行数、NULL、主键粒度、数值范围以及是否满足问题中的时间和过滤条件。若输出是“退款率”，还必须核对分子、分母、退款状态和金额口径；模型写出 AVG(REFUND_FLAG) 并不意味着业务定义正确。

对重要问题维护 Verified Queries 或固定验收样例。比较生成 SQL 的实际结果与业务 owner 确认的结果，而不只比较 SQL 文本。结果为空、行数异常、指标跳变或没有证据支撑时，Agent 应明确说明无法回答，而不是补写推测性解释。

## Cortex Agent 权限不足时会发生什么

Cortex Agent 的工具权限默认行为并不是“一项权限不足就全部失败”。若角色缺少某个配置工具的权限，默认 accept 行为允许 Agent 继续使用其他可访问工具并返回警告。对权限要求严格的生产场景，可以评估 orchestration.tool_not_accessible = 'reject'，使缺少工具权限时整次调用失败。

这项设置不能替代底层对象权限，也不能把 CORTEX_AGENT_USER 当作全量数据访问许可。应按实际工具逐项授予最小权限，并使用无权限、部分权限和完全权限三种角色测试拒绝行为。

## 验收不要只测正常问题

使用三组测试：合法查询、超范围查询和恶意/越权请求。分别验证 SQL AST 检查、Role 权限、工具拒绝模式、Warehouse 预算、结果 Schema、业务指标以及审计日志。测试应包含用户请求和模型生成的 SQL，确保权限控制并非只存在于提示词中。

## 参考资料

- [Cortex Agents access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Cortex Analyst Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
- [Snowflake access control overview](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
