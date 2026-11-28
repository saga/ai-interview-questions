# PostgreSQL 连接管理与 PgBouncer

## 本节要解决的问题

在应用并发、PostgreSQL 连接进程成本和会话状态之间找到平衡。增加连接数不等于增加吞吐：每个服务端连接都有内存、进程调度和锁管理成本；当应用有大量短请求时，连接池可以复用有限的数据库连接，但不同池化模式会改变 Session 语义。

## 核心知识

### PostgreSQL 连接是服务端 Backend，不是无成本的 Socket

传统 PostgreSQL 架构通常为客户端连接建立服务端 Backend 进程。大量空闲连接也会占用进程和内存，增加调度与资源管理负担。max_connections 限制并发连接数，调整它需要评估 shared memory、每连接资源和实际工作负载；不能用无限提高 max_connections 代替连接池。

应用侧连接池可以复用客户端与数据库连接，并控制最大并发和等待队列。它适合长生命周期服务，不应为每个 HTTP 请求临时建立和关闭数据库连接。

### PgBouncer 有 Session、Transaction 和 Statement 三种模式

PgBouncer 接受应用连接，并从服务器连接池分配 PostgreSQL Backend。三个模式对连接复用时点不同：

- **Session pooling**：客户端断开时才释放服务端连接；兼容绝大多数 Session 功能，连接复用效率相对低。
- **Transaction pooling**：事务结束后释放服务端连接，其他客户端可继续使用；适合短事务高并发，但跨事务 Session 状态不保证保留。
- **Statement pooling**：每条语句完成后释放服务端连接，不允许跨多条语句的事务；适用范围最窄。

Transaction pooling 下，应用不能假定同一客户端下一笔事务仍使用相同 Backend。SET SESSION、临时表、LISTEN、会话级 Advisory Lock、未受支持的 Server-side Prepared Statements 等功能可能失效或需要额外配置。PgBouncer 1.21+ 可在 Transaction pooling 中跟踪部分 prepared statements，但需启用 max_prepared_statements 并按驱动版本验证。

### 连接池配置同时影响容量、等待和故障传播

应用连接池的 max connections 与 PgBouncer 的 max_client_conn、default_pool_size、reserve_pool_size、pool_mode 和数据库/用户池配置共同决定并发。连接池应控制服务端连接总量，并保留管理员和运维连接余量。

池化会引入等待队列。如果 PostgreSQL 查询变慢，池中连接被长事务占用，应用端也会出现排队。要同时观察 PgBouncer 的 cl_waiting、sv_active、sv_idle、maxwait 和 PostgreSQL 的 pg_stat_activity；仅看客户端连接数无法定位瓶颈。

## 工程实施步骤

1. 测量应用峰值请求并发、每请求事务数、SQL 平均/尾延迟和实际数据库并发，建立连接需求基线。
2. 在应用侧使用有上限的连接池，明确 acquire timeout、idle timeout、max lifetime 和连接失效检测。
3. 按 Session 状态需求选择 PgBouncer 模式：需要临时表、LISTEN 或跨事务会话状态时优先 Session；普通短事务评估 Transaction。
4. Transaction pooling 下，避免依赖事务外的 SET、临时表、Session Advisory Lock 和会话级状态；将必须的参数设置放入事务内，或使用受支持的连接参数。
5. 若使用 Prepared Statements，确认 PgBouncer 版本和 max_prepared_statements；驱动侧也要验证 prepareThreshold 等设置。
6. 配置 max_client_conn、pool_size 和 reserve_pool，结合 PostgreSQL max_connections 预留管理连接，不把所有容量用尽。
7. 设置连接池等待超时，避免应用请求无限等待；对超时返回可观测错误并按幂等策略处理。
8. 监控 PgBouncer SHOW POOLS、SHOW STATS 与 PostgreSQL pg_stat_activity，区分客户端等待、服务器连接饱和和 SQL 执行慢。
9. 压测连接突增、事务长时间运行、数据库主备切换、PgBouncer 重启和连接失效，验证客户端重连与事务结果判断。
10. 将连接池配置、数据库连接限制和应用部署规模纳入容量管理，避免多个服务各自将连接数配置到最大值后总和超过数据库承载能力。

## 场景分析

API 服务有数百个实例，每个实例配置 20 个数据库连接，导致 PostgreSQL 同时出现数千个 Backend。多数请求 SQL 很短，但实例扩容时连接激增，数据库 CPU 和内存开销显著上升。

可在应用前引入 PgBouncer，并将服务端连接池总量设为经过压测验证的有限值。若应用只执行短事务且没有跨事务 Session 状态，可评估 Transaction pooling；若 ORM 依赖临时表、Session 参数或 prepared statements，先验证兼容性再切换。应用连接池仍应保留合理上限，避免对 PgBouncer 形成无限连接洪峰。

验收同时测量吞吐、p95/p99、客户端等待、服务器连接数、事务时长和故障切换恢复；单看 Backend 数下降不能证明系统性能改善。

## 常见误区

- **增加 max_connections 就能增加吞吐。** Backend 数量增加可能加重内存和调度开销。
- **所有应用都适合 Transaction pooling。** 会话状态、临时表、LISTEN 和某些 Prepared Statement 使用方式可能不兼容。
- **PgBouncer 连接池越大越好。** 过大连接池仍会让 PostgreSQL 过载。
- **应用侧池和 PgBouncer 池可以各自无限扩容。** 两层最大连接总和必须按数据库承载能力设计。
- **池中排队就是 PostgreSQL 慢。** 还要区分服务端连接不足、池等待和 SQL 执行瓶颈。
- **Transaction pooling 自动重置所有 Session 状态。** 正确方案是避免依赖跨事务 Session 状态，而不是假设所有状态能被安全保留。

## 完成标准

- [ ] 能解释 PostgreSQL Backend 连接成本和 max_connections 的作用。
- [ ] 能区分 PgBouncer 的 Session、Transaction 和 Statement pooling。
- [ ] 能识别 Transaction pooling 对 Session 状态和 Prepared Statement 的影响。
- [ ] 能结合应用池、PgBouncer 和 PostgreSQL 连接限制计算容量。
- [ ] 能使用 PgBouncer 与 PostgreSQL 指标定位连接排队。

## 自测

1. 一个应用在每笔事务之外执行 SET search_path，切换到 Transaction pooling 后为什么可能出现不一致？
2. 什么情况下 Session pooling 比 Transaction pooling 更合适？
3. PgBouncer 的客户端连接很多但 PostgreSQL Backend 数量稳定，是否一定代表没有排队？应该看哪些指标？
4. 应用连接池和 PgBouncer 都配置最大连接数时，应该怎样计算最终服务端连接上限？
5. Prepared Statements 在 Transaction pooling 下需要核对哪些版本和配置？

## 参考资料

- [PostgreSQL Connection Settings](https://www.postgresql.org/docs/current/runtime-config-connection.html)
- [PgBouncer Configuration](https://www.pgbouncer.org/config)
- [PgBouncer FAQ](https://www.pgbouncer.org/faq)
- [Monitoring Database Activity](https://www.postgresql.org/docs/current/monitoring-stats.html)
