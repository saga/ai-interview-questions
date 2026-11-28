# CoCo 辅助数据探索：采样方法、偏差与结论边界

## 本节要解决的问题

分析师接入一张 8 亿行的交易明细表，想先回答三个问题：各地区的交易量是否均衡？金额字段是否存在异常值？订单状态的空值和重复记录有多少？

直接跑全表画像可能花费较高；只用 LIMIT 取前几千行，又可能只看到某个日期分区或某个地区。CoCo 可以帮助生成探索 SQL、解释分布和提出下一步检查，但它不会自动把一个方便取得的样本变成有代表性的总体。

数据探索的目标是提出可验证的问题，不是急着给出业务结论。采样方法、过滤范围、时间窗口、分层方式和缺失值处理都要记录下来；对关键发现，必须回到全量数据或更有针对性的样本验证。

## 先理解 Snowflake 的两种基本采样方法

### LIMIT 是快速取行，不是随机抽样

下面的查询快速返回若干记录：

~~~sql
SELECT *
FROM SALES_DB.RAW.ORDER_LINES
LIMIT 2000;
~~~

LIMIT 不承诺随机性。它可能返回扫描路径或存储布局较早遇到的记录。如果表按交易日期聚簇，前 2,000 行可能集中在某一时间段；不能用它估算全年的地区分布或订单状态比例。

探索时可以用 LIMIT 检查字段形态和样例值，但不要把它作为统计样本。要推断分布，应明确使用 SAMPLE，并记录采样方法和参数。

### BERNOULLI 按行选择，SYSTEM 按存储块选择

Snowflake 的 SAMPLE 和 TABLESAMPLE 是同义语法，主要有两种方法：

| 方法 | 采样单位 | 特点 | 适合用途 |
|---|---|---|---|
| BERNOULLI / ROW | 独立行 | 每行以指定概率被选中 | 希望行级随机覆盖，分析行属性分布 |
| SYSTEM / BLOCK | 数据块，通常接近微分区 | 按块选择，通常更快；小表可能产生偏差 | 快速查看大型表的局部数据形态 |

按行取 5%：

~~~sql
SELECT
  ORDER_ID,
  CUSTOMER_ID,
  ORDER_DATE,
  REGION,
  NET_AMOUNT
FROM SALES_DB.RAW.ORDER_LINES
SAMPLE BERNOULLI (5);
~~~

按块取 5%，并指定种子：

~~~sql
SELECT
  ORDER_ID,
  CUSTOMER_ID,
  ORDER_DATE,
  REGION,
  NET_AMOUNT
FROM SALES_DB.RAW.ORDER_LINES
SAMPLE SYSTEM (5) SEED (17);
~~~

SYSTEM 通常比 BERNOULLI 快，因为它按存储块选择，而不是逐行进行随机选择。但如果数据在存储上按地区、日期或客户聚集，选中的块可能偏向部分类别；特别是小表，SYSTEM 样本可能与总体差异明显。

### 固定种子有可复现条件，不是永久样本 ID

对未发生变化的原表，SYSTEM/BLOCK 采样使用相同概率和相同种子，通常可以重复取得相同样本。表发生变化后，样本可能变化；对表副本采样，即使使用相同概率和种子，也不保证结果与原表相同。

SEED/REPEATABLE 只适用于 SYSTEM/BLOCK；不适用于 BERNOULLI，也不适用于固定行数采样。需要保存探索结论时，除了 SQL 和种子，还应保存查询时间、源表快照/版本、过滤条件和样本行数。

固定行数采样可以写成 SAMPLE (10000 ROWS)，其返回行数是固定的（前提是表至少有这么多行），上限为 1,000,000。固定行数采样不能使用 SYSTEM/BLOCK 和 SEED。若把固定行数样本用于比例估算，要注意小总体、分组稀疏和类别比例的影响。

### Join 前后采样的含义和成本不一样

如果在 Join 结果之后采样，Snowflake 需要先完成 Join，再对结果采样；这不会减少 Join 的计算成本。若要降低探索阶段的扫描和 Join 工作量，应考虑分别对源表进行采样，再执行探索性 Join：

~~~sql
SELECT
  o.REGION,
  COUNT(*) AS LINE_COUNT,
  COUNT(DISTINCT o.ORDER_ID) AS ORDER_COUNT,
  SUM(o.NET_AMOUNT) AS SAMPLE_NET_AMOUNT
