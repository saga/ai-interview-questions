# PostgreSQL 数据类型、时间与完整性约束

## 本节要解决的问题

为业务数据选择能表达真实语义的数据类型，并通过约束在数据库层阻止无效记录。类型与约束不仅影响存储大小，也决定精度、比较、NULL 语义、时区转换和并发写入时的数据完整性。

## 核心知识

### NUMERIC 与浮点数适用场景不同

PostgreSQL 的 integer、bigint 适合计数、标识和可精确表达的整数；numeric/decimal 提供可配置精度的精确数值，适合金额、税额和需要确定十进制舍入规则的计算；real 与 double precision 使用二进制浮点，存储近似值，适合测量、统计和对误差可容忍的数值计算。

numeric 计算通常比浮点数慢，不能为了“精度更高”而无差别替换所有数值列。应根据金额、比例、科学测量和计数等业务含义选择类型，并显式定义精度、scale、溢出和舍入规则。

### timestamp 与 timestamptz 表达不同的时间含义

timestamp without time zone 保存日历日期和时间，不做时区转换；适合明确表示某地墙上时间、且业务规则另行约定时区的场景。timestamp with time zone（timestamptz）表示时间点，输入时根据时区解释并以 UTC 内部存储，查询显示时再按当前 Session TimeZone 转换。

timestamptz 不保存原始时区名称。如果业务需要保留用户所在地区或原始时区，应另外保存 IANA Zone Name，例如 Asia/Tokyo。不要用 timestamp without time zone 隐式表示跨地区事件时间，否则夏令时和跨时区比较容易产生歧义。

### JSONB、数组、UUID 与枚举各有取舍

jsonb 以二进制分解形式存储 JSON，适合需要查询和索引的半结构化属性；json 保留输入文本形式，适合需要保留原始 JSON 文本语义的场景。结构稳定、常用于过滤和连接的字段，通常应建成正式列，而不是永远埋在 JSON 中。

数组适合单行内有自然集合语义的值，但不应替代需要独立生命周期、约束或大量关联查询的子表。UUID 适合跨系统生成的全局标识；ENUM 可限制固定状态集合，但增删值需要考虑部署顺序和兼容性。

### Constraints 在写入时强制数据不变量

- NOT NULL：列不能为 NULL。
- CHECK：当前行表达式必须为 TRUE 或 NULL；如果结果是 NULL，也视为通过。因此 CHECK (amount > 0) 不会自动拒绝 amount=NULL，应另设 NOT NULL。
- UNIQUE：保证列或列组合唯一；默认情况下多个 NULL 不被视为相等，PostgreSQL 15+ 支持 NULLS NOT DISTINCT 改变这一行为。
- PRIMARY KEY：唯一且非空，一张表最多一个主键，可由多个列组成。
- FOREIGN KEY：要求引用列匹配被引用表的唯一键/主键；引用侧是否允许 NULL 要结合 NOT NULL 和 MATCH 规则决定。
- EXCLUDE：用于表达相互冲突的值不能同时存在，例如时间区间重叠限制。

Foreign Key 会自动为被引用端的主键/唯一键建立所需索引，但不会自动给引用端列创建索引；父表删除或更新时，引用侧索引会影响性能，应根据查询与级联操作需求评估。

## 工程实施步骤

