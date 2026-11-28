# Task DAG 与任务管理 API

## 本节要解决的问题

每日 02:00，销售数据管道需要先加载订单源数据，再并行更新客户维度和订单清洗结果，最后生成销售事实表。若清洗任务失败，事实表不能继续发布；若一个分支成功、另一个分支失败，也不能只因为根任务正常结束就宣布本批数据可用。

Snowflake Task Graph 将这种依赖关系表达为有向无环图（DAG）。根 Task 负责定时或事件触发，子 Task 用 AFTER 声明前置任务，多个前置任务可汇合到一个下游节点。任务名称、创建顺序和编号都不会自动形成依赖；执行顺序来自任务定义中的显式关系。

## Task DAG 的执行语义

### Root、Child 和 Finalizer 各自承担不同职责

- **Root Task**：DAG 的入口，定义整个管道的调度或触发条件。
- **Child Task**：通过 AFTER 指定一个或多个前置 Task；只有所有前置任务都成功完成后，默认才会触发该子任务。
- **Finalizer Task（可选）**：在图中其他任务完成后执行收尾工作，例如记录整次运行结果、释放外部资源或发送汇总通知。它不是普通下游节点，不参与业务依赖链的成功计算。

下面的结构中，订单清洗和客户维度更新可以并行，销售事实表必须等待两者都完成：

~~~mermaid
flowchart TD
  A["ROOT_LOAD<br/>加载原始订单"] --> B["PROFILE_ORDERS<br/>清洗订单"]
  A --> C["BUILD_CUSTOMERS<br/>更新客户维度"]
  B --> D["BUILD_SALES_FACT<br/>生成销售事实"]
  C --> D
  A -.-> E["FINALIZE_RUN<br/>记录整次运行结果"]
~~~

当 PROFILE_ORDERS 与 BUILD_CUSTOMERS 都成功后，BUILD_SALES_FACT 才会开始。如果任何一个前置任务失败，BUILD_SALES_FACT 默认不会被调度；失败的子任务和它的下游需要在图运行记录中单独检查。

### AFTER 是依赖定义，不是命名约定

一个传统 Task Graph 可以用 CREATE TASK 和 AFTER 定义：

~~~sql
CREATE OR REPLACE TASK SALES_DB.OPS.ROOT_LOAD
  WAREHOUSE = ETL_WH
  SCHEDULE = 'USING CRON 0 2 * * * Asia/Tokyo'
AS
  CALL SALES_DB.OPS.LOAD_STAGED_ORDERS();

CREATE OR REPLACE TASK SALES_DB.OPS.PROFILE_ORDERS
  WAREHOUSE = ETL_WH
  AFTER ROOT_LOAD
AS
  CALL SALES_DB.OPS.CLEAN_ORDERS();

CREATE OR REPLACE TASK SALES_DB.OPS.BUILD_CUSTOMERS
  WAREHOUSE = ETL_WH
  AFTER ROOT_LOAD
AS
  CALL SALES_DB.OPS.BUILD_CUSTOMER_DIM();

CREATE OR REPLACE TASK SALES_DB.OPS.BUILD_SALES_FACT
  WAREHOUSE = ETL_WH
  AFTER PROFILE_ORDERS, BUILD_CUSTOMERS
AS
  CALL SALES_DB.OPS.BUILD_SALES_FACT();

CREATE OR REPLACE TASK SALES_DB.OPS.FINALIZE_RUN
  WAREHOUSE = ETL_WH
  FINALIZE = ROOT_LOAD
AS
  CALL SALES_DB.OPS.RECORD_PIPELINE_RESULT();
~~~

示例假设这些 Stored Procedure 已存在，并且相应 Task Owner Role 对其有执行权限。Root、Child 和 Finalizer 需要位于同一 Schema，并且整张图中的任务必须由同一 Role 拥有。每个 Task 都应明确执行资源、错误处理和业务写入范围；不要只根据名称猜测它属于哪个阶段。

多前置依赖意味着“全部成功后再执行”，不是“任意一个成功就执行”。如果业务确实需要在部分前置失败时执行通知或补偿，应设计独立的 Finalizer，或在确认 Preview 能力和运行边界后评估 Advanced Branching；不要把普通 AFTER 当成条件分支。

### 图内可以并行，图与图是否重叠由 Root 的 OVERLAP_POLICY 控制

两个 Child Task 共享一个 Root 且没有相互依赖时，可以并行执行。OVERLAP_POLICY 控制的是同一 Task Graph 的多次运行能否互相重叠，不是用来描述 Child 之间的依赖关系：

