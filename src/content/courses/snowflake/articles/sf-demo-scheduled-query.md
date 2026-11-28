# Task 定时调度、依赖与失败恢复

## 本节要解决的问题

财务结算需要在东京时间每个工作日早上 8:15 执行。上游订单文件必须先到齐，订单标准化完成后才能生成 NAV 汇总；如果一批数据在 8:15 还没准备好，报告不能用旧数据冒充当天结果。若作业运行超过 10 分钟，下一次计划时间又到来，系统应如何处理？

Snowflake 中的 Task 是运行 SQL 或 Stored Procedure 的调度与执行对象。Task 可以按固定时间运行，也可以由 Stream 数据变化触发；多个 Task 可以组成 Task Graph。它们不等于通用消息队列，也不自动保证业务数据完整。设计时必须明确时间、上游条件、重叠行为、失败重试和批次幂等。

## 核心知识

### SCHEDULE 支持间隔调度和带时区的 Cron

简单周期可使用间隔，例如每 15 分钟：

~~~sql
CREATE OR REPLACE TASK refresh_portfolio_metrics
  WAREHOUSE = TRANSFORM_WH
  SCHEDULE = '15 MINUTES'
AS
  CALL refresh_portfolio_metrics();
~~~

固定时点应使用 Cron，并明确 IANA 时区。例如周一至周五东京时间 08:15：

~~~sql
CREATE OR REPLACE TASK daily_finance_close
  WAREHOUSE = FINANCE_WH
  SCHEDULE = 'USING CRON 15 8 * * MON-FRI Asia/Tokyo'
AS
  CALL close_finance_batch(DATEADD(day, -1, CURRENT_DATE()));
~~~

不要依赖账户默认时区推断业务时间。Cron 的时区决定计划触发时点；如果业务日期与时区跨界，还要明确存储的 TIMESTAMP 类型、会话时区和上一业务日的计算方式。

新建 Task 初始是 SUSPENDED。创建成功后要执行 ALTER TASK ... RESUME 才会按计划运行。EXECUTE TASK 可以立即启动一次运行，用于人工测试；它不会自动把 Task 转为持续调度状态。

### 单个定时 Task 不会并行启动自己的下一次运行

Snowflake 保证一个具有 Schedule 的普通 Task 同一时间只运行一个实例。如果上一次运行在下一次计划时间到达时还没有结束，该次计划会被跳过，而不是排队等待，也不会自动并行启动第二份。

例如 Task 每 10 分钟执行一次，08:00 启动后到 08:13 才结束，那么 08:10 计划时点会被跳过；下一次计划通常是 08:20。若业务要求每一批都必须执行，就不能只依赖固定 Schedule，应保存待处理批次并由后续运行逐批追赶，或者采用 Stream 触发/显式队列模式。

这也意味着 SCHEDULE 是启动节奏，不是任务完成 SLA。增加 Warehouse 规格可能缩短部分 SQL 的执行时间，但不能保证作业一定赶上下一次计划窗口。要监控实际开始、结束、跳过和积压的批次。

### Task Graph 用 predecessor 定义阶段依赖

当订单加载、标准化、汇总和报表发布有顺序关系时，可以将 Task 组成 Graph：

~~~sql
CREATE OR REPLACE TASK ingest_orders_root
  WAREHOUSE = INGEST_WH
  SCHEDULE = 'USING CRON 15 8 * * MON-FRI Asia/Tokyo'
AS
  CALL load_expected_order_files();

CREATE OR REPLACE TASK standardize_orders
  WAREHOUSE = TRANSFORM_WH
  AFTER ingest_orders_root
AS
  CALL standardize_order_batch();

CREATE OR REPLACE TASK calculate_portfolio_nav
  WAREHOUSE = FINANCE_WH
  AFTER standardize_orders
AS
  CALL calculate_nav_for_ready_batch();

CREATE OR REPLACE TASK publish_finance_report
  WAREHOUSE = FINANCE_WH
  AFTER calculate_portfolio_nav
AS
  CALL publish_report_if_reconciled();
~~~

在创建完成后，Graph 中的子任务必须处于 RESUMED 状态，Root Task 才能按计划驱动它们。可以逐个 Resume 需要参与运行的 Child Task，再 Resume Root；也可以调用 SYSTEM$TASK_DEPENDENTS_ENABLE(root_task_name) 启用整张图。手动执行一次 Graph 时，先 Resume 需要执行的 Child Task，再对 Root 执行 EXECUTE TASK；被挂起的 Child Task 会被跳过。AFTER 表示执行依赖，并不是“父任务 SQL 成功就说明数据正确”。子任务仍要检查输入批次、质量状态和业务对账结果。