FROM SALES_DB.RAW.ORDER_LINES SAMPLE BERNOULLI (2) AS o
JOIN SALES_DB.RAW.ORDERS SAMPLE BERNOULLI (10) AS h
  ON o.ORDER_ID = h.ORDER_ID
GROUP BY o.REGION;
~~~

这个查询只用于探索字段和关系，不适合直接估算总体净销售额。两个表独立采样会改变匹配概率，连接后的记录比例也不是简单的 2% 或 10%。如果分析的核心是 Join 匹配率，必须说明对哪一侧采样、抽样概率和推断方法；如果要验证关系键的完整性，最终还应在全量数据上检查孤儿键和重复键。

若在 Join 子查询完成后再使用 SAMPLE，采样虽然可以限制结果行数，但不能减少之前完整 Join 的代价。不要把“返回结果少”误认为“扫描和计算少”。

## 先画像，再抽样

### 样本之前先了解总体规模和字段结构

用 Information Schema 获取表的基本信息：

~~~sql
SELECT
  TABLE_NAME,
  ROW_COUNT,
  BYTES,
  LAST_ALTERED
FROM SALES_DB.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'RAW'
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;
~~~

再查看字段类型：

~~~sql
SELECT
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  ORDINAL_POSITION
FROM SALES_DB.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'RAW'
  AND TABLE_NAME = 'ORDER_LINES'
ORDER BY ORDINAL_POSITION;
~~~

ROW_COUNT 和 BYTES 可以帮助选择探索范围，但元数据不是实时业务质量证明。LAST_ALTERED 表示对象最近变更时间，不等于业务数据覆盖到哪个时点。

### 对关键列做全量轻量统计和样本分布检查

对于金额和业务键，可以先计算空值、唯一值和数值范围：

~~~sql
SELECT
  COUNT(*) AS total_rows,
  COUNT(ORDER_ID) AS non_null_order_id,
  COUNT_IF(ORDER_ID IS NULL) AS null_order_id,
  APPROX_COUNT_DISTINCT(ORDER_ID) AS approx_order_count,
  COUNT_IF(NET_AMOUNT IS NULL) AS null_amount,
  MIN(NET_AMOUNT) AS min_amount,
  MAX(NET_AMOUNT) AS max_amount,
  AVG(NET_AMOUNT) AS avg_amount
FROM SALES_DB.RAW.ORDER_LINES;
~~~

上面的统计是全量聚合，不需要把每条记录返回给客户端；但它仍会扫描相关数据，需要评估仓库资源和聚簇裁剪情况。APPROX_COUNT_DISTINCT 是近似值，不能用来证明主键唯一。唯一性必须通过重复键检查或数据约束验证。

再看分类字段分布：

~~~sql
SELECT
  REGION,
  ORDER_STATUS,
  COUNT(*) AS ROWS
FROM SALES_DB.RAW.ORDER_LINES
GROUP BY REGION, ORDER_STATUS
ORDER BY ROWS DESC;
~~~

如果数据量很大，可以先在样本上找出可疑类别和异常值，再针对候选区间执行精确的全量检查。不要把某个 SAMPLE 的比例直接写成全量统计。

## 分层采样解决稀有类别被漏掉的问题

### 一个总体样本可能完全看不到小群体

假设表中 99% 订单来自东京和大阪，剩余 1% 来自偏远地区。随机抽取 1% 行时，稀有地区可能只拿到很少样本，甚至没有被抽到。此时“样本中没有异常”不能证明总体没有异常。

可以先按 REGION、ORDER_STATUS 或月份分层，再在每层抽样。分层采样有两个不同用途：
- **覆盖检查**：保证每个地区/状态至少有一定数量的样本，用于发现稀有问题；
- **总体估计**：按各层真实总体规模加权，不能把每层等量抽样的结果直接相加当成总体比例。

示例使用稳定哈希值为每个地区抽取近似 10% 的记录，便于同一数据版本重复探索：

~~~sql
WITH profiled AS (
  SELECT
    ORDER_ID,
    REGION,
    ORDER_STATUS,
    NET_AMOUNT,
    HASH(ORDER_ID, 'explore-v1') AS sample_hash
  FROM SALES_DB.RAW.ORDER_LINES
)
SELECT
  REGION,
  ORDER_STATUS,
  COUNT(*) AS SAMPLE_ROWS,
  AVG(NET_AMOUNT) AS SAMPLE_AVG_AMOUNT,
  MIN(NET_AMOUNT) AS SAMPLE_MIN_AMOUNT,
  MAX(NET_AMOUNT) AS SAMPLE_MAX_AMOUNT