1. 为每列写清业务语义、是否可空、允许范围、精度、单位和是否涉及时区。
2. 金额使用 numeric(p,s) 并明确舍入规则；计数使用合适整数；对近似测量或科学计算再选择 real/double precision。
3. 事件时间使用 timestamptz；若需保留原始业务时区，另外保存 zone name 或来源时区。
4. 对 JSON/JSONB 内的稳定高频查询字段，评估是否投影为类型明确的列，并为查询路径建立合适索引。
5. 用 NOT NULL、CHECK、UNIQUE、PRIMARY KEY、FOREIGN KEY 和 EXCLUDE 表达可由数据库保证的不变量。
6. 注意 CHECK 对 NULL 的处理；需要必填的列必须单独使用 NOT NULL。
7. 根据业务选择 UNIQUE 默认 NULL DISTINCT 还是 NULLS NOT DISTINCT，避免误以为 UNIQUE 自动禁止多个 NULL。
8. 对外键引用侧评估索引，检查删除/更新时的级联或拒绝行为及其锁影响。
9. 对大型历史表添加约束时先检查现有脏数据；可用 NOT VALID 验证策略时，安排后续 VALIDATE CONSTRAINT。
10. 用并发写入测试验证唯一键、外键和排斥约束在并发事务下仍能阻止非法状态，不依赖应用先 SELECT 再 INSERT 的竞态检查。

示例：

~~~sql
CREATE TABLE sales.order_line (
  order_id bigint NOT NULL,
  line_no integer NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  event_time timestamptz NOT NULL,
  attributes jsonb,
  PRIMARY KEY (order_id, line_no)
);
~~~

若订单头表位于 sales.orders，还应添加 FOREIGN KEY；若业务允许同一订单存在多个同号行项目，则需要重新定义复合业务键，而不是删掉主键约束。

## 场景分析

订单系统需要保存金额、事件时间和外部支付回执。早期表把金额定义成 double precision，把事件时间定义成 timestamp without time zone，并用应用代码检查订单号是否重复。

迁移时先确认金额精度和历史舍入规则，再转换成 numeric；对事件时间确认原始数据采用哪个时区，转换成 timestamptz 前要显式指定来源时区；支付回执可保留为 jsonb，但交易号和状态等高频字段应投影成可约束的列。最后通过 UNIQUE/PRIMARY KEY 保证业务键，避免应用层先查询再插入所产生的并发竞争。

验收检查金额对账、跨时区显示、重复并发写入、NULL 金额、重复订单行和错误引用；迁移后要比较历史记录数量与金额汇总。

## 常见误区

- **金额直接用 double precision。** 二进制浮点可能无法精确表示十进制金额。
- **认为 timestamptz 会保存用户输入的时区名称。** 它保存时间点并以 UTC 内部表示，原始 Zone 需另存。
- **用 CHECK(amount > 0) 就能禁止 NULL。** CHECK 结果为 NULL 时也会通过，必填列需 NOT NULL。
- **认为 UNIQUE 自动拒绝多个 NULL。** 默认多个 NULL 可以共存；需要时评估 NULLS NOT DISTINCT。
- **把所有半结构化数据永久放在 JSONB。** 稳定、高频查询和需要约束的字段适合正式列。
- **认为外键会自动给引用侧建立索引。** 外键引用侧索引应根据访问和级联行为自行评估。

## 完成标准

- [ ] 能根据业务精度选择 numeric 或浮点类型。
- [ ] 能区分 timestamp 与 timestamptz 的存储和显示行为。
- [ ] 能选择 jsonb、数组、UUID 和 ENUM 的适用场景。
- [ ] 能解释 CHECK、UNIQUE、PRIMARY KEY、FOREIGN KEY 和 EXCLUDE 的语义。
- [ ] 能识别 NULL 在约束中的行为和引用侧索引需求。

## 自测

1. 金额列使用 double precision 可能造成什么问题？numeric 的代价是什么？
2. timestamptz 是否保存了用户输入的 Asia/Tokyo 字符串？若业务需要保留原始时区怎么办？
3. CHECK (amount > 0) 为什么不能禁止 amount 为 NULL？
4. UNIQUE 列默认允许多个 NULL 吗？PostgreSQL 15+ 如何改变这一行为？
5. 外键声明后，引用侧是否自动创建索引？哪些业务操作会使该索引变得重要？

## 参考资料

- [Date/Time Types](https://www.postgresql.org/docs/current/datatype-datetime.html)
- [Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html)
- [Data Types](https://www.postgresql.org/docs/current/datatype.html)
- [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
