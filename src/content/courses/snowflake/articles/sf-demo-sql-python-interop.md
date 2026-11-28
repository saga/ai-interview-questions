# SQL 与 Python 的协同分析

## 本节要解决的问题

分析师需要从订单明细计算每个客户的月销售额，再用 Python 做异常客户识别。最初的 Notebook 先把整张 FACT_ORDER_LINE 表读到 pandas，再在本地 groupby、merge 和计算。数据从几十万行增长到上亿行后，Notebook 内存吃紧，结果也受本地 Python 环境和时区转换影响。

Snowpark DataFrame 和 pandas DataFrame 都叫 DataFrame，但执行位置不同。Snowpark DataFrame 表达的是一条尚未执行的查询计划；pandas DataFrame 是已经搬到 Python 进程内存中的数据。两者之间的转换是性能、内存和数据治理的边界。

## 核心知识

### Snowpark DataFrame 是惰性查询计划，不是本地数据副本

可以先在 Snowflake 端过滤和聚合：

~~~python
from snowflake.snowpark.context import get_active_session
from snowflake.snowpark.functions import col, sum as sum_, count

session = get_active_session()

monthly_sales = (
    session.table("ANALYTICS.MART.FACT_ORDER_LINE")
    .filter(col("ORDER_DATE") >= "2026-11-01")
    .filter(col("ORDER_DATE") < "2026-12-01")
    .group_by("CUSTOMER_ID")
    .agg(
        sum_("LINE_AMOUNT").alias("MONTH_AMOUNT"),
        count("*").alias("LINE_COUNT"),
    )
)
~~~

这段代码建立 DataFrame 逻辑计划，但通常还没有把结果下载到 Python。Snowpark 在调用 collect、show、to_pandas 等 action 时才执行查询。可通过 monthly_sales.explain() 查看计划生成的 SQL 和执行逻辑，确认过滤、聚合是否仍在 Snowflake 端完成。

如果下一步只是要把聚合结果写回表或继续做 SQL 关联，没必要先转成 pandas。可以继续使用 Snowpark DataFrame，或通过 SQL 完成下游计算。

### collect 和 to_pandas 会把结果取回客户端

以下操作会触发计算并把结果交给 Python：

~~~python
rows = monthly_sales.collect()
pdf = monthly_sales.to_pandas()
~~~

collect 返回 Snowpark Row 列表；to_pandas 返回 pandas DataFrame。结果数据量较大时，所有结果都进入当前 Python 进程，内存需求与结果列数、类型和行数相关，不要把这两种操作放在没有行数限制的明细查询上。

若确实需要在 Python 中处理较大的结果，可以按批次取回：

~~~python
for batch in monthly_sales.to_pandas_batches():
    # batch 是当前批次的 pandas DataFrame
    inspect_batch(batch)
~~~

分批能降低单次物化的峰值内存，但仍然会把数据传到客户端。它不能替代 Snowflake 端聚合；如果结果本来可以缩小到几千行，应先在 SQL/Snowpark 端完成过滤和汇总。

### Pandas 适合做本地分析，不适合代替分布式数据处理

pandas 适合在已缩小的样本或聚合结果上做绘图、统计检验、轻量模型输入准备和快速探索。例如按客户销售额计算分位数、绘制异常点分布。若需要处理全量订单明细、复杂 Join 或大规模聚合，应优先留在 Snowflake 或使用适合的分布式执行方式。

一个常见分工是：

1. SQL/Snowpark：筛选时间窗口、过滤无效记录、连接维度、聚合到客户级。
2. pandas：对客户级的有限结果做探索性统计或可视化。
3. 需要生产化的变换：回到受版本管理的 SQL、Snowpark 作业或管道，不把 Notebook 里临时运行的 pandas 代码当成稳定数据契约。

### 类型转换可能改变时间、数值和 NULL 语义

把 Snowflake 查询结果转到 pandas 时，时间戳类型会映射到 pandas 对应类型。TIMESTAMP_LTZ 和 TIMESTAMP_TZ 会转换成带时区的 datetime64 类型；TIMESTAMP_NTZ 会转换成不带时区的 datetime64。若应用把它们都当成同一个“本地时间”，很容易在夏令时或不同时区用户之间产生日期偏差。

数值精度也要小心。财务金额应确认在 Snowflake 中使用的 NUMBER 精度、Python 侧的 decimal/float 转换方式和舍入规则；不要因为绘图方便就把需要精确对账的金额转为二进制浮点后再当作财务结果。

对 NULL、NaN、NaT 和空字符串也应分开定义。SQL NULL 转到 pandas 后的表现取决于数据类型和转换路径，不能简单把所有缺失值填成 0。

### Notebook 的 SQL 和 Python 共享会话，但执行证据仍要看 Query ID

在 Snowflake Notebooks 中，SQL 单元格与 Python 单元格可以围绕当前 Notebook Session 协作。Python 可以用 get_active_session() 获取当前会话；SQL 和 Snowpark 操作使用 Notebook 创建时配置的 Role、Warehouse、Database 和 Schema。

