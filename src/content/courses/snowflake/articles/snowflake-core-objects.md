# Snowflake 核心对象与会话执行边界

## 先辨认一次连接到底带来了什么

一个部署脚本在开发环境能执行 SELECT，在生产环境却报对象不存在。运维准备重建表，开发人员怀疑权限，ETL 同事则认为 Warehouse 没启动。

这几个判断都可能错。Snowflake 会话带有一组上下文：当前 Role、辅助角色、Warehouse、Database、Schema，以及查询时使用的对象搜索路径。它们决定 SQL 在哪里解析、用什么计算资源、以什么权限执行。

先运行下面的查询，确认连接实际处于什么状态：

~~~sql
SELECT
  CURRENT_ROLE(),
  CURRENT_SECONDARY_ROLES(),
  CURRENT_WAREHOUSE(),
  CURRENT_DATABASE(),
  CURRENT_SCHEMA(),
  CURRENT_SCHEMAS();
~~~

尤其要注意 CURRENT_SCHEMA 与 CURRENT_SCHEMAS 并不相同：前者返回当前 Schema，后者反映查询未限定对象名时会搜索哪些 Schema。

## 对象名称和会话上下文是怎样关联的

### Database 与 Schema 是命名空间

Database 是逻辑命名空间，Schema 位于 Database 之下。Table、View、Stage、File Format、Sequence 和 Procedure 等对象通常属于某个 Schema。对象可以使用完整名称：

~~~sql
SELECT *
FROM ANALYTICS.MART.ORDERS;
~~~

在 DDL 和 DML 中，省略 Database 或 Schema 时，Snowflake 会用当前会话上下文补全名称。当前 Schema 始终属于当前 Database；切换 Database 时，当前 Schema 可能随之重置。

查询语句中的未限定对象名还有一个区别：它按 Session 的 SEARCH_PATH 解析。默认路径通常包含当前 Schema 和当前 Database 的 PUBLIC Schema，但用户可以通过 ALTER SESSION 修改搜索路径。因此，“当前 Schema 是 MART”并不能证明所有未限定查询只会在 MART 中查找对象。

### Stage 与 File Format 解决的是文件入口，不是业务表

Stage 提供内部或外部文件位置的访问入口。File Format 描述 CSV、JSON、Parquet 等文件怎样解析。它们不会因为文件存在就自动把数据写进 Table，也不负责判断数据是否符合业务规则。

加载文件时，至少要分别确认 Stage 路径、文件名匹配、File Format、COPY INTO 返回结果、拒绝行以及目标表行数。把这些步骤混在一起，往往会把解析错误误判为目标表问题。

### Warehouse 是计算资源，不属于对象命名层级

Warehouse 执行 SQL 和相关计算，不是 Database、Schema 或 Table 的子对象，也不代表数据存储位置。没有选择 Warehouse 或当前角色无权使用 Warehouse，查询可能无法启动；但 Warehouse 可用不代表当前角色拥有表访问权限。

### Role 决定操作权限，所有权还包含管理责任

Role 是权限主体。权限授予 Role，再由用户在 Session 中激活相应角色；启用的 Secondary Roles 也可能参与权限判断。对象的 USAGE、SELECT、INSERT、CREATE 和 OWNERSHIP 各自代表不同边界。

普通 Schema 中对象 Owner 通常可以管理该对象的 Grants；Managed Access Schema 则将授权决策集中到 Schema Owner 或拥有 MANAGE GRANTS 的 Role。不要把“可以查询”“可以修改对象”和“可以把权限授给别人”视为同一能力。

## 按错误发生的位置排查

回到开头的部署问题，可以按以下顺序处理：

| 观察到的结果 | 优先检查 | 不要先做什么 |
| --- | --- | --- |
| 未限定对象名时提示对象不存在 | CURRENT_DATABASE、CURRENT_SCHEMA、SEARCH_PATH | 重新创建同名对象 |
| 全限定名能解析但查询被拒绝 | 当前 Role、父级容器 USAGE、对象 SELECT | 换一个 Warehouse |
| 表可以查询，但 CREATE/ALTER 失败 | Schema CREATE 权限、对象 OWNERSHIP、Managed Access 规则 | 给用户账户级管理员权限 |
| Stage 文件存在，但 COPY 没写入预期行数 | 文件匹配、File Format、加载错误和目标行数 | 只检查目标表结构 |
| SQL 无法启动或因无权使用仓库失败 | CURRENT_WAREHOUSE、Warehouse 状态与 USAGE | 修改 Database/Schema |

例如，生产脚本使用全限定名仍然查询失败，就没有必要继续怀疑搜索路径；应该转向 Role 和对象授权。相反，如果只有未限定名称失败，重新授予 SELECT 往往并不能解决问题。

## 把连接上下文固定在应用与部署配置里

ETL、应用连接和 CI 脚本应显式设置需要的 Role、Warehouse、Database 和 Schema，避免把个人 Snowsight 工作区的默认值带入生产。对关键表使用全限定名，能减少对象搜索路径变化带来的歧义。

还要区分权限配置和运行资源配置：部署身份需要 CREATE/OWNERSHIP 等对象操作权限；查询服务身份通常只需要必要的 USAGE、SELECT 和 Warehouse USAGE。两类身份不应为了减少配置工作而合并。

## 容易出现的几种误判

- Warehouse 不属于 Database.Schema.Object 命名路径。
- Stage 是文件访问入口，File Format 是解析规则，COPY INTO 才执行加载。
- 当前 Schema 不等于查询时唯一会搜索的 Schema。
- 能看见对象名称不代表有 SELECT 权限。
- 拥有对象不等于能在 Managed Access Schema 中自行决定所有 Grants。

## 自测

1. CURRENT_SCHEMA 返回 MART，但未限定表名仍命中了其他 Schema。接下来应该检查哪个 Session 参数或函数？
2. 一个 Role 能使用 Warehouse，却无法读取订单表。为什么需要分开检查计算权限和数据对象权限？
3. 文件已出现在 Stage，COPY INTO 的目标表行数却少于源文件记录数。应分别检查哪些环节？
4. 在 Managed Access Schema 中，谁负责给对象授予访问权限？为什么对象 Owner 不一定能直接授权？

## 参考资料

- [Object name resolution](https://docs.snowflake.com/en/sql-reference/name-resolution)
- [USE 命令与当前会话上下文](https://docs.snowflake.com/en/sql-reference/sql/use)
- [Overview of access control](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
