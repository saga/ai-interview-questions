# SQL 基础语义、类型与对象边界

## 本节要解决的问题

ETL 作业每天把 CSV 导入 Snowflake。上线一周后，财务发现两个问题：空字符串被当成金额参与计算，部分日期解析失败后却没有报错；另一个团队又在标准表上声明了 PRIMARY KEY，以为数据库会自动挡住重复订单。

这两类故障看起来无关，根源却一样：把 SQL 写得像“差不多就行”。NULL 不是普通值，字符串不等于日期，声明约束也不一定意味着数据库会替你检查。要让 SQL 结果可信，必须弄清楚每一步的类型和语义。

## 核心知识

### NULL 是未知，不是零，也不是空字符串

SQL 条件有 TRUE、FALSE、UNKNOWN 三种结果。下面这些值不是一回事：

| 输入 | 含义 | 判断方式 |
|---|---|---|
| SQL NULL | 值未知或缺失 | `IS NULL` |
| 空字符串 `''` | 有值，长度为 0 | `= ''` |
| 字符串 `'0'` | 文本字符 0 | 先按业务规则转换 |
| 数值 `0` | 数值为零 | 数值比较 |

因此 `amount = NULL` 不会得到 TRUE，应写成 `amount IS NULL`。`COALESCE(amount, 0)` 会把缺失值当成 0，只有业务确认“缺失等价于零”时才应该这样做。

还有一个容易隐藏的坑：`NOT IN` 的子查询如果包含 NULL，比较结果可能变成 UNKNOWN。例如黑名单表里只要有一条 customer_id 是 NULL，下面的查询就可能一个客户也返回不了：

~~~sql
SELECT c.customer_id
FROM dim_customer c
WHERE c.customer_id NOT IN (
  SELECT customer_id
  FROM blocked_customer
);
~~~

需要表达“没有匹配的黑名单记录”时，用 NOT EXISTS 更直接：

~~~sql
SELECT c.customer_id
FROM dim_customer c
WHERE NOT EXISTS (
  SELECT 1
  FROM blocked_customer b
  WHERE b.customer_id = c.customer_id
);
~~~

### WHERE、HAVING 和聚合的顺序会改变结果

`WHERE` 在分组前过滤行，`HAVING` 在聚合后过滤分组。比如只统计已完成订单，并找出金额超过 10,000 的客户：

~~~sql
SELECT
  customer_id,
  SUM(order_amount) AS paid_amount
FROM fact_order
WHERE status = 'PAID'
GROUP BY customer_id
HAVING SUM(order_amount) > 10000;
~~~

如果把金额条件写进 WHERE，就会把逐行金额当成聚合结果过滤；如果把所有行级条件都写在 HAVING，SQL 会更难读，也可能要处理不必要的输入数据。写查询时先说清筛选对象是“行”还是“组”。

### 文本要先转换成业务类型，再参与计算

CSV 导入的 `amount_text` 可能包含空白、货币符号或非法字符。不要直接 CAST 后期待批次永远干净，可以先把空字符串归一化，再用 TRY_TO_DECIMAL 暴露异常行：

~~~sql
WITH parsed AS (
  SELECT
    order_id,
    amount_text,
    TRY_TO_DECIMAL(NULLIF(TRIM(amount_text), ''), 18, 2) AS amount
  FROM raw_order
)
SELECT
  COUNT(*) AS input_rows,
  COUNT_IF(amount IS NULL) AS invalid_or_missing_amounts,
  SUM(amount) AS valid_amount_total
FROM parsed;
~~~

这里把空字符串转为 NULL，再尝试转成 NUMBER(18,2)。无效文本也会得到 NULL，因此要同时保留原始字段和异常计数，不能只看最终 SUM。若业务上空值与 0 含义不同，也不要在这一步用 COALESCE 填零。

日期和时间同样如此。先确认源字段表示的是日期、无时区时间还是带时区时间，再选择 DATE、TIMESTAMP_NTZ、TIMESTAMP_LTZ 或 TIMESTAMP_TZ。字符串能被解析，不代表它的时区含义正确。

### VARIANT 路径与 FLATTEN 会改变行数

假设事件表的一行是一笔订单，payload 中的 `items` 是商品数组：

~~~json
{
  "order_id": "O100",
  "items": [
    { "sku": "A-01", "qty": 2 },
    { "sku": "B-03", "qty": 1 }
  ]
}
~~~

用路径表达式可以读取单个字段：

~~~sql
SELECT
  payload:order_id::STRING AS order_id,
  payload:items[0]:sku::STRING AS first_sku
FROM raw_event;
~~~

要把数组中的每个商品展开成行，可以使用 FLATTEN：

~~~sql
SELECT
  e.payload:order_id::STRING AS order_id,
  f.index AS item_index,
  f.value:sku::STRING AS sku,
  f.value:qty::NUMBER AS quantity
FROM raw_event e,
LATERAL FLATTEN(INPUT => e.payload:items) f;
~~~

一笔订单有两件商品，展开后就会有两行。这是把半结构化数组转换为关系行，并不是重复数据。若还要连接订单头金额，必须重新检查粒度，避免把头表金额随数组元素重复累计。

FLATTEN 默认不会为无法展开的输入生成普通元素行。需要保留空数组或缺失路径对应的源记录时，评估 `OUTER => TRUE`，并明确处理 KEY、INDEX、VALUE 为空的行。

### 标准表声明的键约束，不代表数据库会自动做唯一性检查

