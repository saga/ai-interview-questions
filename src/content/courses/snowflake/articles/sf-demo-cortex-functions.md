# Cortex AI Functions：按任务选择函数并验证输出

## 本节要解决的问题

客服每天收到数万条文本工单、邮件和附件。业务希望自动分流退款、物流和账号问题，从合同/发票附件提取订单号与金额，并汇总一周内的主要客户反馈。

把所有材料都交给 AI_COMPLETE 写一个摘要，既浪费 Token，也难以验证结构化字段。使用 SQL 正则表达式可以提取固定格式，却无法可靠处理客户自然语言、表格和扫描件。Cortex AI Functions 提供不同任务的托管函数：分类、过滤、抽取、解析、生成、情感分析和聚合。选型要看输入类型、输出契约和可验证程度，而不是“哪个模型更强”。

## 核心知识

### 先把输入任务拆成分类、抽取、解析、生成和聚合

| 业务任务 | 优先考虑 | 输出形式 | 不适合直接承担的工作 |
|---|---|---|---|
| 从固定类别中判断工单主题 | AI_CLASSIFY | 类别标签，可单选/多选 | 需要严格规则保证的合规裁决 |
| 判断一条文本是否符合自然语言条件 | AI_FILTER | TRUE/FALSE | 需要解释、多标签或复杂评分的分类任务 |
| 从文本中提取订单号、金额、日期等字段 | AI_EXTRACT | JSON 结构化字段 | 需要先从复杂页面还原表格布局的文档解析 |
| 从 PDF、扫描件提取文本和版面 | AI_PARSE_DOCUMENT | 文本、段落、表格、布局和可选图像 | 直接把模型提取值当作已核实的业务数据 |
| 按提示改写、解释、生成文本 | AI_COMPLETE | 模型生成结果 | 固定字段的确定性解析、权限判断 |
| 识别整体或指定方面的情绪 | AI_SENTIMENT | overall 和 aspect sentiment | 判断投诉是否构成正式违规 |
| 汇总大量行文本中的主题和洞察 | AI_AGG / AI_SUMMARIZE_AGG | 跨行汇总 | 需要保留每一条记录的逐条结果 |
| 生成向量或比较语义相似度 | AI_EMBED / AI_SIMILARITY | 向量或相似度 | 业务规则匹配与身份授权 |

这些函数不是同一个接口换了名字。AI_CLASSIFY 的类别集合由调用者定义；AI_FILTER 判断自然语言条件是否满足；AI_EXTRACT 按给定问题/schema 提取字段；AI_COMPLETE 需要自己写清提示和输出要求。选择过于通用的生成函数，会把本来可测试的字段任务变成难以验收的自由文本。

### AI_CLASSIFY 的类别必须定义清楚，模型不会替你建立业务分类体系

假设工单分类只允许四个队列：退款、物流、账户和其他。类别应相互区分，描述明确，不要把“紧急”与“退款”放在同一维度，也不要把“其他”与“物流投诉”定义成重叠范围。

~~~sql
SELECT
  ticket_id,
  AI_CLASSIFY(
    ticket_text,
    [
      {'label': 'refund', 'description': 'request for refund, charge reversal, or refund status'},
      {'label': 'delivery', 'description': 'shipment delay, missing parcel, or delivery status'},
      {'label': 'account', 'description': 'login, identity verification, or account access'},
      {'label': 'other', 'description': 'issues that do not belong to the other categories'}
    ],
    {
      'task_description': 'Route the customer support ticket to one service queue',
      'output_mode': 'single'
    }
  ):labels[0]::VARCHAR AS queue_name
FROM SUPPORT.TICKETS
WHERE created_at >= '2026-11-01';
~~~

返回结果包含 labels 数组。单标签模式下有一个类别；多标签模式可以返回多个标签。类别是大小写敏感的，通常建议使用自然、互斥的标签，并给容易混淆的标签加简短描述。类别太多会增加输入 Token，也可能降低分类准确率；不要把几十个细碎队列塞进一次分类请求。

