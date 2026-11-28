# Cortex Agent 与 CoCo 的工具授权边界

## Agent 有 USAGE，为什么 Search 和 Analyst 仍然调用失败

分析师已经获得某个 Agent 的 USAGE，可以提交请求，但 Agent 运行时却提示 Cortex Analyst 无权访问 Semantic View，或 Search 工具找不到 Stage 文档。

原因是 Agent USAGE 只允许调用 Agent 本身。Agent 使用调用者当前会话角色执行工具；调用者还需要有权使用每个配置工具和它依赖的数据对象。把所有权限都授给一个管理员角色，也不是合理的修复方式。

## 先区分 Cortex Code、Agent API 和具体工具权限

Snowflake 的 Cortex Code CLI 在 Standard mode 中支持 Snowflake 数据工具、MCP 和 Skills；Code mode 面向代码工程，关闭 Snowflake 数据工具、MCP servers、Skills 和协作能力。两种模式的工具范围不同，不应把 Code mode 的文件/Shell 能力误认为可以访问数据库。

Cortex Agent API 使用者可以拥有 SNOWFLAKE.CORTEX_AGENT_USER，只获得 Cortex Agents、CoWork 和 Cortex Code 的使用权限；若拥有 SNOWFLAKE.CORTEX_USER，则可以访问更广泛的 Cortex Covered AI Features。CORTEX_AGENT_USER 并不包含 Cortex Analyst 权限。使用 Analyst 工具还需要 SNOWFLAKE.CORTEX_ANALYST_USER。

默认情况下，SNOWFLAKE.CORTEX_USER 会授予 PUBLIC。若组织要限制 AI 能力，应先按账户策略撤销 PUBLIC 的广泛授权，再授予专用自定义角色，不要只增加一个较窄角色却忘记旧的 CORTEX_USER 继承。

## Agent 的最小调用权限

调用者至少需要：

- Agent 所在 Database 和 Schema 的 USAGE。
- Agent 对象的 USAGE。
- Agent 配置的每个工具 Warehouse 的 USAGE。
- 使用 Analyst 时的 SNOWFLAKE.CORTEX_ANALYST_USER。
- 使用 Search 时，对 Search Service 的 USAGE；对源 Stage 的引用文档访问还可能需要 Stage READ 和底层对象权限。
- 使用 Semantic View 时，对语义视图及其引用对象所需的 SELECT/USAGE。
- 调用自定义 Stored Procedure 时，对 Procedure 的 USAGE，并满足其依赖对象在对应 Rights 模式下的权限。

示例：

~~~sql
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_AGENT_USER
  TO ROLE SUPPORT_AGENT_ROLE;

GRANT DATABASE ROLE SNOWFLAKE.CORTEX_ANALYST_USER
  TO ROLE SUPPORT_AGENT_ROLE;

GRANT USAGE ON DATABASE AI_DB TO ROLE SUPPORT_AGENT_ROLE;
GRANT USAGE ON SCHEMA AI_DB.AGENTS TO ROLE SUPPORT_AGENT_ROLE;
GRANT USAGE ON AGENT AI_DB.AGENTS.SUPPORT_AGENT
  TO ROLE SUPPORT_AGENT_ROLE;

GRANT USAGE ON WAREHOUSE AGENT_QUERY_WH
  TO ROLE SUPPORT_AGENT_ROLE;
~~~

该角色还需要对具体工具引用的数据和资源有对应权限。不要只复制示例后就认为完整授权已经完成。

## 部分工具不可访问时，Agent 默认可能继续运行

Cortex Agent 的 orchestration.tool_not_accessible 默认值为 accept：若调用者缺少某个已配置工具的权限，Agent 可以继续使用其他可访问工具，并返回警告。对于需要全部工具都可用的工作流，可以设置 reject，使任一配置工具不可访问时整次运行失败。

这两种行为代表不同的产品策略：
- 客服问答允许只用已授权的知识检索回答，可以接受部分工具不可用，但必须显示降级状态。
- 需要 Analyst 与 Search 同时提供证据的财务流程，不应缺少一个工具后仍给出看似完整的答案，应选择 reject。

无论选择哪一种，Agent 的回答都应记录哪些工具实际执行、哪些被拒绝、拒绝原因和最终采用的证据。

## 用角色矩阵测试，而不只用管理员验证

至少准备三种角色：
1. 完整业务角色：可访问 Agent、Analyst、Search 和允许的业务数据。
2. 只读检索角色：可访问 Agent 和指定 Search 内容，但不能读取分析事实表。
3. 无权限角色：没有 Agent 或工具权限，应被拒绝。

分别用 Snowsight 与 API 运行测试，因为它们使用的会话/调用身份可能不同。验证工具是否按预期可见、对象数据是否受 Row Access Policy/Masking Policy 保护、缺少工具时 accept/reject 是否符合流程，以及审计记录是否能关联调用者。

## 常见授权错误

- 认为 Agent USAGE 自动包含 Analyst、Search 和自定义工具权限。
- 给所有人 CORTEX_USER，随后又试图只靠 CORTEX_AGENT_USER 限制范围。
- 使用 Analyst，却忘了单独授予 CORTEX_ANALYST_USER。
- 只测试管理员角色，未测试业务调用者的真实权限。
- 默认 accept 导致一个必需工具不可用，但 Agent 仍返回部分答案。
- 认为 Code mode 与 Standard mode 具有同一套工具。

## 自测

1. Agent USAGE 为什么不能保证 Analyst 工具能查询 Semantic View？
2. CORTEX_AGENT_USER 与 CORTEX_USER 的权限范围有什么区别？
3. 为什么使用 Cortex Analyst 还要另行授权 CORTEX_ANALYST_USER？
4. orchestration.tool_not_accessible 设置为 accept 与 reject，对用户结果有什么影响？
5. 如何设计一个只允许 Search、不允许读取订单事实表的 Agent 角色？

## 参考资料

- [Cortex Agents access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Cortex Code code mode](https://docs.snowflake.com/en/user-guide/cortex-code/code-mode)
- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
