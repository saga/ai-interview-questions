# Query Result、Metadata 与 Warehouse Cache

## 本节要解决的问题

区分结果缓存和 Warehouse 本地数据缓存，理解它们保存的对象、复用条件和生命周期。缓存命中率不是越高越好：应该判断复用是否符合数据新鲜度、安全权限和实际延迟要求。

## 核心知识

### Persisted Query Result Cache 复用查询结果

Snowflake 会保存查询结果，以便后续请求在满足复用条件时直接返回既有结果。缓存结果默认保留 24 小时；被再次复用时，保留时间会重置，但最长不超过首次执行后的 31 天。

结果复用有明确条件。相关源表数据没有变化，查询不能包含不可复用函数或外部函数，执行角色仍具有必要权限，影响结果的会话参数没有变化，且原结果仍在缓存期内。即便条件满足，也不保证一定复用。可通过 Query History 中的查询信息和复用标记观察，不能仅凭 SQL 文本完全相同就推断一定命中。

### Warehouse Cache 保存运行中仓库读取过的表数据

每个运行中的 Warehouse 会维护其访问过的表数据缓存。后续查询如果访问相同的数据区域，可能从本地缓存读取，减少再次访问持久化存储的工作量。仓库计算资源越大，通常可用缓存容量也越大。

Warehouse Suspend 会清除该 Warehouse 的本地数据缓存；恢复后缓存需要随查询逐步重建。因此，频繁暂停可节省空闲 credits，但可能让恢复后的首批查询变慢。不同 Warehouse 的本地缓存独立，某个 Warehouse 预热不会自动预热另一个 Warehouse。

### Metadata Cache 不等同于可配置的结果缓存

Snowflake 的元数据服务会维护对象和数据布局等信息，供 SQL 编译、优化及执行协调使用。它与 Persisted Query Result Cache、Warehouse 本地数据缓存用途不同。排障时应看查询执行阶段和相关历史信息，不要把“元数据服务处理得快”误当成用户能手动清理或调整的缓存层。

## 工程实施步骤

1. 选一条重复执行的代表性 SQL，固定角色、会话参数、源数据版本和查询文本，记录第一次与后续执行的 Query ID、耗时和 Query History 相关字段。
2. 使用相同 SQL 检查结果复用是否发生；再修改源表数据或使用不可复用函数，对照观察结果缓存是否失效。
3. 在同一 Warehouse 上执行一组需要扫描同一区域的查询，观察 Query Profile 的扫描信息和 Query History 的本地缓存扫描比例。
4. Suspend 并 Resume Warehouse 后重复测试，区分结果缓存是否可复用与 Warehouse 本地缓存重新构建的影响。
5. 在 BI、批处理和临时分析之间比较缓存收益，决定是否需要保持仓库运行；同时将空闲时间和 credits 纳入成本评估。
6. 若结果未复用，先检查源数据变更、查询函数、角色权限和会话参数，不要先通过增大仓库试图修复结果缓存条件。

## 场景分析

运营仪表板每隔一分钟运行相同的聚合 SQL。有人建议把 Warehouse 始终保持运行，以保证查询缓存；另一个人希望启用结果缓存来降低成本。

先检查数据是否在刷新间隔内保持不变，以及 SQL 是否包含会影响复用的函数。如果源表频繁变化，结果缓存可能无法复用；如果数据相对稳定，则可观察查询是否重用持久化结果。即使 Suspend 了 Warehouse，符合条件的持久化查询结果仍可能复用；但恢复后的 Warehouse 本地数据缓存已清空，下一条需要真正执行的查询可能出现冷缓存延迟。

因此要分别衡量结果缓存命中、Warehouse 本地缓存、数据刷新频率、首查延迟和空闲 credits。不能把保持 Warehouse 运行当成结果缓存的必要条件。

## 常见误区

- **把结果缓存与 Warehouse 本地缓存当作同一个东西。** 前者复用完整查询结果，后者缓存仓库读取过的表数据；它们的命中条件和生命周期不同。
- **认为相同 SQL 必定命中结果缓存。** 数据、权限、函数和会话配置等条件会影响复用。
- **认为 Suspend 会清除所有已保存查询结果。** Suspend 清除该仓库本地数据缓存，不等于持久化查询结果一并失效。
- **认为缓存命中意味着结果永远最新。** 结果复用仍受源数据版本和复用规则约束；有严格新鲜度要求时要检查源数据是否变化。
- **为了缓存命中而无限期保持所有仓库运行。** 需要比较缓存带来的延迟收益和空闲计算费用。

## 完成标准

- [ ] 能区分 Persisted Query Result Cache、Warehouse Cache 和平台元数据服务。
- [ ] 能说明结果缓存的有效期和主要复用条件。
- [ ] 能解释 Warehouse Suspend 对本地数据缓存的影响。
- [ ] 能设计对照实验区分结果复用与本地缓存读取。
- [ ] 能结合首查延迟、数据新鲜度和空闲 credits 决定仓库策略。

## 自测

1. 同一条 SELECT 在十分钟内运行两次，为什么第二次仍可能重新执行？
2. Warehouse Suspend/Resume 后，哪些缓存状态会受到影响？为什么不能笼统说“所有缓存清空”？
3. 一张表每分钟都被更新，仪表板查询还可能从哪类缓存中获益？应怎样验证？

## 参考资料

- [Using Persisted Query Results](https://docs.snowflake.com/en/user-guide/querying-persisted-results)
- [Warehouse considerations](https://docs.snowflake.com/en/user-guide/warehouses-considerations)
- [Exploring execution times](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
