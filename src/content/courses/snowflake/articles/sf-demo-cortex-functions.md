# Cortex AI Functions：按任务选择模型能力

## 本节要解决的问题

客服团队要处理 50 万条交易留言和退款材料，目标包括：把工单分到正确队列、从 PDF 提取合同编号和金额、识别是否包含个人信息、汇总每个地区的高频投诉，并将少量复杂问题写成调查摘要。

如果把全部文本拼接后交给一个通用生成函数，输入可能超出上下文，输出结构也难以稳定。更合适的做法是先把任务拆成分类、筛选、抽取、汇总、生成和脱敏，再选择对应的 Cortex AI Function。专用函数通常有更明确的输入/输出契约；AI_COMPLETE 留给确实需要自定义生成或推理的任务。

## 核心知识

### 不同函数解决的是不同问题，不是不同写法

| 业务任务 | 优先考虑 | 输入与输出 | 不适合直接承担的工作 |
|---|---|---|---|
| 根据提示生成或改写内容 | AI_COMPLETE | Prompt/文本/支持的多模态输入 → 生成内容 | 代替结构化数据校验或数据库事务 |
| 将文本归入业务类别 | AI_CLASSIFY | 文本/支持的文件 → 一个或多个类别标签 | 计算连续数值或证明分类一定正确 |
| 判断记录是否符合自然语言条件 | AI_FILTER | Prompt + 文本/图像 → BOOLEAN | 取代确定性的 SQL 条件、权限策略 |
| 从文本或文件抽取指定字段 | AI_EXTRACT | 文本/文件 + responseFormat → JSON 结构 | 自动批准合同、付款或业务状态 |
| 汇总单条文本 | AI_SUMMARIZE | 文本/文件 → 摘要 | 汇总任意数量的多行数据 |
| 跨多行生成洞察或摘要 | AI_AGG / AI_SUMMARIZE_AGG | 分组后的多行输入 → 聚合洞察/摘要 | 替代数值聚合、精确计数或事实表 |
| 判断文本情绪 | AI_SENTIMENT | 文本 → 情绪结果 | 替代投诉等级、风险等级的正式规则 |
| 向量化并比较语义相似度 | AI_EMBED / AI_SIMILARITY | 文本等输入 → Embedding / 相似度 | 自动完成检索排序、访问控制或答案生成 |
| 从 Stage 文档读取文本与版面 | AI_PARSE_DOCUMENT | 文档文件 → OCR 文本或版面结构 | 直接完成所有业务字段的准确抽取 |
| 从音视频提取转写文本 | AI_TRANSCRIBE | Stage 中的音频/视频 → 转写、时间戳、说话人信息 | 自动判断说话内容是否合法或可信 |
| 从文本遮盖 PII | AI_REDACT | 文本 → 脱敏文本 | 替代完整的数据分类和访问授权 |
| 翻译文本 | AI_TRANSLATE | 文本 + 目标语言 → 翻译文本 | 代替专业法律/金融译审 |

选型时先问“结果应该是什么类型”。如果答案是固定类别，使用分类；如果答案是字段和值，使用抽取；如果答案是一个布尔筛选条件，使用 Filter；如果答案是跨多行的概述，选择聚合函数；只有需要开放式生成、解释或综合推理时才使用 AI_COMPLETE。

### AI_CLASSIFY 适合固定类别路由，类别本身要有明确边界

例如将客服工单分到退款、银行卡争议或账户访问队列：

~~~sql
WITH tickets AS (
  SELECT
    ticket_id,
    ticket_text
  FROM support_tickets
  WHERE ticket_text IS NOT NULL
)
SELECT
  ticket_id,
  AI_CLASSIFY(
    ticket_text,
    [
      {'label': 'REFUND', 'description': '退款延迟、退款状态和退款金额问题'},
      {'label': 'CARD_DISPUTE', 'description': '银行卡争议、未授权扣款和拒付'},
      {'label': 'ACCOUNT_ACCESS', 'description': '登录、身份验证和账户访问问题'},
      {'label': 'OTHER', 'description': '不属于以上类别的其他客服问题'}
    ],
    {
      'task_description': '根据客户主要诉求选择最合适的工单类别',
      'output_mode': 'single'
    }
  ):labels[0]::VARCHAR AS ticket_category
FROM tickets;
~~~

类别描述应能互相区分，并加入真实的正反例。类别少而明确时，single 输出通常更适合路由；一条记录可能同时涉及多个主题时，再考虑 multi-label。类别数量过多、定义重叠或没有 OTHER/未知处理，会让分类结果难以解释。

