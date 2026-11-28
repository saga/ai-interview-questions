# Schema Change Tracker 与兼容性

## 本节要解决的问题

订单源系统周三增加了 discount_code 字段。数据加载任务仍然显示成功，但下游报表没有这个字段；同一天，源系统把 event_time 从字符串改成了带时区的时间值，部分文件开始加载失败。

这不是一种问题。新增字段属于 Schema Evolution 可以处理的变化；已有字段类型改变需要单独迁移；字段重命名更不能简单地当作“多了一个新字段”。如果把所有变化都归为“自动 Schema Evolution”，很容易让数据静默丢失或让下游查询在上线后才报错。

## 核心知识

### 先区分新增、缺失、类型变化和重命名

假设原始订单文件包含：

~~~json
{
  "order_id": "O1001",
  "customer_id": "C01",
  "amount": 128.50
}
~~~

一周后源系统新增 discount_code：

~~~json
{
  "order_id": "O1002",
  "customer_id": "C02",
  "amount": 98.00,
  "discount_code": "SPRING"
}
~~~

这属于新增字段。Snowflake 的自动 Schema Evolution 可以在满足加载条件时将新列加入目标表。若源系统后来不再输出某个已有列，自动演进可能放宽该列的 NOT NULL 约束，以便缺少该字段的记录能够加载。

但以下变化要分别处理：

| 变化 | 自动 Schema Evolution 的处理 | 下游风险 |
|---|---|---|
| 新增 discount_code | 支持新增列，前提是加载配置满足要求 | 下游旧 SQL 看不到新字段，模型需要决定是否暴露 |
| 新文件缺少旧列 | 可能放宽该列的 NOT NULL | 原来必填的业务字段开始出现 NULL |
| amount 从 NUMBER 改成文本 | 不自动改变已有列类型 | 不兼容值可能导致加载失败 |
| customer_name 改名为 buyer_name | 不会自动推断这是同一个字段 | 旧列可能保持原样，新列可能另行出现 |
| 删除字段 | 不会自动把旧列从表中删除 | 下游可能继续读取旧列，但数据已不再更新 |

自动加列解决的是文件结构变化，不等同于业务契约兼容。

### 启用 Schema Evolution 需要同时满足加载条件

对于标准 Snowflake 表，至少需要：

1. 目标表将 ENABLE_SCHEMA_EVOLUTION 设置为 TRUE。
2. COPY INTO 使用 MATCH_BY_COLUMN_NAME，让文件列名与目标表列名匹配。
3. 执行加载的 Role 拥有 EVOLVE SCHEMA 或 OWNERSHIP 权限；Snowpipe 则检查拥有 Pipe 的 Role。
4. CSV 使用 PARSE_HEADER 时，还要按文档要求设置 ERROR_ON_COLUMN_COUNT_MISMATCH。
5. 文件格式和加载路径必须在该功能支持范围内；它不是任何 INSERT 或任意 SELECT 转换都能触发的通用 DDL 自动迁移。

示意配置：

~~~sql
ALTER TABLE raw_orders
  SET ENABLE_SCHEMA_EVOLUTION = TRUE;

GRANT EVOLVE SCHEMA
  ON TABLE raw_orders
  TO ROLE ingestion_role;

COPY INTO raw_orders
  FROM @orders_stage/daily/
  FILE_FORMAT = (TYPE = PARQUET)
  MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
~~~

列按名称匹配而不是按文件中的位置匹配。对于 CSV，还要核对 Header 解析和列数不匹配策略。开启前应先检查历史文件是否使用过不同的列名大小写或字段定义，避免一次加载意外新增出两列。

### 自动新增列不意味着已有字段可以自动改类型

Schema Evolution 不会把已经存在的列自动从 VARCHAR 改成 NUMBER，也不会自动协调不同系统对日期、时区和金额精度的定义。

例如第一批文件中的 amount 都是整数，推断成 NUMBER(3,0)；后续文件出现 128.50 或更大金额时，已有列类型无法容纳这些值，加载可能失败。正确做法是在建表前检查代表性样本，明确金额精度；类型变更则通过受控 DDL、兼容视图和数据回填完成。

如果需要分析文件结构，可以先用 INFER_SCHEMA 查看推断结果，但不能把一次样本推断结果直接当成永久数据契约。样本应覆盖最大数值、空值、时间格式、嵌套字段和异常值。

### SchemaEvolutionRecord 能帮助追溯自动变化

Snowflake 会在相关的列元数据中记录自动 Schema Evolution 信息。可通过 DESCRIBE TABLE、SHOW COLUMNS 或 INFORMATION_SCHEMA / ACCOUNT_USAGE 的列视图检查新增列的 SchemaEvolutionRecord。

例如：

~~~sql
SELECT
  column_name,
  data_type,
  is_nullable,
  schema_evolution_record
FROM INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = 'RAW'
  AND table_name = 'RAW_ORDERS'
ORDER BY ordinal_position;
~~~

