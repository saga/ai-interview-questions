# SAP BDC Zero-Copy Connector：消费与反向发布数据产品

## 本节要解决的问题

企业已经有 SAP Business Data Cloud（BDC）和 Snowflake。财务团队希望在 Snowflake 中直接查询 SAP 销售订单数据，同时把在 Snowflake 整理的集团级客户主数据发布回 SAP BDC，供其他数据产品复用。

这不是一条单向的“把 SAP 数据挂进 Snowflake”的连接。SAP BDC Connect for Snowflake 支持两个方向：

- **消费**：SAP BDC 将数据产品分享给目标 Snowflake Account，Snowflake 通过 Catalog-Linked Database 挂载并查询。
- **发布**：Snowflake 将符合要求的表放入 Share，再通过 Connector 发布为 SAP BDC 可发现的数据产品。

两条路径共用 Zero-Copy Connector，但对象、权限、数据格式和验收都不同。消费成功不能证明反向发布已准备好；同样，创建 Connector 也不意味着数据产品已经共享。

## 先确认集成方式与前置条件

### SAP Snowflake 和 BDC Connect for Snowflake 是两条开通路径

2026 年 5 月 4 日，SAP BDC Zero-Copy Connector 达到 General Availability。当前主要有两种接入方式：

| 方式 | 适用客户 | Snowflake Account |
|---|---|---|
| SAP Snowflake | 尚无 Snowflake Account 的 SAP 客户 | 从 SAP for Me provision 新账号，Connector 会随账号开通创建和注册 |
| SAP BDC Connect for Snowflake | 已有 Snowflake Account 的客户 | 在现有账号中接受邀请并创建 Zerocopy Connector |

本文讲第二种方式。它要求 Snowflake Account 不是 Trial Account，并完成 SAP 侧的 BDC Connect 配置。不要把两种开户路径的步骤混在同一份 Runbook 中。

### 组织条款、Schema 权限和业务数据权限是三个不同层次

正式创建 Connector 前，需要由 ORGADMIN 在 Snowflake Organization 层面接受 SAP BDC Connect for Snowflake Terms。这项操作每个 Snowflake Organization 只需执行一次。Snowflake 文档明确说明条款不能自行撤销；需要撤销时要联系 Snowflake Support 和 Legal。

之后，日常 Snowflake 角色还需要在目标 Schema 上拥有 CREATE ZEROCOPY CONNECTOR，才能创建 Connector。Connector 创建完成后，再按使用场景授予 CONNECTOR 对象权限：

| 权限 | 对象 | 用途 |
|---|---|---|
| CREATE ZEROCOPY CONNECTOR | Schema | 创建 Connector |
| OPERATE | Zerocopy Connector | CONNECT、DISCONNECT，以及发布数据产品 |
| USAGE | Zerocopy Connector | 创建 Catalog-Linked Database；还需要 Account 上的 CREATE DATABASE |
| MODIFY | Zerocopy Connector | 设置 SHARE_BACK 等属性 |
| MONITOR | Zerocopy Connector | 查看、描述 Connector 和列出 Shares |
| OWNERSHIP | Zerocopy Connector | 重命名或删除 Connector |
| CREATE SHARE | Account | 创建反向发布使用的 Snowflake Share |

不要把 ORGADMIN 接受条款当成运行角色的日常权限，也不要给所有数据消费者授予 Connector OWNERSHIP。Connector 的生命周期操作和查询数据产品的权限应分开管理。

## 创建 Connector 并等待异步连接完成

### Connector 是 Schema 级对象

先准备目标 Database 和 Schema，然后创建 Connector：

~~~sql
CREATE DATABASE IF NOT EXISTS SAP_BDC_INTEGRATION;
CREATE SCHEMA IF NOT EXISTS SAP_BDC_INTEGRATION.CONNECTORS;

CREATE ZEROCOPY CONNECTOR IF NOT EXISTS
  SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC
  PARTNER = SAP_BDC;
~~~

新建后状态为 NEW，并没有建立连接。接着从 SAP BDC 管理端取得 invitation link，执行：

~~~sql
ALTER ZEROCOPY CONNECTOR
  SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC
  CONNECT WITH CONFIG = (
    INVITATION_LINK = '<invitation link from SAP BDC>'
  );
~~~

命令返回后，Connector 会立即进入 CONNECTING。它不是同步握手：Snowflake 在后台验证并建立连接。应使用 DESCRIBE 检查状态和连接错误：

