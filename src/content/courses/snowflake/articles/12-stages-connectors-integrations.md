# Stage、File Format、Connector 与外部集成

## 文件摄取的三个基本对象

Stage 描述文件所在位置；File Format 描述如何解析文件；COPY INTO 负责把数据加载到目标表或从表中卸载。三者职责不同，配置应显式版本化。

内部 Stage 由 Snowflake 管理；外部 Stage 指向云对象存储并通过 Storage Integration 等受控方式访问。不要把云访问密钥硬编码在 SQL、Notebook 或应用配置里。

## 文件加载与卸载

~~~sql
CREATE FILE FORMAT RAW.JSON_FORMAT
  TYPE = JSON
  STRIP_OUTER_ARRAY = TRUE;

CREATE STAGE RAW.ORDERS_STAGE
  URL = 's3://example-data/orders/'
  STORAGE_INTEGRATION = S3_ORDERS_INT
  FILE_FORMAT = RAW.JSON_FORMAT;

COPY INTO RAW.ORDERS
FROM @RAW.ORDERS_STAGE
MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
~~~

生产中还要管理文件清单、命名约定、批次 ID、重复加载、错误行策略、加载历史和重放。数据导出可用 COPY INTO location，但需要同时治理目的端加密、访问权限和保留策略。

## Connector 与 Integration

Connector 是连接系统的客户端或托管组件；Integration 是 Snowflake 内的安全配置对象，通常用于定义云存储、通知或外部访问的信任关系。不要把安装了 Connector 当成已经完成了认证和权限治理。

选型时先识别来源系统、数据形态、延迟、吞吐、重试机制和网络位置，再比较 Openflow、Kafka Connector、Snowpipe、Snowpipe Streaming 或自建 ETL。

## 外部网络和私网

需要 Snowflake 访问外部 API 时，应核对 Network Rule、External Access Integration、Secret、允许的主机和凭据作用域。最小化出站目标；凭据要定期轮换并避免出现在查询文本、日志或模型上下文中。私网连接还涉及云网络配置和账户支持范围，不能只配置 SQL 对象就假定链路可达。

## 运维检查

1. 文件到达后是否生成事件通知。
2. Stage 是否可访问，File Format 是否与源文件一致。
3. COPY 结果的加载行数、拒绝行和文件状态。
4. Connector 的 offset、重试、重复投递和错误队列。
5. 访问凭据、网络规则和外部集成是否符合最小权限。

## 检查题

1. Stage、File Format 和 COPY INTO 的职责如何区分？
2. Storage Integration 为什么优于在脚本里保存云访问密钥？
3. Connector 重试时需要怎样避免重复业务数据？
