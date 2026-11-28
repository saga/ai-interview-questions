# OpenFlow on SPCS：通过 AWS PrivateLink 访问私有数据源

## 本节要解决的问题

OpenFlow Runtime 部署在 Snowpark Container Services（SPCS）中，需要连接私有 VPC 里的两套 RDS MySQL。数据库都监听 TCP 3306，但它们不能暴露到公网，也不能共用同一个入口端口，否则 NLB 无法区分应转发到哪套数据库。

这条链路要在 AWS 和 Snowflake 两侧分别配置：AWS 用内部 Network Load Balancer（NLB）与 VPC Endpoint Service 暴露受控入口；Snowflake 用出站 PrivateLink endpoint、Network Rule 和 External Access Integration（EAI）授权 OpenFlow Runtime 使用它。连接是否成功不能只看对象创建状态，还要逐层验证目标组、NLB、端点和实际 Connector 连接。

## 先确认使用的是哪一种私网连接

本节讲的是 **OpenFlow on SPCS 到 AWS 私有目标的出站 PrivateLink**。它不是 OpenFlow Snowflake Deployment 的 Data Connectivity Proxy（DCP），也不是用户通过 PrivateLink 访问 OpenFlow Runtime UI 的入站路径。

| 方案 | 运行环境 | 典型用途 |
|---|---|---|
| SPCS outbound PrivateLink | OpenFlow Runtime 运行在 SPCS | 通过 AWS Endpoint Service/NLB 连接私有数据库 |
| Data Connectivity Proxy | OpenFlow Snowflake Deployment | Snowflake 托管 Runtime 访问客户网络内的数据库、Kafka 或 API |
| PrivateLink UI access | 用户浏览器到 OpenFlow Runtime UI | 私网访问 UI，不代表 Connector 已能访问私有数据源 |

如果数据源是 AWS 私有 VPC 中的数据库，且可以由 Endpoint Service 发布，可使用本节方案。若数据源在本地机房，需要先保证 AWS VPC 可通过 VPN/Direct Connect 到达；某些目标 IP 不适合直接注册到 NLB IP Target Group 时，还需要在 VPC 内增加 TCP Proxy。若运行环境是 OpenFlow Snowflake Deployment，应评估 DCP，而不是照搬 SPCS NLB 方案。

Snowflake 出站 PrivateLink 需要 Business Critical Edition 或更高版本。AWS 侧需要创建 Target Group、内部 NLB、Endpoint Service、安全组和连接授权；Snowflake 侧需要 ACCOUNTADMIN 执行 PrivateLink endpoint provision 操作。OpenFlow Runtime 应已部署在 SPCS。

## 连接路径和端口映射

~~~mermaid
flowchart LR
  A["OpenFlow Runtime (SPCS)"] --> B["External Access Integration"]
  B --> C["Network Rule: PRIVATE_HOST_PORT"]
  C --> D["Snowflake outbound PrivateLink endpoint"]
  D --> E["AWS VPC Endpoint Service"]
  E --> F["Internal NLB"]
  F --> G1["Listener :3301"]
  F --> G2["Listener :3302"]
  G1 --> H1["Target Group 1 :3306"]
  G2 --> H2["Target Group 2 :3306"]
  H1 --> I1["RDS MySQL A"]
  H2 --> I2["RDS MySQL B"]
~~~

NLB 的 Listener Port 是私网入口端口，Target Group 的端口是数据库实际监听端口。两个 MySQL 都使用 3306 没有关系；入口可以分别使用 3301 和 3302，再转发到各自 Target Group 的 3306。Listener Port 必须唯一，不能让两个数据库共用同一个 host:3306 入口，再期待 Connector 用数据库名称决定后端。

## AWS 侧：先让目标健康，再创建 Endpoint Service

### 为每个数据库创建独立 Target Group

使用 IP 类型 Target Group，协议 TCP，端口填写数据库实际监听端口：

| Target Group | Target 地址 | 协议/端口 |
|---|---|---|
| tg-mysql-a | RDS A 的私有 IP | TCP 3306 |
| tg-mysql-b | RDS B 的私有 IP | TCP 3306 |

