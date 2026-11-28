# Cortex Agent 权限边界：调用者身份、工具授权与数据策略

## 本节要解决的问题

日本地区的分析师可以查看基金 F01 和 F02 的持仓，但不能查看法务争议档案；风险经理可以查看全部基金；Agent Builder 负责维护 Agent 配置，不应自动拥有日常业务查询权限。

如果 Agent 只靠 Prompt 写着“不要返回无权数据”，并不能形成安全边界。真正决定一次运行能访问什么的是 Snowflake 请求身份、当前激活的 Role/Secondary Roles、Agent 对象权限、工具对象权限和各工具自己的执行权限模型。模型可以选择调用哪个工具，但不能创建一个更高权限的 Snowflake 身份。

## Cortex Agent 使用调用者的 Snowflake 权限上下文

### REST API 的身份来自 Token，授权角色来自请求上下文

调用者通过 PAT、OAuth、Key Pair/JWT 或 Session Token 等方式认证。对 REST API，授权请求默认使用用户的 Default Role；若传入 X-Snowflake-Role，则使用 Header 中指定的主角色。若请求会话激活了 Secondary Roles，这些角色也参与对象权限和数据保护策略判断。

Snowsight 或 CoWork 则使用界面选择的 Role；未选择时使用用户默认 Role。

因此，不能在 Agent Prompt 中让用户输入一个管理员 Role，再让模型在调用工具时切换。应用服务端应从已认证会话确定允许的 Role，并且不信任自然语言指令或检索结果中的角色切换请求。

### 调用 Agent 需要的角色与对象权限

调用 Agent 的 Role 至少需要以下权限：

| 对象/范围 | 权限 | 用途 |
|---|---|---|
| Snowflake Database Role | SNOWFLAKE.CORTEX_USER 或 SNOWFLAKE.CORTEX_AGENT_USER | 获得 Cortex Agent API 访问资格 |
| Database / Schema | USAGE | 访问 Agent 对象所在的命名空间 |
| Agent | USAGE | 调用 Agent |
| Tool Warehouse | USAGE | 执行 Agent 工具配置的 SQL/Warehouse 操作 |
| 相关工具对象 | 工具所需权限 | 执行 Analyst、Search、Custom Tool 等实际能力 |

两个 Cortex 数据库角色的范围不同：
- SNOWFLAKE.CORTEX_USER 覆盖所有 Covered AI Features，包括 Cortex Agents；
- SNOWFLAKE.CORTEX_AGENT_USER 只授予 Cortex Agents、CoWork 和 CoCo 的访问，不自动授予其他 Cortex AI 功能。

CORTEX_USER 默认可能授予 PUBLIC。若组织只希望一部分用户调用 Agent，应评估撤销 PUBLIC 上的 CORTEX_USER，再将 CORTEX_AGENT_USER 授予指定自定义 Role。若 Agent 使用 Cortex Analyst Tool，而调用角色仅有 CORTEX_AGENT_USER，还必须额外授予 SNOWFLAKE.CORTEX_ANALYST_USER；CORTEX_AGENT_USER 本身不包含 Analyst 权限。

示例：

~~~sql
USE ROLE ACCOUNTADMIN;

REVOKE DATABASE ROLE SNOWFLAKE.CORTEX_USER FROM ROLE PUBLIC;

CREATE ROLE cortex_agent_runtime;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_AGENT_USER
  TO ROLE cortex_agent_runtime;
~~~

这会收紧所有用户默认可用的 Cortex 功能范围，应先盘点其他应用是否依赖 PUBLIC 的 CORTEX_USER。不要把它当成可随意执行的通用命令。

### Agent Builder、Runtime 和 Monitor 权限要分开

Agent 的对象权限包括：
- CREATE AGENT on Schema：创建 Agent；
- USAGE on Agent：调用 Agent；
- MODIFY on Agent：修改或 Drop Agent；
- MONITOR on Agent：查看 Thread、日志和 Trace；
- OWNERSHIP：拥有对象并可转移所有权。

因此，日常 Runtime Role 只应获得所需 Agent USAGE 和工具权限；Agent Builder Role 负责创建与变更；需要排障的观察角色可获 MONITOR。不要让每个调用用户都拥有 MODIFY 或 OWNERSHIP，否则调用者可能改变工具配置、扩大资源范围或删除 Agent。