| 设置 | 行为 | 适用条件 |
|---|---|---|
| NO_OVERLAP（默认） | 上一轮图运行全部结束后才开始下一轮；若超过调度间隔，后续计划可能被跳过 | 本轮必须完成后才能开始下一批 |
| ALLOW_CHILD_OVERLAP | 如果下一次计划到来时 Root 已结束但 Child 仍在运行，可启动新一轮；Root 不会并发 | 根任务可独立触发，但部分 Child 执行较长 |
| ALLOW_ALL_OVERLAP | 允许多轮图运行同时存在，包括 Root 也可能并发 | 所有读写都能正确处理并发批次 |

默认 NO_OVERLAP 不会自动排队补跑所有错过的计划。如果图每 10 分钟调度一次，但一轮需要 25 分钟，下一些计划可能被跳过。应先检查 SQL、Warehouse 和运行时长，再决定是否拉长间隔或允许重叠。允许重叠前必须验证目标表写入幂等、批次键隔离和不同运行之间不会覆盖数据。

### 修改任务图前先暂停 Root，发布后再恢复

传统 Task Graph 修改依赖关系时，需要先暂停 Root Task。已开始的运行会按当时的图版本继续；暂停后可替换任务、增加或删除 AFTER 依赖，再恢复 Root。所有任务需要同一 Owner Role，且位于同一 Database/Schema。单个 Task 最多 100 个前置和 100 个子任务，Task Graph 最多 1,000 个任务；账户的 resumed tasks 也有总量限制。

发布一个新图版本的基本流程：

1. ALTER TASK ROOT_LOAD SUSPEND；
2. 修改 Child Task 定义或 AFTER 关系；
3. 检查任务依赖和权限；
4. 恢复需要参与运行的 Child；
5. ALTER TASK ROOT_LOAD RESUME，或用 SYSTEM$TASK_DEPENDENTS_ENABLE 启用整张图；
6. 手动触发一次运行，核对图内顺序和结果。

不要在 Root 仍运行时用 CREATE OR REPLACE TASK 替换 Child。若过程代码由 Stored Procedure 承载，还要注意 Task Graph 版本记录的是 Task 定义，不包含被调用 Procedure 的代码版本；Procedure 在图运行期间变更可能影响当前运行。

### Finalizer 用于收尾，不应被当作成功路径的最后一个 Child

Finalizer 在图中的其他任务完成后执行，适合记录状态、发送汇总通知、释放运行资源。它不应承担必须成功后才能发布业务结果的核心计算。若希望在任何任务失败时依然执行清理逻辑，应明确使用 Finalizer，而不是让清理 SQL 挂在一个普通 AFTER 子任务后面；普通子任务在上游失败时默认不会执行。

Finalizer 的结果也应纳入整图验收。如果它失败，清理/通知并没有完成，即使业务计算分支已成功也需要在运行报告中显式呈现。

## 失败、重试与幂等

### 子任务失败会阻止默认下游依赖继续执行

默认情况下，Child Task 只有在所有前置任务成功后才会运行；任何前置失败都会阻断其下游。任务图运行结果会标记失败，后续定时运行是否继续取决于 Root 的失败暂停策略。

可为 Root 配置 TASK_AUTO_RETRY_ATTEMPTS，在子任务失败后自动重试整张图。还可通过 SUSPEND_TASK_AFTER_NUM_FAILURES 控制连续失败多少次后自动暂停。重试只解决运行失败，不替代业务幂等：如果某个 Task 已写入部分数据再报错，重试前仍要确认写入是 MERGE、按批次覆盖还是其他可安全重放操作。

### RETRY LAST 和 RETRY GRAPH RUN GROUP 有恢复条件

EXECUTE TASK ... RETRY LAST 会从最近一次失败或取消的任务继续执行，而不是无条件重跑整张图。RETRY GRAPH RUN GROUP 可以指定较早的一次运行。两者都有限制：
- 目标图运行必须 FAILED 或 CANCELED，且没有仍在执行的同组运行；
- 图结构自该次运行以来不能被修改；
- 第一次尝试必须在过去 14 天内；
- 失败或取消的 Task 会重新执行，其下游在所有前置任务成功后继续运行。

Snowflake 为重试运行保留相同的 GRAPH_RUN_GROUP_ID，并增加 ATTEMPT_NUMBER。不能把重试当成“重新启动一张新图”，也不能修改图后期待旧运行仍可按原图结构重试。

### 手动执行默认异步，AWAIT 才等待整图结束

EXECUTE TASK ROOT_LOAD 默认返回调度结果，不等待整张图完成。若后续 SQL 必须依赖任务图结果，可以使用 EXECUTE TASK ROOT_LOAD AWAIT；它会等待整张图及 Finalizer 完成。AWAIT 会受到语句超时和运行重叠策略限制。若当前已有运行，OVERLAP_POLICY 又不允许立即启动新的运行，命令可能直接报错，而不是排队等待。