~~~sql
DESC ZEROCOPY CONNECTOR
  SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC;
~~~

主要状态：

| 状态 | 含义 | 允许的后续动作 |
|---|---|---|
| NEW | 已创建，尚未尝试连接 | CONNECT |
| CONNECTING | 正在异步建立连接 | 等待并检查状态 |
| CONNECTED | 连接已建立 | 消费数据产品或配置 Share-Back |
| CONNECT_ERROR | 连接失败，错误信息保留 | 修复问题后重新 CONNECT |
| DISCONNECTING | 正在异步断开 | 等待 |
| DISCONNECTED | 连接已断开 | 可重新 CONNECT，或满足条件后 DROP |
| DISCONNECT_ERROR | 断开失败 | 检查错误后重试或处理资源 |
| DELETED | Connector 已删除 | 不支持 UNDROP |

只有 CONNECTED 状态才能创建 Catalog-Linked Database，或执行 Snowflake 与 SAP BDC 之间的数据共享。不要把 CONNECTING 当成“基本可用了”；也不要在失败时反复执行 CONNECT，却不检查 DESC 返回的 connection_error 和 SAP 侧配置。

## 工作流一：把 SAP BDC 数据产品挂载到 Snowflake

### SAP 侧先将数据产品分享给目标 Snowflake Account

在 SAP Business Data Cloud 中，执行分享的用户需要具备相应全局角色：
- BDC Data Packages（read）：访问 SAP Business Data Cloud；
- Catalog Asset（read）：浏览 Catalog 中的 Assets 和 Data Products；
- Cloud Data Product（share）：将数据产品分享给目标系统。

从 BDC Catalog 选择数据产品，在 Share Access 中选择已经注册 Connector 的目标 Snowflake Account。分享完成后，Snowflake 才能发现该产品。

### Snowflake 侧列出 Share，并原样使用名称

使用 Connector 列出已分享的数据产品：

~~~sql
SELECT SYSTEM$ZEROCOPY_CONNECTOR_LIST_SHARES(
  'SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC'
);
~~~

结果是 JSON 数组。每个元素包含 name、id、display_name 等信息。创建 Catalog-Linked Database 时，SHARE_NAME 必须使用返回的 name 原值；这通常是带有 SAP 命名空间和版本信息的长字符串，不要只填页面上显示的可读名称。

### 创建 Catalog-Linked Database，不复制一份业务表

~~~sql
CREATE DATABASE SAP_SALES_ORDER
  LINKED_ZEROCOPY_CONNECTOR = (
    CONNECTOR_NAME =
      'SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC',
    SHARE_NAME =
      '<exact name returned by SYSTEM$ZEROCOPY_CONNECTOR_LIST_SHARES>',
    SYNC_INTERVAL_SECONDS = 86400
  );
~~~

创建需要 Connector USAGE 和 Account 级 CREATE DATABASE。SYNC_INTERVAL_SECONDS 控制 Snowflake 自动发现 SAP 数据产品 Schema/Table 变化的间隔，范围是 30 到 86400 秒；SAP BDC 默认 86400 秒，也就是一天。不要把这个间隔误解为数据行变更的实时同步频率。

每个数据产品可以挂载为一个独立 Catalog-Linked Database。同一个 Connector 可以挂载多个数据产品。挂载后会自动生成只读的 SNOWFLAKE$ Schema，里面包含根据 SAP Core Schema Notation（CSN）生成的 Semantic Views。它们提供实体、指标和关系定义，可以在 Snowflake 中直接用于 SQL 或 Cortex Analyst。

这也是 Zero-Copy 的重要部分：Snowflake 使用共享的数据产品和 Catalog 元数据访问数据，不是把完整源表再 COPY 一份到自己的存储中。若下游需要物化一份独立结果，可以显式 CTAS；那是后续消费建模的选择，不应与 Connector 挂载混为一谈。

### CSN 标记的 PII 默认会被遮罩

Snowflake 会根据数据产品 CSN 中的 PII 注解，为相应列附加 PII Tag 和 Masking Policy。查询结果默认对所有角色遮罩，包括 ACCOUNTADMIN 和 Catalog-Linked Database 的 Owner Role。

只有经过授权、确实需要查看明文 PII 的角色才应被允许解除遮罩。数据库 Owner Role 可以在自动创建的 SNOWFLAKE$ Schema 中，通过 UNMASK_PII Tag 为指定 Role 开放：

