# Stage、文件格式与 COPY 数据加载

## 本节要解决的问题

数据供应商每天交付一批 CSV，字段包括订单号、交易日期、金额和币种。文件偶尔出现列顺序变化、引号不闭合和金额格式错误。团队把文件上传到 Stage 后执行 COPY INTO，部分记录进入目标表，部分记录失败；一周后重跑同一文件，又产生了重复数据。

Stage 解决的是文件在 Snowflake 中的存放和引用位置；File Format 定义如何解析文件；COPY INTO 负责把解析后的行写入目标表。它们不是一回事。文件上传成功不代表文件格式正确，COPY 成功也不代表业务键唯一或批次完整。

## 核心知识

### 先按文件所在位置选择 Internal Stage 或 External Stage

Snowflake 有三类 Internal Stage：
- **User Stage**：每个用户自带的 Stage，适合个人临时上传。
- **Table Stage**：跟随某张表存在，适合该表相关的文件操作。
- **Named Internal Stage**：可以被多个加载任务复用，适合团队管理和权限治理。

External Stage 指向 S3、GCS 或 Azure 等外部对象存储。通常通过 Storage Integration 配置云身份和允许访问的路径，不应把云访问密钥写进 Stage DDL 或 Notebook。

| 场景 | 选择 | 文件进入方式 |
|---|---|---|
| 分析师临时上传少量文件 | User Stage | 客户端 PUT |
| 仅供一张表加载的临时文件 | Table Stage | 客户端 PUT |
| 团队共享的人工批次 | Named Internal Stage | 客户端 PUT |
| 数据湖或企业对象存储持续交付 | External Stage | 云存储原生上传/复制 |

从本地文件系统加载时，过程分成两步：PUT 把文件上传到 Internal Stage；COPY INTO 再由 Warehouse 将文件内容写进表。External Stage 的文件由云存储写入 Bucket/Container，Snowflake 不会通过 PUT 把本地文件直接发到这个外部位置。

### File Format 决定文件如何解析

对 CSV，至少要明确：
- FIELD_DELIMITER：字段分隔符；
- FIELD_OPTIONALLY_ENCLOSED_BY：字段是否允许引号包围；
- SKIP_HEADER：跳过多少表头行；
- NULL_IF：哪些文本值映射成 SQL NULL；
- EMPTY_FIELD_AS_NULL：空字段是否作为 NULL；
- ENCODING、DATE_FORMAT、TIMESTAMP_FORMAT：字符集和时间解析格式。

例如供应商交付的 CSV 使用逗号分隔、双引号包围字段，首行是标题：

~~~sql
CREATE OR REPLACE FILE FORMAT vendor_orders_csv
  TYPE = CSV
  FIELD_DELIMITER = ','
  FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  SKIP_HEADER = 1
  EMPTY_FIELD_AS_NULL = TRUE
  NULL_IF = ('NULL', 'N/A')
  ENCODING = 'UTF8'
  DATE_FORMAT = 'YYYY-MM-DD';
~~~

File Format 应集中管理并记录版本。不要每个 COPY 都临时复制一套略有不同的解析选项；如果供应商变更了字段分隔符或日期格式，应发布新的 File Format 版本并回归验证。

JSON、Parquet 和 Avro 等格式使用不同的解析语义。JSON 常见问题是单行对象与数组包装、字段路径和类型转换；Parquet 则要检查列名、类型和 Schema 演进。不能把 CSV 的 SKIP_HEADER、分隔符选项照搬到所有格式。

### 用 LIST 和文件元数据确认 Stage 中到底有什么

先查看文件路径、大小和修改时间：

~~~sql
LIST @orders_stage/pending/;
~~~

如果需要检查文件内容，可以直接查询 Stage 文件：

~~~sql
SELECT
  METADATA$FILENAME,
  METADATA$FILE_ROW_NUMBER,
  $1:order_id::VARCHAR AS order_id,
  $1:order_date::DATE AS order_date,
  $1:amount::NUMBER(18,2) AS amount
FROM @orders_stage/json/
  (FILE_FORMAT => 'ANALYTICS.INGEST.vendor_orders_json')
LIMIT 20;
~~~

文件元数据包括 METADATA$FILENAME、METADATA$FILE_ROW_NUMBER、METADATA$FILE_CONTENT_KEY、METADATA$FILE_LAST_MODIFIED 和 METADATA$START_SCAN_TIME。加载 Raw 表时保留文件名、文件行号和摄取批次，可以在出现重复或异常时定位到原始文件记录。

不要把文件修改时间当成业务事件时间。供应商重发旧业务日期文件时，METADATA$FILE_LAST_MODIFIED 会变化，但订单的业务日期和版本不一定发生变化。