## 任务管理 API：管理对象与观察运行分开

### REST API 提供任务资源操作，但不替代依赖图设计

Snowflake Task REST API 提供以下操作：

| 操作 | Endpoint（相对路径） | 用途 |
|---|---|---|
| 列出 Schema 中的 Tasks | POST/GET /api/v2/databases/{db}/schemas/{schema}/tasks | 创建或列出任务 |
| 获取单个 Task | GET .../tasks/{name} | 读取定义和状态 |
| 更新/创建 Task | PUT .../tasks/{name} | 创建或更新任务定义 |
| 删除 Task | DELETE .../tasks/{name} | 删除任务 |
| 执行/恢复/暂停 | POST .../tasks/{name}:execute、:resume、:suspend | 触发或管理生命周期 |
| 查看依赖 | GET .../tasks/{name}/dependents | 查询子任务关系 |
| 当前运行和未来计划 | GET .../tasks/{name}/current-graphs | 查看正在执行或未来 8 天计划中的图运行 |
| 已完成图运行 | GET .../tasks/{name}/complete-graphs | 查询已完成任务图运行 |

REST API 的资源是 Database/Schema 下的 Task。依赖仍需在 Task 定义中用 AFTER 表达；不会因为 API 创建了一个叫 TASK_02 的对象，就自动依赖 TASK_01。

REST API 执行命令可能返回 HTTP 202 Accepted：这只代表请求已受理，不表示 Task Graph 已运行完成。客户端应使用 current-graphs 查看当前/未来运行，再使用 complete-graphs 查看完成结果；current-graphs 请求还要求有可用 Warehouse。旧的 current_graphs 和 complete_graphs 路径已经标记为 deprecated，应使用带连字符的新路径。

### 用 Task History 和 Graph Run Group 关联实际执行

运维时至少保留 Root Task Name、GRAPH_RUN_GROUP_ID、ATTEMPT_NUMBER、每个 Task 的状态、Query ID、错误信息、开始/结束时间。只保存 REST 请求返回的 202 或单个 Task 的最后状态，无法说明整张图是否完整成功。

建议通过 Snowsight Task Graph 页面、TASK_HISTORY、COMPLETE_TASK_GRAPHS 和 Query History 分别核对：
- 本次 Graph Run 是否结束；
- 哪个 Task 成功、失败、跳过或仍未运行；
- 失败任务的 Query ID 和错误信息；
- 当前依赖关系是否与发布版本一致；
- 是否因为 OVERLAP_POLICY 跳过后续调度；
- 重试是否使用相同 Graph Run Group。

## 工程实施步骤

1. 画出业务处理顺序和依赖关系，确定哪些任务并行、哪些任务需要等待多个前置结果。
2. 定义 Root Task 的调度/触发条件；每个 Child 明确 AFTER 依赖；清理和汇总放在 Finalizer。
3. 将所有任务部署到同一 Schema，并使用同一 Owner Role；检查 Warehouse、对象和 Procedure 权限。
4. 使用显式的业务批次键和幂等写入，确保任务失败后可安全重试。
5. 根据图整体运行时长和数据一致性要求选择 OVERLAP_POLICY，不要为了缩短延迟直接开放全图重叠。
6. 先创建/更新任务，检查 TASK_DEPENDENTS 或 Snowsight 的图形视图，再恢复 Root。
7. 修改依赖前暂停 Root；修改后重新检查图定义和版本，再恢复调度。
8. 用 EXECUTE TASK ROOT AWAIT 或手动运行验证一次完整图，检查所有 Child 和 Finalizer。
9. 对生产接口使用 REST API 管理对象；遇到 202 响应时轮询 current-graphs 和 complete-graphs，不能直接认为执行完成。
10. 设置 TASK_AUTO_RETRY_ATTEMPTS 和 SUSPEND_TASK_AFTER_NUM_FAILURES 时，结合失败模式、费用和幂等性确定参数。
11. 保存 Task History、Graph Run Group、Attempt Number、Query ID、任务定义版本和业务批次对账结果。
12. 对图结构、Owner、Warehouse、Overlap Policy、Retry 和 Finalizer 的变化执行回归测试。

## 场景分析

每天 02:00 的销售管道先加载订单，然后并行清洗订单和刷新客户维度，最后生成销售事实表。PROFILE_ORDERS 成功，但 BUILD_CUSTOMERS 失败。