Snowflake 标准表可以声明 PRIMARY KEY、UNIQUE 和 FOREIGN KEY，但这些约束主要作为模型和工具元数据，标准表不会强制执行它们。NOT NULL 和 CHECK 会执行。Hybrid Table 的约束执行规则不同。

这意味着：给标准事实表写了 `PRIMARY KEY (ORDER_ID)`，并不能代替入库去重和唯一性测试。建模元数据有价值，但数据质量仍要靠流程和测试保证。

~~~sql
-- 检查订单号是否真的唯一
SELECT order_id, COUNT(*) AS duplicate_count
FROM fact_order
GROUP BY order_id
HAVING COUNT(*) > 1;
~~~

对标准表，应该把唯一键、外键映射和业务去重规则放进数据质量检查。只有确认数据确实符合约束后，才考虑使用 RELY 等属性让下游优化器依赖这些关系。

### 对象名称相同，不代表当前会话访问的是同一个上下文

执行前先确认当前角色和默认对象上下文：

~~~sql
SELECT
  CURRENT_ROLE() AS active_role,
  CURRENT_WAREHOUSE() AS active_warehouse,
  CURRENT_DATABASE() AS active_database,
  CURRENT_SCHEMA() AS active_schema;
~~~

`ORDERS` 可能同时存在于多个数据库或 Schema。没有限定对象名时，Session Context 会影响 SQL 解析到哪个对象；换了 Role，也可能改变能看到或能操作的对象。排查“表不存在”和“权限不足”时，先检查完整对象名和当前上下文，不要先把问题归因于 Warehouse。

## 工程实施步骤

1. 保留原始落地区字段，记录源文件、批次号和导入时间，不要在入库时覆盖掉原始文本。
2. 明确每个字段的业务类型、空值含义、时区和精度；空字符串、非法值和真正的 NULL 分开统计。
3. 使用 TRY_* 转换函数生成解析结果，同时计算失败行数和样例；异常样本进入隔离表或修复队列。
4. 对 VARIANT 字段先检查路径和数组长度，再决定是否 FLATTEN；展开后重新定义一行代表什么。
5. 检查标准表的主键、唯一键和外键声明是否有对应的数据质量测试。
6. 查询执行前记录 Role、Warehouse、Database 和 Schema；排查对象问题时使用限定名称。
7. 将关键规则做成可重复运行的验证 SQL，并在数据发布时检查重复键、孤儿记录、转换失败和 NULL 比例。

## 场景分析

凌晨批次导入 1,000 万条订单，作业状态显示成功，但次日财务对账少了 2.3% 的金额。不要直接把缺失金额填 0，也不要先重跑整个文件。

先统计原始金额字段的空字符串、NULL、合法数字和非法文本。将无法转换的原始值按批次号取样，确认是货币符号、千位分隔符、编码还是源系统字段漂移。再对比转换前后的行数和金额总和，确认过滤发生在哪一步。

与此同时，检查订单号唯一性和引用的客户键是否存在。标准表上的 PRIMARY KEY 声明不会自动替代这些检查。修复后用相同批次重跑验证 SQL，要求输入行数、成功转换行数、隔离行数和金额对账结果能够解释全部差异。

## 常见误区

- **用 `= NULL` 判断空值。** SQL 的比较结果是 UNKNOWN，应使用 IS NULL / IS NOT NULL。
- **把空字符串和零都转成 0。** 这会把“没有提供金额”和“金额确实为零”混在一起。
- **用 CAST 处理脏数据却不记录失败行。** TRY_* 让失败可被统计，但不能把 NULL 结果悄悄丢掉。
- **FLATTEN 后仍把结果当成原始订单粒度。** 数组有几个元素就可能展开几行，聚合前重新定义 grain。
- **认为标准表上的 PRIMARY KEY 会自动拒绝重复值。** 标准表的 PRIMARY KEY、UNIQUE、FOREIGN KEY 不强制执行，必须建立独立数据质量校验。
- **看到 SQLSTATE 或“对象不存在”就判断 Warehouse 有问题。** 先核对当前 Role、Database、Schema 和完整对象名。

## 完成标准

- [ ] 能解释 SQL NULL、空字符串和数值 0 的区别。
- [ ] 能判断条件应该放在 WHERE 还是 HAVING。
- [ ] 能设计 TRY_* 转换和异常行统计。
- [ ] 能解释 FLATTEN 前后行粒度的变化。
- [ ] 能区分标准表和 Hybrid Table 的约束执行差异。
- [ ] 能通过会话上下文定位对象名称和权限问题。

## 自测

1. `blocked_customer` 中存在一条 NULL customer_id 时，NOT IN 为什么可能过滤掉所有客户？怎样改写？
2. 金额字段中同时有空字符串、'0' 和 'abc'。如何分别统计并保留可追溯的原始值？
3. 一笔订单的 VARIANT 数组中有三件商品。FLATTEN 后再连接订单头金额，哪些指标需要特别防止重复累计？
4. 标准表声明 PRIMARY KEY 后仍出现重复订单号，应该检查哪一层，而不是简单地认为 Snowflake 约束失效？
5. 同一条 SQL 在不同会话访问到了不同的 ORDERS 表，先检查哪些上下文函数？

## 参考资料

- [Overview of constraints](https://docs.snowflake.com/en/sql-reference/constraints-overview)
- [FLATTEN](https://docs.snowflake.com/en/sql-reference/functions/flatten)
- [Table design considerations](https://docs.snowflake.com/en/user-guide/table-considerations)
- [Snowflake SQL data types](https://docs.snowflake.com/en/sql-reference-data-types)