不要在结果为空时默认归到“其他”。函数错误可能返回 NULL，业务上“分类为其他”和“模型调用失败”是两种状态。生产查询应保留错误信息或重试标记，并把未知结果送入人工队列。

### AI_FILTER 判断条件，AI_CLASSIFY 负责分配类别

两个函数看起来都能做分类，但业务契约不同：

- AI_FILTER 回答一个布尔问题，例如“这条工单是否包含退款请求？”适合在 WHERE 或 JOIN 条件中筛选。
- AI_CLASSIFY 从预定义类别中选择标签，适合分流和标签体系。
- 若要判断一条文本是否属于多个指定类别，用 AI_CLASSIFY 的 multi 模式；若只判断是否满足一个自然语言条件，使用 AI_FILTER 更直接。

不要把 AI_FILTER 的 TRUE 当成风险等级，也不要把 AI_CLASSIFY 的标签当成规则引擎的审批结果。模型输出是候选分类，关键业务动作仍需经过确定性规则、置信度/异常检查和授权流程。

### AI_EXTRACT 适合把文本转成字段，但提取结果仍需类型与业务校验

客服邮件包含：“订单 JP-82013 的退款金额 12,800 日元尚未到账，希望本周处理。”可以指定要提取的字段：

~~~sql
SELECT AI_EXTRACT(
  text => '订单 JP-82013 的退款金额 12,800 日元尚未到账，希望本周处理。',
  responseFormat => {
    'order_id': 'What is the order identifier?',
    'refund_amount': 'What refund amount and currency are mentioned?',
    'requested_action': 'What action is the customer requesting?'
  },
  scores => TRUE
) AS extracted;
~~~

AI_EXTRACT 返回 JSON，其中 response 保存提取值，scores=TRUE 时还会返回每个字段的评分。评分可用于分流复核，但不是严格统计概率，也不能替代来源核对。金额字段返回的仍可能是带币种文字的字符串；要再做金额解析、币种校验和订单主数据匹配。

若使用 JSON Schema 形式的 responseFormat，顶层必须是 object；目前支持的子对象类型有限，标量字段只支持 string。不要把它写成任意复杂的 JSON Schema，并假设所有 JSON 类型和嵌套对象都会按预期生成。

AI_EXTRACT 的 citation 参数目前为 Preview，需使用命名参数并启用 cross-region inference。对文档输入，引用可返回页码和边界框；对文本输入，引用返回原文偏移量。若系统需要可点击原文定位，必须把引用信息与原文文件版本、页码映射一起保存。

### AI_PARSE_DOCUMENT 先解析文档结构，再做字段抽取

合同、发票、扫描件或研究报告不应先转成一大段纯文本再盲目截断。AI_PARSE_DOCUMENT 提供不同处理模式：

- LAYOUT：保留文本和文档布局，适合表格、标题和阅读顺序；可以设置 extract_images 取出内嵌图像。
- OCR：适合扫描件和文本型图像，重点是提取可读文本。
- AGENTIC（Preview）：自动识别图表、表单、截图等视觉内容，并选择相应处理动作；能力更丰富，但要按 Preview 状态和返回 schema 做评估。

例如，解析一份发票 PDF 时，可以使用 LAYOUT 获取文本和表格结构，再交给 AI_EXTRACT 按业务 schema 提取供应商、发票号、日期、税额和总额。若需要处理图表或复杂视觉元素，再评估 AGENTIC；它不支持 extract_images，且模型生成的结果 schema 不保证完全符合预期，应用必须验证所需字段。

### AI_COMPLETE 适合定制生成，不应拿自然语言当数据库约束

当业务需要一段可读的客户回复或周报摘要，AI_COMPLETE 比固定标签函数更合适。提示应提供经过授权的事实和明确输出要求，例如：
- 只根据传入的工单状态、处理记录和已批准政策生成；
- 不得推测退款到账时间；
- 未知字段应明确标为待确认；
- 不要输出客户不应看到的内部备注。

