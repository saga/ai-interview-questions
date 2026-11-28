# UDF、存储过程与语言运行时

## 本节要解决的问题

订单数据里有渠道代码、产品说明和币种。分析 SQL 反复写渠道标准化逻辑；另一段流程每晚要检查批次状态、汇总金额、更新控制表并返回执行结果。团队把所有逻辑都写成 Python UDF，随后发现函数无法执行 DML，运行依赖也与开发者本地 Python 环境不同。

选择 UDF 或 Stored Procedure，关键不是看代码用 SQL 还是 Python，而是看它是一个被查询调用的值计算，还是一个有明确执行边界的过程。还要区分标量 UDF、表函数和 Stored Procedure；它们的调用方式、返回契约、权限和事务行为不同。

## 核心知识

### UDF 把输入映射为返回值，适合嵌入查询

标量 UDF 接收一组输入参数，返回一个标量值。适合字段标准化、评分转换、业务分类或复用计算。

例如将渠道码映射为统一类别：

~~~sql
CREATE OR REPLACE FUNCTION normalize_channel(channel_code VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
  CASE UPPER(TRIM(channel_code))
    WHEN 'WEB' THEN 'ONLINE'
    WHEN 'APP' THEN 'ONLINE'
    WHEN 'STORE' THEN 'RETAIL'
    ELSE 'UNKNOWN'
  END
$$;
~~~

在查询中调用：

~~~sql
SELECT
  order_id,
  source_channel,
  normalize_channel(source_channel) AS normalized_channel
FROM raw_orders;
~~~

这个函数不依赖外部状态、不修改数据，也不需要在调用前执行单独的 CALL。它把重复的业务表达式收敛到一个可管理的对象。若输入是 NULL、空字符串或未知代码，必须在函数契约中明确返回规则；不要把所有未知值都隐式转为某个看似合法的类别。

UDF 总是返回值。标量 UDF 返回一个值；User-Defined Table Function（UDTF）返回零行或多行，适合拆分、展开或把一个输入转换为多条结果。例如把一段数组或文本解析为多行时，应考虑 UDTF，而不是把 Stored Procedure 放进 SELECT。

### Python/Java/JavaScript UDF 在 Snowflake 托管运行时执行

UDF handler 可以使用 SQL、Python、Java、JavaScript 等受支持语言。函数定义声明运行时、包依赖、导入文件和 Handler；Snowflake 在受控运行环境里执行代码，不会直接使用开发者 Mac/本地虚拟环境中的包。

Python UDF 示例：

~~~sql
CREATE OR REPLACE FUNCTION normalize_amount(raw_amount VARCHAR)
RETURNS NUMBER(18, 2)
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('simplejson')
HANDLER = 'parse_amount'
AS
$$
from decimal import Decimal, InvalidOperation
import simplejson

def parse_amount(raw_amount):
    if raw_amount is None:
        return None

    try:
        payload = simplejson.loads(raw_amount)
        value = Decimal(str(payload["amount"]))
        return value.quantize(Decimal("0.01"))
    except (InvalidOperation, KeyError, ValueError, TypeError):
        return None
$$;
~~~

例子假设输入列是包含 amount 字段的 JSON 字符串。生产函数还要定义格式不合法时是返回 NULL、返回错误码还是由调用查询隔离；不能让异常被悄悄变成“正常金额”。

依赖管理需要考虑：
- RUNTIME_VERSION：Python/Java 等 handler 使用的运行时版本；
- PACKAGES：Snowflake 支持并可解析的包依赖；
- IMPORTS：需要随函数部署的代码或文件；
- Package Policy / Anaconda 条件：账户允许使用哪些包；
- 函数签名：Snowflake SQL 类型与 Python/Java/JavaScript 类型的映射。

本地安装成功不代表托管运行时可以使用。创建函数前应检查包是否可用、运行时版本是否支持，部署后用 NULL、空值、边界数值和无效输入做真实 SQL 测试。若需要自定义依赖或更复杂的系统环境，要评估 UDF 适用的运行能力和限制，不要默认所有 Python 库都能直接安装。

### UDF 不能承担 DDL、DML 或工作流副作用

UDF 的职责是计算和返回值，不适合执行 INSERT、UPDATE、DELETE、CREATE TABLE 或调用外部系统修改状态。即使某种语言代码看起来可以写文件或发网络请求，也不能把函数调用次数、执行顺序或副作用当作业务控制流程。

查询优化器可以调整执行计划。不要把“某行调用一次 UDF”当成外部操作的幂等保证，也不要在表达式里发邮件、创建工单或扣减额度。查询可能因重试、重写或执行计划变化而以不同方式计算表达式。

如果逻辑只需要复用一个 SQL/数值计算，优先写 SQL UDF；需要 Python/Java 等复杂算法时再评估语言 UDF；如果需要多条 SQL、条件分支和写入状态，则使用 Stored Procedure 或外部编排。

### Stored Procedure 控制多步执行，并通过 CALL 启动

Stored Procedure 可以组合 SQL 语句、变量、条件判断、循环、异常处理和过程状态。它通常由 CALL 启动，而不是作为普通标量表达式嵌入 SELECT。

例如检查结算日订单并写入汇总表：

~~~sql
CREATE OR REPLACE PROCEDURE close_order_batch(batch_date DATE)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  order_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO :order_count
  FROM curated_orders
  WHERE business_date = :batch_date;

  IF (order_count = 0) THEN
    RETURN 'NO_ORDERS';
  END IF;

  INSERT INTO daily_order_summary (
    business_date,
    order_count,
    total_amount
  )
  SELECT
    business_date,
    COUNT(*),
    SUM(order_amount)
  FROM curated_orders
  WHERE business_date = :batch_date
  GROUP BY business_date;

  RETURN 'CLOSED:' || order_count;
END;
$$;

CALL close_order_batch('2026-11-27');
~~~

Procedure 可以执行 DML、部分 DDL 和控制逻辑，但要明确它不是通用消息队列或自动事务工作流。代码中哪些语句已提交、失败后哪些数据仍然存在，必须按事务范围判断。对于长流程或外部 API，最好把每个阶段的状态和幂等键写入控制表，而不是依赖过程内变量记住进度。

### Owner's Rights 和 Caller's Rights 改变 Procedure 的权限与会话上下文

Stored Procedure 默认以 Owner's Rights 执行，也可以显式使用 EXECUTE AS CALLER。两者不能在同一 Procedure 中同时生效。

| 项目 | Owner's Rights | Caller's Rights |
|---|---|---|
| 数据对象权限 | 使用 Procedure Owner 的权限 | 使用调用者当前 Role 的权限 |
| Database / Schema 上下文 | 使用 Procedure 创建所在的 Database/Schema | 使用调用者当前 Database/Schema |
| Session Variables | 不能任意读取/修改调用者变量 | 可访问调用者会话变量 |
| 适用场景 | 将有限管理操作封装为受控入口 | 在调用者自己权限和会话上下文中执行 |
| 安全风险 | 参数范围过宽会间接扩大 Owner 权限 | 调用者缺少对象权限时过程会失败 |

Owner's Rights 适合受控委派，例如允许只读角色调用一个过程清理已过期记录，但不给调用者任意 DELETE 权限。此时过程必须将对象范围和 WHERE 条件固定在受控逻辑中，不能接受用户任意传入表名或 SQL 片段。

Caller's Rights 适合必须遵循调用者当前 Database/Schema、Session Variable 或角色权限的过程。若调用者没有直接执行某条 SQL 的权限，Procedure 也不能替他绕过。

### Procedure 的事务边界必须在同一个作用域内完成

Snowflake 支持在 Stored Procedure 内使用事务，也支持在事务中调用 Procedure，但 BEGIN、COMMIT 和 ROLLBACK 必须遵守作用域规则：

- 不能在调用者中 BEGIN，在 Procedure 内 COMMIT；
- 不能在 Procedure 内 BEGIN，返回后再由调用者 COMMIT；
- 不能在一个 Procedure 开始事务，却在另一个 Procedure 中结束事务；
- 多数 DDL 会隐式提交活动事务，不能依赖 ROLLBACK 撤销这些 DDL。

如果需要让一组 DML 原子提交，可以把 BEGIN/COMMIT 放在同一层级，或由调用者在 CALL 外围统一管理，确保 Procedure 内没有另起事务。若过程包含 DDL、数据回填和状态更新，应将这些步骤拆开并记录中间状态，失败后做前向修复或补偿。

下面的伪流程表示一个明确的 DML 事务边界：

~~~sql
BEGIN TRANSACTION;

CALL apply_order_adjustments('batch-2026-11-27');

-- 只有过程执行成功、校验通过后才提交
COMMIT;
~~~

这要求 Procedure 内不要自行开始、结束事务，也不要执行会隐式提交的 DDL。若过程内部包含 DDL，应把 DDL 放到事务外，重新设计发布步骤。

### UDF、UDTF 和 Stored Procedure 的选择取决于返回契约和副作用

| 需求 | 推荐对象 | 调用方式 | 核心约束 |
|---|---|---|---|
| 每条输入计算一个值 | Scalar UDF | SELECT/WHERE/JOIN 表达式 | 只返回值，不写业务状态 |
| 一条输入展开为多行 | UDTF | FROM TABLE(function(...)) | 返回表结构与行集 |
| 多条 SQL、条件分支或批次状态 | Stored Procedure | CALL | 权限、事务和重试需明确 |
| 定时或事件驱动执行 | Task 调度 Procedure/SQL | Task | 调度与过程逻辑分离 |
| 调用外部 API | External Access UDF/Procedure 或独立服务 | 受控 Handler/服务调用 | Network Rule、Secret、幂等与限流 |

不要为了统一语言把所有对象都写成 Python。SQL UDF 可以直接被查询优化，适合简单表达式；Python UDF 适合确实需要 Python 算法的计算；Procedure 处理过程控制；Task 负责触发时点和依赖编排。

## 工程实施步骤

1. 先写明输入、输出、是否修改数据、调用方式和失败语义。
2. 只有当逻辑是可复用值计算时，才选择 Scalar UDF；输出多行时评估 UDTF。
3. 对 UDF 定义 SQL 参数类型、返回类型、NULL 和非法输入规则，避免类型转换含糊。
4. 对语言 UDF 固定 Runtime Version、Package 依赖和 Import 文件，并在目标账户检查包可用性。
5. 对需要写数据或多步骤控制的逻辑使用 Stored Procedure，明确 Owner's Rights 或 Caller's Rights。
6. 对 Owner's Rights Procedure 限制对象名、批次范围和操作条件；对 Caller's Rights Procedure 验证调用者的对象权限和会话上下文。
7. 为 Procedure 设定事务边界；DDL 和 DML 分开管理，避免隐式提交破坏预期回滚。
8. 对会产生外部副作用或重复写入的流程使用业务幂等键，记录任务状态、请求 ID 和外部结果 ID。
9. 用 NULL、空值、非法格式、边界数值、权限不足、中途失败和重复调用测试对象行为。
10. 通过 Query History、Query Profile、Procedure 返回值和状态表验证真实运行路径；不要只凭 CREATE 成功认定对象可用。

## 场景分析

每日结算有两个步骤：先将交易渠道代码统一，再执行批次结算和状态推进。

渠道转换是纯值计算，适合使用 SQL UDF。结算需要检查批次是否完整、汇总金额、插入结算结果并更新控制状态，适合 Stored Procedure，由 Task 在指定时间触发。

如果把渠道转换写成 Procedure，就无法在普通 SELECT 每行表达式中直接复用；如果把结算写成 UDF，则会试图让一个返回值函数承担 DML 和事务副作用。两个问题都来自没有先定义返回契约和副作用边界。

若结算由低权限财务分析角色触发，但需要写入受保护的结算表，可以考虑 Owner's Rights Procedure。其输入应只接受业务批次日期/ID，过程内部固定目标表和校验条件，并记录执行人和批次。不能让调用者传入任意表名和 SQL 字符串。

## 常见误区

- **把 UDF 和 Stored Procedure 当成同一种可替换对象。** UDF 是查询表达式中的返回值计算；Procedure 是多步过程调用。
- **认为 Python UDF 能执行与本地 Python 相同的所有操作。** 它运行在 Snowflake 托管运行时，包、网络、文件和依赖都受平台规则约束。
- **在 UDF 中写数据或触发业务副作用。** 查询优化器不保证函数调用次数和顺序，副作用应交给 Procedure/受控服务。
- **把 UDTF 和 Stored Procedure 混为一谈。** UDTF 返回行集，可出现在 FROM；Procedure 由 CALL 启动。
- **认为 Owner's Rights 可以接收任意表名并安全执行。** 这会变成权限代理，必须将操作范围固定并验证参数。
- **认为 Caller's Rights 过程可以替调用者获得额外权限。** 它只能使用调用者已有的对象权限。
- **把 Procedure 当成天然原子事务。** DDL 隐式提交，跨作用域 Begin/Commit 会失败或破坏预期。
- **把重跑安全当成执行器自动提供。** DML 和外部操作要设计幂等键、状态记录和结果对账。

## 完成标准

- [ ] 能区分 Scalar UDF、UDTF 和 Stored Procedure 的返回契约与调用方式。
- [ ] 能选择 SQL、Python 或其他支持语言实现 UDF。
- [ ] 能说明托管运行时的 Runtime、Package 和 Import 依赖如何管理。
- [ ] 能解释 Owner's Rights 与 Caller's Rights 的权限和会话差异。
- [ ] 能设计事务边界，并说明 DDL 隐式提交的影响。
- [ ] 能为有副作用的过程建立状态和幂等策略。
- [ ] 能基于真实权限、输入边界和失败测试验收 UDF/Procedure。

## 自测

1. 一个逻辑需要在 SELECT 的每行计算出标准渠道分类，为什么 Scalar UDF 比 Stored Procedure 合适？
2. 一个函数接收 JSON 并展开为多行记录，应考虑 Scalar UDF 还是 UDTF？它在 SQL 中如何调用？
3. Python UDF 在开发者本地能导入的包，为什么不代表 Snowflake Runtime 一定能使用？
4. Owner's Rights Procedure 接收调用者传入的表名并执行 DELETE，可能形成什么权限风险？
5. Caller's Rights Procedure 在调用者没有目标表 DELETE 权限时会怎样？为什么不能期待它通过 Owner 权限执行？
6. Procedure 内部开始事务，但在过程返回后由调用者 COMMIT，会发生什么？事务控制应该放在哪一层？
7. 如果 Procedure 中包含 ALTER TABLE 和 UPDATE，为什么不能把它们当成一个可整体 ROLLBACK 的原子迁移？

## 参考资料

- [Choosing whether to write a stored procedure or a user-defined function](https://docs.snowflake.com/en/developer-guide/stored-procedures-vs-udfs)
- [User-defined functions overview](https://docs.snowflake.com/en/developer-guide/udf/udf-overview)
- [Introduction to Python UDFs](https://docs.snowflake.com/en/developer-guide/udf/python/udf-python-introduction)
- [Understanding caller's rights and owner's rights stored procedures](https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-rights)
- [Transactions](https://docs.snowflake.com/en/sql-reference/transactions)