~~~sql
ALTER ROLE SAP_FINANCE_PII_READER
  SET TAG SAP_SALES_ORDER."SNOWFLAKE$".UNMASK_PII = 'true';
~~~

这个权限应当按用途单独授予和复核。不要因为使用 ACCOUNTADMIN 或拥有 Catalog-Linked Database，就假设可以看到全部 PII 明文。

## 工作流二：从 Snowflake 反向发布数据到 SAP BDC

### Share-Back 必须显式开启，发布目标表有严格要求

反向发布不是把任意 Snowflake Table 加进 Share 就完成。先确认 Connector 为 CONNECTED，再启用 SHARE_BACK：

~~~sql
ALTER ZEROCOPY CONNECTOR
  SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC
  SET SHARE_BACK = TRUE;
~~~

每个要发布的数据产品建议使用一个独立 Database。数据表必须满足以下条件：

| 要求 | 配置 | 原因 |
|---|---|---|
| Iceberg Version | V3 | SAP BDC Connector 要求 Iceberg V3 |
| Catalog | SNOWFLAKE | 必须使用 Snowflake 作为 Iceberg Catalog |
| Storage | Snowflake Storage | 该发布路径的存储要求 |
| Row-level write mode | ICEBERG_MERGE_ON_READ_BEHAVIOR = DISABLED | 使用 Copy-on-Write |
| Serialization | STORAGE_SERIALIZATION_POLICY = COMPATIBLE | 让 SAP BDC 能消费发布的数据 |
| Primary Key | 每张发布表必须有 PK | CSN 需要标记同一主键列 |

可以在 Database 层设置默认属性，让新表继承：

~~~sql
CREATE DATABASE SAP_PUBLISH_CUSTOMER
  ICEBERG_VERSION_DEFAULT = 3
  CATALOG = 'SNOWFLAKE'
  ICEBERG_MERGE_ON_READ_BEHAVIOR = 'DISABLED'
  STORAGE_SERIALIZATION_POLICY = 'COMPATIBLE';
~~~

也可以在表级显式指定：

~~~sql
CREATE ICEBERG TABLE SAP_PUBLISH_CUSTOMER.CURATED.CUSTOMER (
  CUSTOMER_ID STRING PRIMARY KEY,
  CUSTOMER_NAME STRING,
  COUNTRY_CODE STRING
)
  ICEBERG_VERSION = 3
  CATALOG = 'SNOWFLAKE'
  ICEBERG_MERGE_ON_READ_BEHAVIOR = 'DISABLED'
  STORAGE_SERIALIZATION_POLICY = 'COMPATIBLE';
~~~

主键不能只存在于 Snowflake SQL 定义中。发布用的 CSN 文档还必须把同一列标记为 key=true。发布前用 SHOW PRIMARY KEYS 检查实际 PK，并逐列核对 CSN。Dynamic Iceberg Table 也可以发布，但要按文档要求在创建后用 ALTER DYNAMIC TABLE ADD PRIMARY KEY。

### 建立 Snowflake Share，再把 Share 关联到 Connector

首先创建 Share，并按最小权限授予 Database、Schema 和 Table：

~~~sql
CREATE SHARE SAP_CUSTOMER_SHARE;

GRANT USAGE ON DATABASE SAP_PUBLISH_CUSTOMER
  TO SHARE SAP_CUSTOMER_SHARE;

GRANT USAGE ON SCHEMA SAP_PUBLISH_CUSTOMER.CURATED
  TO SHARE SAP_CUSTOMER_SHARE;

GRANT SELECT ON TABLE SAP_PUBLISH_CUSTOMER.CURATED.CUSTOMER
  TO SHARE SAP_CUSTOMER_SHARE;
~~~

创建 Share 的角色需要 Account 级 CREATE SHARE。随后将 Share 添加到 Connector：

~~~sql
ALTER ZEROCOPY CONNECTOR
  SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC
  ADD SHARE SAP_CUSTOMER_SHARE;
~~~

此时只是把 Snowflake Share 绑定到 Connector，SAP BDC 仍然需要完成数据产品发布步骤。

### 发布数据产品时传入 ORD 和 CSN 元数据

调用 SYSTEM$SAP_PUBLISH_DATA_PRODUCT 让 SAP BDC 侧发现该数据产品：