它的结果是模型生成内容。即使要求输出 JSON，也要在 SQL 或应用层解析并验证字段、类型、必填项和业务不变量。生成结果不能直接更新订单状态、批准退款或覆盖财务记录。

在多行查询中，AI_COMPLETE 失败默认可能返回 NULL，而不让整条 SQL 失败。若 NULL 会影响业务处理，应使用 return_error_details 获取错误信息，并明确记录失败状态，不能把 NULL 当成“无摘要”。

### 批量 SQL 与交互式低延迟调用应分开考虑

Cortex AI Functions 面向 SQL 批量处理，适合对大表中的文本/图片进行分类、抽取和汇总。Snowflake 建议批量处理使用 AI Functions；需要交互式低延迟时，可以评估 Complete API、Embed API 或 Agents API。

批量任务不是免费的“给每一行调用一次模型”。成本受输入/输出 Token、文件页数和处理模式、所选模型、重复执行和评估次数影响。先用小样本调试提示和 schema，再扩展到全表；对不需要重新处理的结果要持久化并按源版本做增量更新。

### 权限和可用性要与函数选型一起检查

当前 Cortex AI Functions 调用需要账户级 USE AI FUNCTIONS 权限，或对应的单函数 USE AI FUNCTION 权限，并且调用角色还需 CORTEX_USER 或 AI_FUNCTIONS_USER 数据库角色。默认账户可能已将 USE AI FUNCTIONS 授予 PUBLIC；需要细分权限时，应撤销不必要的 PUBLIC 授权，再授予专用角色。

模型访问还受 CORTEX_MODELS_ALLOWLIST 和模型 Role-Based Access Control 控制。函数可用性也受云区域、输入类型和 Preview 状态影响。不能因为账号可以调用 AI_COMPLETE，就假设图片、视频、文档解析或所有模型都在当前区域可用。部署前需要核对 Functions Regional Availability 和具体模型限制。

## 工程实施步骤

1. 把工作流分成输入解析、任务路由、字段提取/分类、业务校验、人工复核和结果落库。
2. 为每种任务选择最窄的函数：分类用 AI_CLASSIFY，布尔条件用 AI_FILTER，字段提取用 AI_EXTRACT，文档结构解析用 AI_PARSE_DOCUMENT。
3. 明确类别集合、提取 schema、Prompt、模型、处理模式和版本；把教学假设与真实业务规则分开。
4. 用固定样本覆盖正常、缺字段、矛盾、扫描质量差、非目标语言和异常格式。
5. 对返回值执行类型转换、范围/币种/日期校验、实体主数据匹配和业务不变量检查。
6. 使用 return_error_details 或单独错误状态区分函数返回 NULL、内容中确实没有信息和业务校验失败。
7. 低分、引用缺失、schema 不合法或关键字段冲突时进入复核队列，不自动写入关键业务字段。
8. 检查 USE AI FUNCTIONS、CORTEX_USER/AI_FUNCTIONS_USER、模型访问权限和区域可用性。
9. 记录函数、模型、Prompt/Schema 版本、源文件版本、Query ID、耗时、Token/费用和复核状态。
10. 先小批量验证准确率与成本，再扩大并发；对未变更输入使用缓存或持久化结果，避免无意义重复推理。

## 场景分析

客服每日有 50,000 条工单，另有 2,000 份发票附件。处理目标是让退款和物流工单进入正确队列，并把发票关键字段交给财务复核。

文本工单先使用 AI_CLASSIFY 分配队列，再对退款类别的工单使用 AI_EXTRACT 提取订单号、金额和请求内容。AI_SENTIMENT 可以补充客户对物流、价格和客服过程的情绪倾向，但它不能判断退款是否符合政策。发票文件先由 AI_PARSE_DOCUMENT 提取文本/布局，再由 AI_EXTRACT 按发票 schema 提取发票号、日期、税额和总金额。

