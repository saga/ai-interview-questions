# Permanent、Temporary、Transient 与 Iceberg 表

## 本节要解决的问题

根据数据生命周期、恢复能力、存储费用和跨引擎访问需求选择 Snowflake 表类型。Permanent、Temporary、Transient 决定表的持久性及 Time Travel/Fail-safe 保护；Iceberg 则涉及开放表格式与外部 Catalog 的元数据责任，不能把它们视为同一组简单的存储选项。

## 核心知识

### Permanent 表适合需要完整恢复保护的长期数据

Permanent 是默认表类型，数据持续存在直到显式删除。Standard Edition 永久表的 Time Travel 保留期默认 1 天，支持设置为 0 或 1 天；Enterprise Edition 及更高版本可设置更长保留期，最长可达 90 天。Permanent 表还具有 7 天 Fail-safe，用于在 Time Travel 结束后由 Snowflake 支持恢复数据。

核心事实表、账务数据和不能轻易重新生成的数据通常应使用 Permanent。Time Travel 和 Fail-safe 是数据保护机制，不替代跨区域备份、业务审计历史和长期归档策略。

### Temporary 与 Transient 适合可重建的短期数据

Temporary 表只在创建它的 Session 存续期间存在。Session 结束即删除，适合中间计算、临时结果和交互分析。它可以有 0 或 1 天 Time Travel，但没有 Fail-safe。

Transient 表跨 Session 持久存在，直到显式删除；Time Travel 只能是 0 或 1 天，并且没有 Fail-safe。它适合可由源数据重建的 ETL 中间表、暂存表和短期处理结果。若系统故障导致 Transient 数据丢失，超出 Time Travel 窗口后 Snowflake 不会为其恢复。

### Iceberg 表采用开放表格式与 Catalog 元数据模型

Iceberg 表将数据文件与表快照/Manifest 元数据分离，通过 Catalog 管理当前元数据指针。Snowflake-managed Iceberg tables 与外部管理的 Iceberg tables 在元数据写入权、Catalog 责任和跨引擎互操作方式上不同。

选型时首先确定谁拥有提交和更新元数据的权力，再决定 Snowflake 与其他引擎是否能同时写入。开放格式并不自动保证多引擎并发写入安全；还必须明确 Catalog、提交冲突处理、文件维护、快照过期和访问权限责任。

## 工程实施步骤

1. 按数据对象登记生命周期：Session 临时结果、可重建的中间数据、长期业务数据或跨引擎数据产品。
2. 对每类数据明确 RPO、恢复窗口、是否可由源系统重建、是否有审计保留义务，再确定 Permanent/Temporary/Transient。
3. 检查实际 DATA_RETENTION_TIME_IN_DAYS、Edition 和对象类型，确认 Time Travel/Fail-safe 的有效窗口。
4. 选择 Iceberg 时，确认 Snowflake-managed 还是 externally managed；记录 Catalog、metadata owner、存储位置和允许写入的引擎。
5. 通过 SHOW/DESCRIBE 和表类型相关元数据确认对象实际类型与保留参数；不要只从 CREATE 脚本推断部署状态。
6. 对 Permanent 表演练 Time Travel 和误删恢复；对 Transient 表演练源数据重建；对 Temporary 表验证 Session 结束后的清理。
7. 对 Iceberg 表演练跨引擎读取、单写者提交、并发提交冲突和快照维护，确认文件清理不会删除仍被引用的数据。
8. 把存储成本与恢复成本一并比较，定期清理无主临时表和过期中间表。

## 场景分析

订单平台每天生成原始落地数据、批次去重中间表和长期订单事实表。落地数据可由源文件重放，中间表只为当日转换服务，订单事实表则承担财务对账。

原始文件和中间结果可以评估 Transient，临时调试结果可以使用 Temporary；财务订单事实表应使用 Permanent，以保留 Fail-safe 恢复保护。若另一个引擎也要读取订单湖仓数据，再单独评估 Iceberg，并先明确 Catalog 与元数据写入责任。不能仅因为 Iceberg 是开放格式，就让 Snowflake 和其他引擎无协调地同时写入。

验收时分别模拟 Session 结束、Transient 表误删、Permanent 表误删以及 Iceberg 跨引擎提交，检查可恢复范围、数据对账和存储成本。

## 常见误区

- **认为 Temporary 表只是名字带临时、但会长期保留。** 它随创建 Session 结束而删除。
- **认为 Transient 与 Permanent 仅有费用差异。** Transient 没有 Fail-safe，恢复能力与 Permanent 不同。
- **把 Time Travel 当作永久备份。** 它受 Edition、对象类型与保留窗口限制。
- **认为 Iceberg 自动解决所有跨引擎并发一致性。** Catalog、元数据提交权和写入协调仍需设计。
- **为了节省存储将核心事实表全部改为 Transient。** 需要比较重建耗时、故障损失和业务恢复目标。

## 完成标准

- [ ] 能比较 Permanent、Temporary、Transient 的生命周期与恢复能力。
- [ ] 能按数据是否可重建和恢复要求选择表类型。
- [ ] 能说明 Iceberg 数据文件、表元数据和 Catalog 的关系。
- [ ] 能明确 Iceberg 跨引擎场景的元数据写入责任。
- [ ] 能设计表类型对应的恢复演练和清理策略。

## 自测

1. 一个 ETL 中间表可在 30 分钟内从原始数据重建，使用 Transient 是否合理？还需要考虑什么？
2. Permanent 表设置 Time Travel 为 0 后，是否仍有 Fail-safe？Transient 表又有什么不同？
3. Snowflake 与 Spark 都要写同一 Iceberg 表，首先必须明确哪个协调边界？
4. Temporary 表的清理时点由什么决定？

## 参考资料

- [Working with Temporary and Transient Tables](https://docs.snowflake.com/en/user-guide/tables-temp-transient)
- [Understanding storage cost](https://docs.snowflake.com/en/user-guide/cost-understanding-data-storage)
- [Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg)
- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