### COPY INTO 写入目标表，必须明确列映射和错误策略

如果文件字段与目标表列顺序一致，可以直接 COPY；如果需要类型转换、列名匹配或追加文件元数据，应使用 COPY 的列清单或 SELECT 变换。

例如将 JSON 订单加载到 Raw 表并保留文件来源：

~~~sql
COPY INTO raw_orders (
  order_id,
  order_date,
  amount,
  source_file,
  source_row_number,
  load_batch
)
FROM (
  SELECT
    $1:order_id::VARCHAR,
    TRY_TO_DATE($1:order_date::VARCHAR),
    TRY_TO_DECIMAL($1:amount::VARCHAR, 18, 2),
    METADATA$FILENAME,
    METADATA$FILE_ROW_NUMBER,
    'vendor-2026-11-28'
  FROM @orders_stage/json/
    (FILE_FORMAT => 'ANALYTICS.INGEST.vendor_orders_json')
)
ON_ERROR = 'CONTINUE';
~~~

这里故意使用 TRY_TO_DATE 和 TRY_TO_DECIMAL，使无法转换的值变成 NULL；但这不等于异常数据已处理。下游质量检查仍然必须识别 NULL 日期、NULL 金额和非法订单状态，并将错误记录隔离。

ON_ERROR 控制加载遇到错误时的处理方式。常见策略：
- ABORT_STATEMENT：遇到错误就中止整个 COPY。
- CONTINUE：跳过错误记录，继续加载其他记录；要保留错误详情时需配合 Error Logging。
- SKIP_FILE：跳过出现错误的文件，避免把不完整文件写入目标表。

选择哪一种取决于业务完整性要求。财务结算文件通常不能静默跳过错误行；探索性数据可以先 CONTINUE 并隔离错误。

### VALIDATION_MODE、VALIDATE 和 Error Table 解决不同问题

在加载前检查文件解析错误，可以用 COPY 的 VALIDATION_MODE：

~~~sql
COPY INTO raw_orders
FROM @orders_stage/json/
FILE_FORMAT = (FORMAT_NAME = 'ANALYTICS.INGEST.vendor_orders_json')
VALIDATION_MODE = RETURN_ALL_ERRORS;
~~~

VALIDATION_MODE 在加载前检查文件错误，不执行正式写入；它有适用限制，例如不支持某些带转换的加载路径，也不会报告 CHECK 约束违规。加载后要检查之前 COPY 任务的错误，可以使用 VALIDATE 函数。需要长期保留被拒绝的 CSV/JSON/Parquet 行及其源数据时，可以启用 Error Logging，并配合 ON_ERROR = CONTINUE 把拒绝记录写入错误表。

因此：
- VALIDATION_MODE：在写入前预检查文件。
- COPY 输出 / COPY_HISTORY：查看文件级加载结果和首个错误。
- VALIDATE：检查之前某次加载的错误。
- Error Table：保存被拒绝的行和错误详情，便于调查和重载。

### COPY 的文件加载元数据用于避免短期重复，但不等于业务幂等

Snowflake 会记录表加载过的文件名、文件大小、ETag/内容标识、行数和加载时间，COPY 可以利用这些元数据避免重复加载相同文件。这个机制是文件级去重，不会检查不同文件里是否含有相同 order_id。

历史加载元数据有保留窗口。若文件很旧、元数据已过期、Stage 路径变化、文件内容被修改，或使用 FORCE = TRUE，COPY 的默认跳过行为可能不同。重放历史文件前应先查 COPY_HISTORY / LOAD_HISTORY，确认表是否已加载过；必要时使用源批次表和业务键做下游幂等。

如果供应商将相同订单拆成两个文件，文件级去重不会阻止两个文件都加载。应在 Raw 层保留原始记录，在标准化层按 event_id 或订单版本规则去重。不能仅凭 COPY 显示 Loaded 就宣布数据无重复。

## 工程实施步骤

1. 先确定文件源、上传主体、文件生命周期和目标表 owner，再决定使用 User、Table、Named Internal 或 External Stage。
2. 为 External Stage 配置 Storage Integration 和最小范围 Allowed Locations；云 IAM 权限必须与 Stage 路径一致。
3. 为每种供应商格式建立独立 File Format，写清分隔符、引号、编码、日期、NULL 和压缩选项。
4. 使用 LIST 核对文件清单、路径和修改时间；对新格式先查询 Stage 文件样本，确认字段结构。
5. 通过 VALIDATION_MODE 预检查文件，再选择合适的 ON_ERROR 策略和 Error Logging。
6. 在 Raw 表保留 source_file、source_row_number、file_content_key、batch_id、loaded_at 和原始字段。
7. 执行 COPY 后检查 COPY 输出、LOAD_HISTORY/COPY_HISTORY、拒绝行和目标行数。
8. 对业务键、批次行数、金额控制总额和日期范围做质量校验；文件级去重不能代替业务键唯一性。
9. 重载失败文件前先核对之前的加载状态，决定使用 VALIDATE、修正文件、定向 FILES 重载还是业务键幂等 MERGE。
10. 保留 Stage 路径、File Format 版本、COPY SQL、Query ID、文件标识和批次对账结果，供审计与重放。

