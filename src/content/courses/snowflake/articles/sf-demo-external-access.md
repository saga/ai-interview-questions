# 外部访问集成与端点安全

## 本节要解决的问题

数据质量团队需要在 Snowflake 中调用合作方的地址标准化 API。开发人员先在 Python UDF 里直接写了 API 地址和 Token，功能跑通了，但安全团队无法回答三个问题：函数还能访问哪些外部主机？谁可以使用这份 Token？如果合作方超时或限流，重复调用会不会造成额外费用？

Snowflake 的 External Network Access 不是“给 Warehouse 开互联网”。它为 UDF 或 Stored Procedure 的 Handler 提供受控出站访问，必须明确允许的网络目的地和凭据。网络规则、Secret、External Access Integration 与函数/过程的绑定共同构成访问边界。

## 核心知识

### Network Rule 限制允许访问的外部目的地

出站网络规则使用 MODE = EGRESS。公共互联网主机通常使用 HOST_PORT，规则中可以指定主机名和端口；不写端口时，外部访问默认使用 443。

~~~sql
CREATE OR REPLACE NETWORK RULE partner_api_egress
  MODE = EGRESS
  TYPE = HOST_PORT
  VALUE_LIST = ('api.partner.example.com');
~~~

如果只允许一个服务，就不要把整个域名后缀、IP 段或一组无关主机都放进去。Snowflake 按 IP 粒度执行网络规则，不会检查应用层请求最终访问的是不是预期业务 API。配置 DNS、证书和主机名时仍要防止同一主机上存在不可信服务。

若外部服务位于私有网络，可以评估 PRIVATE_HOST_PORT 和 Private Connectivity。Snowflake 的外部私有连接要求 Business Critical Edition 或更高；普通公网出站不需要因为使用 External Access Integration 就升级到该 Edition。

### Secret 保存凭据，Integration 决定凭据和网络规则是否可用

不要在 SQL、Notebook 或 Python Handler 中写长期 Token。先把凭据保存为 Secret：

~~~sql
CREATE OR REPLACE SECRET partner_api_token
  TYPE = GENERIC_STRING
  SECRET_STRING = '<由安全流程注入的 token>';
~~~

再创建 External Access Integration，把允许的网络规则和凭据范围绑定起来：

~~~sql
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION partner_api_access
  ALLOWED_NETWORK_RULES = (partner_api_egress)
  ALLOWED_AUTHENTICATION_SECRETS = (partner_api_token)
  ENABLED = TRUE;
~~~

Integration 并不会自动让所有函数都可以访问外网。调用方还必须在 CREATE FUNCTION 或 CREATE PROCEDURE 中声明 EXTERNAL_ACCESS_INTEGRATIONS，并通过 SECRETS 参数将 Secret 绑定到 Handler 里的别名。只有被 Integration 允许的 Secret 才能绑定。

对服务到服务认证，优先评估短期凭据或 Workload Identity Federation，避免自己维护长期 Token 的轮换。是否能使用 WIF，取决于外部服务的 OIDC 信任配置和目标云环境。

### UDF 或 Stored Procedure 需要显式绑定访问能力

下面的 UDF 演示访问合作方单条记录的场景。它不是把 API Token 写入代码，而是用 Secret 别名取出凭据：

~~~sql
CREATE OR REPLACE FUNCTION lookup_partner_status(order_id VARCHAR)
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python', 'requests')
HANDLER = 'get_status'
EXTERNAL_ACCESS_INTEGRATIONS = (partner_api_access)
SECRETS = ('cred' = partner_api_token)
AS
$$
import _snowflake
import requests

def get_status(order_id):
    token = _snowflake.get_generic_secret_string('cred')
    url = 'https://api.partner.example.com/v1/orders/' + order_id
    response = requests.get(
        url,
        headers={'Authorization': 'Bearer ' + token},
        timeout=5,
    )
    response.raise_for_status()
    payload = response.json()
    return payload.get('status')
$$;
~~~

这里的 EXTERNAL_ACCESS_INTEGRATIONS 控制网络访问范围，SECRETS 只把允许的 Secret 映射到 Handler 变量。调用函数的 Role 还需要具备相应的函数 USAGE 和其他对象访问权限；创建 Network Rule、Secret、Integration 和函数也各自需要不同的管理权限。

**不要在数百万行查询中直接对每行调用远端 API。** 这会放大请求量和延迟，容易触发限流，也会让查询结果受外部服务状态影响。对于批量同步，应优先使用批量接口、受控 Stored Procedure 或独立数据接入流程，并将外部响应落地后再做集合式 SQL 转换。

### 超时、限流和不确定响应必须成为数据管道的一部分

外部 API 可能返回 429、5xx、超时、空响应、字段缺失或格式变化。raise_for_status() 能让 HTTP 错误显式失败，但不能替代完整的重试策略。

- 429：遵守 Retry-After，限制并发和重试次数。
- 5xx：使用有限重试和退避；达到上限后隔离失败请求。
- 超时：不能假设服务端没有处理请求，写操作要依赖业务幂等键。
- 4xx：通常先修正请求或凭据，不要对永久性错误无限重试。
- Schema 变化：校验必需字段、类型和状态枚举，不要直接把未知值当成成功。

