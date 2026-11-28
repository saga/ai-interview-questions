# PostgreSQL Roles、权限与最小权限

## 本节要解决的问题

使用 Role 和对象权限管理 PostgreSQL 用户、服务账户和应用访问，避免将超级用户或对象所有权授予普通服务。PostgreSQL 将用户和组统一建模为 Role；登录能力、Role Membership、对象 ACL 和 Schema 可见性是不同控制层，必须逐层配置。

## 核心知识

### Role 是身份、组和对象所有者的统一抽象

PostgreSQL 的 Role 可以拥有对象、获得权限并将权限授予其他 Role。带 LOGIN 属性的 Role 可以作为初始登录身份；不带 LOGIN 的 Role 常用于组角色和职责集合。CREATE USER 等价于 CREATE ROLE 加 LOGIN。

SUPERUSER、CREATEDB、CREATEROLE、REPLICATION 和 BYPASSRLS 等是角色属性，不是普通表权限。尤其 SUPERUSER 会绕过几乎所有权限检查，应仅用于数据库管理；业务服务不应因为需要读写一张表而获得这些属性。

### Role Membership、INHERIT 与 SET ROLE 控制权限使用方式

Role 可以通过 GRANT 成员关系把一组对象权限授予另一个 Role。默认情况下，Role Membership 通常允许继承被授予 Role 的对象权限；也可以通过 NOINHERIT 或 Membership 的 INHERIT/SET 选项改变继承与切换行为。

SET ROLE 会将当前权限检查身份切换为指定 Role；这与连接时使用的 session_user 不同。CURRENT_USER 返回当前权限检查身份，SESSION_USER 通常是最初连接用户。对于审计和 SECURITY DEFINER 函数，需要明确哪一个身份实际生效。

PostgreSQL 16+ 的 Membership Options 允许分别控制 INHERIT、SET 和 ADMIN 能力。设计跨版本系统时要确认目标版本；不能假设所有集群都支持完全相同的成员授权语法。

### 对象权限需要按 Database、Schema 和对象逐级授权

访问某张表通常需要连接目标 Database 的 CONNECT、Schema 的 USAGE 以及表的 SELECT/INSERT/UPDATE/DELETE 等权限。Schema CREATE 决定能否在该 Schema 中创建对象；USAGE 决定能否解析和访问其中对象。Sequence 有 USAGE、SELECT、UPDATE 等单独权限；函数/过程执行需要 EXECUTE。

对象 Owner 通常拥有完整控制权，能够授权给其他 Role。普通成员拥有 SELECT 并不意味着有权 ALTER 或 DROP 对象。对象权限也不会因为拥有 Schema USAGE 就自动获得表 SELECT。

### ALTER DEFAULT PRIVILEGES 只影响将来由指定 Role 创建的对象

ALTER DEFAULT PRIVILEGES 为某个创建者 Role 设置未来新对象的默认 Grant，不会自动修改已经存在的表。新对象权限受实际创建对象时使用的当前 Role 的默认权限影响；成员关系不会简单地把所有上层 Role 的默认权限继承下来。

因此，当迁移脚本使用 app_migrator 创建表时，应为 app_migrator 配置默认权限。若对象由另一个 owner Role 创建，默认授权就应针对那个创建者配置。表权限和 Sequence 权限也要分别处理。

## 工程实施步骤

1. 将登录用户、应用身份、只读组、写入组、迁移角色和管理员角色分别建模，避免让应用直接使用对象 Owner。
2. 为应用登录角色授予 LOGIN，不默认授予 SUPERUSER、CREATEDB、CREATEROLE 或 BYPASSRLS。
3. 创建无 LOGIN 的业务 Role，集中管理查询、写入、报表或运维职责，再通过 GRANT 将 Role Membership 授给登录用户。
4. 根据最小权限选择 Role Membership 的 INHERIT、SET 和 ADMIN 能力；目标版本支持时使用细粒度 Membership Options。
5. 授予 Database CONNECT、Schema USAGE 和具体对象权限；对需要创建对象的迁移角色单独授予 Schema CREATE。
6. 按对象类型授予权限：表、序列、函数/过程、Schema 和 Database 各自检查，不把表 SELECT 当成完整访问权限。
7. 设置默认权限时明确对象创建者 Role 和目标 Schema；分别为 TABLES、SEQUENCES 和 FUNCTIONS/ROUTINES 设置必要 Grant。
8. 使用 SET ROLE 验证运行时身份；查询 current_user、session_user 和 pg_roles/系统权限视图确认实际角色状态。
9. 对新旧对象分别检查权限；ALTER DEFAULT PRIVILEGES 只影响未来对象，历史对象需要单独 GRANT/REVOKE。
10. 定期审计超级用户、可创建 Role 的用户、Role Membership、Schema CREATE、PUBLIC 权限和默认授权。

