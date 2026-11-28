# Snowflake Edition 与功能可用性

## 本节要解决的问题

平台团队准备给一个 Standard Edition 账户增加 Search Optimization 和 Materialized View。开发人员已经写好 SQL，执行 CREATE 时却发现功能不可用。与此同时，另一个团队要求启用多集群 Warehouse、延长 Time Travel 保留期和配置跨区域 Failover，认为只要拥有 ACCOUNTADMIN 就可以打开全部功能。

Snowflake Edition 不只是一个价格标签。不同 Edition 提供的功能集合、数据保护等级和支持能力不同。角色权限解决“谁可以做”，Edition 解决“账户具备哪些产品能力”；两者不是同一层控制。

## 核心知识

### Edition 是逐级扩展的服务能力集合

当前 Snowflake 主要有四个 Edition：

| Edition | 适用定位 | 相对前一层增加的重点 |
|---|---|---|
| Standard | 基础数据仓库和 SQL 工作负载 | 标准数据处理、基础安全和管理能力 |
| Enterprise | 大型企业工作负载 | 更多性能优化、扩展治理和高级数据保护能力 |
| Business Critical | 高敏感数据与严格合规要求 | 增强安全与数据保护，以及账户级 Failover/Failback |
| Virtual Private Snowflake（VPS） | 需要更高隔离级别的组织 | Business Critical 能力，加上独立隔离的 Snowflake 环境 |

Business Critical 面向更严格的数据保护需求；VPS 则不仅是多一些功能，而是提供与其他 Snowflake 账户隔离的专用环境。是否需要这类能力，应该来自合规、网络隔离、数据敏感级别和灾难恢复要求，而不是仅凭“更高级”来选择。

### 有些功能从 Standard 开始提供，有些需要 Enterprise 或更高

下表列出几个经常影响架构选型的功能：

| 功能 | Standard | Enterprise | Business Critical | VPS |
|---|:---:|:---:|:---:|:---:|
| Automatic Clustering | ✓ | ✓ | ✓ | ✓ |
| Multi-cluster Warehouse | — | ✓ | ✓ | ✓ |
| Extended Time Travel（最长 90 天） | — | ✓ | ✓ | ✓ |
| Row Access Policy / Masking Policy | — | ✓ | ✓ | ✓ |
| ACCESS_HISTORY 审计视图 | — | ✓ | ✓ | ✓ |
| Query Acceleration | — | ✓ | ✓ | ✓ |
| Search Optimization | — | ✓ | ✓ | ✓ |
| Materialized View | — | ✓ | ✓ | ✓ |
| Snowpipe / Snowpipe Streaming | ✓ | ✓ | ✓ | ✓ |
| Feature Store / Model Registry | ✓ | ✓ | ✓ | ✓ |
| Account Failover / Failback | — | — | ✓ | ✓ |

这张表是选型时的关键检查项，不是完整功能清单。实际功能还可能受云区域、特性发布状态、账户配置和产品限制影响；对外发布架构前，应再次查看官方 Editions 页面和具体功能文档。

### Edition 不能替代角色授权和对象权限

例如，某账户已经是 Enterprise Edition，但数据分析师仍然需要相应的 Database、Schema 和 Table 权限。Edition 具备 Search Optimization，不代表普通角色就有权创建或管理它；反过来，即使用户是 ACCOUNTADMIN，也不能在 Standard Edition 上通过更高权限启用仅 Enterprise 提供的功能。

排查功能不可用时，应按顺序确认：

1. 当前账户的 Edition。
2. 该功能是否在该 Edition 中提供，以及是否受区域/发布状态限制。
3. 当前角色是否具备该对象和功能所需的权限。
4. 功能对象的配置是否满足产品限制。
5. 错误是 Edition 不支持、权限不足，还是 SQL/对象定义本身不符合要求。

不要把所有失败都归因于“权限不够”或“版本太低”。

### 查询账户实际 Edition，再核对具体功能文档

可以从 Snowsight 的账户信息页面查看当前 Edition；有相应 Organization Usage 权限时，也可以查询账户视图：

~~~sql
SELECT
  account_name,
  edition
