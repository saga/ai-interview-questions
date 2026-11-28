# 网络边界、身份认证与外部数据通路

## 本节要解决的问题

一家企业把订单仓库迁到 Snowflake 后，安全团队提出四项要求：

- 只有公司办公网络和批准的私有连接能够登录账户。
- 人类用户使用企业 SSO 和 MFA；自动化作业不能依赖共享密码。
- Snowflake 只能读取指定云存储 Bucket 和目录，不能随意访问其他文件。
- UDF 或 Stored Procedure 如需调用外部 API，只能访问明确批准的主机和凭据。

这些要求看起来都属于“网络安全”，实际上控制的是不同方向和不同对象。客户端进入 Snowflake、Snowflake 读取云存储、Handler 访问外部 API，应该使用不同的策略和 Integration。只配置 Network Policy 并不能完成整个数据通路治理。

## 核心知识

### 先区分三种流量方向

| 流量 | 方向 | 主要控制 |
|---|---|---|
| 用户、驱动或应用访问 Snowflake | 客户端到 Snowflake | Network Policy、Authentication Policy、Ingress Policy |
| Snowflake 读写 S3/GCS/Azure 外部 Stage | Snowflake 到云存储 | Storage Integration、云 IAM、允许的存储路径 |
| UDF/Procedure Handler 调用 REST API | Snowflake 运行环境到外部服务 | Network Rule、Secret、External Access Integration |

这三个入口不能互相替代。客户端能登录 Snowflake，不代表它能读取某个外部 Stage；某个 Storage Integration 获准读取 S3，也不代表 Python Handler 可以访问任意公网 API。

### Network Policy 限制哪些网络来源能访问 Snowflake

Network Policy 是账户接入边界之一。它可以允许或拒绝 IP 地址、CIDR、云私有端点等来源。一个常见做法是只允许企业出口网段：

~~~sql
CREATE OR REPLACE NETWORK POLICY corporate_access
  ALLOWED_IP_LIST = ('203.0.113.0/24', '198.51.100.24')
  BLOCKED_IP_LIST = ('203.0.113.77');
~~~

应用到账户前，应先确认当前管理员的出口 IP 已在允许列表中，并为紧急运维预留经过审批的访问路径：

~~~sql
ALTER ACCOUNT SET NETWORK_POLICY = corporate_access;
~~~

Network Policy 约束的是连接来源，不验证用户是否具备业务数据权限。若用户从允许的办公网络登录，仍然要通过 Role、Database、Schema、Table、View、Policy 等对象授权检查。反过来，用户拥有 ACCOUNTADMIN，也不能从网络策略禁止的来源绕过账户接入限制。

网络边界应覆盖所有访问方式：Snowsight、SnowSQL、驱动、应用 API、内部 Stage 和私有端点。启用策略前还要检查服务账号、CI/CD、监控和数据集成的出口地址；否则最容易发生的故障是管理员能登录，但无人值守作业全部断连。

### Authentication Policy 管理用户用什么方式认证

认证策略可以限制允许的认证方法、MFA 注册要求以及 SAML/OIDC 身份提供方。常见做法是：

- 人类用户使用企业 SSO，并由 IdP 强制 MFA。
- 需要 Snowflake 额外执行 MFA 的用户使用 Authentication Policy，按用户类型与客户端范围配置。
- 服务用户使用 Key Pair、OAuth 或 Workload Identity Federation 等程序化认证方式，避免把人类密码放进调度脚本。
- Personal Access Token 需要明确用途、期限和撤销责任，不能成为永久共享凭据。

Snowflake 的 Workload Identity Federation 可以让 AWS、Azure、GCP 等受信任工作负载通过其云身份向 Snowflake 认证，使用短期身份声明，减少静态密码或长期密钥的维护。它解决的是“工作负载如何进入 Snowflake”，与下一节的外部服务出站身份不同。

认证成功后，实际数据访问仍由当前 Role、角色继承、次级角色和对象授权决定。Authentication Policy 不能替代 RBAC，MFA 也不能自动缩小某个角色的 SELECT 范围。

