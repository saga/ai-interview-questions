# Cortex 文档解析、分类与结构化抽取

## 本节要解决的问题

文档进入 Snowflake 后，先要判断需要的是保留版面和上下文、提取固定字段、把文件路由到业务流程，还是执行自由文本理解。AI_PARSE_DOCUMENT、AI_EXTRACT、AI_CLASSIFY 和 AI_COMPLETE 的输入与输出目标不同；将它们混用会造成不必要的模型调用、费用和质量风险。

## 核心知识

### AI_PARSE_DOCUMENT 适合建立可搜索、可引用的文档内容层

AI_PARSE_DOCUMENT 将数字 PDF 或扫描文档转换为富文本，并尽量保留标题、表格和版面关系；需要时还可提取图片。适用于全文理解、文档问答、RAG、摘要和后续多字段分析。

它解决的是文档内容解析，不直接定义业务字段是否合格。解析结果应保留页码、段落、表格和原始文件 ID；如果要用于合同金额或发票号码入库，仍需下一步按 Schema 抽取和业务验证。

### AI_EXTRACT 适合有明确目标字段的结构化提取

AI_EXTRACT 根据自然语言 Schema 或字段说明提取实体、列表和表格，可以处理正文、表格、勾选框、手写内容等视觉元素。适合发票、合同、申请表、保单和其他字段稳定的文档。

返回的字段仍是候选值。业务侧要验证数据类型、必填、唯一性、跨字段关系和引用位置。若模型无法确定字段，缺失值应保留为缺失并进入复核，而不是自动补成默认值。

### AI_CLASSIFY 用于分类路由，AI_COMPLETE 用于更开放的生成任务

AI_CLASSIFY 将文档或文本映射到预定义类别，适合混合收件箱入口：先判断是发票、合同、银行对账单还是其他类型，再把文件交给对应字段 Schema。类别集合应稳定、互斥程度明确，并覆盖 Other/Unknown 或异常路径。

AI_COMPLETE 是通用文本生成接口，可以执行开放式解释、摘要、重写或跨段推理；但对有固定类别、固定字段或版面解析要求的任务，通常应先考虑更专用的函数。AI_COMPLETE 不会自动保留文件页面证据，也不能替代文档解析阶段。

### 函数组合应按数据流分阶段，而不是每个文件都调用全部函数

常见流程是：Stage 文件登记 → AI_CLASSIFY 路由 → AI_PARSE_DOCUMENT 解析需要全文/版面理解的文档 → AI_EXTRACT 提取业务字段 → 确定性校验与人工复核 → 写入业务表。并非每类文档都要执行所有步骤：电子发票可以直接按字段 Schema 提取；合同全文问答则可能先解析，再建立索引供 Cortex Search 使用。

## 工程实施步骤

1. 按文件类型、来源、业务用途和下游消费者建立文档分类清单，区分全文搜索、固定字段入库、分类路由和开放式摘要。
2. 将原始文件写入受控 Stage，保存 document_id、源系统、文件 hash、上传时间、业务批次和隐私级别。
3. 对混合文档流先评估 AI_CLASSIFY，定义可选类别、Unknown 路由和低置信/异常处理。
4. 对需要全文语义、页面上下文或版面结构的类型调用 AI_PARSE_DOCUMENT，输出中间解析结果而不是直接写业务主表。
5. 对字段明确的文档调用 AI_EXTRACT，定义字段 Schema、列表/表格结构和缺失值处理。
6. 只有在需要开放式分析、解释或总结时才调用 AI_COMPLETE；明确模型输出不能作为唯一事实来源。
7. 统一保留模型输出与来源证据：文件 hash、页码、文本片段、bounding box、字段名、Schema 版本和 Query ID。
8. 将字段格式校验、业务规则校验和跨字段核对分开执行；例如日期可解析、供应商存在和发票总额等于明细与税额是不同规则。
9. 将未识别类别、缺字段、引用不可靠和业务规则失败的记录放入人工复核队列；通过后才允许 MERGE。
10. 建立按文档类型的固定回归集，统计分类准确率、字段级准确率、完全匹配率、人工复核率、每页成本和端到端时延。

## 场景分析

财务部门收到发票、合同和银行流水三种文件。发票需要提取发票号码、供应商和金额；合同需要全文检索并抽取签约方、起止日期；银行流水先分类再按账户和交易行项目抽取。

不要对全部文件统一调用 AI_COMPLETE 后解析 JSON。先通过 AI_CLASSIFY 将文件路由到不同类型；发票直接调用 AI_EXTRACT，合同可先用 AI_PARSE_DOCUMENT 保留章节和版面，再使用 AI_EXTRACT 提取字段并建立全文索引；银行流水根据版式选择解析方式，再执行字段映射和业务对账。

验收分别测分类混淆矩阵、字段级准确率、引用位置准确率和人工复核率。发票金额校验失败时应隔离记录；合同页码证据缺失时不能把抽取值标记为已验证。

## 常见误区

- **所有文档都先调用 AI_COMPLETE。** 分类、全文解析和 Schema 抽取有更明确的专用接口。
- **把 AI_PARSE_DOCUMENT 当作结构化业务提取。** 它提供富文本和版面，不负责验证业务字段。
- **把 AI_CLASSIFY 输出直接当最终业务状态。** 分类结果只决定路由，业务处理仍需执行自己的校验。
- **认为 AI_EXTRACT 的字段天然可信。** 还需要引用核对、格式、业务不变量与异常复核。
- **每份文档都调用全部四个函数。** 应按文档类型和目标输出选择最少的步骤。
- **只测整体准确率。** 文档字段常有不均匀错误，需要按字段、版面类型、语言和文档来源切分评估。

## 完成标准

- [ ] 能说明 AI_PARSE_DOCUMENT、AI_EXTRACT、AI_CLASSIFY 和 AI_COMPLETE 的任务差异。
- [ ] 能根据全文理解、字段抽取、分类路由和自由生成选择接口。
- [ ] 能设计按文档类型分支的处理流水线。
- [ ] 能将解析结果、候选字段、来源证据和业务校验分层存储。
- [ ] 能用字段级准确率、分类指标、人工复核和成本评估文档流程。

## 自测

1. 混合文件收件箱需要识别发票、合同和银行流水，哪类函数适合做第一步路由？
2. 合同需要保留表格、标题和页面上下文用于全文检索，为什么 AI_EXTRACT 不能完全替代 AI_PARSE_DOCUMENT？
3. 发票字段固定，需要提取金额、税率和供应商，应该优先考虑哪种函数？输出还需要哪些验证？
4. AI_COMPLETE 能返回 JSON，为什么不意味着它最适合所有文档抽取任务？
5. 分类正确但下游提取错误，应分别在哪两个阶段定位？

## 参考资料

- [Cortex AI Functions: Documents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/ai-documents)
- [Parsing documents with AI_PARSE_DOCUMENT](https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document)
- [Extracting information from documents with AI_EXTRACT](https://docs.snowflake.com/en/user-guide/snowflake-cortex/document-extraction)
- [Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/llm-functions)