互相独立的子任务可以并行。例如 NAV 和风险限额计算都依赖标准化持仓，但彼此不依赖时，可让它们成为同一个 root 的不同 child；最终发布任务再依赖两个 child 完成。

### Task Graph 的 OVERLAP_POLICY 控制整张依赖图是否可以重叠

Task Graph 与单个定时 Task 的重叠行为要分开理解。Root Task 的 OVERLAP_POLICY 控制 Graph 实例与子任务并行方式：

| OVERLAP_POLICY | 含义 |
|---|---|
| NO_OVERLAP（默认） | 只有整张 Graph 的所有 Child Task 都结束后，才调度下一次 Root；若整图耗时超过计划间隔，会跳过至少一次计划 |
| ALLOW_CHILD_OVERLAP | 若下一次计划到来时前一轮仍有 Child Task 在运行，可以启动新的 Graph 实例；Root 本身不会与上一轮 Root 重叠 |
| ALLOW_ALL_OVERLAP | 允许完整 Graph 实例并行，包括 Root 与各 Child Task |

允许 Graph 重叠前，要确认所有写操作具备批次隔离和幂等性。若两次运行同时写入同一张汇总表，可能重复累计、覆盖新批次或在前后批次之间读到混合状态。只要数据写入不是天然安全的，就先使用 NO_OVERLAP 并将并行度放在独立的子任务上。

### WHEN 可让 Task 由 Stream 数据变化触发

如果上游数据到达时间不固定，可使用 Triggered Task：

~~~sql
CREATE OR REPLACE TASK merge_new_order_events
  WAREHOUSE = TRANSFORM_WH
  WHEN SYSTEM$STREAM_HAS_DATA('RAW_DB.INGEST.ORDER_EVENTS_STREAM')
AS
  CALL merge_order_events();
~~~

Triggered Task 不需要频繁轮询一个短时间间隔；当 Stream 有变更时即可触发处理。也可以同时配置 Schedule 和 WHEN，让 Task 定期检查 Stream，而不是每次计划时间都执行实际 SQL。

Task 创建后同样需要 Resume。Stream 的消费 offset 与读取它的事务提交相关；如果任务失败并回滚，变更仍应留在 Stream 中供下一次处理。实际业务逻辑仍需考虑同一事件重发、迟到事件、事件版本和 MERGE 幂等。

### 失败重试、自动暂停和通知不是一回事

Task 自动重试默认关闭。可通过 TASK_AUTO_RETRY_ATTEMPTS 设置失败后重试次数；重试适合短暂基础设施问题，但不适合无条件重复执行非幂等外部副作用。对 Task Graph，还需要明确失败分支、下游是否允许继续、重试次数和暂停条件。

Task 可配置失败后暂停的阈值，也可以使用 ERROR_INTEGRATION 发送失败通知。通知让责任人知道有问题，但不会自动修复业务数据。失败后先检查：
- 失败的 Task、Graph Run ID、Query ID 和错误信息；
- 失败时对应的输入批次和 Stream offset；
- 任务是否已提交部分 DML 或调用过外部系统；
- 重跑会不会重复写入、重复发邮件或重复触发支付；
- 是否需要恢复上游批次或将任务重新 Resume。

## 工程实施步骤

1. 明确任务是固定时点、固定间隔还是数据到达触发；写清业务时区和截止日期。
2. 为每个 Task 定义 owner Role、运行 Warehouse/Serverless 模式、输入对象、输出对象和所需权限。
3. 将依赖拆成 Task Graph，只有存在真实依赖的任务才使用 AFTER；相互独立的工作可以并行。
4. 为 root Task 设置 Schedule/WHEN；创建后先在非生产环境使用 EXECUTE TASK 验证，再 Resume。
5. 根据实际运行时间和数据完整要求选择 NO_OVERLAP 或其他 OVERLAP_POLICY；默认先从不重叠开始。
6. 为每个批次保存 batch_id、业务日期、输入文件/Stream 位置和状态，确保重跑能识别已处理记录。
7. 根据失败类型配置 TASK_AUTO_RETRY_ATTEMPTS、暂停阈值和错误通知；外部副作用要使用幂等键。
8. 用 TASK_HISTORY 和 COMPLETE_TASK_GRAPHS 查看计划/实际运行、跳过、失败和整图状态。
9. 将执行成功与质量门禁分开：检查源批次完整、目标行数、金额总额和下游数据时间戳。
10. 对时区切换、夏令时、长时间运行、上游延迟、Stream 无数据、重复事件和中途失败建立回归测试。