### Storage Integration 把 Snowflake 与云存储 IAM 连接起来

外部 Stage 需要访问 S3、GCS 或 Azure 容器时，不应把云访问密钥写在 CREATE STAGE 或 Notebook 代码里。Storage Integration 保存 Snowflake 生成的云 IAM 身份，并可以限制允许访问的 Bucket、Container 或目录前缀。

以 S3 为例：

~~~sql
CREATE OR REPLACE STORAGE INTEGRATION orders_storage
  TYPE = EXTERNAL_STAGE
  STORAGE_PROVIDER = 'S3'
  STORAGE_AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/snowflake-orders-read'
  ENABLED = TRUE
  STORAGE_ALLOWED_LOCATIONS = ('s3://company-data/orders/');
~~~

然后查看 Integration 详情，取得 Snowflake 生成的 IAM 外部身份和信任策略信息：

~~~sql
DESC INTEGRATION orders_storage;
~~~

云平台管理员需要在 IAM Role 的 Trust Policy 中信任对应 Snowflake 身份，并授予该角色读取指定 Bucket/Prefix 所需的权限。Snowflake 的 Integration 允许范围和云端 IAM 权限必须同时成立：Integration 放行但 IAM Role 没有 S3 权限，仍然访问失败；IAM Role 权限过宽，也会扩大该云身份的实际数据访问范围。

创建外部 Stage 时绑定 Integration：

~~~sql
CREATE OR REPLACE STAGE orders_stage
  URL = 's3://company-data/orders/'
  STORAGE_INTEGRATION = orders_storage
  FILE_FORMAT = (TYPE = PARQUET);
~~~

STORAGE_ALLOWED_LOCATIONS 限制哪些路径可以被引用；如使用通配符，也应配合 STORAGE_BLOCKED_LOCATIONS 明确排除敏感路径。不要为了方便给 Integration 开放整个 Bucket 或所有 Bucket。

### 外部 API 出站访问使用 External Access Integration

UDF 或 Stored Procedure 要访问合作方 REST API 时，使用 External Access Integration，而不是 Storage Integration。它由 EGRESS Network Rule、Secret 和 Integration 组成，并在函数或过程中显式声明。

主机名和端口定义在 Network Rule 中；凭据放在 Secret；Integration 再决定哪些规则与 Secret 可以被 Handler 使用。没有被允许的主机或凭据，Handler 不应获得访问能力。

这部分的完整配置、Python Handler 绑定和 429/超时处理见本课程的《外部访问集成与端点安全》教程。不要把 API Token 放进 Network Rule，也不要把一个允许访问 S3 的 Storage Integration 当作 REST API 的出站授权。

## 工程实施步骤

1. 盘点全部访问者和数据通路：人类用户、服务账号、BI、驱动、CI/CD、云存储、外部 API 和 PrivateLink。
2. 将客户端来源网段、私有端点和自动化运行环境加入 Network Policy 设计，并在启用前测试管理员和服务账号的实际出口。
3. 对人类用户建立 SSO/MFA 认证策略；对服务身份评估 Key Pair、OAuth 或 Workload Identity Federation，记录 owner、用途和撤销路径。
4. 使用真实用户和服务身份检查当前 Role、次级角色、角色继承和对象授权；Network Policy 允许登录不代表数据授权正确。
5. 为每个外部 Bucket 创建最小范围的 Storage Integration，使用 STORAGE_ALLOWED_LOCATIONS 限制前缀，并由云管理员配置受限 IAM Role。
6. 为每个外部 Stage 检查 URL 是否落在允许前缀内，验证 COPY、LIST 和 GET 等实际需要的操作。
7. 将外部 API 出站需求独立交给 External Access Integration，按主机、端口、Secret 和函数绑定建立最小权限。
8. 做负向测试：未批准 IP、未批准认证方式、未授权 Role、未允许的 Bucket 路径和未允许的 API 主机都应失败。
9. 记录拒绝日志、Query ID、认证方式、执行身份和云平台审计事件，确保告警能定位到网络、身份或对象授权层。
10. 定期复核网络白名单、Integration 的 Allowed Locations、云 IAM Trust Policy、认证方式和失效服务账号，撤销不再使用的权限。

