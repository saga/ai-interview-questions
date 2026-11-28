# COPY INTO 导出与数据卸载

## 本节要解决的问题

将 Snowflake 表或查询结果可靠地导出到内部或外部 Stage 文件，控制文件格式、分片、路径布局和目标系统兼容性。数据卸载不仅是把 SELECT 结果写出，还需要考虑文件命名、并行度、压缩、重复覆盖和导出结果核对。

## 核心知识

### COPY INTO location 将查询结果卸载到 Stage

COPY INTO location 可将表或 SELECT 查询结果导出至 Snowflake 内部 Stage 或 External Stage。查询源可以使用 SQL 的过滤、Join 和列选择逻辑。目标位置指定文件前缀或路径，文件写出格式由 FILE_FORMAT 与 COPY 选项控制。

默认情况下，Snowflake 为并行卸载生成多个文件，文件名会附加唯一后缀。对大规模结果，多个文件通常比单个大文件吞吐更好，也更方便分布式下游消费。

### SINGLE 与 MAX_FILE_SIZE 控制文件布局

SINGLE=TRUE 可要求输出单个文件，但可能降低卸载性能；MAX_FILE_SIZE 用于控制每个输出文件的最大大小。应按下游工具能力和数据量选择，而不是默认生成单一文件。

PARTITION BY 可以按表达式将结果写入不同目录结构，便于数据湖按业务日期或区域读取。分区表达式需要审慎选择，避免高基数目录导致大量小文件。

### 导出类型、压缩和下游读取需要明确约定

CSV、JSON、Parquet 等格式具有不同类型表达能力。某些 Snowflake 类型导出时会转换为特定表达方式，例如 VARIANT、GEOMETRY 和 GEOGRAPHY 以 JSON 字符串表示；部分复杂类型或高精度时间戳需要显式 CAST，避免下游误读。

压缩算法、文件扩展名、编码、列顺序、时间格式和空值规则应成为导出契约，不能只依靠文件名推断。

## 工程实施步骤

1. 明确下游消费系统、数据格式、列顺序、类型精度、编码、压缩和文件分片要求。
2. 选择内部 Stage、External Stage 或云存储位置，确认 Storage Integration 与目标路径权限。
3. 使用 SELECT 定义导出数据范围，显式列出字段，不要默认使用 SELECT * 造成下游 Schema 漂移。
4. 选择 CSV/JSON/Parquet 等 FILE_FORMAT，配置压缩、Header、空值、日期时间及必要的 CAST。
5. 默认采用多个输出文件并评估 MAX_FILE_SIZE；只有下游必须读取单文件时才设置 SINGLE=TRUE。
6. 对超大数据集按日期或业务维度配置 PARTITION BY，并预估目录数量和小文件问题。
7. 执行 COPY INTO location，记录 Query ID、导出路径、文件数量、数据行数和执行状态。
8. 下游读取后做行数、主键、金额汇总、时间区间和 Schema 校验；导出成功不等于消费者已经正确解析。
9. 通过批次目录、唯一文件名前缀和清理策略管理重试，避免重跑覆盖或下游重复处理。

示例：

~~~
COPY INTO @EXPORT_STAGE/orders/2026/11/28/
FROM (
  SELECT ORDER_ID, CUSTOMER_ID, ORDER_DATE, AMOUNT
  FROM MART.ORDERS
  WHERE ORDER_DATE >= '2026-11-28'
    AND ORDER_DATE <  '2026-11-29'
)
FILE_FORMAT = (TYPE = PARQUET COMPRESSION = SNAPPY)
MAX_FILE_SIZE = 268435456;
~~~

## 场景分析

数据平台每天向云存储导出订单明细，后续由 Spark 批处理作业消费。原流程设置 SINGLE=TRUE，数据增长后导出时间变长，下游还需要等待单一大文件完整落地。

可以改为多文件并行卸载，按业务日期建立目录并控制每个文件大小。Spark 侧读取该日期目录即可并行处理。若下游必须固定文件名或使用不支持目录分片的系统，再评估单文件成本和替代传输方案。

验收不仅检查 COPY 状态，还要核对输出文件数量、总行数、订单总金额、日期范围、Parquet Schema 和下游读取结果。重跑时通过批次路径隔离不同导出尝试。

## 常见误区

- **把 COPY INTO location 当作 COPY INTO table。** 一个将数据写入 Stage 文件，一个从 Stage 文件加载到表。
- **默认选择 SINGLE=TRUE。** 单文件可能成为性能瓶颈，多个文件通常有利于并行卸载和并行消费。
- **认为导出文件一定只有一个。** 默认并行写出可能产生多个唯一命名文件。
- **忽略类型转换和压缩约定。** 下游可能因复杂类型或时间精度表达差异而错误解析。
- **把 COPY 成功当成端到端交付成功。** 还需检查 Stage 文件和下游系统的数据完整性。

## 完成标准

- [ ] 能说明 COPY INTO location 的数据流向和可用目标位置。
- [ ] 能根据吞吐需求选择多文件或单文件输出。
- [ ] 能使用 FILE_FORMAT、MAX_FILE_SIZE 和 PARTITION BY 控制输出。
- [ ] 能识别复杂类型与时间精度的导出差异。
- [ ] 能设计批次目录、重跑和下游对账策略。

## 自测

1. 大数据集导出后由 Spark 消费，为什么通常不应默认设置 SINGLE=TRUE？
2. 下游要求按日期读取目录结构，可以怎样使用 PARTITION BY？
3. COPY INTO location 返回成功，但 Spark 读取后金额列精度错误，应检查哪些格式和类型转换设置？
4. 多次重跑同一天导出，如何避免旧文件和新文件混在一起？

## 参考资料

- [Overview of data unloading](https://docs.snowflake.com/en/user-guide/data-unload-overview)
- [Data unloading considerations](https://docs.snowflake.com/en/user-guide/data-unload-considerations)
- [COPY INTO location](https://docs.snowflake.com/en/sql-reference/sql/copy-into-location)
