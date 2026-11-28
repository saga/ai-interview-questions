# Snowflake 最小权限：角色分层与受控写入

## 服务只需要更新一列，为什么却拿到了整张库的 OWNERSHIP

一个订单处理服务每天只需把状态从 PENDING 更新为 APPROVED。为了减少权限配置工作，部署人员把 SYSADMIN 凭证放进自动化任务。凭证一旦泄露，攻击者就不止能更新状态，还可能删除对象、读取敏感数据或扩大授权。

最小权限要把用户、服务、对象访问和业务操作分开设计，并让数据库约束每个入口。

## 将对象访问角色与功能角色分开

对象访问角色只表达对某些 Database、Schema、表和 Warehouse 的权限；功能角色组合业务岗位需要的对象访问角色。后者授予用户或服务，前者则由平台团队维护。

~~~sql
CREATE ROLE orders_read_role;
CREATE ROLE order_processor_role;

GRANT USAGE ON DATABASE ANALYTICS_DB TO ROLE orders_read_role;
GRANT USAGE ON SCHEMA ANALYTICS_DB.MART TO ROLE orders_read_role;
GRANT SELECT ON TABLE ANALYTICS_DB.MART.ORDERS TO ROLE orders_read_role;

GRANT ROLE orders_read_role TO ROLE order_processor_role;
~~~

示例只表达读取权限。Warehouse 的 USAGE/MONITOR 与表的 SELECT/UPDATE 应分别授予。自动化脚本不应以 ACCOUNTADMIN 运行；日常对象操作放在专用角色层级，账户级用户管理和全局授权管理由相应管理角色承担。

## Future Grants 与 Managed Access Schema 解决不同问题

Future Grants 按对象类型授权未来对象：

~~~sql
GRANT SELECT ON FUTURE TABLES IN SCHEMA ANALYTICS_DB.MART
  TO ROLE ANALYST_READ_ROLE;
~~~

这条授权只覆盖未来 Table，不自动包含 View、Stage 或其他对象类型。已有对象要另行使用 ON ALL TABLES 等授权。普通 Schema 中对象 Owner 可以授予对象权限；Managed Access Schema 则将 Grant 决策集中到 Schema Owner 或拥有 MANAGE GRANTS 的角色。后者有利于集中治理，但团队必须接受由 Schema 层统一授权。

## Owner's Rights Procedure 适合封装一个窄业务动作

当服务不应直接持有目标表 UPDATE 权限时，可以用专用 Owner Role 创建有限业务接口：

~~~sql
CREATE OR REPLACE PROCEDURE APP_API.SET_ORDER_STATUS(
  P_ORDER_ID NUMBER,
  P_STATUS VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
BEGIN
  IF (P_STATUS NOT IN ('APPROVED', 'REJECTED')) THEN
    RETURN 'INVALID_STATUS';
  END IF;

  UPDATE ANALYTICS_DB.MART.ORDERS
    SET STATUS = :P_STATUS
    WHERE ORDER_ID = :P_ORDER_ID
      AND STATUS = 'PENDING';

  RETURN 'REQUEST_PROCESSED';
END;
$$;

GRANT USAGE ON PROCEDURE APP_API.SET_ORDER_STATUS(NUMBER, VARCHAR)
  TO ROLE ORDER_PROCESSOR_ROLE;
~~~

这个入口仍要验证调用者是否能操作这笔订单、是否存在跨租户访问、更新行数是否符合预期、如何记录请求 ID，以及重复请求是否幂等。Owner's Rights 只改变过程内 SQL 的权限上下文，不代表调用者输入可信。不要接受任意表名或拼接 SQL，否则有限业务接口可能变成任意 SQL 执行入口。

## Caller's Rights 与 Owner's Rights 的取舍

Caller's Rights 沿用调用者权限，适合操作范围应严格受用户授权约束的场景。Owner's Rights 使用过程 Owner 权限，适合把高权限操作封装成有限接口，但需要严格校验输入、记录调用并缩小目标对象范围。

选择时先问：这个动作是否应该由每个调用者直接完成？若不是，为什么需要提升权限？能否把提升后的能力缩小到一个业务动作？若无法回答，就不要用 Owner's Rights。

## 权限验收要同时测试允许和拒绝

服务角色应能读取指定 View，却不能读取 HR/Finance 敏感表；可以通过 Procedure 更新指定状态，却不能直接 UPDATE 目标表；撤销功能角色后，服务应失去调用能力。新建表时还要确认 Future Grants 没有扩大到未批准的对象类型。

## 常见权限误区

- 把隐藏按钮当成数据库权限隔离。
- 给服务 ACCOUNTADMIN 或全库 OWNERSHIP，认为部署更省事。
- 使用 Owner's Rights 过程，却允许任意对象名或未经验证的参数。
- 以为 Database 级和 Schema 级 Future Grants 一定叠加。
- 使用 Managed Access Schema 后，仍期待对象 Owner 自行授权。

## 自测

1. 服务只需更新订单状态，为什么不应直接得到整个 Schema 的 OWNERSHIP？
2. FUTURE TABLES 为什么不能据此推断未来 View 也会自动授权？
3. Managed Access Schema 中谁可以管理对象授权？
4. Owner's Rights Procedure 为什么仍需限制参数、目标对象和业务主键？
5. Caller's Rights 与 Owner's Rights 的核心区别是什么？

## 参考资料

- [Access control best practices](https://docs.snowflake.com/en/user-guide/security-access-control-considerations)
- [Access control privileges](https://docs.snowflake.com/en/user-guide/security-access-control-privileges)
- [Owner's rights and caller's rights stored procedures](https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-rights)
