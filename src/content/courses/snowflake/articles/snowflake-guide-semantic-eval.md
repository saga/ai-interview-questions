# Semantic View 与 Cortex Agent 评测晋级门禁

## 本节要解决的问题

数据团队修改了 Semantic View：订单净销售额新增退款扣减规则，客户地区改为按交易发生日的有效地址计算。开发环境中的几条问题都能返回结果，但上线后财务仪表盘的季度汇总翻倍，Agent 也引用了上一个版本的政策。

这不是单纯的模型质量问题。语义定义改变会影响 SQL 生成、仪表盘和 Agent 工具结果；Agent 指令或工具变化也可能影响回答和权限。发布门禁要把语义定义、黄金查询、Agent 评测和权限测试连起来，并且在候选版本未通过之前，不让生产消费者切换。

## 把候选语义定义与生产消费者隔离

### 不要在生产 Semantic View 上直接试错

Semantic View 是 Schema 级对象。若开发者用 CREATE OR REPLACE SEMANTIC VIEW 直接覆盖生产对象，依赖该对象的 Analyst、Agent 和其他消费者会立即面对新的定义。旧 Agent Version 并不会自动恢复旧 Semantic View，也不会替你回滚底层 Metric。

推荐将候选定义放在独立 Database/Schema，或使用版本化对象名：

| 环境 | 示例对象 | 用途 |
|---|---|---|
| 开发 | DEV_SEMANTICS.SALES.NET_SALES_CANDIDATE | 日常修改与结构校验 |
| 测试 | QA_SEMANTICS.SALES.NET_SALES_V2026_11 | 固定测试数据和 Golden Query |
| 生产 | PROD_SEMANTICS.SALES.NET_SALES | 已批准的稳定定义 |

候选 Schema 可以使用受控的测试数据快照或脱敏副本。不要仅仅克隆 Semantic View 定义，却仍然引用正在变化的生产表，然后把测试结果当成可复现的证据。候选环境还应明确使用哪个数据截止时间、底层模型版本和 Role。

### 语义定义校验要检查结构与真实数据两部分

首先验证 Semantic View 对象能否创建、描述和被目标 Role 使用：

~~~sql
DESCRIBE SEMANTIC VIEW QA_SEMANTICS.SALES.NET_SALES_V2026_11;
SHOW SEMANTIC METRICS IN SEMANTIC VIEW
  QA_SEMANTICS.SALES.NET_SALES_V2026_11;
SHOW SEMANTIC DIMENSIONS IN SEMANTIC VIEW
  QA_SEMANTICS.SALES.NET_SALES_V2026_11;
~~~

这类检查只能说明对象定义和元数据可读取，不能证明 Join 基数、指标表达式或业务口径正确。还要验证：
- Logical Table 的主键是否真实唯一；
- Relationships 是否符合实际一对多、多对一或多对多关系；
- 历史维度是否使用事件日期；
- Metric 的分子、分母、过滤和聚合粒度是否符合业务定义；
- 非可加指标是否错误地跨时间求和；
- 目标 Role 能否访问 Semantic View 及其底层对象。

### 变更范围要与受影响的指标和消费者对应

不是所有语义修改都需要把全部应用从头测试，但必须知道改动影响哪些路径。比如：
- 改 Metric 表达式：运行该 Metric 的 VQ、仪表盘控制数和调用它的 Agent 问题；
- 改 Relationship 或 Primary Key：重点测试依赖该关系的多表查询和聚合；
- 改 Dimension 同义词：测试自然语言表达是否映射到正确维度；
- 改 PII 标签或数据策略：运行允许/拒绝角色的权限测试；
- 改 Agent Tool 或 Instructions：运行 Agent Evaluation 和实际用户 Role 测试。

维护一份从 Semantic View 对象到 Metrics、VQ、Agent、Dashboard/应用的依赖清单，比每次机械地跑一套巨大测试更有效。

## 第一层门禁：Golden Query 与 Cortex Analyst Evaluation

### VQ 是业务口径的基准，不是临时生成的“期望 SQL”

关键业务问法应在 Verified Query Repository 中保存经业务 owner 核验的问题和 SQL。SQL 应使用 Semantic View 的逻辑表、逻辑列和 Metric，而不是直接引用底层物理表。

例如“2026 年第三季度日本地区净销售额”，测试应同时固定：
- 语义对象版本；
- 业务日期范围和时区；
- 地区的来源定义；
- Net Sales Metric 的计算口径；
- 测试数据快照和预期结果。

不要只验证 VQ SQL 本身能运行；还要让 Analyst 从自然语言问题生成 SQL，并检查结果与金标准是否一致。

### Cortex Analyst Evaluation 只测 SQL Correctness