将每个数据库的私有 IP 注册到对应 Target Group。RDS 安全组必须允许来自 NLB 安全组的数据库端口流量；安全组或 NACL 如果阻断 NLB 到数据库的 TCP 路径，Target Health 会变为 unhealthy。

如果目标是本地机房，而且地址不满足 NLB IP Target 的地址限制，可在 AWS VPC 内运行 TCP Proxy（例如 NGINX、HAProxy 或 Envoy 的 TCP 模式），再将 Proxy 的私有 IP 加入 Target Group。Proxy 到机房数据库的路径仍要由 VPN/Direct Connect、路由和防火墙单独保证。

### 创建 Internal NLB，并为不同数据库配置唯一 Listener

创建内部 NLB，为两个目标组分别增加 TCP Listener：

| NLB Listener | Forward to | 后端服务 |
|---|---|---|
| TCP 3301 | tg-mysql-a | RDS A:3306 |
| TCP 3302 | tg-mysql-b | RDS B:3306 |

生产环境还要按目标架构配置可用区、跨区负载均衡、健康检查和 NACL。不能只检查 NLB 对象创建成功。

### 创建 VPC Endpoint Service

将内部 NLB 关联到 VPC Endpoint Service，并记录 AWS 返回的 Service Name。建议保留手动接受 Endpoint Connection 的设置，这样在 Snowflake 请求创建连接后，AWS 管理员可以显式接受连接。

**停止点：** 在继续 Snowflake 配置前，先确认：
- Target Group 的 describe-target-health 结果为 healthy；
- NLB 状态为 active；
- 每个 Listener 转发到正确的 Target Group；
- 目标数据库安全组允许来自 NLB 的数据库端口；
- 已记录 NLB DNS Name、Endpoint Service Name 和 Listener Port。

如果目标组尚未健康，不要继续 provision Snowflake endpoint。否则会把 AWS 后端问题和 Snowflake endpoint 状态问题混在一起。

## Snowflake 侧：授权 Endpoint Service，再创建出站端点

### 将 Snowflake Account Principal 加入 AWS Endpoint Service

用 ACCOUNTADMIN 获取 Snowflake PrivateLink 配置信息：

~~~sql
SELECT
  key,
  value
FROM TABLE(
  FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_PRIVATELINK_CONFIG()))
);
~~~

在结果中找到 privatelink-account-principal，将对应 ARN 加入 AWS Endpoint Service 的 Allowed Principals。Endpoint Service 只接受被授权的 Snowflake principal；漏掉这一步时，后续 PrivateLink provision 或连接请求会失败。

### 创建 Snowflake PrivateLink Endpoint

使用 AWS Endpoint Service Name 和 NLB DNS Name 调用系统函数：

~~~sql
USE ROLE ACCOUNTADMIN;

SELECT SYSTEM$PROVISION_PRIVATELINK_ENDPOINT(
  '<endpoint_service_name>',
  '<nlb_dns_name>'
);
~~~

第一个参数是 AWS Endpoint Service Name，不是 RDS 地址；第二个参数是 NLB DNS Name，不带端口。数据库 Listener Port 在 Network Rule 和 Connector 连接配置中指定。

此函数需要 ACCOUNTADMIN，且端点创建是异步的。执行返回成功信息，不代表 AWS 连接已接受，也不代表 endpoint 已经可以使用。

### AWS 接受 Endpoint Connection，并确认两侧状态

在 AWS Endpoint Service 的 Endpoint Connections 中，接受 Snowflake 发起的连接请求。接受之后，再运行：

~~~sql
SELECT SYSTEM$GET_PRIVATELINK_ENDPOINTS_INFO();
~~~

对 AWS endpoint，返回 JSON 同时包含：
- endpoint_state：Snowflake 侧状态；CREATED 表示 Snowflake 已收到云服务商成功创建的响应；
- status：AWS 侧连接状态；Available 表示 endpoint 已创建并可使用。

**停止点：** 继续创建 Network Rule 前，应确认 endpoint_state 为 CREATED，且 AWS status 为 Available。仅看到 pendingAcceptance 或仅在 AWS 点击 Accept，并不足以证明 Snowflake endpoint 已完成配置。该函数依赖云平台状态，可能需要几分钟才能反映最终结果。

