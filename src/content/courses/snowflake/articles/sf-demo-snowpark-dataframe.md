# Snowpark DataFrame 转换与优化

## 本节要解决的问题

订单明细表每天新增数千万行。分析团队需要计算客户月度销售额、找出每个客户金额最高的订单，并把结果写入模型层。开发者先写了一段 Python 循环逐客户查询，后来改成多个 DataFrame 链式调用，却仍不清楚 SQL 什么时候发送到 Snowflake、哪些运算会被下推、怎样判断 Join 有没有扩行。

Snowpark DataFrame 不是把数据加载到 Python 内存的 DataFrame。它主要表达一组关系型转换，Snowflake 在 Action 触发时执行对应查询。理解这一点，才能把筛选、Join、聚合和窗口计算留在数据所在的位置，并用实际执行计划判断优化是否有效。

## 核心知识

### Transformation 只构建查询计划，Action 才触发执行

例如读取订单与客户表，并限定日期范围：

~~~python
from snowflake.snowpark.context import get_active_session
from snowflake.snowpark.functions import col

session = get_active_session()

orders = (
    session.table("ANALYTICS.MART.FACT_ORDER_LINE")
    .filter(col("ORDER_DATE") >= "2026-11-01")
    .filter(col("ORDER_DATE") < "2026-12-01")
    .select("ORDER_ID", "CUSTOMER_ID", "ORDER_DATE", "LINE_AMOUNT")
)
~~~

table、filter 和 select 这些操作通常只是产生新的 DataFrame 计划，不会立即把所有数据传回 Python。真正执行的 Action 包括 collect、count、show、to_pandas、write.save_as_table 等。

可以先用 explain 查看计划：

~~~python
orders.explain()
~~~

检查生成的 SQL/查询计划是否在 Snowflake 端完成过滤与列裁剪。不要把每一步转换都理解成一次独立网络往返；链式操作通常会组成一条查询。不过，执行时机和最终 SQL 仍应通过 Query History 和 Query Profile 核实。

### 把多个步骤组合成一个关系型计划

例如按客户汇总订单明细，然后关联客户地区：

~~~python
from snowflake.snowpark.functions import sum as sum_

customers = (
    session.table("ANALYTICS.MART.DIM_CUSTOMER")
    .select("CUSTOMER_ID", "REGION")
)

monthly_sales = (
    orders
    .group_by("CUSTOMER_ID")
    .agg(sum_("LINE_AMOUNT").alias("MONTH_SALES"))
)

sales_by_region = (
    monthly_sales
    .join(customers, on="CUSTOMER_ID", how="left")
    .group_by("REGION")
    .agg(sum_("MONTH_SALES").alias("REGION_SALES"))
)
~~~

这段逻辑把月份过滤、客户汇总、维度关联和地区聚合组织成一个 DataFrame 计划。它不意味着 Snowpark 自动保证结果正确：如果 DIM_CUSTOMER 中 CUSTOMER_ID 重复，Join 仍会扩行；如果订单事实按订单行存储，LINE_AMOUNT 可以按明细汇总，但订单头金额不能随意混进同一粒度。

在 Join 前先验证维度键唯一：

~~~python
duplicate_customers = (
    customers
    .group_by("CUSTOMER_ID")
    .count()
    .filter(col("COUNT") > 1)
)
duplicate_customers.show()
~~~

如果出现重复键，要确认这是维度历史版本还是数据错误。对 SCD Type 2 维度，应按业务日期选中有效版本，而不是直接按 CUSTOMER_ID 连接所有版本。

### Window 函数需要显式定义分区、排序和 Frame

Snowpark 可以通过 Window API 构建排名、累计、前后记录比较：

~~~python
from snowflake.snowpark.functions import row_number
from snowflake.snowpark.window import Window

customer_order_window = (
    Window
    .partition_by("CUSTOMER_ID")
    .order_by(col("LINE_AMOUNT").desc(), col("ORDER_ID"))
)

largest_order_lines = (
    orders
    .with_column("ROW_NO", row_number().over(customer_order_window))
    .filter(col("ROW_NO") == 1)
)
~~~

这里每个客户只保留金额最大的订单行。ORDER_ID 作为次级排序键，用来处理金额并列时的稳定选择。如果业务要求保留并列最大值，应使用 RANK 或 DENSE_RANK，而不是 ROW_NUMBER。

做逐行累计时还要显式确定 Window Frame；只按日期排序可能让同一天的记录成为 peers。选择 ROWS 或先按天聚合，应取决于业务定义，而不是只看 API 链式调用是否能运行。

### Snowpark 的价值在于数据在 Snowflake 内计算，不是 Python 写法更短

Snowpark DataFrame 可以组合 SQL 能表达的筛选、Join、聚合、窗口和投影，适合用 Python 组织可复用的数据转换。它不会把任意 Python 函数自动翻译成 SQL。

例如，下面的操作是在 Python 客户端把查询结果拉回来，再本地处理：

~~~python
pdf = orders.to_pandas()
~~~

如果 orders 有上亿行，这会产生大量网络传输和客户端内存压力。应先在 Snowpark 中完成过滤、聚合或抽样，再将有限结果交给 pandas。对自定义计算，只有当 SQL 内置表达式不能满足需求时，再评估 UDF、向量化 UDF 或其他运行方式，并比较执行成本与可维护性。