由于 BUILD_SALES_FACT 同时依赖两个任务，默认不会启动。Finalizer 仍可在图任务完成后记录整图失败状态。运维人员修复客户维度任务后，可以在图定义未发生变化且失败运行在 14 天内的前提下执行 RETRY LAST；它会重新执行失败的分支，并在其前置条件满足后继续下游任务。

如果将 Root 的 OVERLAP_POLICY 改为 ALLOW_ALL_OVERLAP，下一批可能在上一批的 Child 仍运行时启动。若两批都向同一张事实表写入且没有 batch_id 约束，可能造成数据覆盖或重复。应先证明批次隔离和目标写入幂等，再考虑让多轮图重叠。

## 常见误区

- **用 Task 名称或创建顺序推断依赖。** 只有 AFTER 或 Task Graph 的显式 Root/Child 定义才构成依赖关系。
- **把 Task Graph 当成一条串行流水线。** 有相同前置条件的 Child 可以并行；下游汇合点会等待所有前置任务成功。
- **把 OVERLAP_POLICY 当成 Child 依赖控制。** 它控制多轮图运行是否可以重叠，不替代 AFTER。
- **认为 Child 失败后所有下游仍会继续。** 默认依赖要求所有前置任务成功，失败会阻断后续节点。
- **把 Finalizer 当作普通 Child。** Finalizer 是图完成后的收尾任务，不应承载必须先成功的业务计算。
- **修改任务定义时不暂停 Root。** 可能让已运行的图和计划中的图使用不同定义，影响回放。
- **把 RETRY LAST 当作任意重跑。** 图结构未变、运行在 14 天内、图已失败/取消等条件都必须满足。
- **把 REST API 的 202 当成运行结束。** 还要查询当前运行和已完成 Graph Run。
- **默认用管理员 Role 创建所有 Task。** Task Graph 要求统一 owner；应由专用运行 Role 获得执行所需最小权限。
- **允许整图重叠，却没有幂等设计。** 并发运行可能重复处理批次或覆盖目标数据。

## 完成标准

- [ ] 能用 Root、Child、AFTER 和 Finalizer 表达一个真实的 Task DAG。
- [ ] 能解释多个前置任务全部成功后才会触发下游的默认语义。
- [ ] 能区分 Child 内部并行与多轮 Graph Run 的 OVERLAP_POLICY。
- [ ] 能说明 Task Graph 同一 Schema、同一 Owner Role 和任务数量限制。
- [ ] 能安全修改图结构并管理 Root 的暂停/恢复。
- [ ] 能解释自动重试、RETRY LAST、RETRY GRAPH RUN GROUP 的区别和约束。
- [ ] 能用 Graph Run Group、Attempt Number、Task History 和 Query ID 追踪运行。
- [ ] 能区分 Task REST API 的对象管理、执行触发和运行状态查询。
- [ ] 能说明 202 Accepted 不是任务执行完成。
- [ ] 能区分传统 Task DAG DDL 与 Preview 的 TASK GRAPH 对象。

## 自测

1. PROFILE_ORDERS 和 BUILD_CUSTOMERS 都 AFTER ROOT_LOAD，BUILD_SALES_FACT AFTER 两者。哪个任务可并行？BUILD_SALES_FACT 何时开始？
2. 一个图每 10 分钟调度，但一轮需要 25 分钟。NO_OVERLAP 下会发生什么？什么条件下可以评估 ALLOW_CHILD_OVERLAP？
3. 一个 Child 失败后，其下游节点没有出现在 TASK_HISTORY 中。为什么这不一定代表任务调度器漏执行？
4. 图结构刚刚修改，运维人员想 RETRY LAST 重跑昨天的失败任务。为什么可能不允许？
5. REST API 的 execute 返回 202。客户端还应查询什么 Endpoint 来确认执行进度和最终结果？
6. 为什么 Finalizer 适合做整图结果记录，却不应替代必须成功的业务计算？
7. 一张图允许 ALLOW_ALL_OVERLAP，但每轮都更新相同目标表。需要怎样的批次键和幂等机制才能避免覆盖？

## 参考资料

- [Create a sequence of tasks with a task graph](https://docs.snowflake.com/en/user-guide/tasks-graphs)
- [CREATE TASK](https://docs.snowflake.com/en/sql-reference/sql/create-task)
- [EXECUTE TASK](https://docs.snowflake.com/en/sql-reference/sql/execute-task)
- [Task Graph SQL commands](https://docs.snowflake.com/en/sql-reference/sql/create-task-graph)
- [Snowflake REST Task API](https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/reference/task)
- [Manage tasks](https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/tasks/tasks-introduction)
- [TASK_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/task_history)
- [COMPLETE_TASK_GRAPHS](https://docs.snowflake.com/en/sql-reference/functions/complete_task_graphs)