示例：为应用建立只读角色和对象授权。

~~~sql
CREATE ROLE app_reader NOLOGIN;
CREATE ROLE orders_api LOGIN;

GRANT app_reader TO orders_api;

GRANT CONNECT ON DATABASE orders TO app_reader;
GRANT USAGE ON SCHEMA sales TO app_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA sales TO app_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA sales
  GRANT SELECT ON TABLES TO app_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA sales
  GRANT USAGE, SELECT ON SEQUENCES TO app_reader;
~~~

默认权限命令只对 app_owner 将来创建的对象生效；若由迁移脚本以其他 Role 创建对象，必须按实际创建者设置。

## 场景分析

订单应用只需要查询销售 Schema 中的订单和客户数据，迁移脚本负责创建新表和修改结构。最初团队让应用使用 schema_owner 账号，导致服务拥有 ALTER 和 DROP 能力。

应将订单 API 身份设为 LOGIN Role，再通过只读业务 Role 获得 Database CONNECT、Schema USAGE 和表 SELECT。迁移操作使用单独的 app_owner 或 app_migrator Role；新建对象后，通过默认权限向 app_reader 授权。应用不能继承迁移角色或 SUPERUSER 能力。

验收需要测试应用可以读取授权表、不能创建/删除表、不能访问未授权 Schema；迁移角色可以部署对象但不能管理账户角色；新对象自动得到预期读权限，而历史对象需要单独盘点和补授权。

## 常见误区

- **把用户和组看成两套不同对象。** PostgreSQL 统一使用 Role，LOGIN 决定是否能直接登录。
- **将 SUPERUSER 或对象 Owner 授给应用。** 这会扩大生产服务的破坏能力。
- **认为 Role Membership 一定自动继承全部权限。** INHERIT、SET 和 Membership Options 决定权限使用方式。
- **只授表 SELECT，不授 Schema USAGE。** 没有 Schema USAGE 时通常无法正常访问对象。
- **认为 ALTER DEFAULT PRIVILEGES 会补齐历史对象。** 它只作用于未来由指定 Role 创建的对象。
- **只给表设默认权限，不检查 Sequence。** 使用序列或 identity 的插入路径还需要对应权限和版本行为核对。

## 完成标准

- [ ] 能说明 Role、LOGIN、对象 Owner 和 Role Membership 的关系。
- [ ] 能区分 INHERIT、SET ROLE 和 ADMIN 能力。
- [ ] 能按 Database、Schema、Table、Sequence、Function 授予权限。
- [ ] 能说明 ALTER DEFAULT PRIVILEGES 的创建者和未来对象范围。
- [ ] 能设计应用读写身份与迁移身份分离的最小权限方案。

## 自测

1. CREATE ROLE 与 CREATE USER 的主要差异是什么？
2. 一个 Role 有 LOGIN，是否就有权连接所有 Database 和查询所有 Schema？
3. Role Membership 的 INHERIT 与 SET 能力分别解决什么问题？
4. ALTER DEFAULT PRIVILEGES 为 app_owner 设置后，为什么不一定会应用到由 app_migrator 创建的表？
5. 一个应用能 SELECT 表但无法访问 Schema，应该检查哪一层权限？

## 参考资料

- [Database Roles](https://www.postgresql.org/docs/current/user-manag.html)
- [Role Attributes](https://www.postgresql.org/docs/current/role-attributes.html)
- [Role Membership](https://www.postgresql.org/docs/current/role-membership.html)
- [Privileges](https://www.postgresql.org/docs/current/ddl-priv.html)
- [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)
