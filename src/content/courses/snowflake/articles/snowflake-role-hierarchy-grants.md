# 系统角色、自定义角色与权限继承

## 为什么一个用户能创建 Warehouse，却不能授予别人表权限

Snowflake 的系统角色不是简单的职级列表。ACCOUNTADMIN、SECURITYADMIN、USERADMIN 和 SYSADMIN 拥有不同管理职责。把所有工作都放在 ACCOUNTADMIN 下，虽然可以绕过很多授权问题，却会让日常任务拥有过大的权限面。

真正需要理解的是：系统角色之间存在默认继承关系；自定义 Account Role 也可以建立层级；Database Role 只在其所属 Database 内使用。这三种边界不能混为一谈。

## 四个常用系统角色各管什么

- ACCOUNTADMIN：最高层账户管理角色，继承 SYSADMIN 与 SECURITYADMIN 的权限，应限制在少数受控管理员手中。
- SECURITYADMIN：默认拥有全局 MANAGE GRANTS，可管理对象授权，并继承 USERADMIN 的用户/角色管理能力；它不因拥有 MANAGE GRANTS 就自动拥有创建所有对象的权限。
- USERADMIN：负责创建与管理用户和角色，拥有 CREATE USER、CREATE ROLE 等能力。
- SYSADMIN：负责 Warehouse、Database 和数据库对象等系统资源；自定义业务角色应最终授予 SYSADMIN，使系统管理员能够管理其拥有的对象。
- PUBLIC：自动授予所有用户和角色。它可以拥有对象，因此把敏感对象授给 PUBLIC 等于向所有用户开放。

USERADMIN 作为 SECURITYADMIN 的子角色、SECURITYADMIN 和 SYSADMIN 又被 ACCOUNTADMIN 继承，这是默认系统角色层级。不要把这种系统继承与自定义业务角色继承混为一谈。

## 自定义 Account Role 的推荐层级

常见模式是先建立对象/业务角色，再建立职责角色，最后将顶层自定义角色授予 SYSADMIN：

~~~sql
CREATE ROLE orders_read_role;
CREATE ROLE orders_operator_role;
CREATE ROLE support_app_role;

GRANT USAGE ON DATABASE ANALYTICS_DB TO ROLE orders_read_role;
GRANT USAGE ON SCHEMA ANALYTICS_DB.MART TO ROLE orders_read_role;
GRANT SELECT ON TABLE ANALYTICS_DB.MART.ORDERS TO ROLE orders_read_role;

GRANT ROLE orders_read_role TO ROLE support_app_role;
GRANT ROLE support_app_role TO ROLE SYSADMIN;
GRANT ROLE support_app_role TO USER service_user;
~~~

Snowflake 的角色授权方向要读清楚：把一个角色授给另一个角色后，接收者继承被授角色的权限。将自定义顶层角色授予 SYSADMIN，目的是让 SYSADMIN 能管理由该角色拥有的对象；不要反向把 SYSADMIN 授给业务功能角色。

若自定义角色没有沿角色层级授予 SYSADMIN，SYSADMIN 就无法自动管理它拥有的对象。只有拥有 MANAGE GRANTS 的角色（默认 SECURITYADMIN）能跨这个边界管理对象授权，但 MANAGE GRANTS 不自动授予对象创建或查询权限。

## Account Role 与 Database Role 的使用范围不同

Account Role 在账户范围定义，可管理 Warehouse、用户、数据库对象和跨 Database 的权限组合。Database Role 隶属于某个 Database，只能用于该 Database 的对象授权，适合把某个数据产品或 Database 内的权限封装起来。

Database Role 不能直接授予用户，必须先授给 Account Role，再由 Account Role 授予用户或其他角色。Database Role 也不能授予 SYSADMIN 等账户系统角色，不能用于管理账户级对象。若要使用数据库角色访问多个 Database，应通过对应的 Account Role 组合，而不是试图跨库授予 Database Role。

## GRANT OPTION、OWNERSHIP 与 MANAGE GRANTS 不是一回事

普通对象权限授予时，可以使用 WITH GRANT OPTION，让接收角色继续授予同一权限。它不会赋予对象所有权，也不等同于全局 MANAGE GRANTS。

OWNERSHIP 是对象所有权。对象 Owner 可以管理对象的属性和授权，但 Managed Access Schema 会把对象 Grant 决策集中到 Schema Owner 或拥有 MANAGE GRANTS 的角色。Database Role 的 OWNERSHIP 与 Account Role 的全局授权能力也不应混淆。

## 角色层级变更要做图和有效权限验证

授权前先列出角色继承图，检查：
- 是否存在不必要的多级父子链或循环依赖。
- 自定义对象 Owner 角色是否最终授予 SYSADMIN。
- 账户级安全管理员与业务对象管理职责是否分离。
- PUBLIC 是否拥有敏感对象。
- Database Role 是否通过 Account Role 正确分配。
- WITH GRANT OPTION 是否只授予可信的管理角色。

变更后使用 SHOW GRANTS TO ROLE、SHOW GRANTS OF ROLE、SHOW GRANTS ON 等命令检查授权，再分别用业务用户和管理员角色验证允许与拒绝的操作。角色名称不能作为权限事实，实际 Grant 才是证据。

## 常见层级错误

- 把 SYSADMIN 当成管理用户和角色的角色。
- 给业务角色授予 ACCOUNTADMIN，导致权限无法收敛。
- 自定义对象 Owner 角色不授予 SYSADMIN，之后系统管理员无法管理其对象。
- 把 Database Role 直接授予用户，忽略必须经过 Account Role。
- 把 WITH GRANT OPTION 当作 OWNERSHIP。
- 误以为 MANAGE GRANTS 同时拥有对象 SELECT、CREATE 或 USAGE。

## 自测

1. 为什么 SYSADMIN 可以创建 Warehouse，却不应承担日常用户管理？
2. SECURITYADMIN 拥有 MANAGE GRANTS，为什么仍不等于它能自动创建所有数据库对象？
3. 将自定义角色授予 SYSADMIN 后，权限继承方向是什么？
4. Database Role 为什么必须先授予 Account Role 才能分配给用户？
5. PUBLIC 对象所有权为什么可能造成意外的数据暴露？

## 参考资料

- [Overview of access control](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [Access control best practices](https://docs.snowflake.com/en/user-guide/security-access-control-considerations)
- [Access control privileges](https://docs.snowflake.com/en/user-guide/security-access-control-privileges)
- [Database roles](https://docs.snowflake.com/en/user-guide/security-access-control-overview#database-roles)