如果请求会修改合作方状态，必须传送可重复使用的幂等键，或者在调用前后查询操作状态。超时可能发生在服务端已完成操作、客户端尚未收到响应的时候。

## 工程实施步骤

1. 确认调用方向是 Snowflake 到外部服务的 EGRESS，而不是用户进入 Snowflake 的 INGRESS。
2. 逐项列出主机名、端口、协议、认证方式和数据敏感级别，Network Rule 只允许必要的目标地址。
3. 由安全负责人创建 Secret 和 External Access Integration；凭据不得写入 SQL 文件、Notebook 或仓库。
4. 对服务到服务身份评估短期 OAuth Token 或 Workload Identity Federation，避免长期共享密码。
5. 创建 UDF/Procedure 时显式绑定 EXTERNAL_ACCESS_INTEGRATIONS 和 SECRETS，并由相应 Role 执行最小权限 GRANT。
6. 使用测试端点验证 2xx、4xx、429、5xx、超时、空响应和错误 JSON；记录 Query ID 与外部请求关联 ID。
7. 设置超时、有限重试、退避、并发上限和失败隔离；若写外部系统，定义幂等键与重复请求检查。
8. 评估是否需要把调用改成批量接口或异步摄取，避免大规模 SQL 查询直接放大远端请求。
9. 监控成功率、状态码、延迟、重试次数、凭据失效和外部服务变更；定期审查 Network Rule 与 Secret 的使用范围。
10. 轮换凭据时先创建新 Secret、验证新凭据，再切换 Handler 绑定并撤销旧凭据，避免在生产中直接替换导致不可恢复的故障。

## 场景分析

合作方地址标准化 API 允许每秒 50 次请求。一个历史回填作业要处理 200 万条客户地址。如果直接执行 SELECT lookup_partner_status(address) FROM customers，查询会产生远超合作方限额的请求，甚至多次重试同一地址。

正确做法是先在 Snowflake 端对地址去重，生成有限的待处理集合；按批次调用合作方的批量 API；把返回的 address_id、标准地址、状态码和处理时间落到结果表；最后用 SQL 将标准地址关联回客户。对 429 响应按 Retry-After 延迟重试，对永久失败写入隔离表，并保留请求 ID 供人工处理。

如果只是网络连接失败，应先区分 DNS/端点不可达、Integration 未启用、Network Rule 不匹配、Secret 未被允许以及外部 Token 失效。不能把所有错误都归为“API 不稳定”，也不能通过放开整个公网出口来绕过配置问题。

## 常见误区

- **把 External Access Integration 当成整个账户的互联网开关。** 它只为显式绑定它的 UDF/Procedure 提供受控出站访问。
- **只配置 Network Rule，不配置 Secret 与 Handler 绑定。** 网络目的地和认证凭据是两条独立的控制边界。
- **把 Token 写在代码或 Notebook 中。** 凭据应放入 Secret 或使用合适的短期工作负载身份。
- **把网络可达当成业务请求成功。** 还要检查 HTTP 状态、响应 Schema、超时、限流和业务字段。
- **对所有错误无限重试。** 4xx、429、5xx 和超时需要不同策略；写请求必须考虑幂等性。
- **在大查询里逐行调用外部 API。** 请求数量、并发和失败重试可能远超外部服务限额，应先去重并使用批量/异步模式。
- **认为 Private Connectivity 在所有 Edition 都可用。** 外部私有连接需要 Business Critical 或更高 Edition。

## 完成标准

- [ ] 能解释 Network Rule、Secret、External Access Integration 和 Handler 之间的关系。
- [ ] 能配置最小范围的 EGRESS 主机和端口。
- [ ] 能说明 UDF/Procedure 为什么必须显式声明 Integration 和 Secret。
- [ ] 能区分公网访问、Private Connectivity 和 Workload Identity Federation 的用途。
- [ ] 能设计超时、限流、重试、幂等和失败隔离。
- [ ] 能判断何时不应逐行调用外部 API，而应采用批量或异步接入。

## 自测

1. UDF 已声明 EXTERNAL_ACCESS_INTEGRATIONS，但 Handler 仍无法读取 Token。还要检查 Secret 的哪两处绑定？
2. 合作方只开放 api.partner.example.com:443。Network Rule 应如何限制目的地？为什么不应将整个公网地址范围开放？
3. API 返回 429 并带有 Retry-After。作业应该如何处理，而不是立即重试？
4. 客户地址回填处理 200 万行。为什么不能直接逐行调用 UDF？应该先怎样组织批量请求？
5. POST 请求超时，但合作方可能已经完成更新。如何避免自动重试造成重复操作？

## 参考资料

- [Creating and using an external access integration](https://docs.snowflake.com/en/developer-guide/external-network-access/creating-using-external-network-access)
- [External network access overview](https://docs.snowflake.com/en/developer-guide/external-network-access/external-network-access-overview)
- [External network access examples](https://docs.snowflake.com/en/developer-guide/external-network-access/external-network-access-examples)
- [Workload identity federation for outbound access](https://docs.snowflake.com/en/user-guide/workload-identity-federation-outbound)
- [Network rules](https://docs.snowflake.com/en/user-guide/network-rules)
