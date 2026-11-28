# VARIANT、对象路径与半结构化数据处理

## 本节要解决的问题

使用 VARIANT、OBJECT 和 ARRAY 保存 JSON 等层级输入，理解字段路径、类型转换、FLATTEN 展开与 Schema Drift。重点是把灵活的源结构转成可靠的分析字段，同时保留原始值和解析异常证据。

## 核心知识

### VARIANT 保存结构化层级值，但不替代类型治理

JSON、Avro、ORC 和 Parquet 可加载到 VARIANT。通过路径表达式可访问对象字段与数组元素，例如 SRC:customer.id。路径访问返回的通常仍是 VARIANT，需要使用 ::NUMBER、::STRING 或 TRY_TO_NUMBER 等进行显式类型转换。

VARIANT 保留层级结构，适合源端字段持续变化或需要保留未建模字段的场景。高频分析字段应根据查询模式投影为明确类型的列，避免每次查询都进行重复转换，也更容易建立数据质量规则。

### 缺失字段、JSON null 与 SQL NULL 必须区分

路径不存在、JSON 中显式 null、SQL NULL 和类型转换失败不是同一状态。可使用 IS_NULL_VALUE、IS_NULL、TYPEOF 和 TRY_TO_* 等函数辅助判断。若直接把所有转换失败映射为 NULL，可能把上游格式变化和真实空值混在一起。

生产转换应保留原始 VARIANT，同时把异常字段、原始路径、来源文件和错误原因记录到质量结果中。不要在没有证据的情况下把缺失值填成默认业务值。

### FLATTEN 将数组或对象展开成多行

FLATTEN 是表函数，可以把 VARIANT、OBJECT 或 ARRAY 转为关系行集。它返回 SEQ、KEY、PATH、INDEX、VALUE 和 THIS 等列，可用于追踪元素路径和数组位置。通常与 LATERAL 结合，让每条源记录展开其内部数组。

FLATTEN 会改变行粒度。一条订单含三条明细，展开后会产生三行；如果把订单头金额直接求和，就会被重复计算。嵌套数组连续展开还可能形成行数乘积，应先明确每一步的粒度和连接键。

## 工程实施步骤

1. 定义输入契约，记录源系统、文件格式、Schema 版本、必需字段和允许扩展字段。
2. 在 Raw 表保留原始 VARIANT、业务键、文件/事件 ID、到达时间和批次标识。
3. 使用 TYPEOF、路径表达式和 TRY_TO_* 验证关键字段类型，分别统计字段缺失、JSON null、SQL NULL 和转换失败。
4. 将稳定、高频使用的字段投影到强类型列；对暂时不稳定的字段保留 VARIANT，并记录 Schema 版本。
5. 需要展开数组时使用 FLATTEN，保留 KEY、PATH、INDEX 和业务主键，确认展开后的一行代表什么。
6. 多层数组展开前后分别记录行数，检查是否意外产生多对多扩张；对订单头级指标先聚合再与明细连接。
7. 为新字段、字段改类型、数组变对象和未知枚举增加兼容测试，避免 Schema Drift 静默丢数。
8. 将无法转换的记录写入隔离表，保留原始值和错误字段；修复解析逻辑后从原始输入回放。
9. 用 Query Profile 检查大型 VARIANT 路径查询与展开操作的扫描、行数和执行成本。

示例：读取订单 JSON 中的明细数组，并保留数组索引。

~~~sql
SELECT
  SRC:order_id::STRING AS ORDER_ID,
  ITEM.INDEX AS LINE_INDEX,
  ITEM.VALUE:sku::STRING AS SKU,
  TRY_TO_NUMBER(ITEM.VALUE:quantity::STRING) AS QUANTITY
FROM RAW.ORDER_EVENTS,
LATERAL FLATTEN(INPUT => SRC:items) ITEM;
~~~

## 场景分析

电商订单 JSON 的 items 字段有时是空数组，有时缺失，有时包含多个对象；quantity 偶尔被上游发送成字符串。简单展开后把缺失值全部转为 0，会掩盖上游 Schema Drift。

应先区分路径缺失、数组为空和类型转换失败，保留原始记录并将无法转换的数量放入异常记录。展开后检查每个 ORDER_ID 的明细行数，再单独汇总订单头级金额。验收注入缺失字段、JSON null、字符串数字、非法字符串和多条 items，检查结果行数、错误分类和金额汇总。

## 常见误区

- 认为 VARIANT 会自动保证所有字段类型稳定。字段解析和业务类型仍需显式验证。
- 把缺失字段、JSON null、SQL NULL 和转换失败全部合并。这样会掩盖源数据变化。
- 把 FLATTEN 当成不改变粒度的字段访问。它会把一个源行展开成多行。
- 多个数组直接连续展开而不检查基数。嵌套展开可能造成行数乘积。
- 直接在每个报表中反复解析所有字段。稳定字段应按查询需要投影为强类型列。
- 类型转换失败就静默填默认值。异常必须保留原始证据并进入质量处理。

## 完成标准

- [ ] 能解释 VARIANT、OBJECT 和 ARRAY 的适用场景。
- [ ] 能访问路径并区分多种 NULL/缺失状态。
- [ ] 能使用 TRY_TO_* 做安全类型转换。
- [ ] 能说明 FLATTEN 对行粒度和 Join 基数的影响。
- [ ] 能设计 Schema Drift 检测和异常回放流程。

## 自测

1. SRC:amount::NUMBER 返回 NULL，如何区分字段缺失、JSON null 和非法数字字符串？
2. 一条订单包含四条 items，FLATTEN 后订单头金额为什么不能直接 SUM？
3. 什么时候应该把 VARIANT 中的字段投影为强类型列？
4. 多层嵌套数组展开后行数突然增长 100 倍，应该检查什么？

## 参考资料

- [Querying semi-structured data](https://docs.snowflake.com/en/user-guide/querying-semistructured)
- [FLATTEN table function](https://docs.snowflake.com/en/sql-reference/functions/flatten)
- [Accessing elements of an array](https://docs.snowflake.com/en/user-guide/querying-semistructured)
