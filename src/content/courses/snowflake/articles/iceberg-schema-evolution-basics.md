# Iceberg Schema 与分区演进基础

## 本节要解决的问题

在 Iceberg 表持续写入和多引擎读取时，安全调整字段和分区布局。Schema Evolution 改变表逻辑列结构；Partition Evolution 改变文件组织规则；两者都通过 Iceberg 元数据描述，不应误认为每次变更都要重写全部历史 Parquet 文件。

## 核心知识

### Field ID 让 Iceberg 按字段身份而非列名匹配数据

Iceberg Schema 为字段分配稳定 Field ID。列重命名或调整顺序时，保留 Field ID 可让查询引擎把旧文件中的数据对应到新字段。新增列后，早期文件没有该 Field ID，读取时按 Schema 规则呈现为 NULL；通常不需要立即重写全部旧文件。

删除列后，旧快照和旧文件可能仍保留原字段数据。重命名不应通过删除再创建同名列模拟，否则可能引入新的 Field ID，造成历史数据无法按预期解释。类型提升有明确范围，能否执行还取决于引擎版本和表格式版本。

### Partition Spec 描述分区转换，不等于目录路径契约

Iceberg Partition Spec 可以基于列执行 transform，例如 days(event_time)、months(event_time)、bucket(customer_id) 和 truncate(product_code)。分区字段及其 Transform 都属于表元数据。修改 Partition Spec 后，新写入文件使用新规范，旧文件仍保留旧规范；查询引擎可同时读取多个 Spec 下的文件。

因此分区演进通常不要求一次性将所有历史数据搬迁到新目录。新的分区方式主要影响未来写入和对应查询的裁剪；如果大部分历史文件仍在旧布局，性能收益需要通过实际扫描验证。

### 规范能力与 Snowflake/外部引擎支持能力要分开

Apache Iceberg 规范定义 Schema/Partition Evolution，但实际变更命令、类型提升、元数据提交和并发处理由具体引擎与 Catalog 实现。Snowflake-managed 表和 External Catalog 表的元数据写入责任不同；外部表的 Schema/Partition 更新通常由拥有 Catalog 写入权的外部引擎提交，再由 Snowflake Refresh 识别。

不能只因 Iceberg 规范支持某项操作，就推断 Snowflake 当前版本和所选 Catalog 都支持完全相同的 DDL。必须分别核对表管理模式、Catalog、Iceberg Format Version 和每个读写引擎的功能矩阵。

## 工程实施步骤

1. 保存当前 Schema ID、Field ID、Partition Spec ID、Snapshot ID、Catalog 和各读写引擎版本。
2. 对变更分类：新增字段、重命名、删除、类型提升、分区 Transform 更新，说明是否需要数据重写。
3. 在测试表验证新旧 Parquet 文件混合读取，确认新增字段的 NULL 行为和重命名字段的历史值。
4. 选择一个具有代表性的查询集，比较旧/新分区条件下扫描文件数、扫描字节和查询耗时。
5. 对 External Catalog 表由 Catalog 管理方指定写入引擎提交 Schema/Partition 更新，避免多个引擎同时修改元数据。
6. 先增加字段和兼容消费逻辑，再逐步迁移下游；消费者全部完成切换后，再考虑删除旧列。
7. 对不兼容的类型变化或引擎暂不支持的 DDL，评估新表迁移和双读方案，不要直接在生产表强行修改。
8. 更新外部 Catalog 后执行或等待 Snowflake Metadata Refresh，检查 Snowflake 与外部引擎看到的 Schema ID、Partition Spec 和 Snapshot。
9. 保留旧 Snapshot 和旧文件的回滚窗口；只有在保留策略允许且不再有消费者依赖时，才进行数据重写或清理。
10. 用真实数据执行跨引擎读取、写入、回滚和历史查询测试，记录操作限制与维护责任。

## 场景分析

订单 Iceberg 表原先按月份对 event_time 分区，现在高频查询集中在最近几天，团队希望改为按日期并按 customer_id 做 bucket。直接重写全部历史文件成本很高。

可以先更新 Partition Spec，让后续写入文件使用新布局，旧文件继续保留原 Spec。然后使用同一查询集测试新旧文件共同存在时的分区裁剪和查询性能。只有旧布局的查询成本仍然不满足目标时，再分批重写历史数据。

若还要新增 delivery_channel 字段，应保留其新 Field ID 并验证旧文件读取为 NULL；如果要把 status 重命名，检查所有读写引擎都能按 Field ID 识别新名字。上线前验证 Spark 与 Snowflake 对新旧 Snapshot 的 Schema 解释一致。

## 常见误区

- **按列名而不是 Field ID 理解 Iceberg Schema。** 字段身份由 Field ID 保持，重命名必须验证旧文件兼容。
- **增加列后强制重写全部旧文件。** 旧文件可以继续按新 Schema 读取，是否重写要基于成本和查询需求。
- **把 Partition Evolution 当传统目录重命名。** 新旧 Partition Spec 可以在同一张表中共存。
- **认为规范允许就意味着所有引擎都支持。** 实现版本、Catalog 和 DML 能力需要分别核对。
- **让多个引擎同时更新 Schema Metadata。** 应明确单一提交协调机制和 Catalog 写入责任。
- **只看 DDL 成功不测历史结果。** 需要验证旧文件、新文件、旧 Snapshot 和下游兼容。

## 完成标准

- [ ] 能解释 Iceberg Field ID 与列名的关系。
- [ ] 能区分 Schema Evolution 与文件重写。
- [ ] 能说明旧、新 Partition Spec 在同一张表中的共存方式。
- [ ] 能按 Snowflake-managed 与 External Catalog 模式确定演进责任。
- [ ] 能设计多引擎兼容测试、双读对账和回滚窗口。

## 自测

1. Iceberg Schema 新增一列后，为什么旧文件不一定需要马上重写？
2. 列重命名时保留 Field ID 有什么作用？
3. Partition Spec 更新后，为什么旧文件仍能按旧规范与新文件共同查询？
4. Snowflake 看到的 Schema 未随外部 Catalog 更新，应该检查哪个刷新步骤？
5. 为什么需要按具体引擎和 Catalog 核对功能矩阵，而不能只读 Iceberg 规范？

## 参考资料

- [Apache Iceberg specification: schema evolution](https://iceberg.apache.org/spec/#schema-evolution)
- [Apache Iceberg specification: partition evolution](https://iceberg.apache.org/spec/#partition-evolution)
- [Create Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-create)
- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