~~~sql
SELECT SYSTEM$SAP_PUBLISH_DATA_PRODUCT(
  'SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC',
  'SAP_CUSTOMER_SHARE',
  '{
    "title": "Customer Master",
    "shortDescription": "Curated customer master data",
    "description": "Approved customer attributes for enterprise reporting."
  }',
  '{
    "csnInteropEffective": "1.0",
    "$version": "2.0",
    "definitions": {
      "Customer": {
        "kind": "entity",
        "elements": {
          "CUSTOMER_ID": {
            "type": "cds.String",
            "key": true
          },
          "CUSTOMER_NAME": {
            "type": "cds.String"
          },
          "COUNTRY_CODE": {
            "type": "cds.String"
          }
        }
      }
    }
  }'
);
~~~

示例中的 ORD 元数据和 CSN JSON 只说明参数位置与主键映射关系。实际发布时必须根据目标产品的 CSN 契约定义字段类型、实体、关系、标签和业务说明；不能把示例 JSON 直接作为真实产品 Schema。执行发布需要 Connector OPERATE 权限。

发布后要从 SAP BDC Catalog 验证数据产品是否可发现、Schema/CSN 是否正确、消费者是否能访问、权限是否符合发布意图。Snowflake Share 创建成功并不等于 SAP 数据产品发布成功。

## 断开与删除：先解除依赖，再断开 Connector

断开连接前必须完成两件事：
1. 删除由该 Connector 创建的所有 Catalog-Linked Databases；
2. 将 SHARE_BACK 设为 FALSE，并处理 Connector 上关联的 Shares。

之后才能执行：

~~~sql
ALTER ZEROCOPY CONNECTOR
  SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC
  UNSET SHARE_BACK;

ALTER ZEROCOPY CONNECTOR
  SAP_BDC_INTEGRATION.CONNECTORS.MY_SAP_BDC
  DISCONNECT;
~~~

DISCONNECT 是异步过程，状态先进入 DISCONNECTING，完成后才变为 DISCONNECTED。只有处于 NEW、CONNECT_ERROR、DISCONNECT_ERROR 或 DISCONNECTED 状态时才允许 DROP。删除后的 Connector 是 DELETED，不能 UNDROP。

如果租户使用 AWS PrivateLink，Connector 断开时还涉及其控制面端点的生命周期；Snowflake 可能移除为该 Connector 创建的控制面 Endpoint。若 7 天内重新连接同一租户，可能需要按错误提示使用 SYSTEM$RESTORE_PRIVATELINK_ENDPOINT 恢复端点，再重新 CONNECT。不要把 Connector 删除和 PrivateLink Endpoint 删除当成完全独立的清理动作。

## 一次完整验收要分成两张清单

| 验收范围 | 消费 SAP 数据产品 | 反向发布到 SAP BDC |
|---|---|---|
| 连接状态 | Connector 为 CONNECTED | Connector 为 CONNECTED，SHARE_BACK 为 TRUE |
| 数据对象 | Catalog-Linked Database 可创建 | Iceberg V3 表、Snowflake Catalog、Snowflake Storage |
| Schema | SNOWFLAKE$ Semantic Views 可读取 | CSN 与实际表 Schema 一致，主键同名同列 |
| 权限 | Snowflake Role 和 PII masking 按预期 | Share 的 DB/Schema/Table 授权范围符合预期 |
| 业务检查 | 行数、日期、业务指标与 SAP Data Product 对账 | SAP BDC Catalog 可发现、可预览/消费 |
| 生命周期 | Database 可按依赖顺序清理 | Share、SHARE_BACK 和 Connector 可按顺序撤销 |

建议分别记录 Connector 状态、Share 名称、Catalog-Linked Database、同步间隔、CSN 版本、PII 授权、Iceberg 属性和发布结果。这样后续出现 Schema 变化、产品撤回或权限问题时，能够分清是 SAP 分享、Snowflake 挂载、数据访问策略，还是反向发布契约出了问题。

## 常见误区

