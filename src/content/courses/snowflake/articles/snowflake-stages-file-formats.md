# Stage 与 File Format 基础

## 本节要解决的问题

将文件存放位置、格式解析规则和目标表加载动作分开设计。Stage 解决文件在哪里以及谁可以访问；File Format 描述 CSV、JSON、Parquet 等内容如何解析；COPY INTO 才负责将文件数据写入表。

## 核心知识

### Stage 是数据文件的存放入口

Snowflake 内部 Stage 包含 User、Table 和 Named 三类。用户 Stage 通过 \`@~\` 引用，表 Stage 通过 \`@%table_name\` 引用，Named Stage 通过 \`@stage_name\` 引用。Named Stage 是数据库对象，可授予角色使用权限并用于多个用户或多个目标表。

External Stage 指向用户管理的云存储位置。它需要配置存储集成或凭证访问边界，不能与 Snowflake 托管的 Internal Stage 混为一谈。

### File Format 定义文件解析规则

File Format 可以定义文件类型和解析选项，例如 CSV 的分隔符、包围字符、跳过表头、空值处理，JSON/Parquet 的结构化解析选项等。Named File Format 便于在多条加载流程中复用，临时加载也可以在 COPY INTO 中直接指定格式选项。

File Format 不会检查业务主键是否重复，也不能替代目标表约束、数据质量规则或业务字段校验。

### PUT、LIST、COPY INTO 分属不同阶段

本地文件上传到 Internal Stage 使用 PUT；检查 Stage 文件使用 LIST；COPY INTO <table> 将文件加载到目标表。对外部云存储文件，通常由外部 Stage 和相应云权限配置访问。加载时需要可用的 Warehouse 执行实际插入计算。

COPY 的 ON_ERROR 决定遇到文件错误时如何继续或终止；VALIDATION_MODE 可在不加载数据的情况下返回文件解析或转换错误。已加载文件的去重行为与 COPY 的文件加载历史有关；需要重复加载时不能不加判断地使用 FORCE=TRUE。

## 工程实施步骤

1. 明确数据提供方、文件命名规则、存储位置、文件大小、到达频率和保留周期，判断使用 Internal Stage 还是 External Stage。
2. 对多用户、多表的常规接入创建 Named Stage，并通过角色授权控制 USAGE；只供单用户临时上传的文件可考虑 User Stage。
3. 创建 File Format，明确文件类型、编码、压缩、分隔符、引号、表头行和空值语义；JSON/Parquet 还要核对嵌套字段与列映射。
4. 加载前用 LIST 检查目标 Stage 路径和文件清单，避免 Pattern、目录前缀或命名错误导致漏文件。
5. 对新格式先使用 COPY INTO 的 VALIDATION_MODE=RETURN_ERRORS 验证解析和类型转换，再正式加载。注意 VALIDATION_MODE 不支持所有转换式 COPY 场景。
6. 正式加载时显式设置 FILE_FORMAT、ON_ERROR 和必要的列映射，并记录 Query ID、文件名、ROWS_PARSED、ROWS_LOADED、拒绝错误。
7. 通过 COPY_HISTORY/LOAD_HISTORY 与目标表行数、业务汇总核对结果；失败重跑前先确认前一轮是否已部分加载以及文件是否已被登记为已加载。
8. 对敏感文件设置 Stage 权限、External Stage 身份、生命周期和清理策略，避免把长期原始文件暴露给不需要的角色。

示例：

~~~sql
CREATE FILE FORMAT RAW.CSV_ORDERS
  TYPE = CSV
  SKIP_HEADER = 1
  FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  EMPTY_FIELD_AS_NULL = TRUE;

LIST @RAW.ORDERS_STAGE;

COPY INTO RAW.ORDERS
FROM @RAW.ORDERS_STAGE
FILE_FORMAT = (FORMAT_NAME = RAW.CSV_ORDERS)
ON_ERROR = 'ABORT_STATEMENT';
~~~

## 场景分析

供应商每天上传一批订单 CSV，文件包含 UTF-8 编码、表头、双引号字段和偶发的空列。最初流程只配置 Stage，直接 COPY 后出现列错位和部分记录被拒绝。

应该先核对文件真实格式与 File Format 选项，再 LIST 确认文件是否完整到达；使用 VALIDATION_MODE 检查解析错误，并检查目标列类型和列映射。正式加载之后，对照文件行数、ROWS_PARSED、ROWS_LOADED、拒绝记录及业务汇总。若需要重跑，先查看 COPY_HISTORY 以及目标表是否已有该批次数据，避免重复导入。

若同一文件要被多个团队处理，应使用有明确 Owner 和权限的 Named Stage，而不是依赖某个工程师的个人 User Stage。

## 常见误区

- **认为 Stage 会自动校验文件内容。** Stage 只负责文件位置和访问，解析由 File Format 与 COPY 负责。
- **用 File Format 解决业务数据质量。** 文件解析通过不代表业务键、金额、日期范围或跨行约束正确。
- **只看 COPY 语句返回成功。** 还要检查文件清单、解析行数、拒绝记录、加载历史和目标表结果。
- **失败后不检查历史就使用 FORCE=TRUE。** 这可能导致重复写入；先判断原文件是否已经部分或全部加载。
- **所有场景都用个人 User Stage。** 多用户和长期生产流程应选择可管理授权的 Named Stage 或 External Stage。

## 完成标准

- [ ] 能区分 User、Table、Named 和 External Stage 的用途。
- [ ] 能说明 File Format 对文件解析的作用及其边界。
- [ ] 能讲清 PUT/LIST/COPY INTO 的加载流程。
- [ ] 能使用 VALIDATION_MODE 检查文件错误并说明适用限制。
- [ ] 能设计失败重跑、重复文件和目标数据对账流程。

## 自测

1. 两个不同角色需要把同一批文件加载到多个表，为什么 Named Stage 通常比 User Stage 更合适？
2. COPY 返回成功但目标表行数低于源文件记录数，应查哪些加载统计与错误记录？
3. 文件解析通过但订单金额出现负数，应该在哪个层次实现业务校验？

## 参考资料

- [Choosing an internal stage for local files](https://docs.snowflake.com/en/user-guide/data-load-local-file-system-create-stage)
- [Staging data files from a local file system](https://docs.snowflake.com/en/user-guide/data-load-local-file-system-stage)
- [COPY INTO table](https://docs.snowflake.com/en/sql-reference/sql/copy-into-table)