Cortex Analyst Evaluations 使用 Semantic View 的 Verified Queries 作为测试集，执行生成的 SQL，并比较结果。SQL 文本可以不同，只要执行结果符合金标准即可。

本次评测选作 Ground Truth 的 VQ 会从临时 Semantic View 副本移除，避免 Analyst 直接命中该条查询而高估生成能力；未被选中的 VQ 仍可留在副本中指导模型。一个 VQ 在同一轮评测中不能同时作为运行时指导和 Ground Truth。

查看结果时分开观察：
- Accuracy：生成 SQL 被判为正确的比例；
- Regressions：之前正确、现在失败的查询数；
- Latency：响应时间；
- Per-query comparison：问题、期望 SQL、生成 SQL 和判定。

不要只看总体 Accuracy。若财务净销售额这条关键 VQ 从正确变为错误，即使总体从 92% 升到 95%，也不应该直接晋级。

## 第二层门禁：Cortex Agent Evaluation 与权限测试

### Agent 评测覆盖工具行为和回答，不替代 Analyst SQL 测试

如果 Agent 调用了 Analyst、Search 和 Custom Tool，应为复合任务建立独立测试集。Ground Truth 可以包含期望答案与预期工具调用。Agent Evaluation 的指标包括：
- answer_correctness：最终回答是否符合期望结果；
- tool_selection_accuracy：是否选择了预期工具；
- tool_execution_accuracy：工具输入/输出是否符合预期；
- logical_consistency：规划与调用是否前后一致。

这些指标的 Preview/版本和工具支持范围应按当前文档确认。Agent Evaluation 不能代替语义 SQL 的黄金查询，也不是所有生产安全路径的完整模拟。

### RLS、MCP 和外部副作用需要独立测试

Cortex Agent Evaluation 有边界，例如依赖 Session Attributes 的 Row Access Policy、MCP Connector 和 Code Execution 文件副作用不一定在评测运行中完整复现。必须安排独立的集成和安全测试：
- 使用真实业务 Role 查询允许的数据；
- 尝试访问无权基金、地区和研究文档，确认被拒绝；
- 测试 Search Owner’s Rights 与 Data Governance Policy Inheritance 的实际配置；
- 测试外部 MCP 的连接、凭证和工具返回；
- 测试 Custom Tool 的写操作、幂等键、超时和人工审批；
- 检查输出文件是否落到正确 Stage，以及下载权限是否正确。

### Agent Evaluation 权限不完整会制造假失败

Agent Evaluation 是批量评测，会创建 Task 并调用被测 Agent 和 Judge Model。执行角色至少需要：

- Cortex 数据库角色：SNOWFLAKE.CORTEX_USER、SNOWFLAKE.CORTEX_AGENT_USER、SNOWFLAKE.CORTEX_ANALYST_USER 或 SNOWFLAKE.CORTEX_REST_API_USER 之一。
- 账户级 EXECUTE TASK。
- 被测 Agent 所在 Database/Schema 的 USAGE，以及评测数据所在 Database/Schema 的 USAGE。
- 若评测要创建输入表，需要评测 Schema 的 CREATE TABLE；若从输入表创建 Dataset，需要 CREATE DATASET。
- 当前执行 Database/Schema 的 USAGE、CREATE FILE FORMAT 和 CREATE TASK；若需要创建评测配置 Stage，还要 CREATE STAGE。
- 被测 Agent 的 USAGE 或 OWNERSHIP，以及 MONITOR 或 OWNERSHIP。
- Agent 所使用的每一个工具的权限；在 Snowsight 中运行或查看评测，还需要评测 Warehouse 的 USAGE。
- 若读取外部配置文件，需要配置 Stage 的 READ 权限。

如果账户启用了 Judge Model allowlist 或模型级访问控制，角色还必须获得每个所选 System Metric Version 对应 Judge Model 的使用权限，以及 Custom Metric 指定模型的权限。缺少 Judge Model 权限时，评测可能返回 0 分而没有可操作的错误，即使同一角色直接调用 AI_COMPLETE 能成功。因此 0 分首先要区分授权失败和真实质量退化。

### 四项 Agent System Metric 测量不同阶段

Cortex Agent Evaluation 的四项 System Metric 覆盖 Goal-Plan-Action 链：

- Answer Correctness：比较最终回答与 Ground Truth。
- Logical Consistency：检查 Instructions、规划和工具调用是否前后一致，不要求 Ground Truth。
- Tool Selection Accuracy（TSA，Public Preview）：比较 Ground Truth 中预期工具名称与真实调用，按匹配数量计分，不要求调用顺序一致。
- Tool Execution Accuracy（TEA，Public Preview）：比较工具输入和输出是否符合 Ground Truth；未调用预期工具会拉低分数。额外调用应由 TSA 识别，未列入 TSA/TEA 当前支持范围的工具不会进入这两项工具指标的分数。

