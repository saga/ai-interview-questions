# 文档解析与结构化抽取

## 本节要解决的问题

从合同、发票、申请表和扫描件中提取结构化字段，同时保留原文位置、页面证据和异常状态。目标不是得到一段看似正确的 JSON，而是让每个字段能够追溯到源文件、经过确定性校验，并在低置信或无法解析时进入人工处理流程。

## 核心知识

### AI_PARSE_DOCUMENT 负责提取文档文本、布局和视觉内容

AI_PARSE_DOCUMENT 接收 Snowflake Stage 中的 FILE 对象，支持 OCR、LAYOUT 和 AGENTIC 模式。OCR 提取文本；LAYOUT 保留表格、标题等结构；AGENTIC 可进一步解释图表、表格和视觉元素并形成结构化理解。可以设置 page_split 按页处理，也可用 FL_FILTER_PAGES 限定需要分析的页面。

当前文档支持 PDF、PPTX、DOCX、JPEG/PNG/TIFF、HTML 和 TXT 等格式。文档最大 100 MB、最多 2,000 页，并有页面像素尺寸等限制。支持语言和区域可用性需要按当前官方文档及账户 Region 检查。

### AI_EXTRACT 面向指定字段和表格的结构化抽取

AI_EXTRACT 通过自然语言说明或 JSON Schema 要求提取实体、列表和表格。对 PDF 等分页文件，可提供 page number 和 bounding box 等 citation，以便回到原文确认字段位置；文本输入也可提供字符偏移量。

例如合同处理中可以请求合同号、签署日期、买卖双方和金额；发票可要求提取行项目、税额和币种。抽取结果仍是模型生成的候选数据，不会自动成为经过业务认证的事实。

### 证据、校验与成本必须一同设计

来源证据应至少记录 Stage 路径、文件 hash、页号、字段名称、提取结果和 citation 定位。字段校验应区分语法类型、业务规则和跨字段不变量。例如日期格式正确不表示合同日期合理；金额字段可解析不表示总额等于明细之和。

AI_PARSE_DOCUMENT 的费用按处理页数计量；AI_EXTRACT 也有相应的 Cortex AI 消耗。Snowflake 建议 AI_PARSE_DOCUMENT 使用不大于 Medium 的 Warehouse，因为更大仓库不会提升该函数性能。需要在执行前评估文件页数、调用次数和失败重试费用。

## 工程实施步骤

1. 建立文档分类和接入策略，明确文件来源、允许格式、最大大小、加密方式、保留期限和隐私等级。
2. 将文件写入受控 Internal/External Stage，记录 document_id、原始文件 hash、上传时间和业务关联键。
3. 对扫描件或复杂版式先调用 AI_PARSE_DOCUMENT，按需选择 OCR、LAYOUT 或 AGENTIC，并评估是否需要按页切分。
4. 对已经知道字段结构的任务调用 AI_EXTRACT，使用明确问题或 Schema 描述字段类型、列表和表格列。
5. 对长文档通过 FL_FILTER_PAGES 只处理相关页面；保留页号、bounding box 或文本偏移 citation。
6. 将候选抽取写入 staging 表，不能直接覆盖业务主表；保留模型输出、函数参数、提示/Schema 版本、Query ID 和处理状态。
7. 对字段执行类型、必填、格式、业务范围和跨字段校验；对低置信、缺失证据、金额对不上或不支持语言的记录进入人工复核。
8. 对通过校验的字段执行 MERGE，并按 document_id + 字段/页位置保证重复提交幂等。
9. 记录页数成本、失败率、人工修正率和字段级准确率，定期使用独立标注样本回归评估。

示例：先解析页面布局，再提取合同字段。

~~~sql
SELECT AI_EXTRACT(
  file => TO_FILE('@DOC_STAGE', 'contract.pdf'),
  responseFormat => {
    'contract_number': 'What is the contract number?',
    'signed_date': 'What date was the contract signed?',
    'parties': ['List the contracting parties'],
    'total_amount': 'What is the total contract amount?'
  }
);
~~~

生产调用还需要确认实际 SQL 函数签名、支持的 responseFormat、页面范围和账户区域权限；复杂流程可以先将 AI_PARSE_DOCUMENT 结果写入中间表再供下游消费。

## 场景分析

财务部门每天收到数千份 PDF 发票。字段包括供应商、发票号、日期、币种、税额和明细行。部分发票是扫描件，部分为电子 PDF，还有少量手写备注。

先使用 AI_PARSE_DOCUMENT 判断文本和布局质量；再用 AI_EXTRACT 按字段 Schema 提取发票信息。对每一字段保留页码和 bounding box，便于核对发票号和金额。然后执行发票号唯一、供应商存在、币种有效、税额计算和总额与明细汇总一致等校验。无法识别或证据不足的文件进入人工队列，不通过猜测补齐。

验收使用人工标注样本，按字段计算准确率、召回率、完全匹配率和人工复核比例；同时测量每页成本、处理时延和重复处理行为。

## 常见误区

- 把模型返回 JSON 当作已验证业务事实。字段需要 Schema、规则和来源位置验证。
- 只保留抽取值，不保留原文定位。后续无法解释金额或日期从哪一页提取。
- 对整份文档重复做所有解析。只处理需要的页面可减少资源消耗并缩短处理时间。
- 将 AI_PARSE_DOCUMENT 与 AI_EXTRACT 当成同一个函数。前者偏文本/布局解析，后者面向结构化字段、实体和表格抽取。
- 直接把低质量抽取写到业务主表。应先进入 staging，按证据和规则门禁后再 MERGE。
- 用更大的 Warehouse 追求 AI_PARSE_DOCUMENT 更快。官方说明更大 Warehouse 不会增加该函数性能，需测量真正瓶颈。

## 完成标准

- [ ] 能区分 AI_PARSE_DOCUMENT 的 OCR/LAYOUT/AGENTIC 与 AI_EXTRACT 的结构化抽取。
- [ ] 能设计 Stage 文件登记、page split 和 page filter。
- [ ] 能保留字段来源的页号、bounding box 或文本偏移证据。
- [ ] 能建立字段校验、人工复核和幂等写入流程。
- [ ] 能估算按页处理费用并验证区域、格式和语言支持范围。

## 自测

1. 发票 PDF 中需要提取表格和勾选框，为什么不能只做普通文本 OCR？
2. AI_EXTRACT 返回合同金额 100 万，但引用页码指向空白区域，应该如何处理？
3. 2,000 页报告中只需提取第 120 页的签字日期，怎样减少不必要的页面处理？
4. 为什么把函数调用结果先写入 staging 而不是直接覆盖发票主表？

## 参考资料

- [Parsing documents with AI_PARSE_DOCUMENT](https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document)
- [Extracting information from documents with AI_EXTRACT](https://docs.snowflake.com/en/user-guide/snowflake-cortex/document-extraction)
- [Cortex AI Functions: Documents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/ai-documents)
- [Document Processing Playground](https://docs.snowflake.com/en/user-guide/snowflake-cortex/document-processing-playground)
