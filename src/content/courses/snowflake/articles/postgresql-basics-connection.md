# PostgreSQL 基础架构、连接与 psql

## 本节要解决的问题

从客户端连接到 PostgreSQL 实例后，确认连接落在哪个服务器、数据库、用户和会话上下文，并能区分网络不可达、认证失败、数据库不存在和权限不足。连接成功只建立了 Session，不表示当前用户可以访问数据库中的所有 Schema 和表。

## 核心知识

### PostgreSQL 实例、数据库与 Session 是不同层次

PostgreSQL Server 实例由一个主服务进程及其后台进程管理。一个实例可以包含多个 Database；每个客户端连接进入其中一个 Database，并建立独立 Session。Database 内部再组织 Schema、Table、View、Function 和其他对象。

PostgreSQL 通常不支持在同一个 SQL Session 中切换当前 Database。连接到另一个 Database 需要重新建立连接，例如在 psql 中使用 \c 命令。与之不同，Schema 属于 Database 内部的命名空间，可以在同一连接中通过 search_path 或全限定名称访问。

客户端进程与服务器进程通过 TCP/IP 或 Unix-domain socket 通信。常见连接参数包括 host、port、dbname、user、sslmode 和 application_name。连接 URI 可用于应用配置，但密码等敏感参数应由 Secret 管理注入，不要写进代码仓库或命令历史。

### psql 是客户端，不是数据库服务端

psql 提供 SQL 执行和一组客户端 Meta-command。常用命令包括：

- \conninfo：显示当前连接信息。
- \l：列出数据库。
- \c dbname：连接另一个数据库。
- \dn：列出 Schema。
- \dt：列出当前 search_path 可见的表；\dt schema.* 可指定 Schema。
- \d object：查看表、视图、索引等对象结构。
- \du：查看角色。
- \dp：查看表和相关对象权限。
- \timing：显示 SQL 执行时间。
- \i file.sql：执行脚本文件。

这些反斜杠命令由 psql 客户端解释，并不是服务器 SQL。不能在普通 JDBC、Python 或 Node.js SQL 执行接口中直接发送 \dt 或 \conninfo。

### 认证链路涉及连接参数、pg_hba.conf 和 Role

服务器端 pg_hba.conf 根据连接类型、客户端地址、目标 Database 和用户匹配认证规则。PostgreSQL 使用第一条匹配规则；若认证失败，不会继续尝试后续规则。规则顺序因此非常重要。

TCP 连接还需考虑监听地址、防火墙和端口。主机名或 IP 错误通常表现为网络连接失败；服务器可达但用户认证失败，则应检查 pg_hba.conf 匹配规则、认证方法、密码或证书；认证成功后若提示 permission denied，才进入数据库、Schema 和对象权限排查。

## 工程实施步骤

1. **确认连接目标。** 记录 host、port、dbname、user、SSL mode 和 application_name，确保开发、测试和生产连接配置分离。
2. **验证网络。** 检查 DNS、端口监听、防火墙、安全组和服务器是否接受 TCP 连接；本机 Unix socket 与远程 TCP 的排查路径不同。
3. **使用 psql 显式连接。** 用 -h、-p、-U、-d 指定连接目标，避免依赖本机默认值；密码通过受控交互或密码文件/Secret 提供。
4. **查看连接信息。** 登录后执行 \conninfo，随后查询 current_database、current_user、session_user、version 和 inet_client_addr 等。
5. **检查数据库和 Schema。** 使用 \l、\dn、\dt 和 \d 确认对象存在的位置；不要仅凭表名推断连接的 Database。
6. **区分认证与授权。** 若连接建立前失败，检查 pg_hba.conf 和凭证；若连接成功但对象操作失败，检查 CONNECT、USAGE、SELECT 等权限。
7. **检查 SSL。** 对远程生产连接确认 sslmode；需要校验证书和服务器主机名时使用 verify-full，并正确配置可信 CA。
8. **检查服务器认证规则。** 由管理员查看 pg_hba.conf 和 pg_hba_file_rules，确认第一条匹配规则、来源地址和认证方式；修改后按系统要求 reload。
9. **为应用设置 application_name。** 将服务名、环境或作业名作为连接标识，便于从 pg_stat_activity 和日志定位连接。
10. **保留可复现信息。** 记录 PostgreSQL 版本、连接目标、当前用户、Database、SSL 状态和错误信息；不要在日志中输出密码或完整敏感 URI。

示例：

~~~bash
psql "host=db.example.net port=5432 dbname=orders user=app_reader sslmode=verify-full application_name=orders-api"
~~~

连接后检查当前 Session：

~~~sql
SELECT
  version(),
  current_database(),
  current_user,
  session_user,
  current_schema(),
  current_schemas(true),
  inet_client_addr(),
  inet_server_addr();
~~~

## 场景分析

应用可以 ping 通数据库主机，但连接时提示 password authentication failed。开发人员准备给该用户增加表 SELECT 权限。

这类错误发生在连接认证阶段，尚未进入表权限检查。应确认目标 host/port/dbname/user，再检查 pg_hba.conf 中第一条匹配该来源、Database 和用户的规则，验证客户端使用的认证方式是否与密码/证书配置一致。若连接成功后出现 permission denied for schema，则应再检查 Schema USAGE 和对象权限。

验收时分别模拟错误端口、不可达 IP、错误密码、没有匹配的 pg_hba 规则、正确认证但无表权限等情况，确认故障分类和日志信息能区分不同阶段。

## 常见误区

- **把 PostgreSQL 实例和 Database 当成同一个东西。** 一个实例可以包含多个 Database，连接固定进入其中一个。
- **认为 psql 的反斜杠命令属于 SQL。** \dt、\d、\conninfo 是客户端 Meta-command。
- **把网络连接失败当成密码错误。** DNS、端口、防火墙、服务监听和认证是不同阶段。
- **连接成功就认为有表访问权限。** 还需要 Database CONNECT、Schema USAGE 和对象级权限。
- **认为 pg_hba.conf 会按顺序尝试直到某条认证通过。** PostgreSQL 使用第一条匹配规则，不会在认证失败后继续尝试。
- **忽略 SSL 与 application_name。** 远程连接要验证加密和服务器身份；应用名称有助于定位运行会话。

## 完成标准

- [ ] 能解释实例、Database、Schema 和 Session 的关系。
- [ ] 能使用 psql 建立指定目标连接并执行常用 Meta-command。
- [ ] 能通过连接参数和当前会话函数确认真实连接上下文。
- [ ] 能区分网络、认证、Database/Schema 权限问题。
- [ ] 能解释 pg_hba.conf 的第一匹配规则和 SSL 校验方式。

## 自测

1. PostgreSQL 连接成功后，是否可以在同一个 Session 中用 SQL 切换到另一个 Database？为什么？
2. psql 的 \dt 与 SQL 查询 pg_catalog.pg_tables 有什么区别？
3. 连接提示 password authentication failed，为什么不应该先授予目标表 SELECT？
4. pg_hba.conf 有两条都可能匹配的规则，PostgreSQL 如何选择？
5. 生产连接为什么应该同时设置 SSL 验证和 application_name？

## 参考资料

- [PostgreSQL connection control functions](https://www.postgresql.org/docs/current/libpq-connect.html)
- [psql reference](https://www.postgresql.org/docs/current/app-psql.html)
- [The pg_hba.conf file](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html)
- [Session information functions](https://www.postgresql.org/docs/current/functions-info.html)
