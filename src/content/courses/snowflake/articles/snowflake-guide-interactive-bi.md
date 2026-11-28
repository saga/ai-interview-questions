# Interactive Warehouse 实时 BI 读写分离

## 本节要解决的问题

为短时、高并发、低延迟的交互查询建立独立服务路径，同时把超过交互执行预算的重查询转交给标准 Warehouse。Interactive Warehouse 不是普通仓库的另一个名字，也不会自动把数据复制成一份新的业务表；它围绕 Interactive Tables 的缓存和查询服务优化工作。

## 核心知识

### Interactive Warehouse 面向短查询和高并发

Interactive Warehouse 针对低延迟和高并发交互工作负载设计，通常与 Interactive Tables 配合使用。它支持多集群处理并发查询，可通过关联表进行主动缓存预热。Interactive Warehouse 也可以直接查询标准表、Dynamic Tables 和 Iceberg 表；关联表用于主动预热，不是查询这些表的前置条件。

Interactive Warehouse 与普通 Warehouse 的执行行为不同。交互执行路径有 5 秒查询时限，超时查询会透明地在配置的 Fallback Warehouse 上重新执行。这种机制把复杂或长时间运行的查询移出交互路径，保护短查询的尾延迟。

### Interactive Tables 与 Zero-Copy Interactive 决定数据准备方式

Interactive Tables 是面向频繁访问数据的交互式查询对象，可以预先准备查询服务所需的数据访问和缓存状态。自 2026 年 9 月起，Zero-Copy Interactive 已 GA，Interactive Warehouse 可以直接查询已有的 Standard、Dynamic、Iceberg 和 Hybrid Tables；不需要为了引入低延迟计算再复制一份标准业务表。

如果工作负载需要主动预热，可以把高频访问表关联到 Interactive Warehouse。预热是优化手段，不是必须步骤；不应把所有表都附加进去，也不要误认为关联会改变原表存储或数据权限。

### Fallback Warehouse、缓存生命周期和权限是设计重点

Fallback Warehouse 是标准 Warehouse，负责重新执行超过交互时限的查询。它应有足够容量并保持可恢复状态。Query Profile 中的 fault_handling_time 可帮助识别是否发生了 fallback。

Interactive Warehouse 支持 Auto Suspend/Resume，但最小 AUTO_SUSPEND 为 1 小时；恢复后缓存需要重新预热，首批查询可能出现明显延迟。它不能调用 Stored Procedure，也不支持依赖过程执行的部分 SQL 操作。上线前要检查权限、客户端行为、超时回退和实际区域可用性。

## 工程实施步骤

1. 从 Query History 筛选候选工作负载，确认查询通常短于 5 秒、请求并发较高、对 p95/p99 延迟敏感。
2. 按实际账号 Region 和 Cloud Provider 核对 Interactive Warehouse 与 Interactive Tables 的可用性。
3. 盘点数据对象类型，确认是否可以直接通过 Zero-Copy Interactive 访问；只有确有价值时才主动关联和预热表。
4. 创建 Interactive Warehouse，配置 Multi-cluster 参数、Fallback Warehouse 和适当的缓存预热范围。
5. 为交互查询配置专用 Role 和 Warehouse 使用权限；长查询的 Fallback Role、Warehouse 与对象权限也要验证。
6. 使用代表性查询验证 5 秒以内的交互延迟，故意运行超过时限的查询，检查是否透明转交及 Query Profile 的 fault_handling_time。
7. 对冷启动、自动暂停、手动恢复和缓存重建进行演练；记录 p50/p95/p99、Fallback 比例、集群数和 credits。
8. 将写操作、Stored Procedure、批处理和复杂长查询留在标准 Warehouse 或专用服务路径，不要强行塞进交互 Warehouse。
9. 按真实高峰流量做容量测试，确认交互队列与 fallback 服务不会互相造成级联过载。

示例：

~~~
CREATE INTERACTIVE WAREHOUSE BI_INTERACTIVE_WH
  WAREHOUSE_SIZE = 'MEDIUM'
  MAX_CLUSTER_COUNT = 3
  AUTO_SUSPEND = 3600
  AUTO_RESUME = TRUE;

ALTER WAREHOUSE BI_INTERACTIVE_WH
  SET FALLBACK_WAREHOUSE = BI_FALLBACK_WH;
~~~

具体参数需按账号区域、当前支持能力和实际工作负载校准。

## 场景分析

运营首页要在用户点击筛选器后快速返回最近订单状态。绝大多数查询只扫描已准备好的数据范围并在 1 秒内完成，但用户偶尔会选择跨年统计，导致查询运行数十秒。

将短查询放在 Interactive Warehouse，配置标准 BI_FALLBACK_WH 处理超过 5 秒的查询。首页常用表可以按收益评估主动预热；跨年统计和批量导出保留在标准 Warehouse。不要为了首页实时体验复制另一份标准订单表，Zero-Copy Interactive 已支持直接访问已有表类型。

验收不仅测热缓存 p95，还要包括未预热表、超过 5 秒的 fallback、仓库恢复、权限拒绝、峰值并发和成本。若大量常规查询都进入 fallback，说明查询形态或 Interactive Warehouse 配置需要调整。

## 常见误区

- **认为 Interactive Warehouse 是数据副本。** 它是专用计算与缓存路径；Zero-Copy Interactive 可直接访问已有表。
- **把主动附加表当作查询前置条件。** 附加/预热是性能优化，未附加的支持表类型仍可查询。
- **认为所有查询都会在 Interactive Warehouse 上无限运行。** 超过 5 秒会转到 Fallback Warehouse。
- **把 Fallback Warehouse 配成不可用或容量不足的仓库。** 这样会把长查询失败或拥塞带到回退路径。
- **将存储过程和批量作业放进交互 Warehouse。** 它面向短查询，CALL 等过程操作并不适用。
- **忽略恢复后的冷缓存。** 过于频繁地暂停和恢复会影响交互请求的首批延迟。

## 完成标准

- [ ] 能说明 Interactive Warehouse 与标准 Warehouse 的执行目标差异。
- [ ] 能解释 Interactive Tables、Zero-Copy Interactive 和主动预热的关系。
- [ ] 能说明 5 秒执行时限和 Fallback Warehouse 的行为。
- [ ] 能设计短查询、长查询和写入任务的分流方案。
- [ ] 能通过尾延迟、fallback 比例、缓存状态和成本验收配置。

## 自测

1. 一个查询超过 Interactive Warehouse 的 5 秒执行时限，会发生什么？在哪里定位是否发生 fallback？
2. 已有标准表可以被 Interactive Warehouse 直接查询，何时仍值得主动附加表进行缓存预热？
3. 用户首页延迟很好，但 Fallback Warehouse 的排队持续增长，说明应检查哪些容量和查询类型？
4. 为什么不适合把长时间 Stored Procedure 放在交互 Warehouse 上执行？

## 参考资料

- [Snowflake interactive analytics](https://docs.snowflake.com/en/user-guide/interactive)
- [CREATE INTERACTIVE WAREHOUSE](https://docs.snowflake.com/en/sql-reference/sql/create-interactive-warehouse)
- [Interactive Analytics product overview](https://www.snowflake.com/en/analytics/real-time-analytics/interactive-analytics/)
