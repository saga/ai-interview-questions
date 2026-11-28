# 虚拟仓库隔离、并发与成本控制

## 本节要解决的问题

为不同工作负载配置 Warehouse，判断查询变慢究竟是单条查询计算不足、并发排队，还是仓库空闲时间过长造成成本浪费。仓库规格、集群数量和自动暂停解决的问题不同，不能只靠不断调大规格处理所有现象。

## 核心知识

### Warehouse 是独立的计算集群

每个 Virtual Warehouse 独立使用计算资源。同一张表可以被多个 Warehouse 查询。为 ETL、BI、数据科学或临时分析分配不同 Warehouse，可以隔离并发、单独观察用量并按团队归集成本。

仓库隔离不会自动隔离数据权限。访问表的能力仍由当前角色及对象授权决定。

### Scale up 与 multi-cluster 不是同一种扩容

- **调整 Warehouse Size（Scale up）：** 提供更强的单仓库计算能力，适合单条查询需要更多 CPU、内存或并行处理资源的情况。它可能缩短部分查询时间，但不保证所有 SQL 都按比例提速。
- **Multi-cluster（Scale out）：** 通过增加同一 Warehouse 的集群来承接更多并发查询，主要解决并发排队。它不等于让一条查询自动分摊到所有集群。
- **分离 Warehouse：** 将负载不同、优先级不同或成本归属不同的任务拆开，避免相互争用同一个仓库。

Multi-cluster Warehouse 的可用性受版本/Edition 限制。上线前应核对账户实际可用能力。

### 自动暂停、自动恢复与资源监控各有边界

Auto Suspend 在一段空闲时间后暂停整个 Warehouse；Auto Resume 在后续请求需要该仓库时恢复。暂停阈值应结合查询到达频率和启动等待接受度设定，过短可能增加反复启动，过长会增加空闲计算费用。

Resource Monitor 用于监控虚拟仓库的 credit 使用并触发通知或暂停动作。不要把它当作覆盖所有 Snowflake 服务和所有 Serverless 消耗的全局预算闸门。

## 工程实施步骤

1. **按业务负载拆分基线。** 至少区分批量 ETL、交互式 BI 和临时分析，记录每类任务的并发、运行时、响应目标和可接受排队时间。
2. **先看排队还是执行。** 使用 Warehouse Load History 检查运行、排队和过载情况；用 Query History 查看单条查询的执行时间、排队时间及实际使用的 Warehouse。
3. **处理单条查询慢。** 查看 Query Profile，确认扫描量、Join、聚合、数据交换等瓶颈。只有当瓶颈与计算资源相关时，才进行 Warehouse Size 对比测试。
4. **处理并发排队。** 先评估拆分 Warehouse 或 multi-cluster。比较并发峰值、排队时间、集群启动和 credit 消耗，不要把扩大单集群规格当作唯一方案。
5. **配置自动暂停与恢复。** 根据任务间隔、夜间批次和交互峰值选择 AUTO_SUSPEND、AUTO_RESUME；对于连续运行作业，明确是否真的适合自动暂停。
6. **设置预算告警。** 为需要控制的 Warehouse 配置 Resource Monitor，明确通知阈值和暂停阈值，并另行核对不受该监控器覆盖的服务用量。
7. **用同一工作负载做对照。** 固定数据量、SQL、并发和时间窗口，比较 p50/p95 延迟、排队时间、成功率、credit 和空闲时间。

示例配置：

~~~sql
CREATE WAREHOUSE BI_WH
  WAREHOUSE_SIZE = 'MEDIUM'
  AUTO_SUSPEND = 120
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;

CREATE WAREHOUSE BATCH_WH
  WAREHOUSE_SIZE = 'LARGE'
  AUTO_SUSPEND = 300
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;
~~~

如果并发排队是主要问题，再评估 multi-cluster 配置，而不是默认把所有 Warehouse 都设成多集群。

## 场景分析

工作日 9:00 后，BI 查询排队明显增加；夜间 ETL 运行时长也在增长。团队准备将原来的 Medium Warehouse 调整为 X-Large。

先对照 Query History：若 BI 的查询执行时间正常而排队时间上升，优先评估 BI 与 ETL 是否共用仓库，以及 multi-cluster 或独立 Warehouse 的收益。若 ETL 查询本身的扫描与 Join 时间上升，应该看 Query Profile 和数据量变化，再进行受控的规格测试。两个问题可能同时存在，但不能用一次放大规格掩盖原因。

上线前用相同 SQL、相同输入和代表性并发做 A/B 测试，并比较成本。验收条件应同时包含 BI p95、ETL 完成窗口、排队时间和 Warehouse credit，而不只是“查询快了”。

## 常见误区

- **用扩大 Warehouse 处理所有排队。** 扩大规格主要增强单集群计算能力；高并发场景还需要评估 multi-cluster 或负载隔离。
- **认为 multi-cluster 会把单条查询拆到多个集群。** 它主要承接更多并发查询，不等同于单查询横向并行。
- **Auto Suspend 设成零等待。** 对高频短任务，过短的空闲阈值可能增加反复启动；应根据真实调用间隔设定。
- **认为 Resource Monitor 是全平台硬预算。** 它的监控对象有范围，Serverless 功能和其他服务费用需要独立监控。
- **只比较查询耗时，不比较成本。** 调优应同时比较延迟、排队、credit 和空闲时间。

## 完成标准

- [ ] 能区分 Scale up、multi-cluster 和独立 Warehouse 的适用场景。
- [ ] 能从 Warehouse Load History 和 Query History 判断是否存在排队。
- [ ] 能用 Query Profile 解释单条 SQL 的执行瓶颈。
- [ ] 能为不同负载制定 Auto Suspend、Auto Resume 和资源监控配置。
- [ ] 能用延迟、排队和 credit 三类指标验证调整效果。

## 自测

1. 单条查询执行很慢，但没有排队；应该优先评估扩大规格还是 multi-cluster？说明依据。
2. 大量短查询并发到来，Warehouse 经常出现队列；为何只调大单集群规格可能仍不是最佳方案？
3. Resource Monitor 达到阈值后暂停了 Warehouse，是否能据此断定整个 Snowflake 账户不再产生计算费用？为什么？

## 参考资料

- [Overview of warehouses](https://docs.snowflake.com/en/user-guide/warehouses-overview)
- [Working with warehouses](https://docs.snowflake.com/en/user-guide/warehouses-tasks)
- [Understanding compute cost](https://docs.snowflake.com/en/user-guide/cost-understanding-compute)