FROM profiled
WHERE ABS(MOD(sample_hash, 100)) < 10
GROUP BY REGION, ORDER_STATUS;
~~~

这是按业务键构造的确定性伪随机筛选，不是 Snowflake SAMPLE 子句，也不是统计学意义上的严格分层概率样本。HASH 分布适合探索性覆盖，不应用于安全、抽奖或审计抽样。若同一个 ORDER_ID 可能有多条明细，要决定是否按订单抽样，还是按订单明细抽样；两者对应不同的分析单位。

如果需要每个地区固定抽取最多 500 行，可用 ROW_NUMBER 分层排名：

~~~sql
SELECT
  ORDER_ID,
  REGION,
  ORDER_STATUS,
  NET_AMOUNT
FROM SALES_DB.RAW.ORDER_LINES
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY REGION
  ORDER BY HASH(ORDER_ID, 'region-sample-v1')
) <= 500;
~~~

该方法保证大多数地区至少能有最多 500 行用于探索；样本并非按地区总体占比抽取。如果要估计总体金额或状态比例，必须将各层结果按真实总体规模加权，或使用全量聚合。

### 缺失值和异常值不能只在样本中处理后丢弃

数据探索时，要先报告缺失值和异常值，再决定是否过滤：
- NULL 是未知、未采集、未适用，还是解析失败？
- 金额 0 是合法交易、退款冲销，还是错误默认值？
- 极大金额是异常交易、批量订单，还是单位错误？
- 状态缺失是否集中在某个来源系统或时间段？
- 数据是否有延迟、重复、修订或回补？

不要在探索 SQL 中用 COALESCE 把所有 NULL 填成 0 后就计算均值；这可能改变分布含义。保留原始缺失计数，再单独展示清理后的分析结果。

## CoCo 在探索过程中的职责

CoCo 可以把业务问题拆成可执行的 SQL 探索步骤，帮助生成列画像、分布统计、候选键检查、抽样查询和图表，并根据结果建议下一轮验证。它是协作开发工具，不是采样算法或数据治理规则引擎。

一个有效的探索请求应该给出：
- 目标表和允许访问的 Schema；
- 希望回答的问题；
- 样本预算和是否允许全量扫描；
- 分析单位（订单、订单行、客户或交易）；
- 时间范围、分层字段和固定样本版本；
- 不允许自动写入或覆盖数据的约束。

例如：“对 SALES_DB.RAW.ORDER_LINES 做只读画像。先统计总体行数、日期范围、关键键空值和近似基数，再按 REGION 和 ORDER_STATUS 做固定哈希样本。不要更新表，也不要把样本比例作为全量结论。输出需要全量复核的发现和下一条 SQL。”

CoCo 应先说明查询范围、预计扫描和输出字段，再运行只读 SQL。若要 CTAS、创建临时表或改变权限，应单独确认。CoCo Profile 只配置模型、instructions 和可用 skills，不会替用户改变当前 Snowflake 账号、Role 或 Warehouse；最终访问边界仍由 Snowflake RBAC 决定。

## 从发现到结论的验证过程

### 样本发现要转成可复核的全量检查

假设某次探索发现西日本地区的订单平均金额低于其他地区。下一步不要直接写“西日本客户购买力较弱”，而应：
1. 检查各地区的样本数和样本日期覆盖；
2. 比较订单类型、渠道、币种和客户分层；
3. 检查是否有某些大额订单只存在于未抽中的微分区；
4. 用全量聚合核对各地区订单量、净金额和平均订单金额；
5. 对可疑类别做分层精确查询；
6. 查看异常日期、退款、取消订单、缺失金额和重复订单；
7. 判断差异是否由交易组合、业务规则或数据问题造成。

样本统计可以提出假设，不能单独证明业务原因。不同分层的样本若采用不同抽样比例，汇总时必须考虑权重；不能把各层的样本均值简单平均当作总体均值。

### 探索结论应保留可复现的查询证据

每次探索至少保存：
- Query ID 和 SQL；
- 账号、Role、Warehouse；
- 源表对象名和采样时点；
- 时间过滤条件；
- SAMPLE 类型、概率和 seed，或分层 HASH 规则；
- 样本行数、全量统计结果；
- 缺失值、异常值与被排除记录的数量；
- 结论中哪些是观察事实、哪些是假设；
- 需要进一步全量复核的项目。