AI_CLASSIFY 返回标签，不应直接作为自动执行高影响操作的授权依据。退款是否批准、账户是否冻结，仍要由正式业务规则、账户状态和人工授权判断。

### AI_FILTER 适合自然语言布尔筛选，不应替代确定性条件

当条件难以写成简单关键词时，可以用 AI_FILTER 做文本或图像判断。例如先筛出明确提到“未按约定时间到账”的客服留言：

~~~sql
SELECT
  ticket_id,
  ticket_text
FROM support_tickets
WHERE ticket_text IS NOT NULL
  AND AI_FILTER(
    CONCAT(
      'The customer explicitly reports that an expected refund has not arrived by the promised date. ',
      'Does this support transcript describe that issue? Transcript: ',
      ticket_text
    )
  );
~~~

AI_FILTER 返回 BOOLEAN。应给出具体任务描述，避免只写“是否满意”或“是否相关”这种含义不明确的提示。Snowflake 文档建议避免 NULL 输入；对需要跨多列拼接的场景，可以用 PROMPT() 构造模板。

如果条件本来可以用 SQL 精确表达，例如金额大于 10,000、订单状态等于 SETTLED、日期落在某范围，就应使用 WHERE，而不是调用 AI_FILTER。权限、行级策略和付款条件也不应交给模型作最终决定。

### AI_EXTRACT 适合按明确 Schema 从文本或文件抽取字段

AI_EXTRACT 接收文本或 Stage 文件，以及字段说明/Schema，返回 JSON 对象。对合同或发票抽取时，可以同时请求字段分数和引用位置：

~~~sql
SELECT
  file_name,
  AI_EXTRACT(
    file => TO_FILE('@LEGAL_DB.DOCS.CONTRACTS', file_name),
    responseFormat => {
      'contract_number': 'Contract number',
      'counterparty': 'Legal entity name of the counterparty',
      'effective_date': 'Contract effective date',
      'termination_date': 'Contract termination date',
      'currency': 'Currency code',
      'amount': 'Total committed amount'
    },
    scores => TRUE,
    citation => TRUE
  ) AS extracted
FROM staged_contract_manifest;
~~~

返回的 JSON 包含 response；开启 scores 后会增加 scoring 对象，开启 citation 后会增加 citations。文档引用可以带页码和位置，便于审核员回到原始文件核对。分数表示模型对字段抽取的置信程度，不是该字段经过法律或财务确认。

对低分、金额、日期、合同主体和支付条款等关键字段，应设置阈值并进入人工复核。还要验证币种、精度、日期范围、合同编号格式和字段之间的业务不变量，不能因为 JSON 格式正确就直接写入正式合同主数据。

AI_EXTRACT 也可以直接抽取文本中的字段。如果文件首先需要 OCR 或保留版面、表格结构，可以用 AI_PARSE_DOCUMENT；如果需要从解析后的内容提取指定字段，再用 AI_EXTRACT。两个函数的用途不一样：解析文档结构和提取业务字段不是同一步。

### AI_SUMMARIZE 与 AI_AGG / AI_SUMMARIZE_AGG 的输入范围不同

AI_SUMMARIZE 对一段文本或一个支持的文件生成摘要。它适合单份研究报告或单个合同摘要。

如果要总结某地区 5 万条客户意见，不能将全部记录通过 LISTAGG 拼成一个超长字符串再交给 AI_SUMMARIZE。这样既受单次输入上下文限制，也容易丢失每条记录之间的边界。

应先按地区、产品或时间窗分组，再使用 AI_AGG 或 AI_SUMMARIZE_AGG 对多行内容生成洞察/摘要。两者都属于聚合 AI 函数，但目标不完全相同：AI_AGG 用于从多行文本中归纳洞察；AI_SUMMARIZE_AGG 更侧重将多行内容压缩成摘要。记录数、分组粒度和代表性样本仍要有业务设计，模型总结不能取代精确计数、金额或趋势计算。

例如，先按地区得到投诉主题摘要，再将结果交给 AI_COMPLETE 生成管理层说明，比把 50 万条原始记录一次塞进 Prompt 更可控。

### AI_EMBED 与 AI_SIMILARITY 负责语义向量，不等于 RAG 完成

AI_EMBED 将文本转换成向量，AI_SIMILARITY 用于比较两个输入的语义相似度。它们适用于构建向量召回、相似文档比较或语义去重候选。

向量相似度不是事实正确性，也不是权限过滤。生产检索仍需要：
- 文档版本和有效日期；
- 用户访问范围；
- Chunk 粒度和原始引用；
- 召回与排序评测；
- 回答阶段的证据核验。

