# CoCo 生成 SQL 的审查

## 本节要解决的问题

检查 CoCo 生成或修改的 SQL 是否符合业务语义、权限要求和执行成本约束。代码能编译、查询能返回行数或运行更快，都不足以证明修改正确；审查必须同时覆盖访问对象、过滤条件、Join 粒度、写入副作用和结果等价性。

## 核心知识

### 先审查 SQL 读取和写入了什么对象

对生成的 SQL，先确认 Database、Schema、Table、View、Stage、Warehouse 和当前 Role 是否符合目标环境。检查是否误用同名对象、临时表、非生产 Schema 或开发 Warehouse。对于 UPDATE、DELETE、MERGE、CREATE OR REPLACE 和 COPY INTO，必须明确影响范围及可逆性。

CoCo 在 Snowflake 中执行 SQL 时使用当前活动 Role 的权限；这不代表开发者可以免于审查。若 Role 过宽，Agent 也可能执行本来不应执行的操作。生产写入应采用最小权限、独立审批和确定性数据验证。

### 检查过滤、Join 粒度和 NULL 语义

WHERE 条件、时间窗口、状态筛选和 NULL 处理经常导致静默漏数或多算。Join 前要确认两侧键的唯一性和关系基数；一对多或多对多会改变输出行数。LEFT JOIN 的右表条件若放到 WHERE，可能丢掉未匹配行。

聚合前应写出结果粒度。不能仅用 DISTINCT 消除重复行，因为它可能隐藏错误 Join，也可能删除真实业务记录。财务指标还要检查币种、时区、退款和取消等口径。

### Query Profile 用于验证性能假设，不替代结果审查

CoCo 可以帮助解释 Query Profile、提出过滤和 Join 优化建议。审查时要比较扫描字节、微分区数量、Join 输入/输出行数、聚合、spill 和排队时间。若查询变快但结果集不同，需要先判断是否改变了过滤或 Join 语义。

在可比数据、参数、Warehouse 和缓存条件下执行前后 SQL，比较 p50/p95、扫描量、结果行数、业务汇总和 credits。不要只用单次最短耗时判断优化效果。

## 工程实施步骤

1. 让 CoCo 给出 SQL Diff 和修改目标，明确它是否改变对象、权限、数据写入或部署资源。
2. 对每条 SQL 列出读取/写入对象、执行 Role、Warehouse 和 Database/Schema 上下文。
3. 对 SELECT 检查投影、过滤、日期边界、NULL 语义和聚合粒度。
4. 对 JOIN 检查主键唯一性、外键基数、重复和未匹配行；逐步比较 Join 前后行数。
5. 对 UPDATE/DELETE/MERGE/COPY 等写入操作，先在测试数据或事务/隔离环境验证影响行数与重复执行行为。
6. 检查 SQL 是否隐含全表扫描、笛卡尔连接、无界窗口、SELECT * 或过大的中间结果。
7. 打开 Query Profile，核实扫描、Join、Aggregate、Sort、spill 和排队等性能证据。
8. 运行旧版和新版 SQL，固定时间范围、参数、数据版本、Warehouse 和缓存条件，核对结果集与关键业务汇总。
9. 将通过审查的 SQL Diff、测试记录、Query ID 和业务 owner 确认纳入 Git PR。
10. 对生产变更保留回滚/补偿脚本；CoCo 的代码提交不等于数据库部署成功。

## 场景分析

CoCo 将一个多表报表查询从 90 秒优化到 25 秒，但结果金额下降 12%。开发者怀疑是缓存或统计误差。

审查 Diff 后发现 CoCo 将 LEFT JOIN 的右表状态条件从 ON 移到了 WHERE，并把订单头表连接到明细表后直接汇总。前者会丢掉没有匹配明细的订单，后者会重复累计订单头金额。性能虽然提升，但业务语义已经改变。

修复时先恢复预期外连接语义，再将订单头和订单明细分别聚合到共同粒度后关联。验收要核对未匹配订单数、订单金额、明细金额、退款和关键维度，并在可比环境重新测量 Query Profile。

## 常见误区

- **SQL 能执行就通过审查。** 语法正确并不证明业务结果正确。
- **把更快等同于更好。** 必须验证结果等价、扫描量和成本。
- **让 DISTINCT 修复 JOIN 重复。** 应先找出基数和业务粒度问题。
- **只看当前 Role 是否有权限。** 还要判断该操作是否应允许，最小权限并不等于业务授权。
- **忽略 DDL 和 DML 副作用。** CREATE OR REPLACE、DELETE、MERGE 和 COPY 可能改变持久化数据或对象。
- **只审查最终 SQL，不保存 Diff 和测试证据。** 后续无法复盘 AI 建议改变了什么。

## 完成标准

- [ ] 能审查 SQL 的对象、Role、Warehouse 和环境上下文。
- [ ] 能检查 WHERE、JOIN、NULL 和 GROUP BY 的语义。
- [ ] 能识别写入 SQL 的影响范围与幂等风险。
- [ ] 能使用 Query Profile 验证性能假设。
- [ ] 能通过结果对账和 Git Diff 验收 AI 生成的变更。

## 自测

1. CoCo 将 LEFT JOIN 的右表条件移动到 WHERE，为什么可能改变结果？
2. 查询速度提升，但收入总额下降，应该先检查哪些 SQL 语义？
3. 为什么不能通过 SELECT DISTINCT 直接掩盖多对多 Join？
4. CoCo 使用当前活动 Role 执行 SQL，是否意味着生产写入自动获得批准？
5. 优化前后要固定哪些环境和数据条件，才能合理比较性能？

## 参考资料

- [Overview of Snowflake CoCo](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code)
- [CoCo mode in Snowsight](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-snowsight/coco-mode)
- [Working with joins](https://docs.snowflake.com/en/user-guide/querying-joins)
- [Query Profile and performance](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
- [Overview of Access Control](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
