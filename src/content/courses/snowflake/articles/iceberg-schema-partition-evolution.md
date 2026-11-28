# Iceberg Schema 与 Partition Evolution 安全迁移

## 本节要解决的问题

在数据持续写入时调整 Iceberg Schema 或 Partition Spec，并确保旧数据仍可被正确解释。Schema 演进与数据重写不是一回事；增加列通常不需要立刻重写所有旧文件，而分区规范变更也不能直接等同于传统 Hive 目录结构迁移。

## 核心知识

### Iceberg 使用稳定 Field ID 维护列身份

Iceberg Schema 中的列有 Field ID。引擎通过 Field ID 识别字段，而不只依赖列名或列顺序。因此增加列、重命名列和调整字段顺序可以作为元数据演进处理；读取旧数据文件时，缺少新列的文件会按 Schema 规则表现为 null。

删除列或改变类型仍需谨慎。旧列数据可能继续保留在历史文件与 Snapshot 中；重命名应该保留 Field ID，而不是通过删除旧列并新建同名列来模拟。类型提升范围由 Iceberg 规范和具体引擎支持决定，不能把任意类型转换都当作安全演进。

### Partition Evolution 允许新旧分区规范共存

Iceberg 的 Partition Spec 记录分区字段和变换表达式，例如 days(event_time)、bucket(customer_id) 或 truncate(order_code)。变更 Partition Spec 后，新写入数据采用新规范，旧文件保留原 Partition Spec；引擎读取时能够同时处理不同规范下的文件。

这意味着分区演进通常不要求立刻重写全部历史数据，也不应要求所有旧文件一次性搬进新目录。分区变更的收益在于未来写入和查询逐步使用新布局，但如果旧数据占绝大多数，查询仍需评估两种布局共同工作的效果。

### Snowflake 端能力必须按 Catalog 和写入模式核对

Iceberg 规范支持 Schema 和 Partition Evolution，但 Snowflake 对不同 Iceberg 管理模式暴露的 DDL 与演进能力可能不同。Snowflake-managed 表和 external catalog 表的元数据写入权不同；外部表的 Schema/Partition 更新通常由外部 Catalog 的写入引擎提交，再由 Snowflake refresh 识别。

不要依据通用 Iceberg 规范推断所有 Snowflake DDL 均可执行。变更前核对当前支持文档、Catalog 模式、引擎版本和写入功能；对暂不支持的操作，使用外部 Iceberg 引擎维护，或建立新表迁移路径。

## 工程实施步骤

1. 记录现有 Schema ID、Field ID、Partition Spec ID、当前 Snapshot 和主要消费引擎。
2. 对每项变更标记为 Add、Rename、Drop、Type Promotion 或 Partition Spec Update，并判断是否需要数据重写。
3. 优先在测试表验证各引擎如何读取旧文件、新文件及混合 Snapshot，尤其检查新增列的 NULL 语义和重命名结果。
4. 对 Partition Spec 变更比较旧分区和新分区的查询条件、数据分布、文件大小及裁剪效果。
5. 选择一个写入引擎负责提交演进后的 metadata，避免多个引擎同时修改同一表定义。
6. 在兼容窗口内让消费者同时支持新旧 Schema；先增加字段，再更新消费逻辑，最后在所有消费者迁移后考虑移除旧字段。
7. 对不能安全原地升级的变更，创建新表或新 Snapshot 路径，进行双读、数据对账和切换。
8. 检查外部 Catalog 的当前 metadata location，并在变更提交后执行 Snowflake metadata refresh。
9. 保留回滚窗口和旧 Snapshot，直到消费者通过验收；确认不再需要历史列和旧分区后再清理文件。

## 场景分析

订单表按 event_time 的月分区存储，随着查询模式变化，团队希望改为按 days(event_time) 加 bucket(customer_id)。如果直接重写整个对象存储目录，迁移成本和故障风险都很高。

Iceberg Partition Evolution 允许新写入文件使用新 Partition Spec，而旧文件仍保留旧规范。可以先切换写入，再观察查询能否同时裁剪新旧布局；若历史大文件仍导致查询慢，再分批重写旧数据。与此同时新增字段时应保持 Field ID 语义，验证 Spark 与 Snowflake 对旧文件缺失值的解释一致。

验收要覆盖新旧 Snapshot、分区过滤、Schema 重命名、下游 BI 字段兼容、外部引擎刷新和回滚路径。

## 常见误区

- 把 Schema 演进当成普通按名称更新列。Iceberg 使用 Field ID，重命名必须保留字段身份。
- 增加字段后立刻要求重写所有旧文件。旧文件可依据 Schema 解释缺失列，是否重写应由性能和数据质量需求决定。
- 把 Partition Evolution 当成传统目录重命名。旧文件和新文件可属于不同 Partition Spec。
- 认为所有引擎都立即支持相同的类型提升与 DDL。规范能力和实现支持需要分开验证。
- 一次变更多个字段和分区策略且不做双读。很难定位兼容性错误来源。
- 外部 Catalog Schema 已变化但 Snowflake 未 refresh。两个引擎可能看到不同的表定义。

## 完成标准

- [ ] 能解释 Field ID 与列名的关系。
- [ ] 能区分 Schema Evolution 与数据文件重写。
- [ ] 能解释新旧 Partition Spec 在同一表中的共存。
- [ ] 能按 Snowflake-managed/external 模式确认演进操作责任。
- [ ] 能设计双读、对账、切换和回滚窗口。

## 自测

1. Schema 中新增列后，为什么旧 Parquet 文件不一定需要立即重写？
2. Iceberg 重命名列时保留 Field ID 有什么意义？
3. Partition Spec 更新后，为什么旧分区文件不需要立即全部重写？
4. 外部引擎完成 Schema 提交后，Snowflake 查询仍看不到新字段，应检查什么？
5. 哪类变更应先考虑创建新表并双读，而不是直接修改生产表？

## 参考资料

- [Apache Iceberg specification: schema evolution](https://iceberg.apache.org/spec/#schema-evolution)
- [Apache Iceberg specification: partition evolution](https://iceberg.apache.org/spec/#partition-evolution)
- [Create Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-create)
- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