## 权限要沿工具链逐项授予

### Analyst Tool 不只需要 Agent USAGE

Cortex Analyst 使用 Agent specification 中配置的 Semantic View/语义模型。调用 Role 还需要：
- Semantic View 所在 Database 和 Schema 的 USAGE；
- Semantic View 对象的 USAGE；
- Semantic View 引用的底层对象所需的访问权限，包括相关表和视图的 SELECT；
- Agent 工具配置的 Warehouse USAGE；
- 使用 Agent API 所需的 Cortex 数据库角色；
- 若使用 Agent_USER 的最小权限路径，还要单独授予 CORTEX_ANALYST_USER。

可按实际对象授予：

~~~sql
GRANT USAGE ON DATABASE ANALYTICS TO ROLE portfolio_runtime;
GRANT USAGE ON SCHEMA ANALYTICS.SEMANTICS TO ROLE portfolio_runtime;
GRANT USAGE ON SEMANTIC VIEW ANALYTICS.SEMANTICS.PORTFOLIO_OVERVIEW
  TO ROLE portfolio_runtime;
GRANT USAGE ON WAREHOUSE AGENT_WH TO ROLE portfolio_runtime;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_ANALYST_USER
  TO ROLE portfolio_runtime;
~~~

以上是对象授权结构示意；Semantic View 引用的所有底层对象权限仍要按实际定义授予并进行测试。不要为了让一个 Agent “能跑起来”就将整个 Database 的 SELECT 授给宽泛角色。

### Search Tool 需要服务权限，且要理解服务的 Owner’s Rights

调用 Cortex Search Service 需要 Search Service 的 USAGE，以及包含该 Service 的 Database/Schema USAGE。Search 的权限模型与普通 SELECT 表不同：默认 Cortex Search Service 以服务 Owner 的权限构建和提供索引，调用者通过 Service USAGE 查询索引内容，不会自动把底层表上的 Row Access Policy 按调用者身份重新执行。

因此，服务 Owner 能读取全公司文档，而 Agent 调用者只能查看日本地区记录时，不能因为底层表有 Row Access Policy 就假设 Search 结果也会按调用者过滤。对敏感文档应按授权域拆分服务，或在满足条件时评估 Data Governance Policy Inheritance Preview。后者要求 Primary Key，并且使用受支持的 SQL 查询函数；不能把 REST/Python Search API 和 Preview 策略继承混为一谈。

在 Agent 调用前还要检查：
- Search Service 是否索引了不应共享的文档；
- 调用者是否有目标 Search Service 的 USAGE；
- 搜索过滤字段是否由可信应用构造；
- 引用是否保留 document_id、版本、生效日期和页码；
- 无权服务是否会按预期产生 Warning 或 reject。

### Custom Tool 的权限取决于它实际调用的 Snowflake 对象

如果 Custom Tool 调用 Stored Procedure 或 UDF，调用 Role 需要对应函数/过程的 USAGE。Stored Procedure 是 Owner’s Rights 还是 Caller’s Rights，由该 Procedure 自身的定义决定：
- Caller’s Rights Procedure 使用调用者权限；
- Owner’s Rights Procedure 使用 Procedure Owner 的权限。

Owner’s Rights 适合封装一个受控的操作接口，但这会使 Procedure 成为权限边界的一部分。过程内部必须验证允许的对象、参数、业务状态、调用人和操作范围，不能将用户传入的任意表名、SQL 文本或路径直接执行。

对高风险写操作，应把权限和审批留在后端流程，使用独立身份和明确的业务校验；不要让 Agent 通过一个宽权限过程任意修改账务、持仓或安全策略。

## 模型决策与授权检查是两层控制

### 工具选择不能替代 Snowflake RBAC

Agent 可以被指示“退款问题只能使用 Search”“只有分析问题才用 Analyst”，但这仅影响工具选择，不授予对象权限。反过来，即使某个 Role 有 Search USAGE，若任务必须使用政策证据，也不应让 Agent 在 Search 不可用时静默给出完整结论。