若源表发生变化，之前的样本和比例不一定仍然成立。要复现历史结果，需要固定源数据快照或业务版本，而不是只保存随机种子。

## 工程实施步骤

1. 确认目标对象、当前 Role、Warehouse 和允许读取范围，使用只读角色执行探索。
2. 从 Information Schema 获取对象、列类型、行数、大小和最近修改信息。
3. 对关键字段计算空值、近似基数、最小/最大值、日期覆盖和分组分布。
4. 使用 LIMIT 查看样例行，但不要将其作为统计样本。
5. 根据成本和目标选择 BERNOULLI 行采样或 SYSTEM 块采样；明确是否需要 seed。
6. 在需要覆盖稀有群体时，按地区、状态或时间分层采样，并明确每层样本量和总体权重。
7. 避免在 Join 后抽样来节省计算；先说明采样对象和 Join 后推断的意义。
8. 对发现的问题执行全量或针对性精确查询，验证重复键、孤儿键、缺失值和异常金额。
9. 将探索性结论、样本证据、假设和待验证事项分开记录，不直接改写正式 Metric 或业务数据。
10. 保存 SQL、Query ID、采样参数、源数据时间和验证结果，支持重复探索与审计。

## 常见误区

- **把 LIMIT 当随机采样。** LIMIT 只是快速返回若干行，不保证代表总体。
- **把 SYSTEM 和 BERNOULLI 当成相同采样。** SYSTEM 按块采样，通常更快但可能受微分区/存储聚集影响；BERNOULLI 按行采样。
- **认为 seed 可以永久固定样本。** 原表改变、复制表或数据布局变化时，样本不保证一致。
- **在 Join 结果后采样以降低 Join 成本。** Join 已经执行完成，采样不会减少前面的 Join 工作量。
- **把全局随机样本当稀有类别覆盖保证。** 稀有地区/状态需要分层覆盖或专项抽查。
- **把分层等量抽样的样本均值直接合并成总体均值。** 不同层样本比例不同，需要按总体规模加权。
- **把 APPROX_COUNT_DISTINCT 当唯一性证明。** 近似基数只用于画像，不能代替重复键检测。
- **把发现性统计当正式指标。** 需要核对业务口径、全量数据和反例，再发布 Metric。
- **让 CoCo 根据样本直接修改业务数据。** 探索和生产变更应分离，写入前必须确认目标、影响和回滚方案。

## 完成标准

- [ ] 能区分 LIMIT、BERNOULLI、SYSTEM 和固定行数采样。
- [ ] 能解释 SYSTEM 按块采样可能带来的偏差以及 BERNOULLI 的成本取舍。
- [ ] 能说明 seed 复现样本的适用条件和限制。
- [ ] 能识别 Join 前后抽样对计算成本与统计解释的影响。
- [ ] 能按业务分层覆盖低频类别，并说明总体加权的必要性。
- [ ] 能使用 Information Schema 和聚合 SQL 进行基本数据画像。
- [ ] 能将样本发现转成全量或定向复核，并保存可复现证据。
- [ ] 能限制 CoCo 的查询范围和写入权限，不把探索结果直接升级为业务结论。

## 自测

1. 对一张按交易日期聚簇的大表使用 LIMIT 2000。为什么得到的样本可能集中在某个日期区间？
2. 什么时候优先用 BERNOULLI，什么时候可以使用 SYSTEM？两者分别按什么单位采样？
3. 原表没变时用同样 seed 得到相同 SYSTEM 样本；复制表后样本变了。这是否违反文档的可复现保证？为什么？
4. 对两张表先 Join 再 SAMPLE，能否减少 Join 的扫描成本？如果需要降低成本，应如何组织探索 SQL？
5. 某地区占总体 0.1%，随机抽取 1% 行没有出现这个地区。能否说该地区没有异常？应使用什么抽样方案？
6. 你对每个地区等量抽取 500 行，直接平均各地区平均金额是否等于全体客户平均金额？需要什么权重？
7. CoCo 通过样本发现某字段重复率很低。是否足以把它声明为正式 Primary Key？还需要什么验证？

## 参考资料

- [SAMPLE / TABLESAMPLE](https://docs.snowflake.com/en/sql-reference/constructs/sample)
- [CoCo Profiles (Preview)](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-snowsight/profiles)
- [Skills and Plugins in CoCo](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-snowsight/skills-and-plugins)
- [Snowpark DataFrame API](https://docs.snowflake.com/en/developer-guide/snowpark/python/working-with-dataframes)
