# Snowflake 驱动、Connector 与 Integration

## 本节要解决的问题

选择合适的客户端驱动和数据集成组件，并控制 Snowflake 与云存储、外部 API 及外部网络之间的信任边界。Driver/Connector 负责连接或数据传输；Integration 是 Snowflake 中的安全配置对象，不是一个可以代替所有外部连接的万能凭证。

## 核心知识

### Driver 面向应用建立会话和执行 SQL

Snowflake 为 Java、.NET、Python、Node.js、Go 和 ODBC 等客户端提供驱动。选择时要考虑语言运行时、同步/异步模型、连接池、认证方式、结果消费和文件 PUT/GET 支持。

Driver 负责协议连接、执行语句、读取结果和管理 Session，不会自动给应用授予数据权限。应用仍需使用受控用户/服务身份，设置必要 Role、Warehouse、Database 和 Schema，并遵守最小权限。

### Storage Integration 连接外部云存储

Storage Integration 为 S3、GCS 或 Azure 等外部存储创建受控的 IAM 身份，并通过 STORAGE_ALLOWED_LOCATIONS / STORAGE_BLOCKED_LOCATIONS 限定 Stage 可访问路径。云平台管理员需要授权该 IAM 身份访问对应 Bucket 或 Container。

一个 Storage Integration 可以服务多个 External Stage。它避免在 Stage DDL 中长期散落云访问密钥，并让访问位置与角色授权集中管理。它不是查询结果缓存，也不替代文件解析或目标表加载步骤。

### API Integration 与 External Access Integration 用途不同

API Integration 主要用于 Snowflake 调用受支持的外部 API/服务，例如 External Function 或特定外部服务连接；需要指定 provider、允许访问的 URL 前缀和相应认证配置。

External Access Integration 用于 UDF/Stored Procedure Handler 访问外部网络位置，汇总允许的 Network Rules、API Authentication Integrations 和 Secrets。Secrets 单独保存凭证，Handler 引用 Secret；不应在代码或 SQL 字面值中嵌入 API Key。

此外 Security Integration 用于 SAML/OAuth/OIDC/SCIM 等身份和授权集成。先识别要解决的是客户端登录、Snowflake 对外访问、外部 API 调用还是云存储访问，再选择对应 Integration 类型。

## 工程实施步骤

1. 明确连接主体、运行语言、部署环境、调用模式、身份来源、并发连接数和文件传输需求。
2. 选用对应 Snowflake Driver/Connector，检查支持的运行时版本、认证方法、TLS、连接超时、重试和连接池行为。
3. 使用专用服务用户或受控 OAuth/Key-pair 身份连接，并限制其 Role 的对象访问权限。
4. 连接云存储时创建 Storage Integration，由云管理员授权 Snowflake 生成的 IAM 主体；将 allowed/blocked locations 限制到具体 Bucket 路径。
5. 访问外部 API 时判断由 External Function/API Integration 还是 UDF/Procedure 的 External Access Integration 承担；不要跨用两种访问机制。
6. 使用 Network Rule 列出准许的域名或网络范围，使用 Secret 管理 API Key/OAuth 等凭证，授权 Integration 使用相应 Secret。
7. 为连接与外部访问开启必要的日志和历史观察，核对登录、访问拒绝、外部请求失败和凭证轮换记录。
8. 使用最小权限分别验证：能建立会话、能查询授权对象、能访问允许的 Stage 路径、不能访问未允许路径、不能调用未授权外部域名。
9. 记录驱动版本、Integration 依赖、云端 IAM 角色和凭证所有者，建立升级、轮换及撤销流程。

示例：

~~~
CREATE STORAGE INTEGRATION ORDERS_S3_INT
  TYPE = EXTERNAL_STAGE
  STORAGE_PROVIDER = 'S3'
  STORAGE_AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/snowflake-orders'
  ENABLED = TRUE
  STORAGE_ALLOWED_LOCATIONS = ('s3://company-data/orders/');

CREATE STAGE RAW.ORDERS_STAGE
  URL = 's3://company-data/orders/'
  STORAGE_INTEGRATION = ORDERS_S3_INT;
~~~

外部 IAM 策略仍需在云平台配置，且应限制到所需路径。

## 场景分析

Node.js 服务每天通过 Snowflake 读取订单，再调用第三方地址校验 API。团队将 API Key 写进 Handler 代码，并尝试用 Storage Integration 让 UDF 访问互联网。

这里有两个不同信任边界：Node.js Driver 用于应用连接 Snowflake；Snowflake Handler 出站访问第三方 API 应使用 External Access Integration、Network Rule 和 Secret。Storage Integration 仅用于访问外部对象存储，并不授权互联网 API 调用。

验收分别检查服务身份登录、Role 权限、外部 API 域名 allowlist、Secret 访问范围、API Key 轮换以及 External Access History。任何未列入 allowlist 的域名都应被拒绝。

## 常见误区

- **认为装上 Driver 就自动拥有 Snowflake 数据访问权限。** Session 身份和 Role/Grants 仍决定对象访问。
- **把 Storage Integration 当成 API Integration。** 前者面向云存储位置，后者用于特定外部 API/服务集成。
- **用 External Access Integration 代替 Storage Integration 下载 Stage 文件。** 它用于 Handler 外部网络访问。
- **把 API Key 放进代码或 SQL。** 应放到 Secret 并限制读取与使用范围。
- **开放所有网络目的地以避免排障。** Network Rule 应精确限定域名/网络，并保留请求审计。
- **只测试连接成功。** 还需验证 Role 授权、路径边界、外部访问限制和凭证撤销。

## 完成标准

- [ ] 能为应用选择合适 Snowflake Driver/Connector。
- [ ] 能说明 Storage Integration 与 External Stage 的关系。
- [ ] 能区分 API Integration、External Access Integration 和 Security Integration。
- [ ] 能使用 Network Rule 与 Secret 限定 UDF/Procedure 的外部访问。
- [ ] 能验证连接身份、数据权限和外部网络 allowlist。

## 自测

1. Python 应用需要连接 Snowflake 执行 SQL，应该使用什么类型的组件？它是否自动赋予表权限？
2. Snowflake Handler 需要调用第三方 HTTPS API 并用 API Key 认证，应组合哪些对象？
3. External Stage 需要访问 S3 指定前缀，应使用哪种 Integration？如何限制访问路径？
4. 为什么不能把 Storage Integration 用作 UDF Handler 的通用出站网络许可？

## 参考资料

- [Snowflake Drivers](https://docs.snowflake.com/en/developer-guide/drivers)
- [CREATE STORAGE INTEGRATION](https://docs.snowflake.com/en/sql-reference/sql/create-storage-integration)
- [CREATE API INTEGRATION](https://docs.snowflake.com/en/sql-reference/sql/create-api-integration)
- [CREATE EXTERNAL ACCESS INTEGRATION](https://docs.snowflake.com/en/sql-reference/sql/create-external-access-integration)
- [Creating and using an external access integration](https://docs.snowflake.com/en/developer-guide/external-network-access/creating-using-external-network-access)