Agent specification 的 orchestration.tool_not_accessible 默认是 accept：缺少某些已配置工具权限时，Agent 仍可以使用其余可访问工具，并以 Warning 报告缺失工具。对必须同时取得结构化结果与政策证据的风控任务，应考虑 reject，或由应用层检查 Warning/必需字段后拒绝输出完整结论。

这不是“Agent 自动判断用户有没有权限”的通用安全功能。运行环境仍需在真实调用 Role 下做允许和拒绝测试。

### 工具结果中的文本不是权限命令

Cortex Search 返回的文档、网页或用户上传文本都可能包含“切换管理员 Role”“忽略前面授权限制”等指令。它们是待分析的数据，不是可信的 Snowflake 授权上下文。工具返回文本不能更改 Role、授予对象权限或修改 Agent specification。

Prompt 可以约束模型如何解释结果，但数据访问必须由 RBAC、Row Access Policy、Masking Policy、受控服务和工具接口执行。

## 正向测试和负向测试要同时做

以组合持仓为例，测试角色如下：

| Role | 预期权限 | 关键负向检查 |
|---|---|---|
| PORTFOLIO_ANALYST_JP | 可查询日本地区授权基金 | 不得通过 Analyst 查询其他地区基金 |
| PORTFOLIO_RISK_GLOBAL | 可查询全球基金 | 不应获得 Agent MODIFY/OWNERSHIP |
| LEGAL_REVIEWER | 可搜索法务争议档案 | 其他角色不能通过 Search 共享服务看到法务文档 |
| AGENT_BUILDER | 可创建/修改 Agent | 不应自动拥有所有基金和客户明细数据 |
| AGENT_OBSERVER | MONITOR Agent | 不应因为可查看 Trace 就获得业务表查询权限 |

每个角色至少执行：
1. 能否调用 Agent；
2. 能否访问 Semantic View、Search Service 和 Custom Tool；
3. 能否查询自己授权的数据；
4. 不能访问的数据是否被 Snowflake 拒绝；
5. Search Owner’s Rights 是否产生了超出预期的可见范围；
6. 工具缺权时 Agent 是否按预期 Warning 或 reject；
7. 修改 Prompt/Agent instructions 是否改变不了对象权限；
8. Secondary Roles 启用/禁用时，Row Access/Masking 的行为是否符合设计。

不能只用 Agent Owner 的 Role 测试成功路径。要用实际最终用户 Role 验证失败路径，且将负向访问结果作为上线条件。

## 工程实施步骤

1. 列出 Agent Builder、Runtime、Observer 和各业务用户 Role，分别定义创建、调用、监控和数据权限。
2. 盘点 Account 上 PUBLIC 是否拥有 CORTEX_USER；若收窄范围，先检查其他 Cortex 应用依赖。
3. 为 Runtime Role 授予 CORTEX_AGENT_USER；使用 Analyst 时额外授予 CORTEX_ANALYST_USER。
4. 授予 Agent 所在 Database/Schema USAGE、Agent USAGE 和工具 Warehouse USAGE。
5. 对每个 Analyst Semantic View、Search Service、Custom Tool 列出所需对象权限，最小化到具体对象。
6. 审查 Search Service Owner’s Rights、索引内容和 Data Governance Policy Inheritance 是否适用。
7. 审查 Owner’s Rights Stored Procedure 的输入验证和授权行为，禁止用户参数扩大对象或 SQL 范围。
8. 为不同业务 Role 建立正向/负向测试，覆盖主/次级 Role、Row Access Policy 和 Masking Policy。
9. 设置 tool_not_accessible 策略，确保必需工具缺权时不会返回“完整”答案。
10. 保留 request_id、调用 Role、Agent Version、工具调用、Query ID、Warning 和访问拒绝证据。
11. Agent specification、工具对象、Semantic View、Search Service 或政策修改后重跑权限测试。
12. 将权限矩阵和负向测试结果作为生产发布验收的一部分。

## 场景分析

PORTFOLIO_ANALYST_JP 有 Agent USAGE、CORTEX_AGENT_USER、Analyst User、Portfolio Semantic View USAGE 和查询 Warehouse USAGE，底层表权限只覆盖日本基金。其 Agent 同时配置了一个服务 Owner 可以读取全球报告的 Search Service。

