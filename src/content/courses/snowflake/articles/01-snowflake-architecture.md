# 学习目标

学完本节，应该能说明 Snowflake 的三层架构分别负责什么，理解存储与计算分离带来的能力和边界，并能把一次 SQL 请求放回平台架构中解释。

## 1. 为什么采用分层架构

传统数据仓库通常把存储、计算和管理组件部署在同一套基础设施中。扩容、维护和工作负载隔离容易相互影响：分析查询可能争抢同一组计算资源，扩容也可能同时牵动存储和计算。

Snowflake 将职责拆分为数据库存储、计算和 Cloud Services。基础设施由 Snowflake 管理，用户主要通过 SQL、平台对象和服务接口使用能力，而不是自行部署数据库节点和维护底层集群。

## 2. 三个主要层次

### Database Storage

负责持久化数据。Snowflake 表的数据会被组织为压缩的列式存储，并自动划分为微分区。平台维护文件组织、元数据和统计信息，用户通常不需要手动分配数据文件或创建微分区。

### Compute

计算由 Virtual Warehouse 承担。Warehouse 是独立的计算集群，用于执行 SQL 查询，以及支持的 Snowpark 工作负载。不同 Warehouse 之间不共享计算资源，因此可以为 ETL、BI、数据科学和临时分析配置不同的计算边界。

### Cloud Services

Cloud Services 协调平台活动，处理认证、访问控制、元数据管理、查询解析与优化、基础设施管理等工作。它不是用户 SQL 查询中负责扫描和计算数据的 Warehouse。

## 3. 一次查询如何经过平台

~~~mermaid
flowchart TD
  U[Client / BI / Application] --> C[Cloud Services]
  C --> A[Authentication and Access Control]
  A --> P[Parse and Optimize SQL]
  P --> W[Virtual Warehouse]
  W <--> S[Database Storage]
  P --> R[Result Metadata and Coordination]
  W --> R
  R --> U
~~~

这是职责视图，不是内部组件的完整部署拓扑。实际查询还涉及缓存、元数据访问、调度和结果处理，不能将图中的箭头理解成严格的内部调用顺序。

## 4. 存储与计算分离意味着什么

- 同一份持久化数据可以由不同 Warehouse 按各自工作负载访问。
- 可以为 BI 和数据加载设置不同 Warehouse，降低计算资源争用。
- 暂停 Warehouse 不等于删除表数据；计算停止与数据持久化是两个不同生命周期。
- 计算可以按需要扩缩，但这不意味着所有 SQL 都会自动变快。查询结构、扫描范围、并发和数据组织仍然重要。

存储与计算分离也不是“完全没有共享资源”。Cloud Services 仍负责平台级协调，账户还会受到权限、服务能力、配额和区域可用性的约束。

## 5. 工程场景：零售企业的多工作负载

一家零售企业把订单、库存和客户数据集中到 Snowflake。数据加载任务使用 ETL Warehouse，BI 报表使用 BI Warehouse，临时分析使用受控的分析 Warehouse。

这样做的目的不是简单地增加 Warehouse 数量，而是把不同工作负载的计算容量、并发、成本归属和运维责任分开。上线后仍要通过 Query History、Query Profile 和成本视图验证隔离是否真正解决问题。

这是用于解释架构取舍的教学场景，不代表某家客户的公开案例或性能承诺。

## 6. 常见误解

- **Warehouse 保存着表数据。** 表数据由持久化存储层管理，Warehouse 提供计算资源。
- **Cloud Services 执行全部 SQL 算子。** 它负责协调、元数据、认证和优化等平台服务，SQL 的主要计算由 Warehouse 承担。
- **存储计算分离后就不需要性能治理。** 查询扫描、Join、聚合、并发和 Warehouse 尺寸仍然影响性能与费用。

## 7. 架构判断

遇到“是否应该给每个团队建立独立 Warehouse”的问题，不要只回答应该或不应该。先了解工作负载是否存在资源竞争、是否需要独立成本归属、权限是否需要隔离、并发峰值是否不同，再决定采用共享 Warehouse、独立 Warehouse 或多集群策略。

## 本节检查

1. Warehouse 暂停后，为什么表数据仍然存在？
2. Cloud Services 与 Warehouse 在查询处理中的职责有什么区别？
3. 哪些场景值得使用多个 Warehouse？如何用运行数据验证收益？
