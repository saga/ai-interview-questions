# 查询结果缓存与 Warehouse Cache 的性能验证

## 本节要解决的问题

一个 BI 看板每五分钟运行一次相同的销售汇总 SQL。第一次执行要 18 秒，随后几次只有 0.3 秒。团队据此认为 Warehouse 太小，准备升到 2XL；但 Query History 显示，后几次请求根本没有重新计算查询结果。

Snowflake 中至少要区分两种容易混淆的缓存：

- Persisted Query Result Cache 保存完整查询结果，条件满足时可以直接返回上次结果。
- Warehouse Cache 保存运行中的 Warehouse 读过的表数据，查询仍然执行，只是部分扫描可以从本地缓存读取。

两者对延迟的影响很不一样。一个查询用了结果缓存，不代表 Warehouse 扫描很快；一个查询从 Warehouse Cache 读数据，也不表示它跳过了整个 SQL 执行过程。

## 核心知识

### Persisted Query Result Cache 复用的是完整查询结果

当一条查询执行完成，Snowflake 会把结果保留一段时间。后续请求满足复用条件时，可以直接返回已有结果，而无需重新执行原查询。

默认结果缓存保留 24 小时。每次复用都会重置这段 24 小时保留期，但最长不超过第一次执行后的 31 天。较大的结果集还涉及访问令牌有效期：大于 100 KB 的结果访问令牌默认 6 小时过期，结果本身仍可能在缓存期内。

要复用查询结果，常见条件包括：

- 新查询文本与之前执行的查询完全一致；大小写、表别名等细微差异也可能阻止完全复用。
- 查询没有包含不可复用函数，例如 RANDOM 或 UUID_STRING，也没有 External Function。
- 查询不读取 Hybrid Table。
- 参与结果计算的表数据和相关微分区没有发生影响结果的变化。
- 结果仍处于缓存保留期。
- 当前执行角色仍具备读取原查询所用对象的权限。
- 影响结果的会话配置没有变化。

满足这些条件仍不保证一定复用。可以用 USE_CACHED_RESULT 控制是否启用结果复用：

~~~sql
ALTER SESSION SET USE_CACHED_RESULT = FALSE;
~~~

这个参数只关闭 Persisted Query Result Cache 的复用，不会关闭 Warehouse Cache。做性能实验时要把两者分开，否则会把“直接返回结果”和“从本地缓存扫描数据”混成一个命中率。

### Warehouse Cache 保存的是运行中 Warehouse 读取过的表数据

每个运行中的 Warehouse 都维护自己的表数据缓存。后续查询如果访问同一个 Warehouse 已缓存的数据区域，可能减少从持久化存储读取数据的工作。

Warehouse Cache 不会把整个查询结果原样返回。SQL 仍然需要执行过滤、Join、聚合、排序等操作，只是部分数据读取工作可能更快。不同 Warehouse 的本地缓存相互独立，A Warehouse 预热过的数据，不意味着 B Warehouse 也已预热。

Warehouse Suspend 会清空该 Warehouse 的本地数据缓存。Resume 后，查询逐渐重新填充缓存，因此恢复后的第一批查询可能较慢。延长 Auto Suspend 可以保留热点数据，但空闲 Warehouse 仍会消耗 Credits。

### 用 Query History 区分本地缓存扫描与重新执行

可以按 Warehouse 统计近一周读取的数据中有多少来自缓存：

~~~sql
SELECT
  warehouse_name,
  COUNT(*) AS query_count,
  SUM(bytes_scanned) AS bytes_scanned,
  SUM(bytes_scanned * percentage_scanned_from_cache)
    / NULLIF(SUM(bytes_scanned), 0) AS cache_scan_ratio
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE start_time >= DATEADD(day, -7, CURRENT_TIMESTAMP())
  AND bytes_scanned > 0
GROUP BY warehouse_name
ORDER BY cache_scan_ratio;
~~~

PERCENTAGE_SCANNED_FROM_CACHE 用于判断数据扫描有多少来自 Warehouse Cache。它不是 Persisted Query Result Cache 的复用比例。

如果结果缓存已经直接返回查询结果，SQL 执行阶段被跳过，扫描字节数可能为零。分析时应查看 Query History 中的结果复用信息和 Query Profile，而不是只盯 cache_scan_ratio。对 Warehouse Cache，则结合扫描总量、扫描缓存比例和执行时间判断。

## 工程实施步骤

