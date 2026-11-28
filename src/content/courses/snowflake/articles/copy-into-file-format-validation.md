# COPY INTO 文件匹配与加载校验

## 本节要解决的问题

使用 COPY INTO 将 Stage 文件写入目标表时，确保文件选择、列解析、类型转换、错误处理和重跑行为都可解释。COPY 成功或失败只是加载执行结果；还需要验证每个文件、每条拒绝记录和目标表业务汇总。

## 核心知识

### FILES、PATTERN 与 File Format 决定加载范围和解析方式

COPY INTO table 可以从 User、Table、Named 或 External Stage 读取文件。FILES 用于指定明确文件名；PATTERN 用正则表达式筛选文件路径；需要长期复用解析规则时使用 Named File Format，否则也可在 COPY 语句中指定 TYPE 和格式选项。

CSV 的 FIELD_DELIMITER、FIELD_OPTIONALLY_ENCLOSED_BY、SKIP_HEADER、NULL_IF 和编码等设置会直接影响字段边界和空值；JSON/Parquet 等格式有不同解析和类型规则。格式配置应与源文件契约一致，不应仅凭文件扩展名推断内容。

加载历史会记录已处理文件；默认情况下，已成功加载的文件通常会被跳过。FORCE=TRUE 会改变这一行为，重跑前必须检查目标表是否已经写入，避免重复记录。

### VALIDATION_MODE 先验证文件，不执行入表

COPY INTO table 设置 VALIDATION_MODE=RETURN_ERRORS 或 RETURN_ALL_ERRORS 时，只检查文件的解析/转换错误，不会加载数据。RETURN_ERRORS 返回指定文件中发现的错误；RETURN_ALL_ERRORS 还可以包含先前以 ON_ERROR=CONTINUE 部分加载的文件错误。

VALIDATION_MODE 有明确限制：不支持加载时转换数据的 COPY 语句；不支持 Iceberg 表；不检查 CHECK constraint 违规。它不是完整的数据质量测试，也不证明目标表业务规则正确。

### VALIDATE 与 Error Table 解决已执行加载后的错误分析

VALIDATE(table, JOB_ID => query_id) 可以检查过去某次标准 COPY 加载的错误；但它不支持加载时转换数据的 COPY，也不返回 CHECK constraint 违规记录。

如果要保留每条被拒绝的数据及其错误信息，可以在目标表启用 Error Logging，随后以 ON_ERROR=CONTINUE 运行 COPY。错误表支持 CSV、JSON、Parquet 等范围内的拒绝记录，并保留源数据与错误信息。注意 ON_ERROR=CONTINUE 可能只在 COPY 输出中报告每个文件的部分错误；要完整分析行级问题，应该查询 Error Table。

## 工程实施步骤

1. **确认输入范围。** 记录 Stage 路径、文件名规则、批次 ID 和预期文件数，选择 FILES 或 PATTERN，避免目录前缀匹配到历史文件。
2. **核对 File Format。** 对照源文件实际编码、分隔符、引号、表头、压缩、空值和嵌套结构，确认列顺序或列映射。
3. **检查目标表定义。** 核对目标字段类型、NOT NULL、CHECK 和业务主键；不要把文件解析规则当作业务数据校验。
4. **先做非变换加载验证。** 对支持的标准加载运行 COPY INTO ... VALIDATION_MODE=RETURN_ERRORS；需要检查之前部分加载过的文件时评估 RETURN_ALL_ERRORS。
5. **按错误策略执行正式加载。** 数据必须全批通过时使用 ABORT_STATEMENT；允许坏行隔离时先启用 Error Logging，再使用 CONTINUE；不要无意中忽略错误文件。
6. **检查返回和历史结果。** 保存 Query ID、文件名、STATUS、ROWS_PARSED、ROWS_LOADED、错误信息和加载时间；必要时查询 LOAD_HISTORY 或 COPY_HISTORY。
7. **分析拒绝记录。** 使用 VALIDATE 查看支持的历史加载错误，或查询 ERROR_TABLE(target_table) 获取被拒绝行和源数据。
8. **独立运行业务对账。** 比较源文件行数、成功加载行数、拒绝行数、目标主键、金额汇总和批次时间范围。
9. **修正文件与重跑。** 对拒绝数据修复文件或清洗逻辑，重新提交前检查既有加载记录；默认跳过历史成功文件，只有在明确防重策略下才使用 FORCE。
10. **保留回放证据。** 记录原始文件 hash、修复版本、Query ID 和重新加载结果，确保失败批次可以重复执行且不会造成重复业务记录。