如果已经使用 Cortex Search，通常由 Search Service 管理索引和检索，不必为了“有 Embedding”而在应用里重复实现向量库。若需要自定义相似度或向量工作流，再单独评估 AI_EMBED 和 AI_SIMILARITY。

### 生成函数输出是候选结果，结构化处理必须有校验层

AI_COMPLETE 适合处理专用函数无法覆盖的任务，例如根据多份已核验材料起草一段解释、将多个分析结果整理成固定格式，或执行更开放的文本生成。

但 AI_COMPLETE 返回的文本不应直接写入正式业务字段。至少要做：
- JSON/Schema 解析与必填字段校验；
- 类型、单位、币种和数值范围检查；
- 引用是否存在且能支持对应结论；
- 未知值、拒答和异常响应处理；
- 模型、Prompt、输入范围和输出版本记录。

若必须得到结构化字段，先评估 AI_EXTRACT；若只要固定分类，先评估 AI_CLASSIFY；不要为方便而全部用一个通用 Prompt 让模型“输出 JSON”。

### 权限、地区和成本是函数设计的一部分

调用 AI Functions 不只有表权限。当前访问控制包含两层：
- 账户级 USE AI FUNCTIONS 权限，或按函数授予 USE AI FUNCTION <name>；
- 角色获得 SNOWFLAKE.CORTEX_USER 或 SNOWFLAKE.AI_FUNCTIONS_USER 数据库角色。

AI_FUNCTIONS_USER 只覆盖标量 AI Functions，不包括 AI_AGG 和 AI_SUMMARIZE_AGG；如果要使用聚合函数，需要具备相应的 Cortex 用户角色。USE AI FUNCTIONS 默认授予 PUBLIC 的行为也应在账户安全设计中明确评估；若需要精细控制，可以撤销 PUBLIC 的广泛授权，并按函数向业务 Role 授权。

模型、文件类型和多模态输入的可用性存在地区差异。部分文档/图像功能需要启用 Cross-region inference；Tokyo Region 对 text 和部分功能的支持与 US Region 并不完全相同。生产部署前应按实际 Region、Function、输入类型和模型核对可用性，不要仅在开发账户测试成功就推断生产区域也支持。

AI Functions 会产生模型推理费用。成本通常与输入/输出 Token、文件页数或输入类型有关；批量 SQL 每行调用模型会放大成本和延迟。应先按数据范围去重、过滤和分批，记录 Query History 与相关 Usage View，并用代表性样本测试后再放大运行规模。

## 工程实施步骤

1. 将业务需求分类为生成、分类、筛选、字段抽取、总结、跨行洞察、情绪、向量、文档解析、转写、脱敏或翻译。
2. 优先使用最贴近目标输出的专用函数；只有专用函数无法覆盖时再使用 AI_COMPLETE。
3. 为类别定义边界、未知类别和 few-shot 样例；为抽取定义 responseFormat 和必填字段；为 Filter 写出清晰、可判定的自然语言条件。
4. 将文件解析、字段抽取和业务核验拆开，保存原始文件、页码/引用、抽取结果和复核状态。
5. 对跨行任务先按业务维度分组，再选择 AI_AGG 或 AI_SUMMARIZE_AGG；不要把大表全文拼接成一个 Prompt。
6. 对 AI_EMBED/AI_SIMILARITY 明确向量模型、输入规范和相似度阈值，并单独评估召回质量与访问控制。
7. 建立独立测试集，覆盖类别边界、未知/空值、文档格式变化、字段遗漏、错误单位、跨语言输入和异常文件。
8. 对关键抽取字段设置分数阈值和人工复核；不把 AI_EXTRACT score 视为事实准确率或业务审批。
9. 为目标账户授予必要的 USE AI FUNCTIONS 或单函数权限及相应数据库角色；按实际 Region 检查功能和模型可用性。
10. 先用小批量测量准确率、延迟、失败率和费用，再放大批次；对失败或低置信数据隔离，不要静默写入正式表。
11. 保留 Function、模型、Prompt、输入批次、来源 ID、Query ID、输出与人工复核结果，支持问题回放。

## 场景分析

金融客服的 50 万条留言需要先分成退款、卡争议和账户访问三类；其中 2,000 条投诉需要提取交易日期、金额和币种；每个地区还需要一段周度投诉摘要。

合理流程是：
1. 用 AI_CLASSIFY 对留言分类，未确定类别进入 OTHER/复核队列；
2. 对合同或争议文件使用 AI_EXTRACT 提取需要的字段，并开启 scores/citation；
3. 先用 SQL 按地区和周分组，再用 AI_SUMMARIZE_AGG 归纳多条留言；
4. 需要撰写面向管理层的综合说明时，才用 AI_COMPLETE 汇总已核验的数字和证据。