FROM SNOWFLAKE.ORGANIZATION_USAGE.ACCOUNTS
WHERE account_name = CURRENT_ACCOUNT();
~~~

这个查询依赖对 ORGANIZATION_USAGE 的访问权限。没有权限时，可以由组织管理员通过 Snowsight 或账户管理渠道确认，不能把查询失败误当成 Edition 信息不存在。

## 工程实施步骤

1. 把项目需求拆成明确功能，例如 Extended Time Travel、Row Access Policy、Search Optimization、QAS、Failover，而不是只写“需要高级版”。
2. 查询账户实际 Edition，确认测试、开发和生产环境是否一致。
3. 逐项核对 Edition 矩阵和功能文档，记录是否需要 Enterprise、Business Critical 或 VPS。
4. 将 Edition 条件与对象权限分开检查：账户具备功能后，再确认角色是否有创建、使用和管理权限。
5. 对性能优化功能估算维护和计算成本；对数据保护功能核对实际保留期、网络和恢复要求。
6. 对 Business Critical / VPS 需求，明确监管要求、Private Connectivity、Failover/Failback 和数据隔离目标。
7. 在目标 Edition 的非生产账户上完成 DDL、角色授权和运行验证，再决定生产升级或功能部署。
8. Edition 变化前重新评估单位 Credit 和存储价格，避免只比较功能而忽略计费影响。

## 场景分析

团队准备将 Standard Edition 的订单平台升级为 Enterprise，原因有三个：需要 90 天 Time Travel、使用 Row Access Policy、为客服订单查询启用 Search Optimization。

这三个需求都能映射到具体的 Edition 能力。升级前应确认：
- 90 天恢复窗口确实是业务要求，而非只想“多保留一些”；
- Row Access Policy 的行过滤逻辑和角色测试已经设计；
- Search Optimization 的查询谓词具有足够选择性，且预计节省的延迟高于维护成本。

升级后还要分别授予策略和优化功能所需权限，并测试目标查询。若只是升级 Edition，却没有设置 90 天保留期、策略绑定和 Search Optimization 配置，系统不会自动获得这些业务效果。

## 常见误区

- **把 Edition 当作用户角色。** Edition 定义账户功能范围，角色决定用户能否执行某项操作。
- **认为 Enterprise、Business Critical 和 VPS 只是价格不同。** 它们在数据保护、连接隔离和灾难恢复能力上有差异。
- **认为 Standard 不支持所有高级功能。** Automatic Clustering、Snowpipe、Feature Store 和 Model Registry 等能力在多个 Edition 中都可用，应查具体矩阵。
- **认为 ACCOUNTADMIN 可以绕过 Edition 限制。** 高权限角色不能把账户不具备的产品能力变出来。
- **只看 Edition 名称，不看具体功能条件。** 某些特性还受区域、发布状态、配置和使用限制影响。
- **升级后假设功能已经自动配置。** Edition 提供能力，仍要完成对象 DDL、策略绑定、权限和运行验证。

## 完成标准

- [ ] 能说明 Standard、Enterprise、Business Critical 和 VPS 的定位差异。
- [ ] 能从 Editions 矩阵确认目标功能所需的 Edition。
- [ ] 能区分 Edition 可用性与 Role/Object Privilege。
- [ ] 能通过 Snowsight 或 Organization Usage 查询账户 Edition。
- [ ] 能在升级前评估功能收益、维护成本和计费影响。

## 自测

1. Standard 账户的用户拥有 ACCOUNTADMIN，创建 Materialized View 仍提示 Edition 不支持。提高角色权限能解决吗？为什么？
2. Automatic Clustering、Search Optimization 和 Materialized View 的 Edition 要求是否相同？应从哪里核对？
3. 公司要求 90 天 Time Travel 和 Row Access Policy。选择 Edition 时要确认哪些条件？
4. 企业对敏感数据和账户灾难恢复有额外要求。Business Critical 与 VPS 的关键差异是什么？
5. Edition 升级后，为什么仍要单独完成功能配置、角色授权和运行验收？

## 参考资料

- [Snowflake editions](https://docs.snowflake.com/en/user-guide/intro-editions)
- [Working with account editions](https://docs.snowflake.com/en/user-guide/organizations-manage-accounts-editions)
