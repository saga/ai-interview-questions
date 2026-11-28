# Snowflake Notebooks in Workspaces 工作区与交互执行

## 本节要解决的问题

数据分析师在 Notebook 中先用 SQL 筛选订单，再用 Python 画图，最后把 Python 计算结果传回 SQL 做二次分析。单独运行几个单元格时结果看起来正常，但修改了前面的 Python 变量后，下面的图表仍显示旧结果；同事打开分享的 Notebook，也无法判断结果是刚刚运行的，还是上次会话留下的。

Notebook 是交互式开发环境，不是自动按依赖关系执行的 DAG。它允许 SQL 和 Python 单元格共享数据，但单元格的执行顺序、会话上下文和输出状态必须明确。要把 Notebook 作为团队资产交付，首先要确保所有结果能从当前代码重新生成。

## 核心知识

### 新 Notebook 工作流应以 Workspaces 中的 Notebooks 为主

Snowflake 已将原始 Snowsight Notebooks 重新命名为 Legacy Notebooks，新的 Notebooks in Workspaces 提供 Jupyter 兼容的 ipynb 编辑体验，并与 Workspaces、Git 和 Python 文件工作流衔接。新建账户已不能创建 Legacy Notebooks，因此新项目应优先使用 Workspaces 中的 Notebook，而不是继续按旧界面的菜单和功能写操作手册。

Legacy Notebook 和 Workspaces Notebook 的功能与执行细节并不完全一样。旧 Notebook 文档仍可用于理解历史行为，但操作步骤、运行时和 Git 集成应以 Workspaces 文档为准。

### SQL 与 Python 单元格可以双向引用 DataFrame

在 Workspaces Notebook 中，SQL 单元格结果会暴露为一个 DataFrame 指针，例如 dataframe_1。Python 单元格可以直接引用它；另一个 SQL 单元格可以用双大括号引用这个变量：

~~~sql
SELECT
  CUSTOMER_ID,
  SUM(ORDER_AMOUNT) AS TOTAL_AMOUNT
FROM ANALYTICS.MART.FACT_ORDERS
WHERE ORDER_DATE >= '2026-11-01'
GROUP BY CUSTOMER_ID;
~~~

后面的 Python 单元格可使用 SQL 结果：

~~~python
top_customers = dataframe_1.sort("TOTAL_AMOUNT", ascending=False).limit(20)
top_customers.show()
~~~

SQL 也可以引用 Python 变量：

~~~python
SELECT *
FROM {{top_customers}}
WHERE TOTAL_AMOUNT > 10000;
~~~

这类引用让 SQL 与 Python 之间不必手动导出 CSV 再导入。需要注意 SQL 单元格结果的 DataFrame 类型会随 Container Runtime 版本变化：Runtime 2.6 及以上使用 Snowpark DataFrame，Runtime 2.5 及以下使用 pandas DataFrame。对跨环境共享的 Notebook，应在文档中写清运行时版本和数据对象类型，不能假定它们都能调用相同方法。

### 单元格有依赖关系，但单独运行不保证上游自动更新

假设 Python 单元格先生成 cutoff_date，接下来的 SQL 单元格用它筛选订单，第三个 Python 单元格画趋势图。修改 cutoff_date 后只运行第三个单元格，Notebook 可能继续使用旧的 SQL 结果。

Workspaces 提供几种执行方式：

- Run all cells：从头顺序执行全部单元格。
- Run one single cell：只执行选中的单元格。
- Run current cell and all descendant cells：执行当前单元格及其依赖的后续单元格。
- Run current cell and all above/below cells：按菜单选项执行上方或下方的单元格。

修改了上游变量后，应使用 current cell and all descendant cells，或直接 Run all，确保引用该变量的下游单元格重新执行。不能只看输出没有报错就认定结果与当前代码一致。

### SQL 单元格执行证据与 Python 输出需要分开看

Notebook 中可以显示数据表、图表和变量，但这些输出不一定都是当前代码刚刚产生的。审查时至少要看：

- 单元格当前状态：成功、失败、运行中或代码已修改。
- SQL Query ID：用于回到 Query History 检查执行文本、Warehouse 和耗时。
- Python 结果：确认它依赖的变量和上游 SQL 单元格是否在当前会话重新执行。
- Runtime 与 Session：确认当前 Notebook 使用的 Python 环境、Role、Warehouse 和数据库上下文。

如果 Notebook 在修改代码后没有重跑，单元格中保留的结果只能视为历史输出，不能作为当前代码的验收证据。

### Notebook 的计算资源来自选择的 Role、Warehouse 和 Runtime

Workspaces Notebook 可以选择用于 SQL 与 Snowpark pushdown 的 Role、Warehouse。Snowpark DataFrame 的过滤和聚合通常在 Snowflake 引擎执行；Python 解释器和本地 Python 对象则运行在 Notebook 的 Runtime 环境。