## 场景分析

数据平台的订单加载作业运行在 AWS，分析师从公司 VPN 登录 Snowsight，Python UDF 需要访问合作方的地址标准化 API。

这三条路径分别治理：

- 分析师入口：Network Policy 允许公司 VPN 出口；Authentication Policy 要求企业 SSO/MFA；进入账户后再由 Role 控制可以查询哪些表。
- 云存储读取：Storage Integration 只允许 S3 的 orders 前缀，云 IAM Role 也只授予该目录的读取权限；其它财务和 HR 目录不可被该 Stage 引用。
- 外部 API：External Access Integration 只允许 api.partner.example.com:443，并绑定专用 Secret；函数无权访问其他 API 主机。

如果把三者混成一条“放行 Snowflake 网络”的规则，就很难回答哪个主体能访问哪一个对象。按流量方向拆分后，故障也更容易定位：登录被拒绝查 Network Policy/认证策略，Stage 403 查 Storage Integration/IAM，UDF 无法连接查 EGRESS 规则/Secret 绑定。

## 常见误区

- **认为 Network Policy 管理所有网络流量。** 它主要控制进入 Snowflake 的连接来源；外部 Stage 和 Handler 出站访问各有 Integration 边界。
- **认为通过 SSO/MFA 后就自动获得正确的数据权限。** 认证只确认身份，Role 和对象 GRANT 决定可访问的数据。
- **把 Storage Integration 当成外部 API 的出站授权。** 它用于外部云存储 Stage；UDF/Procedure 出站访问应使用 External Access Integration。
- **只限制 Snowflake Integration，不限制云 IAM Role。** 两边授权必须同时收敛到相同的 Bucket 和 Prefix。
- **把整个 Bucket 或所有主机加入允许列表。** 应按用途分开 Integration，并用最小的主机、目录和凭据范围。
- **用长期共享密码认证自动化作业。** 应评估 Key Pair、OAuth 或 Workload Identity Federation，并建立轮换与撤销责任。
- **只做正向连通测试。** 还要验证不允许的网段、认证方式、对象路径和外部端点确实被拒绝。

## 完成标准

- [ ] 能区分 Network Policy、Authentication Policy、Storage Integration 和 External Access Integration。
- [ ] 能分别描述客户端入站、外部 Stage 访问和 Handler 出站的数据通路。
- [ ] 能用最小网络来源和认证策略保护账户登录。
- [ ] 能用 Storage Integration 与云 IAM 限制外部 Stage 的目录范围。
- [ ] 能为服务账号选择程序化身份，并说明 WIF 的使用边界。
- [ ] 能设计正向与负向测试，证明网络、身份和数据权限分别生效。

## 自测

1. 某个用户可以从公司 VPN 登录 Snowflake，但查询 Payroll 表失败。为什么不能只检查 Network Policy？
2. 一个 Stage 可以读取 S3 目录 A，却不应访问目录 B。应该限制 Storage Integration 的哪项配置？云 IAM Role 还要怎样设置？
3. Python UDF 要访问合作方 API。为什么 Storage Integration 不能代替 External Access Integration？
4. 服务账号从 AWS 自动化环境连接 Snowflake，不想保存长期密码。可以评估哪类工作负载身份机制？
5. 如何证明“未授权 IP 无法登录”以及“已登录用户仍无法读取敏感表”是两条独立控制？

## 参考资料

- [Controlling network traffic with network policies](https://docs.snowflake.com/en/user-guide/network-policies)
- [Authentication policies](https://docs.snowflake.com/en/user-guide/authentication-policies)
- [Workload identity federation](https://docs.snowflake.com/en/user-guide/workload-identity-federation)
- [CREATE STORAGE INTEGRATION](https://docs.snowflake.com/en/sql-reference/sql/create-storage-integration)
- [External network access overview](https://docs.snowflake.com/en/developer-guide/external-network-access/external-network-access-overview)
