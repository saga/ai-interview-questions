# Snowflake 平台分层与计算存储分离

## 本节要解决的问题

理解 Snowflake 的存储、计算和 Cloud Services 各自负责什么，以及一条查询如何经过这些层次。重点不是记住三层名称，而是定位性能、权限、数据和平台协调问题时应该检查哪一层。

## 核心知识

### 存储层保存表数据，虚拟仓库负责执行计算

Snowflake 将表数据组织为微分区，并由平台管理其持久化、压缩、加密和元数据。用户通常通过表、视图等逻辑对象访问数据，不需要自行管理底层文件布局。

虚拟仓库（Virtual Warehouse）是一组独立的计算资源。它负责执行 SQL，也可承载 Snowpark 工作负载。不同仓库不共享计算资源：一个仓库的查询负载不会直接占用另一个仓库的计算容量；但它们可以读取同一份持久化数据。

因此，创建第二个仓库通常是为了隔离执行负载、控制资源或区分成本归属，不是为了复制一份表数据。

### Cloud Services 负责请求协调和平台级服务

Cloud Services 处理登录认证、访问控制、元数据、SQL 解析与优化、查询协调等工作。它与用户管理的虚拟仓库不是同一类资源。用户不能通过调大 Warehouse 来修复角色授权错误，也不能通过修改表的聚簇键来修复登录认证问题。

### 一条查询经过多个责任边界

1. 客户端建立会话，Snowflake 验证用户身份并确定活动角色及会话上下文。
2. Cloud Services 检查对象元数据与权限，解析 SQL、生成执行计划。
3. 查询需要计算时，由当前 Warehouse 执行计划；执行过程读取需要的微分区。
4. 平台返回结果，并记录查询信息，供后续诊断和成本分析。

实际执行会受到缓存、查询类型、服务层处理和权限检查等因素影响。不要将上述逻辑步骤理解成每条 SQL 都会完整触发同一套物理操作。

## 工程实施步骤

1. **先确认执行上下文。** 运行 \`SELECT CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_DATABASE(), CURRENT_SCHEMA();\`，确认请求使用的角色、仓库和对象解析上下文。
2. **检查对象而不是猜测底层文件。** 使用 \`SHOW TABLES\`、\`SHOW VIEWS\`、\`DESCRIBE TABLE\` 和对象定义确认逻辑对象及其结构。
3. **从 Query History 定位查询。** 记录 Query ID、执行时间、Warehouse、错误信息、排队时间和执行状态；不要只依据客户端感知的总耗时判断问题所在。
4. **检查执行层。** 对慢查询查看 Query Profile，区分排队、扫描、Join、聚合、写入和数据交换等阶段；同时检查 Warehouse Load History。
5. **检查服务层和访问层。** 对权限错误核对活动角色、角色继承、对象授权；对对象解析错误核对 Database/Schema 和完整对象名。
6. **按责任层采取措施。** 计算不足再评估仓库规模或并发；权限错误修复授权；数据扫描量过大再分析过滤条件和微分区裁剪。

## 场景分析

ETL 和 BI 团队同时使用一张订单表。ETL 查询在批量加载时变慢，BI 仪表板也出现查询排队。团队考虑为 BI 创建独立仓库。

首先确认两个团队是否确实使用同一个 Warehouse，以及 Query History 中是否存在排队。如果二者共用仓库，分离仓库可以减少计算资源竞争，但不会自动改变表数据或 SQL 的扫描量。若 BI 查询本身扫描过多微分区，还要单独分析过滤条件和 Query Profile。若用户收到权限错误，则应检查活动角色及对象授权，增加 Warehouse 容量没有帮助。

设计结论应分别写明：隔离的是哪类计算负载、预期消除什么竞争、如何验证排队时间变化，以及是否会增加常驻仓库和计算费用。

## 常见误区

- **把每个 Warehouse 当作一份数据副本。** Warehouse 是计算资源，多个 Warehouse 可以访问相同的持久化对象。
- **认为 Cloud Services 就是用户可调节的 Warehouse。** 认证、授权、元数据和 SQL 优化属于平台服务，不通过调整用户仓库规格直接管理。
- **把慢查询全部归因于计算资源不足。** 排队、扫描、Join、数据倾斜和 SQL 计划是不同问题，应通过 Query Profile 和 Warehouse Load 分开验证。
- **把当前 Schema 当成对象本身。** 会话上下文影响未限定名称的解析；跨环境脚本应优先使用明确的 Database.Schema.Object 名称。

## 完成标准

- [ ] 能说明存储、Warehouse 和 Cloud Services 的职责边界。
- [ ] 能解释为什么两个 Warehouse 可以访问同一份表数据，又不共享计算资源。
- [ ] 能从 Query History 和 Query Profile 区分排队、执行和扫描问题。
- [ ] 能根据权限错误、对象解析错误和查询性能问题选择不同排查路径。
- [ ] 能说明增加独立 Warehouse 的隔离收益及成本影响。

## 自测

1. 为 BI 新建 Warehouse 后，为什么不需要再复制一份订单表？什么情况下仍需要复制或物化数据？
2. 查询在执行前就因活动角色缺少权限而失败，应该检查哪个责任边界？增加 Warehouse 规格是否有用？
3. Query History 显示查询长时间排队，但执行阶段很短，应该优先检查什么？与 Query Profile 中扫描量过大有什么区别？

## 参考资料

- [Snowflake key concepts and architecture](https://docs.snowflake.com/en/user-guide/intro-key-concepts)
- [Overview of warehouses](https://docs.snowflake.com/en/user-guide/warehouses-overview)
- [USE 命令与当前会话上下文](https://docs.snowflake.com/en/sql-reference/sql/use)
