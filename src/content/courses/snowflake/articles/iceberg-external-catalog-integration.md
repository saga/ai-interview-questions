# Iceberg Catalog、外部引擎与权限边界

## 本节要解决的问题

让 Snowflake、Spark、Trino 等引擎安全访问同一份 Iceberg 表，并明确 Catalog API、对象存储、凭证下发和表级授权的职责。多引擎场景的关键不是网络能否连通，而是所有写入者能否通过同一个 Catalog 正确提交 Snapshot，并且每个引擎只访问被允许的 Namespace 和文件路径。

## 核心知识

### Catalog Integration 连接的是表元数据服务

外部 Iceberg Catalog 维护 Namespace、Table Identifier 和当前 metadata location。Snowflake 通过 Catalog Integration 与支持的 REST Catalog 通信。部分 Catalog 可提供短期存储凭证（vended credentials）；若 Catalog 不提供凭证下发，则需要配置 External Volume 访问实际对象存储。

Catalog URI、认证方式、OAuth/Token 或云角色信任关系都应由平台管理员管理。不能把 Catalog endpoint 当作数据文件 URL，也不能仅开放 HTTPS 域名就认为 Snowflake 已有读取 Parquet 的权限。

### 存储访问、Catalog 授权和 Snowflake 对象授权是三层边界

- **Catalog**：允许发现表、Namespace、获取 metadata location 和执行提交。
- **Object Storage**：允许读取或写入对应的 Parquet、Manifest 和 Metadata 文件。
- **Snowflake Object Grants**：控制哪些 Snowflake Role 可以访问 Iceberg 表、Database 和 Schema。

这三层授权不能相互替代。Snowflake 角色拥有表的 SELECT 权限，不代表 Catalog 身份能访问 S3；Catalog token 可读取某个 Bucket，也不代表任意 Snowflake 用户可查询对应表。

### 外部写入需要 Catalog 提交协议和范围限制

Snowflake 当前支持向符合 REST 协议的部分 External Catalog Iceberg 表写入。Catalog Integration 和存储凭证必须支持所需写操作。写入采用 autocommit 事务，不支持多语句事务；特定 Catalog 与云存储组合的能力还有差异。

Snowflake 外部写入冲突时会报告提交失败；客户端应重新读取当前 Snapshot、确认上次提交是否成功，再决定重新计算或幂等重试。不要绕过 Catalog 直接更新 metadata location。

## 工程实施步骤

1. 绘制 Snowflake、Catalog、对象存储、外部计算引擎和消费者之间的读写方向，标清每个主体使用的身份。
2. 列出支持的 Catalog 及其 REST API、认证机制、credential vending 和写操作能力。
3. 为 Snowflake 创建最小权限的 Catalog Integration，并限制其允许访问的 Catalog/Namespace。
4. 对没有 credential vending 的 Catalog 配置 External Volume，并将读写权限限制到所需存储路径。
5. 分别验证 Catalog 元数据访问、对象存储文件读取和 Snowflake Role 查询权限；不要只用一条 SELECT 作为完整授权验收。
6. 多写入方场景明确唯一的 Catalog 协调协议，禁止引擎绕过 Catalog 更新元数据文件。
7. 检查外部写入支持的 DML、Iceberg 版本、删除文件语义和 autocommit 限制。
8. 为外部引擎与 Snowflake 设定不同的服务身份和审计记录，轮换 Catalog Token、云角色和访问密钥。
9. 演练凭证过期、Catalog 不可用、存储拒绝、提交冲突、权限撤销和跨区域访问。
10. 对外部表的 Compaction、Snapshot Expiry 和 Metadata Refresh 指定维护 Owner，并验证维护后各引擎看到同一个当前 Snapshot。

## 场景分析

Snowflake 和 Spark 需要协同写入一个由 REST Catalog 管理的共享数据集。Spark 将原始事件转换成订单表，Snowflake 追加财务修正记录。两边都能访问对象存储，并不足以保证一致性。

应确保两边通过同一个 Catalog 发现并提交表状态，且各自身份只获得相应 Namespace 和文件路径权限。Snowflake 写入需要核对 external Iceberg write support 的 DML 和事务限制。若 Snowflake 提交冲突，应重新读取当前 Snapshot 并检查业务记录是否已存在，再按请求 ID 幂等重试。对外部写入完成后的 Catalog refresh 也要纳入读取流程。

## 常见误区

- 把 Catalog URI 当作数据存储地址。数据文件和元数据文件仍保存在对象存储。
- 只配置 Catalog Integration 不验证存储凭证。缺少对象存储权限仍无法读取实际数据文件。
- 把 Snowflake Role SELECT 权限当成云存储权限。两层身份完全不同。
- 多个引擎各自更新 metadata JSON。这样会绕开 Catalog 提交冲突检测。
- 认为外部写入支持所有事务语义。当前 Snowflake external write path 仅支持 autocommit。
- 将长期云密钥写入 SQL 或仓库配置。应使用受控身份与短期凭证。

## 完成标准

- [ ] 能区分 Catalog、Object Storage 和 Snowflake Grants。
- [ ] 能说明 REST Catalog、credential vending 和 External Volume 的关系。
- [ ] 能设计多引擎共享表的读写身份与提交协调。
- [ ] 能识别 external write 的事务、DML 和版本限制。
- [ ] 能设计凭证轮换、冲突恢复和安全审计。

## 自测

1. Snowflake Role 已获得 SELECT，但查询 Iceberg 文件失败，应该分别检查哪两个外部访问边界？
2. Catalog 能提供短期凭证时，凭证下发解决了哪类问题？是否替代 Snowflake Role Grants？
3. 两个引擎可以写同一 Iceberg 表，是否意味着它们可以绕过 Catalog 直接写 metadata JSON？
4. Snowflake external Iceberg write 不支持多语句事务，应该如何调整跨表更新方案？

## 参考资料

- [Write support for externally managed Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-externally-managed-writes)
- [Use catalog-vended credentials](https://docs.snowflake.com/en/user-guide/tables-iceberg-catalog-vended-credentials)
- [Manage Apache Iceberg tables](https://docs.snowflake.com/en/user-guide/tables-iceberg-manage)