- **把接受组织条款、创建 Connector 和数据授权当成一个步骤。** 它们位于不同权限层次，由不同角色执行。
- **CONNECT 返回后立即创建 Catalog-Linked Database。** CONNECTING 只是后台连接进行中，必须等到 CONNECTED。
- **把 SAP 侧可见的数据产品名称直接当作 SHARE_NAME。** 应使用 SYSTEM$ZEROCOPY_CONNECTOR_LIST_SHARES 返回的 name 原值。
- **把 Catalog-Linked Database 当成普通本地数据库。** 它是共享数据产品的挂载对象，包含只读 SNOWFLAKE$ Schema 和 CSN 生成的 Semantic Views。
- **认为 ACCOUNTADMIN 或 Database Owner 自动能看到 PII 明文。** 默认 Masking 对所有角色生效，解除遮罩必须显式授权。
- **把普通 Snowflake Table 直接发布给 SAP BDC。** 反向发布要求 Iceberg V3、Snowflake Catalog/Storage、Copy-on-Write、兼容序列化和 PK/CSN key 对齐。
- **认为创建 Snowflake Share 就完成 SAP BDC 发布。** 还需将 Share 关联 Connector 并调用 SYSTEM$SAP_PUBLISH_DATA_PRODUCT。
- **忽略一产品一 Database 的推荐和主键契约。** Share-back 的数据产品 Schema 要按 SAP BDC 消费契约维护。
- **直接 DISCONNECT 或 DROP，忽略挂载数据库和 Share-Back。** 必须先清理 Catalog-Linked Databases、Share-Back 和关联资源。

## 完成标准

- [ ] 能区分 SAP Snowflake 新账号路径与现有账号的 BDC Connect for Snowflake 路径。
- [ ] 能解释 ORGADMIN 条款接受、Schema CREATE ZEROCOPY CONNECTOR 与 Connector 对象权限的差异。
- [ ] 能创建 Connector 并通过 DESC 理解 NEW、CONNECTING、CONNECTED、CONNECT_ERROR 等状态。
- [ ] 能使用 SYSTEM$ZEROCOPY_CONNECTOR_LIST_SHARES 和精确 SHARE_NAME 创建 Catalog-Linked Database。
- [ ] 能解释 SNOWFLAKE$ Schema、CSN Semantic Views、SYNC_INTERVAL_SECONDS 与默认 PII masking。
- [ ] 能列出 share-back 的 Iceberg V3、Snowflake Catalog/Storage、Copy-on-Write、COMPATIBLE serialization 和 PK/CSN key 要求。
- [ ] 能创建 Snowflake Share、授权对象并使用 SYSTEM$SAP_PUBLISH_DATA_PRODUCT 发布数据产品。
- [ ] 能按先清理 Catalog-Linked Databases/Share-Back，再 DISCONNECT/DROP 的顺序关闭集成。

## 自测

1. ORGADMIN 已接受条款，但目标 Schema 中的普通开发角色没有 CREATE ZEROCOPY CONNECTOR。它能否创建 Connector？还需要什么授权？
2. ALTER ... CONNECT 返回后 Connector 处于 CONNECTING。为什么此时不能创建 Catalog-Linked Database？应查看哪个对象状态和错误列？
3. SYSTEM$ZEROCOPY_CONNECTOR_LIST_SHARES 返回多个长字符串。为什么要把 name 原样用于 SHARE_NAME？
4. Catalog-Linked Database 自动生成 SNOWFLAKE$ Schema。它包含什么内容？PII 为什么默认对 ACCOUNTADMIN 也遮罩？
5. 发布 Snowflake 表给 SAP BDC，为什么需要 Iceberg V3、Snowflake Catalog、Copy-on-Write、COMPATIBLE serialization 和主键？只满足其中四项能发布吗？
6. 已创建 Snowflake Share 并授予 SELECT，但 SAP BDC Catalog 看不到数据产品。还缺少哪个关联/发布步骤？
7. 为什么断开 Connector 前要先删除所有 Catalog-Linked Databases 并关闭 SHARE_BACK？若使用 PrivateLink，重连时还要留意什么？

## 参考资料

- [SAP BDC Connect for Snowflake — Set up Zero-Copy Connector](https://docs.snowflake.com/en/user-guide/data-integration/zero-copy/sap-sql/setup)
- [Security and privileges](https://docs.snowflake.com/en/user-guide/data-integration/zero-copy/sap-sql/security)
- [Explore data products from SAP BDC](https://docs.snowflake.com/en/user-guide/data-integration/zero-copy/sap-sql/explore-data-products)
- [Publish data from Snowflake to SAP BDC](https://docs.snowflake.com/en/user-guide/data-integration/zero-copy/sap-sql/publish-data)
- [Private connectivity for SAP BDC Zero-Copy Connector](https://docs.snowflake.com/en/user-guide/data-integration/zero-copy/sap-sql/private-connectivity)
- [SAP BDC Zero-Copy Connector — General Availability, May 4, 2026](https://docs.snowflake.com/en/release-notes/2026/other/2026-05-04-Snowflake-SAP-zerocopy-integration)