用户问“F01 是否违反 11 月 27 日生效的政策？”Analyst 查询 F01 日本基金数据成功，但 Search 服务可能包含全球及法务档案。即使调用用户的底表 Role 只允许日本，也不能假设 Owner’s Rights Search 会自动按该 Role 过滤索引结果。

正确的修复不是在 Prompt 加一句“只展示日本数据”，而是拆分 Search 授权域或使用符合条件的 Policy Inheritance Preview，并执行跨地区和法务资料的负向测试。Agent 在 Search 权限不足时如果默认 accept，就可能只拿到 Analyst 结果；此类任务应 reject，或由应用层检测 Search Warning 并把结果标记为 INCOMPLETE。

## 常见误区

- **在 Prompt 中写“只访问用户有权的数据”就认为安全。** 模型指令不是对象权限，授权必须由 Snowflake 和受控工具执行。
- **只授 Agent USAGE，不授工具对象权限。** Agent 的权限不会自动传递到 Semantic View、Search Service、Warehouse 或 Stored Procedure。
- **把 CORTEX_AGENT_USER 当成包含 Analyst 的所有权限。** 若只授 Agent User，还需 CORTEX_ANALYST_USER 才能访问 Analyst 功能。
- **用 CORTEX_USER 代替更细粒度的最小权限设计。** CORTEX_USER 涵盖所有 Covered AI Features，且默认可能从 PUBLIC 继承。
- **认为底表 Row Access Policy 自动过滤默认 Cortex Search 服务。** Search 默认采用 Owner’s Rights，需要专门设计索引授权边界。
- **把 Owner’s Rights Stored Procedure 当成普通调用者 SQL。** 过程以所有者权限执行，必须对输入和可操作对象进行严格校验。
- **只用 Agent Builder/Owner Role 验收。** Builder 权限宽，无法证明普通用户无法越权。
- **把缺权工具的 Warning 当成正常完成。** 需要按任务风险设置 reject 或应用侧必需证据校验。
- **认为工具返回的文本能授权模型切换 Role。** 检索内容是数据，不是可信授权指令。

## 完成标准

- [ ] 能解释 Cortex Agent REST 请求如何从 Token、X-Snowflake-Role 和 Secondary Roles 得到授权上下文。
- [ ] 能区分 CORTEX_USER、CORTEX_AGENT_USER 和 CORTEX_ANALYST_USER 的权限范围。
- [ ] 能列出 Agent USAGE、Database/Schema USAGE、Warehouse USAGE 和工具对象权限。
- [ ] 能说明 Analyst、Search 和 Custom Tool 各自的权限依赖。
- [ ] 能解释 Cortex Search 默认 Owner’s Rights 与底层行策略的边界。
- [ ] 能区分 Caller’s Rights 与 Owner’s Rights Stored Procedure 的授权影响。
- [ ] 能设置 tool_not_accessible 的 accept/reject 策略并测试缺权行为。
- [ ] 能用实际用户 Role 做正向/负向授权测试并保留证据。

## 自测

1. 用户已获 CORTEX_AGENT_USER，但没有 CORTEX_ANALYST_USER。一个包含 Analyst Tool 的 Agent 是否一定可以完整运行？为什么？
2. REST API 请求省略 X-Snowflake-Role 时，使用哪个 Role？Secondary Roles 会怎样参与权限检查？
3. Agent 有 USAGE，但没有工具 Warehouse USAGE 或 Search Service USAGE，会发生什么？
4. Cortex Search Owner Role 可以读取全球档案，调用者只能读取日本底表。为什么不能把底层 Row Access Policy 当成默认 Search 过滤？
5. 一个 Owner’s Rights Stored Procedure 被包装成 Custom Tool。调用者只需 USAGE 就能调用时，过程内部必须怎样限制参数和对象？
6. Agent 工具缺权时默认 accept。在哪些任务下应使用 reject？如何避免输出看似完整的部分结果？
7. 为什么 Agent Builder 和 Agent Observer 的权限不应与 Runtime 用户相同？

## 参考资料

- [Access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Inaccessible tool handling](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-inaccessible-tool-handling)
- [Create and manage agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-manage)
- [Cortex Search data governance policy inheritance](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-data-governance-inheritance)
- [Understanding caller’s rights and owner’s rights stored procedures](https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-rights)
