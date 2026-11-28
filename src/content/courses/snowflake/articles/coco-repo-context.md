# Cortex Code 仓库上下文：从项目理解到受控修改

## 同一条 SQL，在两个仓库里可能代表不同的东西

开发者要求 CoCo 修复一个 Snowflake Task。仓库里有部署模板、不同环境的变量、对象命名规则和数据契约。如果只把当前 SQL 文件交给模型，它可能修好语法，却破坏下游依赖或部署顺序。

Snowflake 当前将 CoCo 作为 Cortex Code CLI 提供。它不仅是 SQL 补全器，还能读取文件、搜索仓库、运行 Shell 命令，并在 Standard mode 中使用 Snowflake 数据工具。项目上下文应从仓库本身获取：目录结构、README、项目规则、SQL 定义、CI、部署配置、测试和依赖关系，而不是只依赖聊天里的一段描述。

## Code mode 和 Standard mode 不应混为一谈

cortex --mode code 启动面向软件工程的 Code mode。它提供文件读写、Shell 和代码搜索等工具，但关闭 Snowflake 数据工具、MCP servers、Skills、Teams 和计划/目标模式等能力。适合改应用代码、dbt 项目、重构和运行测试；不适合直接查询 Snowflake 数据。

默认 Standard mode 面向需要 Snowflake 数据访问、MCP 工具、Skills 或协作能力的工作。模式选择决定 Agent 能调用哪些工具，不是一个 UI 选项。把 Code mode 当成已经连接了所有 Snowflake 数据工具，会导致它无法完成查询验证；反过来，在 Standard mode 中执行仓库修改，也仍然需要常规代码审查。

## 让 Agent 先建立可核验的仓库地图

一次修复开始时，先要求 Agent 找到目标对象的定义、引用位置、部署入口和测试。以 Task 为例，至少应检查：

- Task DDL、依赖的 Stream/Dynamic Table 和目标表。
- 使用的 Warehouse、Role、Database、Schema 与环境变量。
- 调度关系、触发方式、暂停/恢复逻辑。
- 相关 dbt/SQL 脚本、迁移文件和部署定义。
- 单元测试、数据测试、CI 验证与上线流程。

不要把 grep 到的文本匹配当成完整依赖图。动态对象名、Jinja 模板、存储过程、外部配置和权限继承可能不会在一个文件里显式出现。Agent 应标出无法静态确认的依赖，并给出下一步查询或运行证据。

## 为仓库提供明确的项目规则

把稳定约定放在版本控制中，例如对象命名、目录结构、SQL 风格、迁移规则、不得修改的生产对象、测试入口、环境差异和秘密管理。Cortex Code 支持项目技能和指令发现；.agents/skills 是其项目级 Skill 发现目录之一。不要把临时会话里的口头约定当作长期项目规范。

一个有效的任务上下文应说明目标、允许改动的目录、禁止触碰的对象、必须运行的测试，以及输出变更摘要的格式。对影响范围大的修改，先让 Agent 解释依赖和修改计划，再开始写入。

## 修改范围要能从 Diff 中复核

先建立基线，再逐文件修改。Agent 交付时应列出新增、删除和修改文件，说明每项改变如何对应需求，并给出测试命令和结果。若它声称修复了 Task，却没有展示相关 DDL、部署文件和测试的实际差异，就不能只凭自然语言摘要验收。

对 SQL 对象，可通过 INFORMATION_SCHEMA、SHOW 命令或查询历史确认部署环境里的实际定义。仓库声明与数据库实际状态可能漂移，二者需要对照。代码搜索只能解释仓库文本，不自动证明线上对象就是这份定义。

## 何时切换模式

| 工作类型 | 更合适的模式 | 仍需补充的验证 |
| --- | --- | --- |
| 修改 Python、TypeScript、dbt 项目 | Code mode | 单元测试、Lint、构建和 Diff 审查 |
| 查找 Task 依赖、对象权限和运行错误 | Standard mode | 查询账户对象、运行历史和权限 |
| 生成 SQL 后执行代表性数据验证 | Standard mode | 受限 Role、隔离 Warehouse、结果对账 |
| 大范围重构但尚未确认影响面 | 先分析仓库，再决定模式 | 依赖清单、测试计划和修改边界 |

## 容易犯的错误

- 只提供当前 SQL 文件，不提供项目规则和上下游依赖。
- 把代码搜索结果当作完整的数据库依赖图。
- 在 Code mode 中期待 Snowflake SQL 工具或 MCP 工具可用。
- 让 Agent 在没有基线和 Diff 的情况下修改大量文件。
- 把仓库定义当作生产真实状态，不核对部署对象和运行历史。

## 参考资料

- [Cortex Code CLI code mode](https://docs.snowflake.com/en/user-guide/cortex-code/code-mode)
- [Cortex Code changelog and project skill discovery](https://docs.snowflake.com/en/user-guide/cortex-code/changelog)
- [Cortex Agents access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