财务系统只接受通过校验的字段：订单号必须存在于订单主表，币种必须属于允许列表，税额和总额必须满足金额规则。AI_EXTRACT 如果无法确定发票日期，或者金额字段评分过低，记录为待复核，而不是填入默认日期。客户回复由 AI_COMPLETE 根据已确认的处理状态生成，发送之前仍要检查输出是否包含内部备注或未经证实的到账承诺。

## 常见误区

- **所有任务都用 AI_COMPLETE。** 它是通用生成函数，不是最适合每一项分类、字段提取和布尔判断的接口。
- **把 AI_FILTER 和 AI_CLASSIFY 当成同一个功能。** 一个回答布尔条件，一个返回用户定义的类别标签。
- **分类标签重叠或没有边界。** 模型只能在给定集合里选择；标签设计本身不清楚时，无法靠增加 Prompt 修复。
- **把 AI_EXTRACT 返回的金额字符串直接写入财务字段。** 还需要币种、精度、范围和主数据校验。
- **把提取评分当作正确概率。** 评分只是可用于排序和人工复核的信号，不是业务正确性的证明。
- **把 AI_PARSE_DOCUMENT 的 OCR、LAYOUT 和 AGENTIC 混为一谈。** 三种模式用途不同，AGENTIC 仍是 Preview。
- **让函数 NULL 静默通过流水线。** NULL 可能代表调用失败，不等于文本中没有相关信息。
- **忽略账户、角色和区域限制。** 函数有权限和区域边界，不能只在个人开发账号上测试。
- **把模型分类或情绪结果当成正式审批。** 高影响决策必须由确定性业务规则和授权流程控制。

## 完成标准

- [ ] 能区分 AI_CLASSIFY、AI_FILTER、AI_EXTRACT、AI_PARSE_DOCUMENT、AI_COMPLETE 和 AI_SENTIMENT 的输入输出契约。
- [ ] 能设计互斥且可解释的分类标签。
- [ ] 能使用 AI_EXTRACT schema 提取字段并验证评分、引用和类型转换。
- [ ] 能根据文档形态选择 AI_PARSE_DOCUMENT 的 LAYOUT、OCR 或 AGENTIC。
- [ ] 能处理多行函数调用返回 NULL 和错误详情。
- [ ] 能说明批量 SQL 与低延迟 API 的选型差异。
- [ ] 能检查 USE AI FUNCTIONS、数据库角色、模型访问控制和区域可用性。

## 自测

1. 一个客服工单需要被路由到“退款/物流/账户/其他”四个队列。为什么优先使用 AI_CLASSIFY，而不是让 AI_COMPLETE 生成一个类别名称？
2. 业务只关心“这条文本是否包含退款申请”，返回 TRUE/FALSE。AI_FILTER 和 AI_CLASSIFY 分别适合什么情况？
3. AI_EXTRACT 返回退款金额 "12,800 JPY"，为什么不能直接写入 NUMBER 列？至少还要验证什么？
4. 一份扫描发票需要保留表格阅读顺序。应先考虑 AI_PARSE_DOCUMENT 的哪种模式？若要识别复杂图表和视觉元素，可评估哪种 Preview 模式？
5. AI_CLASSIFY 返回 NULL。系统如何区分模型调用失败与真正被分到“其他”类别？
6. 同一批工单每天重复执行 AI_COMPLETE。怎样减少重复推理成本，同时避免使用过期输入生成结果？
7. 某函数在 AWS Tokyo Region 不支持当前输入类型。为什么不能仅凭账号支持 Cortex AI Functions 就假设这个调用可用？

## 参考资料

- [Cortex AI Functions overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql)
- [Privileges and model access for Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-privileges-and-access)
- [AI_CLASSIFY](https://docs.snowflake.com/en/sql-reference/functions/ai_classify)
- [AI_EXTRACT](https://docs.snowflake.com/en/sql-reference/functions/ai_extract)
- [AI_PARSE_DOCUMENT](https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document)
- [Cortex AI Functions regional availability](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-regional-availability)
