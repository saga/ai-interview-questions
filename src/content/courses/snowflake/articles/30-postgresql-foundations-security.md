# PostgreSQL 基础架构、连接、Schema 与权限

## PostgreSQL 的基本结构

PostgreSQL 服务进程管理连接、事务、内存和后台进程；数据库集群包含多个 Database，每个 Database 内有 Schema 和对象。客户端连接时选择数据库、用户和连接参数，之后在该连接的 Session 中执行 SQL。

psql 是常用交互客户端。常见排查从连接参数、服务状态、监听地址、TLS、认证规则和日志开始，不要一遇到连接失败就修改数据库权限。

## Schema 与 search_path

Schema 是 Database 内的命名空间。search_path 决定未限定对象名的解析顺序。生产 SQL 尤其是多租户和多环境脚本，建议使用明确 Schema，避免同名对象造成误访问。

## 类型和约束

PostgreSQL 提供整数、数值、文本、时间、UUID、JSONB、数组等类型。金额应考虑 NUMERIC 的精度；时间要区分 timestamp with time zone 和 without time zone；主键、唯一约束、外键和 CHECK 是数据完整性的一部分。

## Roles 与权限

Role 既可表示登录身份，也可表示权限集合。推荐通过 NOLOGIN Group Role 组织业务权限，再将其授予 LOGIN Role。默认权限、Schema USAGE、对象 SELECT / INSERT 等权限需要分别管理。

不要让应用使用超级用户连接。应用 Role 应只拥有完成业务操作所需的权限，Migration Role 与 Runtime Role 分离。

## 迁移和连接安全

使用 TLS 验证传输；密码、证书和连接字符串放入 Secret 管理。生产变更应由迁移工具执行并记录版本。避免应用自动执行未经审查的 DDL。

## 检查题

1. Database 和 Schema 的作用有什么区别？
2. search_path 为什么可能带来对象解析风险？
3. 为什么应用账号和 Migration Role 应该分开？
