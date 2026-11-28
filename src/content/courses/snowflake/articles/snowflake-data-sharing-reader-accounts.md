# Snowflake Data Sharing 与 Reader Account

## 对方没有 Snowflake 账号，为什么还能读你的数据

合作方需要每周读取供应商目录，但没有自己的 Snowflake 账户。直接 Share 可以把 Snowflake 数据共享给另一个 Snowflake Account；Reader Account 则让没有 Snowflake 许可的消费者也能通过 Snowflake 查询共享数据。

这两种方式的计费、身份管理和区域限制不同。不要把 Reader Account 当作普通消费者账户的免费替代品：它由数据提供方创建并拥有，相关账户成本由提供方承担。

## Direct Share 共享对象，不复制数据

Provider 创建 Share，再授予 Share 对 Database、Schema 和 Table 的必要权限：

~~~sql
CREATE SHARE PARTNER_CATALOG;

GRANT USAGE ON DATABASE SUPPLY_DB
  TO SHARE PARTNER_CATALOG;

GRANT USAGE ON SCHEMA SUPPLY_DB.PUBLISHED
  TO SHARE PARTNER_CATALOG;

GRANT SELECT ON TABLE SUPPLY_DB.PUBLISHED.PRODUCTS
  TO SHARE PARTNER_CATALOG;

ALTER SHARE PARTNER_CATALOG
  ADD ACCOUNTS = PARTNER_ACCOUNT_LOCATOR;
~~~

Consumer 可以从 Provider 提供的 Share 创建只读 Database：

~~~sql
CREATE DATABASE PARTNER_PRODUCTS
  FROM SHARE PROVIDER_ACCOUNT.PARTNER_CATALOG;
~~~

Share 不会把数据复制到消费者存储账户；消费者查询时使用自己的 Virtual Warehouse，因此标准 Direct Share 场景下，Provider 支付存储，Consumer 支付自己使用的计算资源。共享对象是只读的，消费者不能修改或删除提供方数据。Provider 可以随时撤销 Share 或移除消费者账户，移除后消费者立即失去访问。

## 区域和云平台决定使用 Direct Share 还是 Listing

Direct Share 要求 Provider 和 Consumer 位于同一 Snowflake Region。若要跨 Region 或跨云平台，应使用 Listing 的 Cross-Cloud Auto-Fulfillment 或适用的数据复制能力。Listing 还适合 Marketplace 发布、数据产品说明、样例查询、付费访问和消费者使用情况分析。

对于外部企业，不能因为两边都是 Snowflake 就默认可以直接 Share。先核对 Region、Cloud Platform、组织策略和消费者账户标识，再选择 Direct Share、Listing 或 Replication。

## Reader Account 面向没有 Snowflake 账户的消费者

Reader Account 由 Provider 创建、管理和拥有，Consumer 不需要有独立 Snowflake 许可账户。Reader Account 只能消费创建它的 Provider 所提供的共享数据，不能作为普通独立 Snowflake 账户运行完整的写入工作负载。

Provider 对 Reader Account 的账户和使用成本负责，包括其所需的计算资源与相关存储成本；应在产品定价和合同里明确成本归属。Reader Account 不是让消费者免费运行查询，也不是向消费者开放 Provider 整个账户。

消费者身份、用户管理、Warehouse 和网络访问由 Provider 负责建立。Provider 应创建独立 Reader Account，而不是把合作伙伴用户直接加到内部账户中。对 Reader Account 数据集也应使用 Secure View、受限 Share 和最少必要对象，避免直接暴露内部原始表。

## 共享前要先做数据产品边界设计

共享对象应通过专用 Schema 或 Secure View 对外发布。敏感列用 Masking Policy，行范围用 Row Access Policy 或按消费者拆分视图。共享对象的结构变化也应纳入兼容管理，因为消费者可能将字段映射到自己的下游系统。

在 Reader Account 场景中，Provider 还要负责消费者账号的生命周期、用户、计算资源和用量监控。Direct Share 场景则由 Consumer 自己管理查询 Warehouse 和用户权限。两种模式的运维分工并不相同。

## 费用与治理检查

| 项目 | Direct Share | Reader Account |
| --- | --- | --- |
| 消费者是否已有 Snowflake 账户 | 需要 | 不需要 |
| 数据存储 | 不复制共享数据 | 仍由 Provider 管理 |
| 查询计算费用 | Consumer 自己的账户承担 | Provider 对 Reader Account 成本负责 |
| 区域约束 | Direct Share 需同 Region | 由 Provider 创建并管理 |
| 身份管理 | Consumer 管理自己的用户和角色 | Provider 管理 Reader Account 用户 |
| 适合场景 | 已有 Snowflake 的企业伙伴 | 没有 Snowflake 账户的合作方 |

正式共享前要核对数据分类、授权对象、消费者身份、Region、费用预算、撤销流程、用量监控和隐私要求。对外提供数据不应直接把内部开发 Schema 当成产品接口。

## 常见误解

- 把 Share 当成数据复制，误以为消费者会占用 Provider 的存储副本。
- 认为消费者可以修改 Share 中的 Table。
- 在跨 Region 场景仍使用 Direct Share。
- 把 Reader Account 当成消费者自行付费的普通 Snowflake Account。
- 忽略 Reader Account 用户、Warehouse 和成本都由 Provider 负责。
- 直接共享内部表，未通过 Secure View/Policy 限定对外数据。

## 自测

1. Direct Share 为什么可以不复制底层表数据？
2. 标准 Direct Share 的计算费用由谁承担？存储费用由谁承担？
3. 为什么跨 Region 的消费者应考虑 Listing 或跨区域复制？
4. Reader Account 为什么由 Provider 创建、管理和承担成本？
5. Provider 撤销 Share 后，Consumer 对共享数据的访问会发生什么？

## 参考资料

- [About Secure Data Sharing](https://docs.snowflake.com/en/user-guide/data-sharing-intro)
- [Create and configure shares](https://docs.snowflake.com/en/user-guide/data-sharing-provider)
- [Consuming shared data](https://docs.snowflake.com/en/user-guide/data-sharing-consumer)
- [Share data across regions and cloud platforms](https://docs.snowflake.com/en/user-guide/data-sharing-across-regions)
- [Reader accounts](https://docs.snowflake.com/en/user-guide/reader-accounts)