TSA 是确定性工具名称匹配；TEA 使用语义 Judge 对提供的 tool_input/tool_output 进行匹配。若 Ground Truth 不提供输入和输出，TEA 只能确认工具是否被调用，不能证明参数和结果正确。对于 MCP、Code Execution 或自定义工具等未在 TSA/TEA 当前支持名单中的类型，应使用 Answer Correctness、Logical Consistency 或自定义 Metric 评估，另外安排独立集成与安全测试。

### Analyst Evaluation 的权限与 Ground Truth 有另一套规则

Cortex Analyst Evaluation 使用 Semantic View 的 Verified Queries 建立 Ground Truth。执行角色需要 SNOWFLAKE.CORTEX_USER、USE AI FUNCTIONS（或相应的 AI_COMPLETE 函数权限）、账户级 EXECUTE TASK、Semantic View 所在 Schema 的 CREATE TASK 和 CREATE DATASET，以及 Semantic View 与底层表的 SELECT、Semantic View 的 MONITOR。Judge Model 访问权限同样适用。

这些权限必须授予同一个 Primary Role；Task 不会考虑 Secondary Roles。选作 Ground Truth 的 Verified Query 会从临时 Semantic View 副本中移除，防止模型直接命中原问题而高估 SQL 生成能力。没有被选中的 Verified Query 仍可作为运行时参考。Cortex Analyst Evaluation 当前只使用 SQL Correctness 指标，并记录 Accuracy、Regressions 和 Latency。

SQL Correctness 的 Judge Version 目前有 v1、v2、v3。v1 依赖的 Judge Model 已于 2026 年 10 月 14 日 End of Life；默认版本已切换到 v3。CI/CD 评测应固定当前可用版本，例如 v3_0，并在升级 Judge Version 时建立新基线，不要直接比较不同版本的分数。

Cortex Agent Evaluation 与 Cortex Analyst Evaluation 不能互相替代。一个 Agent 可能调用 Analyst 正确生成 SQL，却在后续 Search 或解释环节出错；反过来，Agent 最终回答正确，也不能证明所有 SQL 模板都可靠。两种评测需要分别准备数据集、角色、工具和门槛。

Agent Evaluation 在 Snowsight 中使用 Agent 的 Database/Schema；通过 SQL 执行时则使用 Session 的 Database/Schema。Analyst Evaluation 使用 Semantic View 所在 Schema 和评测配置文件。权限检查应按实际执行入口进行，不能只在一个角色上验证后假定另一个入口也可用。
## 晋级流程与回滚边界

### 版本化的候选对象通过门禁后再切换消费者

一个可执行的发布过程：

1. 将 Semantic View 定义和 Agent specification 存在版本控制中；
2. 将候选 Semantic View 部署到 QA Schema；
3. 执行结构校验、主键/Relationship 检查和关键 Metric Golden Query；
4. 运行 Cortex Analyst Evaluation；
5. 将候选 Semantic View 绑定到测试 Agent，运行 Agent Evaluation；
6. 执行真实 Role 的允许/拒绝权限测试以及外部工具集成测试；
7. 对候选版本计算成本、延迟和资源消耗；
8. 由数据 owner 和应用 owner 确认结果后，将生产消费者指向已批准版本；
9. 保留前一个 Semantic View 和 Agent Version 的引用，便于恢复；
10. 上线后观察实际请求、Query History、Agent Trace 和用户反馈。

不要让“创建候选对象成功”就自动晋级，也不要把一个旧 Agent Version 当成完整回滚。Agent Version 可能仍然引用被覆盖的 Semantic View；真正回滚时要同时恢复语义对象版本、Agent tool_resources 和下游连接。

### 任一关键门禁失败时，生产指针不应变化

候选版本失败后，应保持生产消费端继续使用当前已批准对象。修复后重新跑与变更范围对应的测试，并将结果写入发布记录。若出现线上错误：
- 先把消费者指回前一已批准版本；
- 若语义对象已被覆盖，恢复其定义并重新验证；
- 若底层数据已被修改，确认恢复点和影响范围；
- 保存失败 SQL、Query ID、Agent Trace、Role 和数据快照；
- 对受影响指标做前后对账，再关闭事件。

回滚需要版本化对象和可追溯的依赖关系。没有保存旧语义定义、Agent 配置和生产引用，就不能承诺“一键回滚”。

## 工程实施步骤