## 配置 Network Rule 和 External Access Integration

### Network Rule 要指向 NLB DNS 和唯一监听端口

~~~sql
CREATE OR REPLACE NETWORK RULE openflow_private_db_rule
  MODE = EGRESS
  TYPE = PRIVATE_HOST_PORT
  VALUE_LIST = (
    '<nlb_dns_name>:3301',
    '<nlb_dns_name>:3302'
  );
~~~

这里必须使用 NLB DNS Name，而不是 RDS 的原始 endpoint；端口使用前面定义的 Listener Port。DNS 名称使用小写形式，避免 VALUE_LIST 校验失败。多个私有目标通过同一 NLB 连接时，将所有已批准的 host:port 放进有限的 VALUE_LIST，不要用宽泛通配符开放任意目标。

### EAI 只允许这条 Network Rule

~~~sql
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION openflow_private_db_eai
  ALLOWED_NETWORK_RULES = (openflow_private_db_rule)
  ENABLED = TRUE;
~~~

创建 EAI 后，还需要进入 OpenFlow Runtime UI，将该 External Access Integration 关联到对应 Runtime。只创建 Network Rule 和 EAI，不代表 Runtime 已经获得这条出口能力。

接下来在 Connector 配置中分别使用 NLB DNS：
- MySQL A：NLB DNS + 3301；
- MySQL B：NLB DNS + 3302。

Connector 的用户名、密码、TLS 参数和数据库权限仍按各数据库要求配置。PrivateLink 只建立网络路径，不会创建数据库账号，也不会授予数据读取权限。

## 逐层验证和故障定位

| 现象 | 应先检查 | 下一步 |
|---|---|---|
| Target Group unhealthy | 数据库/Proxy 是否监听后端端口，安全组是否允许 NLB 流量 | 修复目标端口和网络策略，再确认健康 |
| Endpoint Connection 一直 Pending Acceptance | AWS Endpoint Service 是否接受 Snowflake Principal，是否接受了连接请求 | 检查 Allowed Principals 并接受连接 |
| endpoint_state 仍是 PENDING_CREATION | Snowflake provisioning 和云侧创建是否完成 | 再查询端点状态，检查云侧失败详情 |
| AWS status 不是 Available | AWS endpoint service connection 状态 | 检查拒绝/断开状态并修复后重新 provision |
| VALUE_LIST 无效 | NLB DNS 是否为小写，是否使用 NLB FQDN 和正确端口 | 修正 hostname:port，不要填写数据库原始域名 |
| 端点 Available 但 Connector 超时 | NLB Listener、Target Group、目标组健康、EAI 是否关联 Runtime | 用实际 Connector 流量逐层验证 |
| 一个数据库可连，另一个不可连 | Listener 与 Target Group 映射、端口和安全组 | 分别检查 3301 与 3302 对应链路 |

不要为了验证 PrivateLink 而把数据库临时开放到公网，也不要通过给 EAI 加通配符来掩盖端口映射或安全组问题。每个故障都应沿链路定位到具体一层。

## 生命周期和成本

删除资源也有顺序。先从 OpenFlow Runtime 解除 EAI，再删除 EAI 和 Network Rule，随后调用 SYSTEM$DEPROVISION_PRIVATELINK_ENDPOINT，最后删除 AWS Endpoint Service、NLB 和 Target Group。不要先删 NLB 再保留 Snowflake endpoint，否则会留下失效的 endpoint 配置。

NLB 的小时费用和 LCU、Endpoint Service、Snowflake PrivateLink endpoint 以及数据传输都会产生费用。多数据库共享一个 NLB 能减少入口资源，但仍要为 Listener、Target Group、健康检查和网络策略分别做变更管理。

## 常见误区

