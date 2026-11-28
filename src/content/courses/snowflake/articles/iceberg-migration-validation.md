# Iceberg Catalog 转换：双读验收与回退窗口

## 先区分迁移的是数据，还是 Catalog 所有权

有一张由 AWS Glue 管理的 Iceberg 表，Snowflake 已经可以读取。团队希望让 Snowflake 成为 Catalog，并在 Snowflake 中执行写入。有人建议把所有 Parquet 文件重新导入一张新表；另一个方案是直接转换现有 Iceberg 表。

两者不是一回事。Snowflake 的 Convert to Managed 操作改变 Catalog 和生命周期管理责任，不会在转换时重写所有 Parquet 数据文件。转换前，外部 Catalog 管理表元数据；转换后，Snowflake 成为 Iceberg Catalog，并接管表文件与元数据的生命周期。迁移评审必须把“数据是否一致”和“谁负责管理这些文件”分开验收。

## 转换前要检查的不是只有行数

先确认当前 Iceberg 表类型、Catalog、外部 Volume、metadata 文件路径和格式版本。接着盘点所有还会读写这张表的引擎：Spark、Flink、Trino 或其他客户端是否仍在运行自动维护、Compaction 或 DML。

转换前至少完成以下检查：

- 最新 Snapshot 已由外部引擎提交，Snowflake 执行过 REFRESH，读取到的是预期 metadata。
- Snowflake 对 External Volume 具有写入能力，且 ALLOW_WRITES = TRUE。
- 没有仍在向同一存储位置提交的外部写入任务。转换不会自动阻止其他引擎继续写对象存储。
- 若表使用 position-delete files，先确认是否需要执行 OPTIMIZE (REMOVE_POSITION_DELETES)。
- 分区、Schema、类型范围、删除文件和 Snapshot 保留策略已做差异检查。
- 需要供其他引擎继续使用的旧文件，已复制到不会被 Snowflake 生命周期规则删除的位置。

特别注意最后一项：转换之后，Snowflake 管理的 Snapshot retention 和 cleanup 规则也会管理转换前的文件。Snapshot 过期可能删除旧 metadata 和不再引用的数据文件；DROP 转换后的表也可能删除转换前写入的文件。不能把原 Catalog 仍然存在，当作旧文件一定安全的证明。

## 先建立基线，再比较两个读取路径

迁移验收不应只比较总行数。至少选定一段固定业务时间窗口，保存源表的 Schema、分区定义、行数、主键重复数、NULL 分布、关键指标聚合和抽样明细。对于 CDC 或频繁更新的表，还需要记录基线 Snapshot ID 和抽样时点。

示例核对：

~~~sql
SELECT
  COUNT(*) AS row_count,
  COUNT(DISTINCT ORDER_ID) AS distinct_orders,
  SUM(AMOUNT) AS total_amount,
  MIN(ORDER_TS) AS min_order_ts,
  MAX(ORDER_TS) AS max_order_ts
FROM ANALYTICS.ORDERS;
~~~

相同的 SQL 应在转换前后使用同一业务窗口和同一时点条件执行。若数据持续写入，双读结果不同并不自动说明迁移失败：两边可能读取了不同 Snapshot。验收数据必须绑定到 Snapshot 或冻结的时间边界，且要单独测试 DELETE、UPDATE 和迟到数据。

## 转换动作及其不可忽略的影响

完成外部 Catalog 刷新和权限准备后，转换命令会把表切换到 Snowflake Catalog：

~~~sql
ALTER ICEBERG TABLE ANALYTICS.ORDERS
  CONVERT TO MANAGED
  BASE_LOCATION = 'managed/analytics/orders';
~~~

BASE_LOCATION 是 External Volume 内的相对路径。实际命令还应根据是否保留源 Catalog 项、目标位置和对象定义确认选项。转换前核实 Snowflake 能访问并写入外部 Volume；转换成功后，不代表外部引擎会自动知道写入权已经改变。

转换还会移除原 Iceberg 分区定义。若其他引擎依赖特定分区布局或仍需独立维护文件，必须先评估兼容影响。切换后由单一 Catalog 协调元数据提交；若保留多个写入者而没有明确协调策略，可能发生表状态分叉或数据损坏。

## 回退不是一句 UNDO

最安全的回退窗口通常是在转换前保留旧 Catalog 的只读快照或独立副本，并冻结外部写入。转换后若 Snowflake 已经写入新 Snapshot，简单地重新启用旧 Catalog 并不能自动带回这些变更。

回退前要明确哪一边是权威数据源、转换后新增的数据如何回灌、文件是否仍在保留期内，以及恢复旧 Catalog 会不会让两个 Catalog 同时认为自己拥有写权限。若没有可重放的变更日志或业务键对账，回退应暂停写入并由数据 owner 决定恢复点，而不是直接切回连接字符串。

## 迁移验收应覆盖这几种失败

- 转换前 Snowflake 读取的是旧 metadata：检查 Catalog 刷新与 Snapshot ID。
- 转换后旧引擎还在写：停止旧写入者，核对最新 Snapshot 和文件引用。
- 关键聚合不同：先固定 Snapshot，再区分真实数据差异、时区、类型映射和删除语义。
- 需要回退但旧文件已被清理：只能从独立备份或保留副本恢复，不能要求 Catalog 自动复活已经删除的文件。

## 评审结论

迁移完成的标志不是 ALTER 命令返回成功，而是 Catalog 所有权唯一、读取路径一致、关键指标对账通过、旧写入者退出、文件保留责任明确，并且回退窗口经过实际演练。若仍有跨引擎写入或文件生命周期不清楚，应继续保持只读影子验证，不要提前开放生产写入。

## 自测

1. 转换前和转换后各自读取到不同 Snapshot 时，为什么不能直接把行数差异判为数据丢失？
2. Snowflake 成为 Iceberg Catalog 后，为什么旧的 Glue/Flink 写入者必须退出或切换？
3. 转换后 Snowflake 已提交新 Snapshot，为什么不能简单恢复旧 Catalog 指针就完成回滚？
4. 如果还需要让其他引擎读取旧文件，转换前必须明确哪项文件生命周期责任？

## 参考资料

- [Convert an Iceberg table to use Snowflake as the catalog](https://docs.snowflake.com/en/user-guide/tables-iceberg-conversion)
- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
- [Automatically refresh Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-auto-refresh)