如果把 50 万条留言全部拼进一个 AI_COMPLETE Prompt，既无法保证上下文覆盖，也难以准确核算每条投诉归属和金额。专用函数与 SQL 聚合可以先完成结构化处理，生成模型负责剩余的开放式语言表达。

## 常见误区

- **所有任务都使用 AI_COMPLETE。** 分类、抽取、过滤、摘要和向量化已有任务专用函数，输出契约更清楚。
- **把 AI_CLASSIFY 标签当成批准决定。** 类别只做路由，最终退款、冻结或合规状态仍要经过业务规则。
- **用 AI_FILTER 替代普通 SQL WHERE。** 金额、日期、状态和权限等确定性条件应使用 SQL。
- **把 AI_EXTRACT score 当作事实正确率。** 它是模型对字段提取的置信分，不是对业务真值的证明。
- **把 AI_PARSE_DOCUMENT 和 AI_EXTRACT 当成同一函数。** 前者解析文档文本/版面，后者按 Schema 抽取指定字段。
- **把 AI_SUMMARIZE 用于任意规模的多行汇总。** 单文档摘要与跨行聚合应选择不同函数。
- **把向量相似度当作权限或证据。** Embedding/Similarity 不提供用户级授权，也不证明内容真实。
- **默认所有函数、模型和文件类型在所有 Region 可用。** 多模态和 Cross-region inference 有区域及预览限制。
- **按行无差别调用模型。** 先过滤、分组、去重和抽样，再评估成本与延迟。
- **只给角色授予数据库角色，不检查账户级函数权限。** USE AI FUNCTIONS 或 per-function grant 也是访问控制的一部分。

## 完成标准

- [ ] 能按任务选择 AI_COMPLETE、AI_CLASSIFY、AI_FILTER、AI_EXTRACT、AI_SUMMARIZE 和聚合函数。
- [ ] 能说明 AI_PARSE_DOCUMENT 与 AI_EXTRACT 的用途差异。
- [ ] 能区分 AI_AGG 与 AI_SUMMARIZE_AGG 的跨行用途。
- [ ] 能解释 AI_EMBED/AI_SIMILARITY 与完整 RAG 检索的边界。
- [ ] 能使用 scores/citations 并设计低置信人工复核。
- [ ] 能说明 USE AI FUNCTIONS、per-function grant、CORTEX_USER 和 AI_FUNCTIONS_USER 的关系。
- [ ] 能按 Region/输入类型核对模型与函数可用性。
- [ ] 能用固定样本测量输出质量、延迟、失败率和成本。

## 自测

1. 客服留言需要分配到退款、卡争议或账户访问队列。为什么 AI_CLASSIFY 比 AI_COMPLETE 更合适？分类结果能否直接批准退款？
2. 从 PDF 贷款合同中提取借款人、金额和到期日。AI_PARSE_DOCUMENT 与 AI_EXTRACT 分别负责什么？
3. AI_EXTRACT 返回某个合同金额 score 为 0.62。这个分数能否证明金额错误？应该怎样进入业务流程？
4. 需要从 50 万条投诉中按地区生成摘要。为什么不应使用 LISTAGG 拼成一个超长字符串再调用 AI_SUMMARIZE？
5. AI_FILTER 和 SQL WHERE 分别适合什么条件？为什么权限条件不能交给 AI_FILTER？
6. 某个 Role 获得 AI_FUNCTIONS_USER，但没有 CORTEX_USER。它能否调用 AI_AGG 和 AI_SUMMARIZE_AGG？为什么？
7. 一个函数在美国开发账户可用，部署到东京账户却失败。需要检查哪些 Region、文件类型和 Cross-region inference 条件？

## 参考资料

- [Cortex AI Functions overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql)
- [Privileges and model access for Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-privileges-and-access)
- [AI_COMPLETE](https://docs.snowflake.com/en/sql-reference/functions/ai_complete)
- [AI_CLASSIFY](https://docs.snowflake.com/en/sql-reference/functions/ai_classify)
- [AI_FILTER](https://docs.snowflake.com/en/sql-reference/functions/ai_filter)
- [AI_EXTRACT](https://docs.snowflake.com/en/sql-reference/functions/ai_extract)
- [AI_SUMMARIZE](https://docs.snowflake.com/en/sql-reference/functions/ai_summarize)
- [AI_SUMMARIZE_AGG](https://docs.snowflake.com/en/sql-reference/functions/ai_summarize_agg)
- [AI_SIMILARITY](https://docs.snowflake.com/en/sql-reference/functions/ai_similarity)
