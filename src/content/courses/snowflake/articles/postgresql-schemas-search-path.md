# PostgreSQL Schema、对象命名与 search_path

## 本节要解决的问题

理解 PostgreSQL Database 内部的 Schema 命名空间，以及未限定对象名如何通过 search_path 解析。生产 SQL 若依赖隐式 Schema 顺序，可能在开发、测试和生产访问不同对象；search_path 还具有安全意义，允许不可信角色在搜索路径中的 Schema 创建对象，可能改变其他用户 SQL 的解析结果。

## 核心知识

### Schema 是 Database 内部的对象命名空间

一个 PostgreSQL Database 可以包含多个 Schema。Table、View、Sequence、Function、Type 等对象都属于某个 Schema。同一个 Database 中可以存在多个同名表，只要它们位于不同 Schema，例如 sales.orders 和 archive.orders。

Schema 不等于 Database，也不是独立连接目标。连接固定到一个 Database 后，可以访问该 Database 中多个 Schema；要访问另一 Database 通常需要新建连接，不能用 Schema 名称替代 Database。

### search_path 决定未限定名称的解析顺序

当 SQL 使用未限定名称，例如 SELECT * FROM orders，PostgreSQL 按 search_path 中的 Schema 顺序查找第一个匹配对象。若路径中找不到对象，才报告 relation does not exist。全限定名 schema.object 则明确指定对象位置，不依赖搜索顺序。

search_path 的第一个有效 Schema 是 current_schema；未限定名称创建对象时，也会默认创建到该 Schema。current_schemas(false) 返回显式有效搜索路径；current_schemas(true) 还包含隐式搜索的系统 Schema，例如 pg_catalog。

PostgreSQL 默认将 pg_catalog 放在隐式搜索位置；如果显式把 pg_catalog 放入 search_path，则它的位置由配置顺序决定。临时 Schema 也可能影响对象解析。需要确认真实有效路径时，应结合 SHOW search_path、current_schema 和 current_schemas(true)，不能只看配置文本。

### search_path 是安全边界，不只是开发便利

如果一个不可信用户对 search_path 中某个 Schema 拥有 CREATE 权限，他可能创建与可信对象同名的函数、操作符或其他对象，影响其他用户执行未限定名称 SQL 的行为。PostgreSQL 官方文档明确指出，将一个 Schema 加入搜索路径等于信任所有能在其中创建对象的用户。

生产应用通常应将业务 Schema 和用户可写 Schema 分开；可对关键对象使用全限定名称，并限制不可信用户在应用 search_path 中的 CREATE 权限。不要把 public 或临时 Schema 的可写权限当成无风险默认值。

## 工程实施步骤

1. 使用 \dn 查看 Database 中的 Schema；使用 \dt schema.* 查看特定 Schema 的表。
2. 执行 SHOW search_path，记录显式配置；再查询 current_schema() 和 current_schemas(true) 获取实际有效路径。
3. 对生产脚本优先使用 schema.object 全限定名称，尤其是 DDL、迁移、权限管理和关键业务 SQL。
4. 若应用需要使用未限定名称，显式设置受控的 search_path，并核对每个 Schema 的 USAGE 与 CREATE 权限。
5. 检查用户在 search_path 各 Schema 中是否拥有 CREATE；移除不必要的写权限，避免不可信对象遮蔽可信函数或表。
6. 对新建对象验证其实际落点；执行 CREATE TABLE 后用 to_regclass 或系统目录确认对象属于哪个 Schema。
7. 在连接池中初始化和重置 search_path，避免上一个请求修改会话设置后污染下一个请求。
8. 将不同环境的 Schema 名称映射、迁移脚本和权限清单版本化，减少环境差异。
9. 对对象改名、Schema 移动和 search_path 顺序变化运行回归测试，确认依赖 View、Function 和应用 SQL 的解析没有变化。
10. 定期审计 public、临时 Schema 和应用搜索路径的权限，检查可写 Schema 是否由不可信用户控制。

示例：创建应用 Schema 并限定应用角色搜索路径。

~~~sql
CREATE SCHEMA app AUTHORIZATION app_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO app_reader;

ALTER ROLE app_reader IN DATABASE orders
  SET search_path = app, pg_catalog;
~~~

该示例的权限应按应用需要配置；若 app_reader 还需访问其他 Schema，应显式加入并审查其信任边界。

## 场景分析

应用在开发环境访问 orders 表正常，生产环境却访问了 archive.orders。两个 Schema 都包含同名表，而应用 SQL 使用未限定名称。生产连接池还会复用 Session，某次请求将 search_path 改成 archive 后没有复原。

先检查 SHOW search_path 与 current_schemas(true)，确认是否发生隐式解析或连接池状态泄漏。随后对生产 SQL 使用全限定名称，或在每次借出连接时设置固定 search_path，并在归还时重置。若 search_path 中存在用户可写 Schema，还要检查是否有同名函数或对象被意外创建。

验收包含多个同名对象、连接池复用、不同 Role、临时 Schema 和用户可写 Schema 等情况，确保解析结果始终符合预期。

## 常见误区

- **把 Schema 当成独立 Database。** Schema 是 Database 内部的命名空间。
- **认为同名对象一定是同一张表。** 不同 Schema 可以存在同名关系对象。
- **只检查 SHOW search_path 就认定解析顺序完整。** 还要考虑隐式 pg_catalog、临时 Schema 和当前有效路径。
- **把 search_path 当纯粹的便利设置。** 不可信 Schema 的 CREATE 权限可能影响对象解析和安全。
- **认为创建对象一定落到 public。** 未限定创建位置取决于当前有效 Schema。
- **连接池只管理 socket，不需管理 Session 参数。** search_path 可以跨请求残留。

## 完成标准

- [ ] 能解释 Database 与 Schema 的层级关系。
- [ ] 能使用全限定名和 search_path 解析对象。
- [ ] 能区分 current_schema、current_schemas 和 SHOW search_path。
- [ ] 能解释 search_path 中 Schema 的 CREATE 权限带来的风险。
- [ ] 能为应用连接池设计稳定的 Schema 上下文初始化和重置。

## 自测

1. 同一 Database 中有 app.orders 与 archive.orders，SQL 只写 orders 时如何决定实际对象？
2. current_schema() 与 current_schemas(true) 返回的信息有何区别？
3. 为什么把一个用户可写 Schema 加入可信应用的 search_path 会造成安全风险？
4. 未限定名称创建表时，表会落入哪个 Schema？应如何确认？
5. 连接池请求 A 修改 search_path 后，请求 B 可能遇到什么问题？

## 参考资料

- [Schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)
- [Schema information functions](https://www.postgresql.org/docs/current/functions-info.html)
- [GRANT](https://www.postgresql.org/docs/current/sql-grant.html)