## 场景分析

供应商上传了 3 个文件：
- orders_2026-11-27_a.csv：10,000 行，金额和日期均有效；
- orders_2026-11-27_b.csv：8,000 行，有 3 行日期格式错误；
- orders_2026-11-27_c.csv：重新发送的文件，文件名不同，但包含 a.csv 中的 100 条订单。

若采用 ABORT_STATEMENT，b.csv 可能因错误而中止；若采用 CONTINUE，剩余有效行可以加载，但应将 3 条错误记录留存并隔离。c.csv 文件名不同，因此文件元数据不会识别它与 a.csv 的业务内容重复；必须在标准化层按订单 ID/事件版本去重。

验收不能只统计三份文件均已处理。还要确认每份文件的解析行数、拒绝行数、原始记录数、去重后的订单数和金额总额，并把错误行关联到文件名和行号。若文件重发后将金额修正，应根据业务版本决定覆盖当前状态还是保留历史事件，不能简单把修正文件再次 append 到事实表。

## 常见误区

- **把 Stage 当成业务表。** Stage 存放文件，COPY 才将解析结果写入表。
- **把 Internal Stage 和 External Stage 的上传方式混为一谈。** 本地 PUT 面向 Internal Stage；External Stage 由云存储路径和 Integration 管理。
- **所有文件共用一个默认 File Format。** CSV、JSON、Parquet 的解析规则不同，供应商版本也可能变化。
- **认为 VALIDATION_MODE 会完成正式加载。** 它只做预检查，不替代 COPY 正式写入和后续质量核验。
- **把 ON_ERROR = CONTINUE 当作自动修复。** 错误行可能被跳过；应保留 Error Table 并安排修正或重放。
- **认为 COPY 文件元数据能去除重复订单。** 它按文件跟踪加载，不检查不同文件中的业务键重复。
- **重跑文件前不查加载历史。** FORCE、文件修改、旧元数据过期和路径变化都可能改变跳过行为。
- **只核对 COPY 成功状态，不核对金额和业务行数。** 文件加载成功不等于批次业务正确。

## 完成标准

- [ ] 能区分 User Stage、Table Stage、Named Internal Stage 和 External Stage。
- [ ] 能为 CSV/JSON 等文件格式配置合理 File Format。
- [ ] 能使用 LIST 和 METADATA$ 列检查文件来源与行号。
- [ ] 能通过 COPY INTO 完成文件解析、类型转换和来源字段保留。
- [ ] 能区分 VALIDATION_MODE、VALIDATE、COPY_HISTORY 和 Error Table。
- [ ] 能解释文件级加载元数据与业务键幂等的差别。
- [ ] 能安全恢复失败文件并对账输入、拒绝、去重和目标记录。

## 自测

1. 供应商本地 CSV 文件要上传到 Snowflake 并加载，PUT 和 COPY INTO 分别负责什么？如果文件在 S3，流程有什么变化？
2. CSV 的首行是表头，金额列可能为空，日期采用 YYYY-MM-DD。File Format 需要明确哪些选项？
3. COPY INTO 设置 ON_ERROR = CONTINUE，返回成功，但有 3 行转换错误。如何保留和调查这 3 行？
4. VALIDATION_MODE 检查通过后，是否说明目标表已经写入数据？还需要哪个操作？
5. 两个文件名不同，却包含相同 order_id。为什么 COPY 的文件加载元数据不能阻止重复订单？
6. 一个 70 天前加载过的文件需要重放。为什么不能假设 Snowflake 一定还保留着它的文件加载元数据？

## 参考资料

- [Bulk loading from a local file system](https://docs.snowflake.com/en/user-guide/data-load-local-file-system)
- [Copy data from an internal stage](https://docs.snowflake.com/en/user-guide/data-load-local-file-system-copy)
- [Copying data from an S3 stage](https://docs.snowflake.com/en/user-guide/data-load-s3-copy)
- [Data loading considerations](https://docs.snowflake.com/en/user-guide/data-load-considerations-load)
- [Error logging for COPY INTO and Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-error-tables)
- [Query metadata for staged files](https://docs.snowflake.com/en/user-guide/querying-metadata)