- **把 SPCS 出站 PrivateLink、OpenFlow DCP 和 Runtime UI PrivateLink 当作同一方案。** 它们解决的运行环境和连接方向不同。
- **让两个数据库共用同一个 NLB Listener Port。** 即使后端端口相同，入口也要通过不同 Listener 区分。
- **直接用 RDS DNS 创建 Network Rule。** 该方案要连接的是 NLB DNS 和 Listener Port。
- **只接受 AWS Endpoint Connection，不检查 Snowflake endpoint 状态。** 还要确认 endpoint_state=CREATED 与 AWS status=Available。
- **在 Endpoint Available 前创建 Network Rule。** 应按依赖顺序等待端点就绪。
- **忘记将 EAI 关联到 OpenFlow Runtime。** EAI 和 Network Rule 对象存在，不代表 Runtime 已绑定。
- **只验证 SQL 对象创建成功。** 必须从实际 Connector 发起连接，并确认正确的 Listener/Target Group 收到流量。
- **把网络可达当作数据库授权。** 用户、凭据、数据库权限和 TLS 仍要独立配置。
- **删除 AWS NLB 前不处理 Snowflake endpoint。** 清理应按 Snowflake 侧到 AWS 侧顺序进行。

## 完成标准

- [ ] 能区分 SPCS outbound PrivateLink、OpenFlow DCP 和 Runtime UI PrivateLink。
- [ ] 能按每个数据库创建 IP 类型 Target Group，并使用唯一 NLB Listener Port 映射。
- [ ] 能解释 Endpoint Service 的 Allowed Principals 和手动接受连接。
- [ ] 能使用 SYSTEM$GET_PRIVATELINK_CONFIG 获取 Snowflake Account Principal。
- [ ] 能调用 SYSTEM$PROVISION_PRIVATELINK_ENDPOINT，并解释两个参数的含义。
- [ ] 能通过 SYSTEM$GET_PRIVATELINK_ENDPOINTS_INFO 检查 endpoint_state 与 AWS status。
- [ ] 能创建 PRIVATE_HOST_PORT Network Rule 和 External Access Integration。
- [ ] 能将 EAI 关联到 OpenFlow Runtime，并从 Connector 端验证实际连接。
- [ ] 能按顺序清理配置并识别 PrivateLink/NLB 资源成本。

## 自测

1. 两个 MySQL 都监听 3306，为什么不能直接在 NLB 上给它们配置同一个入口端口？请给出一组 Listener 到 Target Group 的映射。
2. AWS Endpoint Service 已创建，Snowflake 的 SYSTEM$PROVISION_PRIVATELINK_ENDPOINT 也返回成功。为什么此时还不能创建 Network Rule？
3. SYSTEM$GET_PRIVATELINK_ENDPOINTS_INFO 返回 endpoint_state=CREATED，但 AWS status 仍为 Pending。此时是否应开始 Connector 测试？
4. Network Rule 中应该写 RDS DNS 还是 NLB DNS？端口应该是 3306 还是自定义 Listener Port？
5. EAI 和 Network Rule 已经创建，但 OpenFlow Connector 仍然连接失败。需要检查哪一步是否遗漏？
6. 数据源位于本地机房且目标 IP 不适合直接注册到 NLB IP Target Group。为什么可能需要 VPC 内 TCP Proxy？
7. 为什么删除 NLB 前应该先解除 EAI 并 deprovision Snowflake endpoint？

## 参考资料

- [Snowflake-Labs: OpenFlow PrivateLink Setup](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/openflow-spcs-privatelink)
- [Manage private connectivity endpoints: AWS](https://docs.snowflake.com/en/user-guide/private-manage-endpoints-aws)
- [SYSTEM$PROVISION_PRIVATELINK_ENDPOINT](https://docs.snowflake.com/en/sql-reference/functions/system_provision_privatelink_endpoint)
- [SYSTEM$GET_PRIVATELINK_ENDPOINTS_INFO](https://docs.snowflake.com/en/sql-reference/functions/system_get_privatelink_endpoints_info)
- [CREATE NETWORK RULE](https://docs.snowflake.com/en/sql-reference/sql/create-network-rule)
- [Creating and using an external access integration](https://docs.snowflake.com/en/developer-guide/external-network-access/creating-using-external-network-access)
- [AWS: Create a service powered by AWS PrivateLink](https://docs.aws.amazon.com/vpc/latest/privatelink/create-endpoint-service.html)
- [AWS: Health checks for Network Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/target-group-health-checks.html)