### 执行计划、Query Profile 与结果对账要一起看

explain 可帮助开发者查看 DataFrame 转换形成的计划，但它不是实际运行性能报告。执行之后，还要通过 Query History 和 Query Profile 检查：

- 计划是否使用了预期过滤条件和列投影。
- Join 前后的行数与关键键数量是否符合预期。
- 扫描的微分区和字节数是否合理。
- Join、聚合、排序算子是否成为耗时热点。
- 是否发生本地或远程 Spill。
- 最终输出行数、金额和控制总额是否与 SQL 基线一致。

如果 DataFrame 计划看起来合理但执行很慢，应针对实际 Query ID 打开 Query Profile，不能只凭 Python 代码“看起来是向量化的”就断言性能很好。

## 工程实施步骤

1. 先明确输入输出粒度、业务键、目标表和过滤范围。
2. 使用 Snowpark DataFrame 构建过滤、投影和聚合；尽可能先缩小数据再做 Join。
3. 对 Join 的两侧检查唯一键和基数，特别关注 SCD 历史维度与多对多关系。
4. 对 Window 明确 partition、排序稳定性和 ROWS/RANGE 语义。
5. 在执行前调用 explain 查看计划；在执行后保存 Query ID 并打开 Query Profile。
6. 比较 Snowpark 结果与独立 SQL 基线，检查行数、去重键、金额、NULL 和边界日期。
7. 对小样本使用 show 或 collect；只有结果规模明确受控时才用 to_pandas。
8. 需要写表时使用 DataFrameWriter，明确 mode、目标表和是否允许覆盖，避免将临时测试结果误写入生产表。
9. 对重复执行的作业定义业务键和幂等规则，避免 overwrite/append 模式造成重复或误删。
10. 将稳定转换放进版本管理的 Python 模块或受控作业中，不把生产逻辑只留在一次性 Notebook 单元格。

## 场景分析

每月订单明细有 8,000 万行。业务需要按客户汇总月销售额，再计算地区总额，并取每个客户金额最大的订单行。

如果先把 8,000 万行转为 pandas，Notebook 会先承担全部网络传输和本地内存成本。使用 Snowpark 时，先在 Snowflake 端按月份过滤、按客户聚合，再关联已校验唯一的客户维度；另一个窗口查询从筛选后的数据中找最大订单行。最后只把少量汇总结果取回 Python 画图。

验收要分别比较客户汇总行数、地区总额和最大订单行样本。若 Join 客户维度后地区总额突然增加，先检查 CUSTOMER_ID 是否唯一，而不是继续加 Warehouse 或改用 pandas。

## 常见误区

- **把 DataFrame 对象当成本地数据。** Snowpark DataFrame 通常是逻辑计划，只有 Action 才执行并返回结果。
- **认为链式 API 自动保证高性能。** 仍要检查生成计划、Query Profile、Join 基数和扫描量。
- **在 Join 前不检查维度唯一性。** 重复键会扩行，Snowpark 不会自动判断哪个记录才是正确维度版本。
- **用 ROW_NUMBER 处理并列值却不定义次级排序。** 结果可能不稳定；是否保留并列项应由业务规则决定。
- **把 to_pandas 当作无成本转换。** 它会把结果取到 Python 客户端，必须控制数据规模。
- **把 show 或 explain 的输出当作性能验收。** 计划和实际执行证据不同，性能问题应回到 Query ID 与 Query Profile。

## 完成标准

- [ ] 能区分 Transformation 与 Action，并指出哪些操作会触发执行。
- [ ] 能通过 explain 查看 Snowpark DataFrame 计划。
- [ ] 能在 Join 前核对业务键唯一性和粒度。
- [ ] 能用 Window API 实现稳定排名和窗口计算。
- [ ] 能区分 Snowpark 端计算与 pandas 本地计算的资源位置。
- [ ] 能结合 Query Profile 与业务控制总额验证优化结果。

## 自测

1. 构建 DataFrame 并连续调用 filter、select、group_by，为什么通常还没有执行 SQL？哪些操作会触发执行？
2. customers 表中 CUSTOMER_ID 有重复。orders Join customers 后金额变大，问题可能来自哪里？Snowpark 会自动去重吗？
3. 每个客户要选最大金额的订单，若金额可能并列，ROW_NUMBER 与 RANK 分别会产生什么结果？
4. explain 显示过滤被下推，但 Query Profile 中仍然有远程 Spill。下一步应检查哪些算子和数据规模？
5. 一张 8,000 万行表只需返回 5,000 个客户汇总。为什么应先在 Snowflake 端聚合，而不是先 to_pandas 再 groupby？

## 参考资料

- [Working with DataFrames in Snowpark Python](https://docs.snowflake.com/en/developer-guide/snowpark/python/working-with-dataframes)
- [Snowpark DataFrame API](https://docs.snowflake.com/en/developer-guide/snowpark/reference/python/latest/snowpark/api/snowflake.snowpark.DataFrame)
- [Query Profile and operator statistics](https://docs.snowflake.com/en/user-guide/performance-query-exploring)
