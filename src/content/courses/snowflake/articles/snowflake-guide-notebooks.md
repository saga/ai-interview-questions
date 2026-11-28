# Snowflake Notebooks：从交互探索到可部署作业

## Notebook 可以运行，不代表它已经是生产作业

数据工程师在 Notebook 里完成清洗和聚合，手工运行结果正确。到了凌晨由 Task 执行时，却出现依赖包找不到、Database/Schema 不同、文件路径失效或权限不足的问题。

原因通常不是 Notebook 语法，而是交互环境与部署环境并不相同。Notebook 负责探索和组织代码；进入生产调度时，还要明确计算环境、依赖、执行身份、输入输出以及部署版本。

## 先分清 Legacy Notebook 与 Workspaces Notebook

当前新一代 Notebook 位于 Snowsight Workspaces，提供 Jupyter 兼容的文件工作区、终端、Git 集成和共享协作。旧版 Notebooks 已被称为 Legacy Notebooks；自 2026 年 9 月起，Snowflake 已停止创建新的 Legacy Notebook。迁移不是简单复制文件，旧 Notebook 中部分组件和依赖需要调整。

新 Workspaces Notebook 的 Kernel 运行在 Snowpark Container Services Compute Pool 上。SQL 和 Snowpark DataFrame 计算仍可下推到 Warehouse，因此容器计算与查询 Warehouse 是两类资源。一个 Notebook Service 可以供多个 Notebook 文件使用；Service 运行时占用 Compute Pool 节点。

还有一个容易遗漏的上下文差异：Legacy Notebook 文件属于某个 Notebook 对象，会继承其 Database/Schema；Workspaces Notebook 文件属于 Workspace，不再自动继承数据库上下文。代码应显式执行 USE DATABASE、USE SCHEMA，或始终使用全限定对象名。

## Snowpark DataFrame 的延迟执行会影响调试

Snowpark DataFrame 表示一段关系运算计划。select、filter、join 和 group_by 通常只是继续构造计划，并不会立即读取数据；调用 collect、count、show 或写入目标表等 Action 时，才会触发执行。

~~~python
from snowflake.snowpark.functions import col, sum as sum_

orders = session.table("RAW.ORDERS")
daily_sales = (
    orders
    .filter(col("ORDER_DATE") >= "2026-11-01")
    .group_by("ORDER_DATE", "REGION")
    .agg(sum_("AMOUNT").alias("TOTAL_AMOUNT"))
)

# Action 才会真正执行查询
daily_sales.show()
~~~

因此，在 Notebook 中创建多个 DataFrame 变量，并不代表数据已经被多次读取；也不代表最终执行计划一定符合预期。需要观察 Query History 和 Query Profile，确认过滤、聚合、Join 是否被推送到 Snowflake，以及何时发生数据回传到 Python。

尽量把大规模关系运算留在 Snowflake 执行。将大量数据 collect 到 Python 进程后再处理，会消耗容器内存和网络带宽，也可能绕过数据库优化器。

## 依赖、Secrets 和文件路径要成为部署的一部分

开发阶段临时安装的包，不会自动成为生产 Code Bundle 的固定依赖。Workspaces Notebook 使用 Container Runtime 的包管理方式，依赖和版本应写进可复现的环境配置，并在目标 Runtime 验证。

凭证不要写在 Notebook 单元格、参数文件或 Git 中。访问外部系统时，使用 Snowflake 支持的 Secret、External Access Integration 和受控网络访问；交互用户与调度任务的执行身份也要分别验证权限。

交互环境里读取的本地临时文件，在非交互执行时可能不存在。依赖文件应放入 Workspace、Stage 或其他明确管理的位置，并确认它们进入部署包。

## 用 Code Bundle 把 Workspace 内容部署成可调度单元

Notebooks in Workspaces 通过 Code Bundle 将 Workspace 文件打包为生产对象。Code Bundle 是 Database/Schema 下的对象，包含 Notebook、Python 文件和 SQL 文件，可指定 Notebook 作为入口，并在 Task 中执行。

部署不是“定时打开 Notebook”。Task 执行的是已发布到 Code Bundle 的版本。修改 Notebook 后必须再次 Deploy Changes，否则已有 Task 仍使用上一次部署的代码。

生产 CI/CD 可以将 Git 仓库中的 Notebook 文件部署到内部或临时 Stage，再创建或更新 Code Bundle，最后由 Snowflake Task 调度。Code Bundle 采用 caller's rights；Database/Schema USAGE、Code Bundle USAGE、Warehouse/Compute Pool USAGE、External Access Integration 和账户级 EXECUTE TASK 都要纳入检查。Task Owner Role 还必须拥有运行代码所需的对象权限。

## 一条 Notebook 作业的验收链

将订单明细整理为日汇总时，至少保留以下证据：

1. Git Commit：确定 Notebook、Python 模块和依赖文件的版本。
2. Code Bundle：确认生产发布的入口文件和内容。
3. Task：确认调度、Owner Role、Warehouse/Compute Pool 与执行权限。
4. Query ID：确认实际运行了哪些 SQL，是否发生不必要的数据回传。
5. 数据校验：检查批次行数、订单键唯一性、金额汇总和迟到数据。
6. Run History：保存运行状态、错误信息、日志、耗时和结果。

Notebook 单元格显示成功只是开发证据；生产作业还要在非交互模式、真实执行身份和真实调度下验证。

## 容易踩中的迁移与运行边界

- 把 Legacy Notebook 的 Warehouse Runtime 规则直接套到 Workspaces Notebook。
- 假定 Notebook 自动继承 Database/Schema 上下文。
- 在 Python 中收集数百万行，再用本地 Pandas 完成数据库本可以处理的聚合。
- 只在交互环境安装依赖，未把包版本和文件纳入 Code Bundle。
- 修改 Notebook 后未重新部署 Code Bundle，Task 继续执行旧版本。
- 只检查执行者能否看到 Run History，不检查其是否有权读取执行结果。

## 自测

1. 为什么 Workspaces Notebook 的 Kernel 使用 Compute Pool，而 SQL 查询仍然需要 Warehouse？
2. Snowpark DataFrame 创建后没有立即执行 SQL。哪些 Action 会触发实际计算？
3. Notebook 在 Snowsight 手工运行成功，Task 执行却找不到文件。应检查 Workspace 文件、Stage 和 Code Bundle 的哪个环节？
4. 修改了 Notebook 代码但没有 Deploy Changes，下一次 Task 会运行哪个版本？
5. 为什么能查看 Code Bundle 的运行状态，不代表一定有权限查看运行结果？

## 参考资料

- [Snowflake Notebooks in Workspaces](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-in-workspaces/notebooks-in-workspaces-overview)
- [Migrating Legacy Notebooks to Workspaces](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-in-workspaces/notebooks-in-workspaces-migrate)
- [Schedule Notebooks in Workspaces](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-in-workspaces/notebooks-in-workspaces-schedule)
- [Observability and logging for Notebooks in Workspaces](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-in-workspaces/notebooks-in-workspaces-observability-logging)
- [Working with DataFrames in Snowpark Python](https://docs.snowflake.com/en/developer-guide/snowpark/python/working-with-dataframes)