## 场景分析

财务报表在东京时间 08:15 触发。订单文件预计 08:00 前到齐；标准化通常需要 6 分钟，NAV 计算需要 4 分钟。某天标准化耗时 13 分钟，NAV 仍在 08:28 完成。

如果这是一个单 Task 每 10 分钟调度的工作流，08:20 计划时点到达时前一轮仍在执行，该时点会被跳过。若系统只看“Task 最终成功”，可能忽略报告已超过 08:15 的业务截止时间。

更稳妥的方式是让 Root 在计划时间启动后先检查批次完整性，再依赖标准化、NAV 和发布子任务逐步推进；每个阶段将 batch_id 和业务状态写入控制表。发布任务只有在源批次齐全、NAV 已完成且差异在容差内才发布。若 08:15 尚未完成，报告应标记延迟，而不是展示前一天的旧数据并显示正常。

若任务失败后自动重试，必须确认同一 batch_id 不会重复写入 NAV 或发送两次发布通知。所有 Task Graph 的并行策略都应以这个幂等前提为基础。

## 常见误区

- **把 SCHEDULE 当成完成时间保证。** 它定义尝试启动的时间；数据可用性和业务 SLO 需另行监控。
- **认为一个定时 Task 会把错过的计划时点排队补跑。** 任务运行跨过下一计划时点时，该次计划会被跳过。
- **把 Task Graph 的 OVERLAP_POLICY 当成普通 Task 的通用重叠参数。** 单 Task 和 Graph 有不同的调度语义。
- **用 ALLOW_ALL_OVERLAP 解决延迟，却没有批次隔离。** 可能导致重复写入或跨批次混读。
- **认为 AFTER 表示上游数据已通过质量检查。** AFTER 只表达任务依赖，业务质量要单独判断。
- **把自动重试当成幂等保证。** DML、外部 API 和通知都需要独立的重放策略。
- **只看单 Task History，不看 Graph 和数据批次。** 任务成功不代表整条业务链已发布完整结果。

## 完成标准

- [ ] 能用 Schedule 和 Cron 建立带业务时区的定时 Task。
- [ ] 能区分 Task 创建、Resume 和 Execute Task 的作用。
- [ ] 能解释单个 Task 运行跨过下一计划时点会发生什么。
- [ ] 能用 AFTER 组织 Task Graph，并识别可并行的依赖分支。
- [ ] 能区分 NO_OVERLAP、ALLOW_CHILD_OVERLAP 和 ALLOW_ALL_OVERLAP。
- [ ] 能使用 WHEN/SYSTEM$STREAM_HAS_DATA 创建触发任务。
- [ ] 能设计自动重试、失败暂停、通知和批次幂等策略。
- [ ] 能通过 Task History 和业务对账验证端到端发布。

## 自测

1. 一个 Task 每 10 分钟运行一次，08:00 的运行到 08:13 才结束。08:10 的计划会如何处理？Snowflake 会自动排队补跑吗？
2. 一个 Graph 包含标准化、NAV 和风险计算。后两个步骤都只依赖标准化，但彼此独立。应怎样设置任务依赖？
3. NO_OVERLAP 与 ALLOW_CHILD_OVERLAP 的差异是什么？Root Task 会不会在两种设置下同时运行两份？
4. Stream 有新数据才需要执行 MERGE。为什么 Triggered Task 比每分钟固定轮询更合适？失败时还要检查什么？
5. Task 自动重试 3 次，但它会调用外部邮件 API。为什么还需要业务幂等键？
6. Task History 全部成功，但财务报表仍未按时发布。还应检查哪些业务批次和质量条件？

## 参考资料

- [Introduction to tasks](https://docs.snowflake.com/en/user-guide/tasks-intro)
- [Create a sequence of tasks with a task graph](https://docs.snowflake.com/en/user-guide/tasks-graphs)
- [Monitor task runs](https://docs.snowflake.com/en/user-guide/tasks-monitor)
- [Triggered tasks](https://docs.snowflake.com/en/user-guide/tasks-triggered)
- [Configure error alerts and notifications for tasks](https://docs.snowflake.com/en/user-guide/tasks-errors-integrate)