这能回答“哪些列是自动加进来的、由哪个加载触发”。它不能替代下游依赖检查。字段重命名、手动修改字段或迁移后，还要确认元数据记录是否被清除，以及变更是否进入版本控制。

### 兼容性要从生产者、存储和消费者三侧判断

一个字段对源系统是可选的，不代表对报表也是可选的。建议把字段变化分类：

- **向后兼容**：新增可选字段，旧消费者忽略它仍能工作。
- **有条件兼容**：字段变为可空、精度变宽或业务含义变更，消费者可能需要调整。
- **破坏性变更**：字段重命名、删除、单位改变或枚举含义改变，旧消费者会得到错误结果或失败。

对于破坏性变更，不要直接覆盖旧字段。可以在过渡期同时输出旧字段和新字段，建立兼容视图，迁移消费者后再删除旧字段。对关键指标，做变更前后的样本对账和查询回归。

## 工程实施步骤

1. 在接入契约中记录字段名称、类型、是否可空、业务含义、单位、时间语义和负责人。
2. 对源文件运行 INFER_SCHEMA，抽查不同日期和不同来源的样本，确认推断出的类型能容纳真实数据范围。
3. 对允许新增列的原始落地表开启 Schema Evolution，并授予最小范围的 EVOLVE SCHEMA 权限。
4. 每次 COPY 后检查 SchemaEvolutionRecord、新列、可空属性和加载错误；不要只看 COPY 是否返回成功。
5. 对类型变化、重命名、删除字段建立显式迁移：兼容视图、双写或回填、消费者切换、旧列下线。
6. 用 INFORMATION_SCHEMA.COLUMNS、查询历史和下游依赖清单确认变化影响了哪些视图、任务、报表和 Semantic View。
7. 为关键字段建立回归数据集，比较行数、NULL 比例、金额总和、时间边界和枚举分布。
8. 记录变更版本、执行人、审批、回滚方案和生效日期；对无法兼容的消费者提前发出通知。

## 场景分析

订单源系统将 customer_name 改为 buyer_name，同时新增 buyer_type。加载任务开启了 Schema Evolution，第二天目标表出现 buyer_name 和 buyer_type 两列，但旧报表仍读取 customer_name。

不要把 buyer_name 自动覆盖到 customer_name。先确认这是真正的重命名，还是两个不同业务字段；再查明有哪些消费者依赖 customer_name。若语义相同，可以在迁移期提供兼容视图：

~~~sql
CREATE OR REPLACE VIEW orders_compat AS
SELECT
  order_id,
  customer_id,
  buyer_name AS customer_name,
  buyer_type
FROM raw_orders;
~~~

然后将下游消费者逐步切换到新字段，运行行数、空值率和业务报表对账。确认没有消费者依赖旧名字后，再安排旧列和兼容视图的退役。自动新增列只保证数据能进入目标表，不会自动迁移下游 SQL。

## 常见误区

- **把新增列、类型变化和重命名都视为自动 Schema Evolution。** 自动功能主要处理新增列和部分可空性变化，已有字段类型变化与重命名需要显式迁移。
- **开启 ENABLE_SCHEMA_EVOLUTION 就认为配置完成。** 还要检查 MATCH_BY_COLUMN_NAME、EVOLVE SCHEMA 权限、文件格式和加载方式。
- **只看 COPY INTO 成功状态。** 新列、NULL 比例、SchemaEvolutionRecord 和下游查询都要检查。
- **用少量文件推断永久字段类型。** 样本要覆盖最大精度、不同时间格式、嵌套字段和异常值。
- **源字段重命名后直接删除旧列。** 先查消费者并运行兼容期回归，再退役旧字段。

## 完成标准

- [ ] 能区分新增列、字段缺失、类型变化和字段重命名。
- [ ] 能列出自动 Schema Evolution 的目标表、COPY 配置和 Role 权限条件。
- [ ] 能解释 SchemaEvolutionRecord 的用途与局限。
- [ ] 能为类型变化和重命名设计兼容迁移。
- [ ] 能用数据质量与下游查询测试验证变更结果。

## 自测

1. COPY INTO 成功了，但新增字段没有出现在目标表。应优先检查哪三个配置或权限条件？
2. 某个新文件不再包含原先 NOT NULL 的字段。自动 Schema Evolution 可能如何调整列属性？这会给下游带来什么风险？
3. amount 由整数变成带两位小数的金额。为什么自动加列能力不能解决这个问题？
4. customer_name 改为 buyer_name，旧报表还依赖 customer_name。怎样安排兼容迁移和下线？
5. 怎样确认某个字段是通过自动 Schema Evolution 加入目标表的？

## 参考资料

- [Enable automatic table schema evolution](https://docs.snowflake.com/en/user-guide/data-load-schema-evolution)
- [Data loading overview](https://docs.snowflake.com/en/user-guide/data-load-overview)
- [Introduction to data pipelines](https://docs.snowflake.com/en/user-guide/data-pipelines-intro)
