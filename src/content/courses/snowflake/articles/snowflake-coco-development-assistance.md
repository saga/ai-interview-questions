# CoCo 开发辅助：计划、工具审批与可复核交付

## Agent 修改了文件，不代表它理解了整个项目

开发者让 CoCo 修复一条 Task。它读取目标 SQL 后修改了语法，测试也通过；上线后却发现 Task 依赖的 Stream 被提前消费，导致下游数据缺失。

这类问题不是模型不会写 SQL，而是任务上下文不完整。开发辅助流程应先建立仓库和数据库对象之间的关系，再决定使用哪个模式、开放哪些工具、如何审批和验证修改。

## 先确认正在使用哪个 CoCo 产品入口

Snowflake 当前的 CoCo 有 CLI、Desktop、Snowsight 和 IDE 等入口。不同入口的模式名称和确认方式不完全一样：

- CLI 的 Standard mode 是默认模式，面向需要 Snowflake 数据工具、MCP 和 Skills 的工作。
- CLI 的 Code mode 面向代码工程，使用文件、Shell 和代码搜索工具，但关闭 Snowflake 数据工具、MCP servers、Skills 和协作能力。
- CoCo Desktop 的 Agent mode 可以读写文件、运行命令和 SQL；Plan mode 是只读协作模式，不会修改文件或执行破坏性操作。
- Desktop 的 Default Approvals 与 Bypass Approvals 控制工具何时停下来等待确认；这与 CLI 的 Standard/Code mode 不是同一组概念。

不要把 Desktop Plan mode 理解为 CLI Code mode，也不要把 Default Approvals 当作数据库角色权限。它们分别控制工作阶段和交互审批，不替代底层权限。

## 先建立仓库地图，再允许修改

以修复 Task 为例，CoCo 应先定位：
- Task DDL、Warehouse、Owner Role 和触发条件。
- 依赖的 Stream、Dynamic Table、目标表和 Procedure。
- SQL/Python/dbt 模块、环境变量和部署模板。
- 项目规则、数据契约、CI 与测试入口。
- 与该对象相关的 Query History 和 Task History（需要 Standard mode/有权访问的数据库会话）。

静态搜索只能发现仓库中可见的引用。动态对象名、Jinja 模板、存储过程、外部配置和权限继承不一定能从一个文件中识别出来。Agent 应将“仓库中找到的依赖”和“数据库运行时确认的依赖”分开记录，不能把 grep 结果称为完整数据血缘。

## CLI 工具审批按影响分级

CoCo CLI 的工具权限分为 Safe、Low、Medium、High 和 Critical。Read/Glob/Grep 通常自动通过；创建新文件可能自动通过；Edit 和安全 Shell 命令在 Confirm 模式下需要确认；危险 Bash 和 SQL 写操作始终需要确认；rm -rf、sudo 等 Critical 操作需要额外确认。

在交互模式中，审批设置可以决定工具是自动运行、确认还是拒绝。批处理模式没有交互式提示，未预先批准的工具调用会被拒绝；通过 cortex -p 或 cortex exec 运行时，应使用 --allowed-tools 只预先批准必要工具，并用 --disallowed-tools 显式排除不需要的工具。若工具同时在两份清单中，拒绝规则优先。

例如只允许读取和搜索仓库，并运行受限 Git 命令：

~~~bash
cortex -p "Summarize the changes on this branch" \
  --allowed-tools "read" "glob" "grep" "bash(git *)" \
  --disallowed-tools "sql" "bash(rm *)"
~~~

不要为了让 CI 不阻塞就启用全工具 Bypass。批处理中的自动批准应和 CI service identity、目录边界、网络限制及审计日志一起评审。

## 计划和实现分开，Diff 是正式验收对象

大范围重构先在只读模式检查依赖与风险，形成文件清单、修改策略和验证计划，再进入 Agent mode 执行。交付时要检查 Git Diff，而不是只读 Agent 的完成摘要：

- 修改了哪些文件，是否越过允许目录。
- SQL 是否改变了对象名、权限、过滤条件和 Join 粒度。
- 是否更新部署模板、环境变量和测试。
- 测试是否真的执行，还是因工具权限不足而被跳过。
- 生成的 SQL 是否在受限 Role 和隔离 Warehouse 下执行。

若 Agent 只能做静态分析，应明确标注“未执行数据库验证”，不能把代码检查成功写成运行验收通过。

## 数据库变更必须使用受限身份

CoCo Standard mode 可调用 Snowflake SQL 工具，但实际可执行范围仍受当前 Session Role、Warehouse、Database/Schema 和对象权限控制。生产写操作应使用最小权限部署角色，不能把个人 ACCOUNTADMIN 会话交给 Agent。

对高风险 DDL、权限扩大、删除数据和替换对象，应要求 CoCo 先给出 SQL/DDL Diff 和影响范围，再由有责任的人批准。低风险的文档或测试修改可以自动化；生产权限与数据副作用不应通过提示词自我批准。

## 一次交付至少留下这些证据

关联同一个工作 ID 保存：
- 仓库 Git Commit 和 CoCo/CLI 版本。
- 使用的入口和模式、工具批准策略。
- 修改前后的 Diff。
- 实际运行的测试命令和结果。
- 数据库执行的 Query ID、Role 和 Warehouse。
- 发布/部署结果以及必要的恢复步骤。

## 常见错误

- 只给 Agent 一条 SQL，不给它上下游对象和项目规则。
- 把 Desktop Plan mode、CLI Code mode 和 Approval mode 混为一谈。
- 在批处理模式中误以为工具调用会自动弹出确认。
- 为 CI 方便而预批准全部 Shell 和 SQL 工具。
- 只看 Git Diff，不确认数据库真实对象和运行证据。
- 把工具执行被拒绝当成测试通过。

## 自测

1. CLI Code mode 为什么不能直接执行 Snowflake 数据工具？什么时候该切换 Standard mode？
2. CoCo Desktop 的 Plan mode 与 CLI Code mode 有什么不同？
3. CLI 批处理没有交互式提示时，如何限制它只能运行必要工具？
4. 为什么静态搜索 Task DDL 不能证明已发现所有运行时依赖？
5. 数据库写操作为何需要单独的部署 Role 和变更审批？

## 参考资料

- [Cortex Code code mode](https://docs.snowflake.com/en/user-guide/cortex-code/code-mode)
- [CoCo CLI tools and permission levels](https://docs.snowflake.com/en/user-guide/cortex-code/tools)
- [CoCo Desktop Agent mode and Plan mode](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-desktop/agent-mode-and-plan-mode)
- [CoCo Desktop permission modes](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-desktop/permission-modes)
- [CoCo CLI security](https://docs.snowflake.com/en/user-guide/cortex-code/security)