1. 为 Semantic View、VQ、Agent specification 和测试数据建立版本号或 Git Commit 关联。
2. 为候选版本分配隔离 Schema，并记录底层数据快照/截止时间。
3. 验证 Semantic View 定义、主键、Relationship、Metric 和目标 Role。
4. 根据修改范围运行 Golden Query 和 Cortex Analyst SQL Correctness Evaluation。
5. 在使用候选 Semantic View 的 Agent 上运行 Agent Evaluation，覆盖答案、工具选择和执行。
6. 对 Session Attribute/RLS、MCP、外部 API、文件副作用和写工具执行独立测试。
7. 为 Eval Role 检查 Primary Role 权限、Warehouse、Task 和 Judge Model 访问。
8. 设定单条关键 VQ、整体 Accuracy、Regression 数、Latency、权限拒绝和成本门槛。
9. 任一关键门禁失败时，禁止切换生产消费者，并将失败用例分派给对应 owner。
10. 通过审批后更新生产 Agent/应用引用；保留旧 Semantic View、Agent Version 和配置清单。
11. 上线后监控 Query History、Agent Trace、权限 Warning、指标对账和用户反馈。
12. 发生回归时恢复前一语义版本与 Agent 配置，并完成数据和权限复验。

## 场景分析

财务团队修改 Net Sales Metric，增加退款扣减，同时将 Customer Region 改为订单发生日的历史地址。候选版本在 QA Schema 中通过对象创建检查，但 Golden Query 中有两条地区汇总结果翻倍；Analyst Evaluation 的 Accuracy 从 96% 降为 88%。Agent Evaluation 也出现了把新地址政策引用到旧订单上的错误。

正确做法是阻止晋级。团队检查到订单明细 Join 历史地址表时存在两个重叠有效期，导致一条明细匹配两行。修复维度区间后，重跑受影响的 VQ 和 Agent 问题。若修正后所有关键测试通过，再由财务 owner 核验退款口径和地区定义，最后切换生产消费者。

如果只是 Agent 最终文本变得更自然，但 SQL 仍然重复累计金额，不能把它判定为改进。晋级条件要围绕业务事实、工具行为和权限，而不是回答风格。

## 常见误区

- **把 YAML/SQL 解析通过当成语义质量通过。** 对象能创建不代表主键、关系和指标正确。
- **只跑 Analyst Evaluation，不跑 Agent 工具与答案评测。** 复合应用还要验证 Search、Custom Tool、权限和最终回答。
- **只看总体 Accuracy。** 一条高影响财务指标回归可能被大量简单问题掩盖。
- **在生产 Semantic View 上直接实验。** 候选定义必须隔离，避免影响现有消费者。
- **把 Agent Version 当作完整回滚点。** Agent 可能仍引用新的 Semantic View 或工具资源。
- **忽略真实 Role 的负向权限测试。** Evaluation 不一定能复现 Session Attributes/RLS、MCP 和外部副作用。
- **评测失败后为了通过而改 Ground Truth。** 先判断业务口径是否真的改变，再由 owner 更新 VQ。
- **所有门禁通过后不做上线监控。** 线上数据、角色、外部依赖和查询模式仍可能发生变化。

## 完成标准

- [ ] 能设计隔离的候选 Semantic View 与生产消费者切换方式。
- [ ] 能用 Golden Queries 检查指标、关系、日期与结果粒度。
- [ ] 能解释 Cortex Analyst SQL Correctness 与 Cortex Agent Evaluation 的覆盖差异。
- [ ] 能为 RLS、MCP、外部副作用和真实用户 Role 安排独立测试。
- [ ] 能设置关键指标回归、整体准确率、延迟、权限和成本门槛。
- [ ] 能让 Semantic View、Agent Version、工具资源和应用引用同时具备版本和恢复依据。
- [ ] 能在门禁失败时阻止晋级，并明确失败责任人和重新测试范围。
- [ ] 能设计上线后的监控、回滚和数据对账流程。

## 自测

1. Semantic View 候选对象可以创建，但某条高价值 VQ 结果翻倍。为什么不能因为对象结构校验通过而晋级？
2. Cortex Analyst Evaluation 全部通过，但 Agent 的 Search 工具调用了过期政策。需要增加哪类评测？
3. 某项 Row Access Policy 依赖 Session Attribute。为什么只跑 Evaluation 仍不足以证明真实用户访问安全？
4. Agent Version 回滚到旧版，但它引用的 Semantic View 已经被覆盖。为什么业务结果仍可能无法回滚？
5. 总体 Accuracy 从 90% 升到 95%，但一条财务关键指标 Regression。发布门禁应如何决策？
6. 语义变更后，哪些情况下要更新 VQ 金标准？如何避免为了通过评测而掩盖真实回归？

## 参考资料

- [Semantic Views overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
- [Cortex Agent evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations)
- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Cortex Agents access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Cortex Analyst Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