不要把所有 Python 操作都理解成在 Warehouse 内运行。对 Snowpark DataFrame 的转换，计算可下推到 Snowflake；对 pandas DataFrame 的操作，数据已经在 Python 进程中。需要本地包或容器能力时，检查 Notebook 的 Runtime 设置和依赖，而不是只更换 Warehouse。

## 工程实施步骤

1. 新项目创建 Workspaces Notebook，旧 Notebook 迁移时先确认功能差异和 Runtime 要求，不要照搬 Legacy 操作步骤。
2. 为 Notebook 选择最小权限 Role、专用 Warehouse 和明确 Runtime；记录数据库、Schema 和包版本。
3. 将 SQL 过滤、Join 和聚合尽量留在 Snowflake，避免把大表直接下载成 pandas DataFrame。
4. 在 SQL 单元格和 Python 单元格之间使用 DataFrame 引用，减少中间 CSV 和重复加载。
5. 为变量和单元格依赖写清执行顺序；改变上游参数后运行全部后代单元格或 Run all。
6. 通过单元格状态确认修改过的代码是否已重跑，并检查 SQL Query ID 与结果行数。
7. 分享、提交或发布之前执行 Run all，从干净的执行顺序重新生成结果。
8. 若 Notebook 是团队长期代码资产，将 ipynb 与依赖、说明和辅助 Python 文件一起纳入 Workspaces/Git 管理；将稳定逻辑抽取到模块或作业，而不是把所有生产逻辑留在交互单元格中。
9. 对计划运行的 Notebook 另行检查调度身份、执行权限、Warehouse 和日志；交互成功不代表任务身份也有同样权限。
10. 为数据样本、输出和 Query ID 留存足够信息，方便他人复现分析。

## 场景分析

分析师先用 SQL 单元格统计 11 月订单，再用 Python 计算高销售客户阈值，最后用 SQL 单元格筛选这些客户。最初运行时 cutoff 为 10,000，得到 240 个客户。后来分析师把 cutoff 改成 15,000，只运行最后一个 SQL 单元格，Notebook 仍然显示 240 个客户。

这是上游变量没有触发下游重算，而不是 Snowflake 缓存把 SQL 结果“算错了”。应从修改 cutoff 的 Python 单元格执行 current cell and all descendant cells，或直接 Run all。重新执行后检查 Python 单元格和 SQL 单元格状态，再从 SQL 的 Query ID 确认查询文本中确实使用 15,000。

若要把结果交给其他分析师，必须 Run all 并确认所有输出来自当前代码。保留旧的 240 行表格，却在 Markdown 中写“阈值 15,000”，会让读者无法判断报告究竟使用了哪组参数。

## 常见误区

- **继续按 Legacy Notebook 说明指导新账户。** 新项目应优先使用 Workspaces 中的 Notebooks；旧 Notebook 已进入 Legacy。
- **把单元格显示顺序当作执行顺序。** 单独运行一个单元格不会自动保证所有上游依赖都是最新的。
- **修改变量后只运行最后一个单元格。** 应重跑当前单元格的后代或 Run all。
- **认为所有 SQL 单元格结果都转换成 pandas。** Runtime 2.6+ 的 SQL 结果引用为 Snowpark DataFrame，旧 Runtime 行为不同。
- **把 Notebook 中的旧输出当作代码验收。** 要检查修改状态、当前执行状态和 Query ID。
- **认为切换 Warehouse 就能改变 Python Runtime。** Warehouse 负责 SQL/Snowpark 计算；Python 包和解释器由 Notebook Runtime 管理。

## 完成标准

- [ ] 能说明 Workspaces Notebook 与 Legacy Notebook 的产品边界。
- [ ] 能在 SQL 与 Python 单元格之间双向引用 DataFrame。
- [ ] 能解释单独运行与重跑下游依赖单元格的差异。
- [ ] 能区分 Snowpark DataFrame 和 pandas DataFrame 的执行位置。
- [ ] 能检查当前 Role、Warehouse、Runtime 和 Query ID。
- [ ] 能通过 Run all 重新生成可复现输出。

## 自测

1. 修改了生成 SQL 参数的 Python 单元格，只运行最后的 SQL 单元格。为什么结果可能仍然使用旧参数？应该选择哪种执行方式？
2. Workspaces Notebook 的 SQL 结果 DataFrame 在 Runtime 2.6 及以上与旧 Runtime 有什么区别？这会影响哪些 Python 操作？
3. Notebook 中显示一个绿色成功结果，但代码后来已被编辑。为什么这个输出不能作为当前代码通过验收的证据？
4. Python 单元格使用 pandas 对 1 亿行数据做 groupby，Warehouse 再大是否能自动解决 Notebook Python 进程内存不足？为什么？
5. Notebook 已在交互模式运行成功，但计划任务失败。还要检查哪些调度身份和权限信息？

## 参考资料

- [Editing and running Notebooks in Workspaces](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-in-workspaces/notebooks-in-workspaces-edit-run)
- [About Legacy Snowflake Notebooks](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks)
- [Session context in Notebooks](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-sessions)
- [Schedule Notebooks in Workspaces](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-in-workspaces/notebooks-in-workspaces-schedule)
