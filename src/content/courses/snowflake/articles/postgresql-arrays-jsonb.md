# PostgreSQL Arrays、JSON 与 JSONB

## 本节要解决的问题

根据数据结构、更新方式和查询模式选择关系列、数组、JSON 或 JSONB。半结构化类型适合承载确实具有集合或文档语义的数据，但不应成为逃避数据建模的默认方案；需要频繁连接、约束和独立生命周期的实体通常应拆成关系表。

## 核心知识

### JSON 与 JSONB 的存储和查询特性不同

json 保存输入文本的原始表示，包括空白、对象键顺序和重复键；jsonb 将内容解析成二进制结构，查询和索引支持更丰富，通常是需要频繁检索和操作 JSON 文档时的默认选择。jsonb 不保留空白和键顺序，重复键只保留最后一个值。

如果业务需要逐字保留原始 JSON 内容，应保留原始文本或使用 json；若需要按键查找、包含匹配和 GIN 索引，通常选 jsonb。两者都不代表自动拥有文档 Schema 或字段约束，关键字段仍应在写入层校验，或投影为正式列。

### JSON 操作符区分 JSON 值与文本值

常见操作包括：

- ->：按键或数组下标返回 JSON/JSONB。
- ->>：返回文本值。
- #> 与 #>>：按路径提取 JSON 或文本。
- @>：jsonb 包含关系。
- ?：检查顶层键或数组元素是否存在。
- jsonb_set：在指定路径更新 JSONB 内容。

路径提取遇到结构不匹配或字段不存在时通常返回 NULL，而不是自动报错。若要将 JSON 值转换为日期、数值或 UUID，应显式 CAST，并处理转换失败。JSON null、键缺失和 SQL NULL 在业务上可能代表不同状态。

### GIN 索引支持特定 JSONB 查询模式

jsonb 可以使用 GIN 索引支持包含和键存在等查询。默认 jsonb_ops 支持更广泛的操作符；jsonb_path_ops 索引体积通常更小，适合特定包含路径查询，但不支持所有键存在操作。索引应按实际查询模式选择，并通过 EXPLAIN (ANALYZE, BUFFERS) 验证。

数组适合一行中具有自然集合语义、通常整体读取或检查包含关系的值，例如一条产品记录的固定标签集合。若元素需要单独维护属性、拥有外键、参加频繁 Join 或有独立权限，应该建子表，而不是长期存入数组。

### 关系模型与半结构化模型可以组合使用

稳定且高频使用的字段适合正式列；变化频繁、低频读取的扩展属性可以留在 JSONB。常见模式是把业务主键、状态、时间和金额列化，将可选元数据保留为 JSONB，同时对实际使用的 JSONB 路径建立表达式索引或 GIN 索引。

不要因为 JSONB 灵活就把所有字段放进同一文档。字段变更、类型转换、索引、约束和统计信息仍需要维护。

## 工程实施步骤

1. 盘点字段是否具有固定结构、独立身份、关系约束和独立更新周期，先判断是否应该规范化为关系表。
2. 对需要保留输入原貌的 JSON 选择 json；对需要查询和索引的 JSON 文档优先评估 jsonb。
3. 将稳定、高频使用和需要约束的字段投影为普通列；将可选扩展属性放入 JSONB。
4. 明确字段缺失、JSON null 和 SQL NULL 的业务含义；使用 jsonb_typeof、?、->> 和显式转换区分。
5. 对数值、日期、枚举等 JSON 字段转换时使用安全的应用校验或 PL/pgSQL 错误处理，不要假定所有输入格式合法。
6. 按查询模式选择 GIN 操作类：需要键存在等操作时核对 jsonb_ops；主要使用 @> 包含查询时评估 jsonb_path_ops。
7. 对高频路径查询评估表达式索引，例如对 JSONB 中 tenant_id 或状态字段建立索引。
8. 若数组元素要参与 Join、权限控制或引用完整性，将其拆成子表并建立主外键。
9. 用真实查询执行 EXPLAIN ANALYZE，检查索引是否使用、返回行数和 Buffer 命中情况。
10. 对文档 Schema 演进建立版本和校验，不允许未知结构静默改变下游业务计算。

示例：保留扩展属性并建立 GIN 索引。

~~~sql
CREATE TABLE app.documents (
  document_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  document_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_payload_gin
  ON app.documents USING gin (payload);

SELECT document_id
FROM app.documents
WHERE payload @> '{"status":"approved"}'::jsonb;
~~~

如果查询只访问 payload 中的一个稳定字段并带有高选择性过滤，表达式 B-tree 索引可能比整份 JSONB 的 GIN 更合适，应通过实际计划验证。

## 场景分析

订单系统从多个供应商接收 JSON 扩展属性。常规字段包括 order_id、customer_id、amount 和 created_at；供应商可额外提供不同的物流信息。团队准备把所有订单字段都存进 JSONB，以适应源结构变化。

订单主键、客户外键、金额和事件时间应保留为类型明确的列，以便约束、Join 和统计；供应商特有且不常用的扩展信息可以放在 JSONB。若承运商代码成为高频筛选字段，再投影成正式列或建立表达式索引。

验收包含字段缺失、JSON null、错误金额格式、扩展字段新增和 JSON 键顺序变化。确认关键业务字段不会因 JSON 路径提取失败而静默变成 NULL，并核对索引是否支撑实际过滤。

## 常见误区

- **把 json 和 jsonb 当成完全相同。** json 保留文本表示，jsonb 解析并优化查询与索引。
- **所有结构化数据都放进 JSONB。** 会增加类型转换、约束和 Join 复杂度。
- **认为 JSON 路径提取字段不存在会报错。** 多数提取操作会返回 NULL，必须区分缺失和显式 null。
- **为 JSONB 一律创建 GIN。** jsonb_ops 与 jsonb_path_ops 支持的查询不同，索引也有写入和存储成本。
- **用数组代替有独立关系的子表。** 需要外键、独立属性和频繁关联的元素更适合规范化表。
- **不检查 JSON 数值和日期转换。** 文本内容不保证能安全转换成目标类型。

## 完成标准

- [ ] 能比较 json 与 jsonb 的存储和查询差异。
- [ ] 能使用 ->、->>、#>、@> 和 ? 操作符。
- [ ] 能区分 JSON null、缺失键和 SQL NULL。
- [ ] 能根据查询模式选择 GIN 或表达式索引。
- [ ] 能判断何时使用数组/JSONB，何时拆成关系表。

## 自测

1. 需要逐字保留供应商上传 JSON 的空白和重复键，json 与 jsonb 应如何选择？
2. payload->>'amount' 返回文本，转换 numeric 前还要考虑什么？
3. jsonb_path_ops 与 jsonb_ops 的适用操作有什么差异？
4. 一个 JSON 数组里的每个元素需要外键引用客户表，为什么应考虑拆成子表？
5. JSON 路径提取返回 NULL，如何判断是键不存在、JSON null 还是 SQL NULL？

## 参考资料

- [JSON Types](https://www.postgresql.org/docs/current/datatype-json.html)
- [JSON Functions and Operators](https://www.postgresql.org/docs/current/functions-json.html)
- [Array Types](https://www.postgresql.org/docs/current/arrays.html)
- [Indexes](https://www.postgresql.org/docs/current/indexes.html)
- [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