Notebook 交互执行并不意味着每次都从头按顺序运行。单独运行某个单元格时，它可能引用之前某次执行留下的变量或结果；正式分享或调度前应执行 Run All，检查所有单元格按顺序重新执行后的结果。SQL 单元格的运行详情包括 Warehouse、返回行数和 Query ID，可以用来追踪具体查询。

## 工程实施步骤

1. 先明确最终需要留在 Snowflake 的结果，以及真正必须进入 Python 的数据范围。
2. 使用 Snowpark DataFrame 构建过滤、连接和聚合步骤；在 action 之前调用 explain() 检查逻辑计划。
3. 对 collect、to_pandas、to_pandas_batches 逐一记录预计行数和列宽，限制不必要的明细数据下载。
4. 如需 pandas，尽量传递已聚合或抽样结果；大结果使用批次迭代，并控制客户端内存。
5. 核对 TIMESTAMP_LTZ、TIMESTAMP_TZ、TIMESTAMP_NTZ 的含义和时区转换；财务数值保留所需精度。
6. 将本地计算和 Snowpark 计算的输出用小样本对账，特别检查 NULL、重复键、时间边界和舍入。
7. Notebook 定稿前执行 Run All，确认没有依赖旧变量或上次会话缓存的输出。
8. 记录执行身份、Warehouse、Query ID、输入范围和运行时间；生产化后将稳定逻辑迁移到 SQL、Snowpark 作业或受控管道。

## 场景分析

客服分析团队要识别 11 月销售额异常高的客户。原表有 1.2 亿条订单明细，团队只需要每个客户的月销售总额和订单行数，再在 Python 里计算分位数并可视化。

如果先运行：

~~~python
all_lines = session.table("ANALYTICS.MART.FACT_ORDER_LINE").to_pandas()
~~~

就会把 1.2 亿条明细搬到 Notebook 进程。更合理的做法是先过滤 11 月，再按 CUSTOMER_ID 聚合。假设聚合后只有 8 万行，pandas 的内存需求和网络传输就会小得多。

即使聚合后的 8 万行可以一次性取回，也应先用 Query ID 确认数据库端扫描范围和结果行数。若后续只需要画图，甚至可以在 SQL 端先计算分位数和异常客户列表，再取回少量展示数据。数据在哪边执行，应由数据规模和操作类型决定，不由“Notebook 里写的是 Python”决定。

## 常见误区

- **把 Snowpark DataFrame 当作 pandas DataFrame。** 前者是查询计划，后者是本地内存中的数据；执行和资源位置不同。
- **一开始就调用 collect 或 to_pandas。** 这会触发执行和数据传输；先检查结果规模，并尽可能在 Snowflake 端缩小数据。
- **以为 to_pandas_batches 不会传输数据。** 它只是分批返回，仍然会把结果送到客户端。
- **认为 Snowpark 的链式调用每一步都会立即运行。** 多数转换是惰性的，action 才触发查询执行。
- **把所有时间戳都当成本地时间。** NTZ、LTZ 和 TZ 的转换语义不同，要明确业务时区。
- **把 Notebook 单元格显示的旧结果当作当前代码运行证据。** 正式交付前应 Run All 并检查 Query ID。

## 完成标准

- [ ] 能解释 Snowpark DataFrame 的惰性执行和 action。
- [ ] 能区分 collect、to_pandas 与 to_pandas_batches 的内存和传输行为。
- [ ] 能判断哪些操作应该在 Snowflake 端完成，哪些适合本地 pandas。
- [ ] 能说明 Snowflake 时间戳和数值类型转为 pandas 后的风险。
- [ ] 能通过 explain、Query ID 和结果规模验证执行位置和数据传输。
- [ ] 能解释 Notebook 单元格执行顺序与旧输出的风险。

## 自测

1. 一个 Snowpark DataFrame 还没有调用 collect 或 to_pandas，为什么通常还不能认为查询已经执行？
2. 表有 1 亿行，但分析只需要每个客户一行的月度汇总。应在哪一侧完成 GROUP BY？为什么？
3. to_pandas_batches 与 to_pandas 在内存方面有什么不同？它们是否都把数据传到客户端？
4. TIMESTAMP_NTZ 与 TIMESTAMP_TZ 转到 pandas 时会出现什么差异？跨时区报表要额外确认什么？
5. Notebook 单独运行一个 Python 单元格，引用了上次运行留下的变量。正式交付前应该怎样验证结果是可复现的？

## 参考资料

- [Snowpark DataFrame](https://docs.snowflake.com/en/developer-guide/snowpark/reference/python/latest/snowpark/api/snowflake.snowpark.DataFrame)
- [DataFrame.to_pandas](https://docs.snowflake.com/en/developer-guide/snowpark/reference/python/latest/snowpark/api/snowflake.snowpark.DataFrame.toPandas)
- [Session context in Notebooks](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-sessions)
- [Develop and run code in Snowflake Notebooks](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-develop-run)
