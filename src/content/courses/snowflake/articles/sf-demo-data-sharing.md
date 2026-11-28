# 数据共享与应用交付

## 本节要解决的问题

把 Snowflake 数据共享设计成一个有明确发布者、消费者、对象范围、版本和撤销机制的数据产品。需要先判断消费者只需要读取数据，还是需要在其账户中安装运行一套应用；两者的交付机制和运维责任不同。

## 核心知识

### Secure Data Sharing 通过 Share 暴露选定对象，不复制数据

Provider 创建 Share，将数据库、Schema、Table、Secure View 等授权给 Share，再把 Consumer 账户加入 Share。消费者执行 CREATE DATABASE FROM SHARE 创建只读数据库，并在本地通过 Role/Grants 控制访问。共享数据不会复制到消费者账户，也不会占用消费者的数据存储；查询消耗消费者自己的 Warehouse 计算资源。

Provider 可以更新 Share 中已有对象的数据，消费者能在共享数据库中看到更新。Provider 也可以撤销 Share 或对象访问。数据共享因此是在线访问授权，不是导出一份可独立修改的数据副本。

### Database Role 能把共享对象权限细分给消费者

Provider 可以把对象权限直接授予 Share，也可以先在共享数据库中创建多个 Database Role，再将不同对象的权限授予不同角色并把角色授权给 Share。Consumer 将导入数据库的 Database Role 授予自己的 Account Role，实现消费者内部的权限分组。

没有共享 Database Role 时，消费者通常通过 IMPORTED PRIVILEGES 获得对共享数据库对象的访问；这对消费者内部细分权限不够灵活。需要分部门授权时，应优先设计数据库角色层次。

### Listing 是产品发现与分发，Native App 是应用安装

Direct Share 面向明确指定的 Snowflake 账户；Listing 可以提供产品说明、发现入口和消费者管理，适合面向多个账户分发数据产品。Listing 不替代底层对象授权，数据访问仍取决于 Share 及其 Grants。

Native App 的 Application Package 可连同代码、数据和 Setup Script 交付应用能力。消费者安装后可以配置应用角色和授予所需权限。如果只是读取数据，直接 Share 往往更简单；若交付可运行逻辑、界面和应用对象，再评估 Native App。

## 工程实施步骤

1. 定义 Provider、Consumer、数据 owner、目标账户和消费者使用场景，明确读取、二次分享和撤销要求。
2. 只共享消费者需要的数据库对象；敏感字段先通过 Secure View、Masking Policy 或 Row Access Policy 形成适当的数据产品接口。
3. 按消费权限边界创建 Share；若需消费者内部细粒度权限，使用 Database Role 分组对象权限。
4. 在 Share 中授予 Database/Schema USAGE 与目标对象 SELECT 权限，再通过 ALTER SHARE 添加 Consumer 账户。
5. 由消费者创建共享数据库，检查 imported database、Database Role 或 IMPORTED PRIVILEGES，并将权限授予本地业务角色。
6. 对跨区域/多云消费者核对 Listing、复制和区域限制；不能假定所有 Direct Share 路径都支持相同拓扑。
7. 如果需要应用运行能力，另行建立 Native App Package、Setup Script、Manifest、Application Roles 和版本升级测试。
8. 以消费者身份验证可读对象、不可读对象、实时更新、撤销访问及应用升级行为。
9. 建立产品版本、Schema 兼容、变更通知、消费者支持联系人和服务级目标，并定期审查访问清单。

示例：Provider 创建 Share 并暴露订单安全视图。

~~~sql
CREATE SHARE SALES_SHARE;

GRANT USAGE ON DATABASE SALES_DB TO SHARE SALES_SHARE;
GRANT USAGE ON SCHEMA SALES_DB.PUBLIC TO SHARE SALES_SHARE;
GRANT SELECT ON VIEW SALES_DB.PUBLIC.ORDER_SUMMARY_SECURE
  TO SHARE SALES_SHARE;

ALTER SHARE SALES_SHARE
  ADD ACCOUNTS = <consumer_account_identifier>;
~~~

消费者随后执行 CREATE DATABASE SHARED_SALES FROM SHARE <provider_account>.SALES_SHARE，再将共享数据库访问权限授予本地角色。

## 场景分析

总部要把区域销售汇总提供给日本和新加坡两个子公司。两个消费者都需要读取汇总数据，但日本财务只能访问收入指标，新加坡运营还需要产品分类和订单数量。

可以使用一个 Share 配合多个 Database Role 分组对象授权，也可以根据数据边界拆分 Share。若共享对象直接授予 Share 且消费者只获得 IMPORTED PRIVILEGES，则可能无法在消费者端细分到对象级权限。发布前应模拟两个消费者角色，确认各自只能看到需要的视图。

若未来将一套销售规划应用安装到消费者账户，则转为评估 Native App，而不是把数据共享对象与应用部署能力混为一谈。

## 常见误区

- 认为 Secure Data Sharing 会复制数据到消费者账户。共享数据通过 Snowflake 服务层暴露，消费者查询使用自己的计算资源。
- 把 Share 视为消费者角色。Share 是 Provider 创建的共享对象容器，消费者本地仍需设置 Role 和 Grants。
- 认为创建共享数据库后所有本地角色都能访问。消费者需要授予 IMPORTED PRIVILEGES 或共享 Database Role。
- 只用一个 Share 解决所有消费者权限差异。需要按对象范围或 Database Role 设计细分边界。
- 把 Listing 当成 Native App。Listing 是发现/分发入口；Native App 才是安装应用包并运行逻辑。
- 不验证撤销和版本变更。数据产品要有消费者通知、兼容策略和撤销演练。

## 完成标准

- [ ] 能说明 Share、Provider、Consumer 和导入数据库的关系。
- [ ] 能解释数据共享不复制数据及消费者计算费用。
- [ ] 能区分直接对象授权与 Database Role 授权。
- [ ] 能选择 Direct Share、Listing 或 Native App。
- [ ] 能设计消费者侧授权验证、版本更新和撤销流程。

## 自测

1. 数据共享后消费者账户没有复制表数据，查询时计算资源由哪一方承担？
2. 消费者内部的财务和运营团队需要访问不同对象，如何使用 Database Role 设计权限？
3. 如果 Provider 需要撤销某个消费者访问，Share 的哪些方面可以被调整？
4. 消费者只要读取数据集，为什么可能不需要 Native App？

## 参考资料

- [About Secure Data Sharing](https://docs.snowflake.com/en/user-guide/data-sharing-intro)
- [Share secure database objects](https://docs.snowflake.com/en/user-guide/data-sharing-gs)
- [Create and configure shares](https://docs.snowflake.com/en/user-guide/data-sharing-provider)
- [Consume imported data](https://docs.snowflake.com/en/user-guide/data-share-consumers)
