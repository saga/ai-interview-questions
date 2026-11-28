# 虚拟仓库隔离、并发与成本控制

## 先判断查询是在等待，还是在执行

工作日 9 点，BI 看板开始超时。团队发现同一时段 ETL 也在运行，于是准备把原来的 Medium Warehouse 改成 X-Large。

这可能有帮助，也可能只是增加成本。关键是先区分两个时间：

- **排队时间**：查询已经提交，但还没有获得计算资源。
- **执行时间**：查询已经开始运行，真正消耗计算资源处理 SQL。

如果查询主要在排队，应该先研究并发和负载隔离；如果查询拿到资源后仍然执行很久，再分析 SQL、数据扫描和 Warehouse 规格。把这两个问题混在一起，是仓库调优中最常见的浪费。

## 三种扩容方式解决的不是同一个问题

### 调整 Size：增强单个 Warehouse 的计算能力

Scale up 是把 Warehouse 从 Small 调到 Medium、Large 等更高规格。它适合单条查询确实需要更多计算资源的情况，例如扫描、Join 或聚合阶段受资源限制。

但查询耗时不一定随着规格线性下降。SQL 计划、数据量、缓存、数据倾斜和外部等待都可能成为主要瓶颈。调规格前先用 Query Profile 确认问题，调整后用相同 SQL 和输入做对照。

### Multi-cluster：让更多并发查询有资源可用

Multi-cluster Warehouse 通过增加集群来承接并发请求，重点是缓解高峰期排队。它不是把一条 SQL 拆成多份交给多个集群同时计算。

如果 BI 查询本身执行时间很长，单纯增加集群通常不会直接解决这个问题。反过来，如果 ETL 与 BI 在同一个仓库里争用资源，单纯调大单集群规格也未必是最合适的隔离方式。

Multi-cluster 的可用能力受账户 Edition 和配置条件限制，上线前要核对当前账户的产品能力。

### 独立 Warehouse：把不同工作负载分开管理

ETL、BI 和临时分析往往有不同的峰值、优先级和成本归属。拆分 Warehouse 后，每类负载可以独立设置规格、自动暂停、监控和访问权限。

隔离的是计算资源，不是表数据权限。多个 Warehouse 可以访问同一张表；能否读取仍由 Role 和对象授权决定。拆分后也会增加资源配置和成本管理工作，因此应该以真实的资源竞争为依据，而不是按团队数量机械地创建仓库。

## 用现象和证据选择处理方式

| 现象 | 优先检查 | 候选措施 |
| --- | --- | --- |
| 排队时间高，执行时间相对稳定 | Warehouse Load History、并发峰值 | 拆分负载或评估 Multi-cluster |
| 排队不明显，但单条 SQL 执行很慢 | Query Profile、扫描量、Join 和聚合 | 优化 SQL，再对比不同 Size |
| ETL 高峰挤压交互式 BI | 两类任务是否共用 Warehouse、各自的响应目标 | 分离 Warehouse，单独设置资源策略 |
| 任务结束后仓库长时间空闲 | 调用间隔、下一次启动的等待容忍度 | 调整 AUTO_SUSPEND 与 AUTO_RESUME |
| Credit 持续超过预算预期 | Warehouse 用量和未覆盖的服务用量 | 设置 Warehouse Resource Monitor，并监控其他服务 |

做选择前，先把问题写成可验证的假设。例如：“BI 查询没有明显执行瓶颈，慢主要来自与 ETL 共用 Warehouse 时的排队。”如果证据不支持这个判断，就不要先拆仓库。

## 一个配置例子，以及它没有替你决定的事

下面的配置将交互式 BI 与批处理分开。参数只是起点，不能替代根据实际任务周期调整自动暂停时间。

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

BI_WH 和 BATCH_WH 的规格不必相同。应该先用代表性负载测量，再根据响应目标和费用调整。对于持续运行的任务，过短的 AUTO_SUSPEND 可能带来频繁暂停和恢复；对于偶发任务，过长的空闲时间又会产生不必要的计算费用。

Resource Monitor 可以针对 Warehouse 的 Credit 使用配置通知或暂停动作，但不能把它当成整个 Snowflake 账户的全局费用闸门。Serverless 功能和其他服务需要另外观察。

## 把调优做成一次可比较的实验

不要一边改 Size、一边改 SQL、再同时拆 Warehouse，否则即使结果变好，也无法知道是哪项改变起了作用。

建议固定 SQL、数据量和时间窗口，记录下面四类结果：

1. BI 的 p50/p95 延迟和排队时间；
2. ETL 是否在业务窗口内完成；
3. 并发高峰时的查询成功率；
4. 两类工作负载各自的 Credit 消耗与空闲时间。

调整后的方案只有在响应目标得到改善、成本仍可接受，并且没有把问题转移给另一类任务时，才算真正有效。

## 容易把扩容手段用反的情况

- 单条 SQL 执行慢，不等于需要 Multi-cluster；先看执行计划。
- 大量查询排队，不等于单集群算力不足；先看并发和负载隔离。
- Auto Suspend 不是越短越好，要考虑任务到达间隔和恢复等待。
- Resource Monitor 不是全平台硬预算；不要遗漏 Serverless 等其他用量。

## 自测

1. 单条查询执行时间很长，但基本没有排队。你会先比较 Warehouse Size，还是先增加 Multi-cluster？说明需要看的证据。
2. BI 与 ETL 共用一个 Warehouse，只有每天早上的 ETL 高峰出现 BI 排队。拆分 Warehouse 会隔离什么，又不会隔离什么？
3. 为什么 Resource Monitor 触发暂停后，仍不能据此断定账户不再产生任何计算费用？

## 参考资料

- [Overview of warehouses](https://docs.snowflake.com/en/user-guide/warehouses-overview)
- [Working with warehouses](https://docs.snowflake.com/en/user-guide/warehouses-tasks)
- [Understanding compute cost](https://docs.snowflake.com/en/user-guide/cost-understanding-compute)