1. 选择固定查询，保留 Query ID、SQL 文本、Role、Warehouse、会话参数、查询时间和数据更新时间。
2. 先执行一次查询，再原样执行第二次；检查第二次是否直接复用结果，并记录两次耗时。
3. 修改 SQL 的一个细节或更新参与查询的表，观察结果复用是否失效；不要同时更改多个条件。
4. 设置 USE_CACHED_RESULT = FALSE，再运行同一查询，避免完整结果复用对测试产生干扰。
5. 在 Warehouse 保持运行时重复执行查询，观察 Query Profile 和 PERCENTAGE_SCANNED_FROM_CACHE，识别本地表数据缓存带来的变化。
6. Suspend/Resume Warehouse 后，在仍禁用结果缓存的条件下执行相同查询，观察冷缓存扫描与执行时间。
7. 按真实负载评估 Auto Suspend。把缓存带来的延迟收益与空闲 Warehouse Credits 一起比较，不要只追求最高缓存比例。
8. 扩大测试样本，覆盖不同并发、查询形态和数据更新时间；不要用单个热查询的结果代表整个 Warehouse 工作负载。

## 场景分析

BI 看板每五分钟按地区汇总当天订单金额。订单表在每个整点批量更新。

第一次查询耗时 18 秒，第二次查询只有 0.3 秒。先检查第二次是否复用了 Persisted Query Result Cache。如果复用，第二次并没有重新扫描订单表；这不能证明 Warehouse Cache 有多快。

随后在 Session 中关闭结果缓存，再重复执行相同 SQL。第一次扫描耗时 12 秒，第二次降到 4 秒，Query Profile 显示一部分扫描来自 Warehouse Cache。此时可以认为本地缓存对这个工作负载有帮助。

如果 Warehouse 每五分钟就有一次相同看板查询，延长 Auto Suspend 可能减少反复冷启动；但如果每 30 分钟才运行一次，设置 10 分钟 Auto Suspend 会让 Warehouse 空转 20 分钟后仍然丢掉缓存。此时节省的计算费用可能更重要。最终需要用真实查询周期和 Credits 计算，而不是简单设定一个更长的 Suspend 时间。

## 常见误区

- **把结果缓存和 Warehouse Cache 当成同一种缓存。** 一个返回完整查询结果，一个缓存表数据供后续查询扫描。
- **把 cache_scan_ratio 当作结果缓存命中率。** 它描述扫描数据来自 Warehouse Cache 的比例，不描述完整结果是否被复用。
- **认为 SQL 文本相同就一定命中结果缓存。** 数据变化、函数、角色权限、配置和微分区变化都会影响复用。
- **认为 Suspend 只影响费用，不影响查询延迟。** Suspend 会清除本地表数据缓存，Resume 后需要重新构建。
- **为了缓存命中而无限延长 Auto Suspend。** 空闲 Warehouse 仍消耗 Credits，必须按查询频率和业务时延权衡。
- **把单条查询的热缓存成绩当作整个工作负载基线。** 需要覆盖查询类型、并发、数据更新和冷启动。

## 完成标准

- [ ] 能说明 Persisted Query Result Cache 与 Warehouse Cache 保存的对象不同。
- [ ] 能列出影响结果缓存复用的主要条件。
- [ ] 能解释 USE_CACHED_RESULT 参数只影响结果复用。
- [ ] 能通过 Query History 和 Query Profile 判断本地缓存扫描情况。
- [ ] 能说明 Suspend/Resume 对 Warehouse Cache 的影响。
- [ ] 能将延迟收益与 Warehouse 空闲 Credits 一起纳入 Auto Suspend 决策。

## 自测

1. 同一查询第一次运行 18 秒，第二次运行 0.3 秒。应该先检查哪类缓存？为什么不能直接判断 Warehouse Cache 命中？
2. 设置 USE_CACHED_RESULT = FALSE 后，Warehouse Cache 是否仍可使用？如何验证？
3. 查询使用了 RANDOM()，为什么即使 SQL 文本完全相同，也不能依赖结果缓存复用？
4. Warehouse Suspend/Resume 后，Persisted Query Result Cache 和 Warehouse Cache 分别会怎样？
5. 一个 Warehouse 每 30 分钟运行一次查询，Auto Suspend 设置 10 分钟。保留缓存与节省 Credits 的取舍是什么？

## 参考资料

- [Using Persisted Query Results](https://docs.snowflake.com/en/user-guide/querying-persisted-results)
- [Optimizing the warehouse cache](https://docs.snowflake.com/en/user-guide/performance-query-warehouse-cache)
- [Warehouse considerations](https://docs.snowflake.com/en/user-guide/warehouses-considerations)
