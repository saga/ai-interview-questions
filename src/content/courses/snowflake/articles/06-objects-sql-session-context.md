# Snowflake 对象模型、SQL 与会话上下文

## 学习目标

能从账户、数据库、Schema、表、视图、Stage、Warehouse、Role 和 Session 组成的对象模型定位一次 SQL 操作；理解当前会话上下文如何影响对象解析与权限。

## 对象层级与运行上下文

Snowflake 的常用命名层级是 Account → Database → Schema → Object。表、视图、Stage、File Format、Sequence、Function、Procedure、Pipe、Stream、Task 等对象位于 Schema 内。Warehouse、Role 和 User 则参与会话执行，但不属于表数据的存储层级。

一个 Session 至少要明确当前 Role、Warehouse、Database 和 Schema。它们分别影响授权、计算资源、对象定位和默认命名空间。不要仅凭 SQL 文本判断执行行为：同一条未限定库名和 Schema 的 SQL，在不同 Session Context 下可能访问不同对象。

~~~sql
USE ROLE ANALYST_ROLE;
USE WAREHOUSE BI_WH;
USE DATABASE ANALYTICS;
USE SCHEMA MART;

SELECT *
FROM ORDERS
LIMIT 10;
~~~

排查“对象不存在”时，先核对当前上下文，再检查完整限定名、大小写规则、对象类型和当前 Role 的可见权限。排查“查询跑错仓库”时，检查 Session 的 Warehouse，而不是只看客户端连接字符串。

## 对象类型不要混为一谈

| 对象 | 主要职责 | 常见误区 |
|---|---|---|
| Database / Schema | 组织与命名边界 | 不等于物理存储目录 |
| Table | 持久化结构化或半结构化数据 | 与 Warehouse 混淆 |
| View / Secure View | 保存查询定义 | 普通 View 不自动隔离权限 |
| Stage / File Format | 文件位置与解析规则 | 不等于目标表 |
| Stream / Task | 变化跟踪与调度执行 | Stream 不保存完整变更副本 |
| UDF / Procedure | 复用计算逻辑 | 函数与过程的执行语义不同 |

Table 类型也有生命周期差异。Permanent、Transient、Temporary 和 Iceberg Table 的保留、恢复与管理责任不同，不能只按“能否查询”判断。视图类型同样有不同的安全和物化语义。

## SQL 执行前的检查顺序

1. 当前 Role 是否具有访问对象和执行操作所需的权限。
2. 当前 Warehouse 是否正确、已启动且容量合适。
3. Database / Schema 是否指向预期对象。
4. 对跨库对象、共享对象和外部对象，确认对象所有权与授权路径。
5. 把完整限定名写入生产脚本，减少隐式上下文依赖。

## 工程建议

生产作业不要依赖开发者 Snowsight 中遗留的 Session 状态。连接初始化应显式设置 Role、Warehouse、Database 和 Schema；部署脚本应使用明确的目标环境和服务身份。多环境同名对象尤其要使用完整对象名，避免 DEV 作业误访问 PROD。

## 检查题

1. 为什么 USE WAREHOUSE 和 USE ROLE 影响的是不同边界？
2. 当未限定对象名解析到错误 Schema 时，应该先检查哪些 Session Context？
3. 为什么 Stage、Stream、Task 与 Table 不能当成同一类对象？