示例：先验证再正式加载。

~~~sql
COPY INTO RAW.ORDERS
FROM @RAW.ORDER_STAGE
FILE_FORMAT = (FORMAT_NAME = RAW.ORDER_CSV)
PATTERN = '.*orders_2026[0-9]{4}.*[.]csv'
VALIDATION_MODE = 'RETURN_ERRORS';

COPY INTO RAW.ORDERS
FROM @RAW.ORDER_STAGE
FILE_FORMAT = (FORMAT_NAME = RAW.ORDER_CSV)
PATTERN = '.*orders_2026[0-9]{4}.*[.]csv'
ON_ERROR = 'ABORT_STATEMENT';
~~~

正式 COPY 不再设置 VALIDATION_MODE；若业务需要隔离拒绝行，先配置 Error Logging 再选择 ON_ERROR 策略。

## 场景分析

供应商每晚上传订单 CSV。某日文件表头多了一个字段，且部分金额列出现空字符串。COPY 设置 ON_ERROR=CONTINUE 后返回成功，但订单总额比源系统少 3%。

先检查文件匹配是否包含当天全部文件，再看 ROWS_PARSED 与 ROWS_LOADED 差异和 COPY History。使用 VALIDATE 或 ERROR_TABLE 查看拒绝行；若只是空字符串含义与 File Format 不一致，修正 NULL_IF 或字段规则；若文件 Schema 已改变，则更新列映射并做独立对账。不要因为 COPY 命令返回成功就将批次标记为完整。

重跑时先按 Query ID 和文件历史确认是否已加载部分记录，使用 batch_id 或业务唯一键执行幂等合并，避免简单 FORCE 重复插入已经成功的文件。

## 常见误区

- **认为 VALIDATION_MODE 会把文件加载到表中。** 它只验证，不写入目标表。
- **认为 VALIDATION_MODE 会检查 CHECK 约束。** 它不返回 CHECK constraint 违规记录。
- **认为 VALIDATION_MODE 支持所有 COPY 转换语句。** 加载时转换数据的 COPY 不支持该模式；Iceberg 表也不支持。
- **把 VALIDATE 当作所有加载错误的完整报告。** 它有标准加载范围限制；需要保留拒绝行时用 Error Table。
- **把 ON_ERROR=CONTINUE 当作数据质量通过。** 它允许继续加载，仍需统计拒绝行并阻断不完整批次。
- **失败后不检查加载历史就使用 FORCE=TRUE。** 这可能重复写入已加载文件，必须先做批次和业务键对账。

## 完成标准

- [ ] 能说明 FILES、PATTERN、File Format 与 COPY 选项的作用。
- [ ] 能区分 VALIDATION_MODE、VALIDATE 和 Error Table。
- [ ] 能说明 VALIDATION_MODE 对转换加载、Iceberg 和 CHECK 约束的限制。
- [ ] 能选择 ABORT_STATEMENT 或 CONTINUE 并保留拒绝记录。
- [ ] 能设计文件筛选、重跑、防重和批次对账流程。

## 自测

1. COPY 使用 VALIDATION_MODE=RETURN_ERRORS 后，目标表中的记录会发生变化吗？为什么？
2. COPY 语句执行了列重排或转换，为什么不能简单地用 VALIDATION_MODE 做预检？
3. ON_ERROR=CONTINUE 后 ROWS_PARSED 大于 ROWS_LOADED，应该读取哪些结果了解拒绝内容？
4. VALIDATE 与 ERROR_TABLE 分别适合分析什么场景？
5. 某文件之前部分加载成功，重跑时为什么不能直接设置 FORCE=TRUE？

## 参考资料

- [COPY INTO table](https://docs.snowflake.com/en/sql-reference/sql/copy-into-table)
- [Error logging for COPY INTO and Snowpipe](https://docs.snowflake.com/en/user-guide/data-load-error-tables)
- [VALIDATE table function](https://docs.snowflake.com/en/sql-reference/functions/validate)
- [Data loading overview](https://docs.snowflake.com/en/user-guide/data-load-overview)
