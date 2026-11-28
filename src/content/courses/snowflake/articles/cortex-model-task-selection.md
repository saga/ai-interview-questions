# Cortex 任务型函数与通用模型调用选型

## 本节要解决的问题

客服团队要处理三类数据：
- 10 万条工单要分配到退款、物流、账户和其他四个队列；
- 5,000 份邮件要提取订单号、金额和请求动作；
- 每周给主管生成一份客户反馈摘要。

三类任务都涉及文本，但不应该默认使用同一个模型函数。工单类别是有限集合，字段提取有固定输出结构，周报则需要组织成一段可读文字。若全部用 AI_COMPLETE，调用者要自己维护类别、JSON 格式和错误检查；若全部用专用函数，又无法替代真正需要自由生成的报告。

选型应先看任务能否被明确描述为分类、过滤、抽取、解析、情感、向量相似度或跨行聚合，再决定是否需要通用生成。模型参数量和单价不是第一判断条件；真正重要的是错误代价、输出契约、可验证程度、区域与权限边界，以及处理规模。

## 先判断是否真的需要生成式模型

### 可以确定性计算的任务，不要交给模型猜

如果问题是“订单金额是否大于 10,000 日元”“日期是否在有效期内”“订单状态是否为 CANCELLED”，优先使用 SQL 和业务规则。若输入字段已经结构化，模型调用会增加成本和不确定性，却没有提供额外能力。

如果输入是自然语言，例如客户写“我不想要这笔订单了，请退回款项”，需要理解语义才能判定是否属于退款请求，这时才考虑任务型 AI Function。

一个有用的判断顺序：

| 问题 | 优先选择 | 原因 |
|---|---|---|
| 条件已结构化，规则明确 | SQL / CASE / 规则表 | 确定、可测试、成本低 |
| 在一组预定义标签中选择 | AI_CLASSIFY | 类别集合和返回值有约束 |
| 判断自然语言是否满足一个条件 | AI_FILTER | 输出是布尔值 |
| 按字段契约从文本中提取值 | AI_EXTRACT | 输出结构受 Schema 约束 |
| 从 PDF/图片获取文字和版面 | AI_PARSE_DOCUMENT | 先处理文档结构 |
| 写摘要、改写、解释或生成回复 | AI_COMPLETE | 需要开放式语言生成 |
| 识别情绪或方面情绪 | AI_SENTIMENT / ENTITY_SENTIMENT | 任务本身是情绪分类 |
| 对大量文本跨行归纳 | AI_AGG / AI_SUMMARIZE_AGG | 需要跨行主题和聚合结果 |
| 计算语义表示或相似度 | AI_EMBED / AI_SIMILARITY | 后续需要向量检索或相似度判断 |

这里不是“专用函数永远比通用函数好”。专用函数减少了输出空间，通常更容易设定验收；但如果任务需要多段文字组织、复杂解释或用户指定格式，AI_COMPLETE 可能更合适。

### 先选函数，再选模型

AI_COMPLETE 是通用生成函数，允许选择支持的模型并控制生成参数。AI_CLASSIFY、AI_FILTER、AI_EXTRACT 和 AI_PARSE_DOCUMENT 则按任务定义输入与输出。不要把“模型名称”当作整个选型过程的起点。

例如，工单路由只允许四种类别时，可以使用 AI_CLASSIFY；若只是判断“是否包含退款申请”，AI_FILTER 更直接；若希望输出订单号和金额，则使用 AI_EXTRACT；如果最终还要写一段客服回复，才使用 AI_COMPLETE。

不要用一个 AI_COMPLETE Prompt 同时完成分类、抽取、情绪判断和回复生成，再从长段文字里用正则表达式拆出结果。把不同任务分开，能让失败定位、权限和评测更加明确。

## 有明确输出契约的任务优先选专用函数

### 分类任务：标签集合由业务定义

假设工单只允许退款、物流、账户和其他四个队列。调用 AI_CLASSIFY 时，应保证标签不互相冲突，描述能区分相似类别：

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
    {'output_mode': 'single'}
  ):labels[0]::VARCHAR AS queue_name
FROM SUPPORT.TICKETS;
~~~

如果“紧急”是独立维度，不应把它与“退款”放在同一个标签集合里。应考虑单独分类或规则字段。模型返回 NULL 也不能默认为“其他”，必须区分调用失败、无结果和正常类别。

当类别数量很大、标签定义重叠或错误分流代价高时，应先收敛标签体系，并在固定样本集上测量混淆矩阵、类别召回和误分代价。模型可以给出建议类别，但关键业务队列可要求人工复核或规则二次判定。

### 条件判断：布尔输出不等于风险评分

AI_FILTER 适合“这段文本是否包含退款要求？”这类自然语言条件。其输出是 TRUE/FALSE，不会自动给出置信度、风险等级或详细原因。

若实际业务需要三档风险、多个主题标签或解释，应选择 AI_CLASSIFY 或其他有结构的方案，而不是把 TRUE 解释成“高风险”。对低置信、复杂或可能影响客户权益的结果，要进入人工复核。

### 字段抽取：先定义字段，再验证数值和实体

AI_EXTRACT 可以从邮件中抽取订单号、金额和请求动作。字段可以附带自然语言描述，也可以使用支持的 Schema 约束输出结构。提取出的金额仍可能是字符串；必须再转换成 NUMBER，校验币种、精度、允许范围，并与订单主数据比对。

例如，客户写“订单 JP-82013 的退款金额 12,800 日元尚未到账”。模型可能正确提取订单号和金额，却把退款金额理解为客户声称的金额，而不是支付系统实际已退金额。字段来源必须在语义上区分“客户提出的金额”和“交易系统确认金额”。

需要引用时，还要保存引用对应的文件版本、页码或文本偏移量。分数可以帮助排序复核优先级，但不能当成统计正确概率。

### 文档解析：先还原内容结构，再做字段抽取

PDF、扫描件和表格通常需要先解析版面。AI_PARSE_DOCUMENT 提供 LAYOUT、OCR 和 AGENTIC 等模式：
- LAYOUT 更适合保留标题、段落、表格结构；
- OCR 针对扫描图像中的文本识别；
- AGENTIC（Preview）可针对复杂视觉元素选择更丰富的处理方式，但需要接受 Preview 的行为边界和返回格式检查。

解析结果不是已经核实的业务事实。发票金额仍要和订单、税率及财务规则核对；合同条款要记录页码和修订版本。对于高影响字段，不要因为解析置信分数看起来高就直接写入账务系统。

## 只有需要开放式语言输出时才使用 AI_COMPLETE

### 生成内容需要更严格的输出校验

AI_COMPLETE 适合摘要、解释、改写、客服回复和内容生成。使用时要给出上下文、任务目的、不可编造的约束和输出格式。

如果要求输出 JSON，还需要在 SQL 或应用层解析 JSON，检查：
- 必填字段是否存在；
- 字段类型与枚举值是否正确；
- 金额、日期和实体是否与来源数据一致；
- 是否包含提示中没有提供的事实；
- 是否泄露不应展示的内部备注或个人信息。

结构合法不等于内容正确。对金额、客户身份、退款状态等字段，必须用权威结构化数据核验，不能让生成文本成为新的事实来源。

### AI_COMPLETE 的模型参数不会替代业务验收

temperature、top_p、max_tokens、guardrails 和 response_format 控制生成方式或格式约束，但不保证内容符合业务口径。低 temperature 可能降低随机性，仍无法保证 SQL 指标或财务数字正确。

如果多行 SQL 中某一行的模型调用返回 NULL，应用应将其标记为调用失败或待重试。不能把 NULL 当成“文本中没有信息”，也不应在没有检查失败状态的情况下继续发布报告。

### 注意函数命名和兼容性

新实现应优先使用 AI_COMPLETE。旧的 SNOWFLAKE.CORTEX.COMPLETE 函数仍为向后兼容而保留，Snowflake 当前文档说明其将在 2026 年底前弃用。旧代码需要列入迁移计划，而不是继续把旧函数作为新项目示例。

## 固定测试集：不能只看一个演示样本

### 根据错误代价定义质量指标

不同任务要衡量不同的错误：
- 分类：每类 Precision、Recall、Confusion Matrix，重点看错误路由代价；
- 布尔过滤：False Positive 与 False Negative 的成本；
- 字段抽取：字段级准确率、缺失率、格式有效率和实体匹配率；
- 文档解析：关键页/表格字段覆盖率、引用定位正确率；
- 开放式生成：事实一致性、引用忠实度、拒答边界和人工评分；
- 批量聚合：覆盖范围、样本代表性、主题稳定性和输入行数。

不能把“平均准确率 95%”当成所有任务都合格。对于退款金额抽取，少量错误也可能造成财务损失；对于一般周报摘要，轻微措辞差异通常影响较低。阈值应由业务错误代价确定。

### 测试集要包含正常、边界和失败样本

至少覆盖：
- 正常样本与常见表达；
- 同义表达、拼写错误和多语言；
- 字段缺失或互相矛盾；
- 长文本、截断和复杂表格；
- 扫描质量差和非目标格式；
- 低频类别和稀有实体；
- 不应回答或超出业务范围的输入；
- 模型/函数调用失败、NULL 和权限不足。

同一批测试样本应固定，并记录输入版本、Prompt/Schema 版本、模型、区域、Query ID、延迟和费用。输入分布变化后，需要新增样本，而不是不断调提示词直到旧样本全部通过。

## 权限、区域和模型可用性要纳入部署检查

调用 Cortex AI Functions 需要账户级 USE AI FUNCTIONS 或单函数 USE AI FUNCTION 权限，以及 CORTEX_USER 或 AI_FUNCTIONS_USER 数据库角色。若只需要某几种函数，可以撤销 PUBLIC 上的宽泛授权，再把单函数权限授予专用 Role；模型访问控制还需单独检查。

AI Functions 的可用性还会受到：
- Snowflake Region 和跨区域推理配置；
- 所选模型生命周期和弃用状态；
- 输入类型（文本、图像、文档、音频）；
- 特定函数的 Preview/正式可用状态；
- Model RBAC 或历史 allow-list 配置；
- 账户/Role 权限的影响。

SHOW CORTEX BASE MODELS 可以帮助发现模型信息，但不是对某个函数、输入类型和当前 Role 的最终调用保证。应在目标账户、目标 Region 和运行 Role 下做一次真实探测。

## 选型流程

1. 先确认任务是否能用确定性 SQL 或规则解决；能解决就不要调用模型。
2. 将任务归类为分类、布尔过滤、字段抽取、文档解析、情感、向量、聚合或开放式生成。
3. 优先选择输出契约与任务一致的专用函数；只有需要自由文本生成时才使用 AI_COMPLETE。
4. 对抽取/生成结果执行 Schema、类型、范围、实体、来源和业务规则验证。
5. 按错误代价设计固定测试集和质量门槛，不只看单条演示。
6. 对低置信、缺失字段、格式错误和调用 NULL 设置重试、回退或人工复核。
7. 核对 USE AI FUNCTIONS 或 per-function grant、数据库角色、模型 RBAC 和区域可用性。
8. 测量输入/输出 Token、文档页数、模型费用、Warehouse 时间和重复执行成本。
9. 记录函数、模型、Prompt/Schema 版本和评测结果；变更后重跑回归集。

## 场景分析

客服工单包括退款、物流、账户和其他四类。团队需要自动分流，提取订单号与客户请求，并每周生成反馈摘要。

分流使用 AI_CLASSIFY，退款请求的布尔过滤可用 AI_FILTER，邮件中的订单号和客户要求可用 AI_EXTRACT。若输入包含扫描发票，先用 AI_PARSE_DOCUMENT 获取文本和表格，再提取字段。周报摘要可使用 AI_COMPLETE 或跨行汇总函数，视报告需要逐行摘要还是整体洞察决定。

系统将订单号与订单主表匹配，将退款金额和币种与支付系统核对。若 AI_EXTRACT 返回的金额无法转换、订单不存在或字段含义不清，工单进入人工复核；只有经过校验的状态才用于生成客户回复。AI_COMPLETE 不得自行承诺到账时间，也不能将客户提出的金额写成已实际退款金额。

## 常见误区

- **所有任务都用 AI_COMPLETE。** 任务型函数有更明确的输入输出契约，能减少提示词和解析代码。
- **为了使用模型而忽略 SQL 规则。** 已结构化的状态、金额和日期判断应优先使用确定性逻辑。
- **认为专用函数不需要业务校验。** 类别、字段和解析结果仍可能错，必须对照真实来源。
- **把 JSON 格式正确当作字段语义正确。** Schema 只约束结构，不保证提取事实无误。
- **用一个平均准确率代表所有任务。** 质量阈值应按错误代价和类别分布分别设置。
- **忽略 NULL、权限和区域错误。** 调用失败不能伪装成“没有内容”或正常类别。
- **选择已弃用的 COMPLETE 作为新项目接口。** 新实现使用 AI_COMPLETE，并为旧代码安排迁移。
- **根据 SHOW 模型清单就认为实际调用一定可用。** 应在目标 Region 和 Role 下执行真实探测。

## 完成标准

- [ ] 能判断哪些任务应使用 SQL/规则，哪些需要 AI Function。
- [ ] 能比较 AI_CLASSIFY、AI_FILTER、AI_EXTRACT、AI_PARSE_DOCUMENT 和 AI_COMPLETE 的输出契约。
- [ ] 能按错误代价设计任务级测试指标。
- [ ] 能解释结构合法与语义正确的差异。
- [ ] 能处理低置信、NULL、字段缺失和权限/区域调用失败。
- [ ] 能检查 USE AI FUNCTIONS、单函数权限、数据库角色和 Model RBAC。
- [ ] 能评估输入/输出规模、成本、延迟和重复执行。
- [ ] 能说明旧 COMPLETE 函数的兼容和弃用边界。

## 自测

1. 一张订单金额是否超过 10,000 日元，为什么优先用 SQL 而不是 AI_FILTER？
2. 从四类队列中选择一个标签，与判断是否含退款申请，为什么应分别考虑 AI_CLASSIFY 和 AI_FILTER？
3. AI_EXTRACT 返回合法 JSON，但订单号在订单主表不存在。这个输出是否可以入库？还要验证什么？
4. 同一批工单每天重复执行 AI_COMPLETE，会产生什么费用和版本风险？如何减少不必要的重复推理？
5. 周报要求对所有文本生成可读摘要，和要识别每一行的退款类别，两者对 AI_COMPLETE/AI_CLASSIFY 的选择有什么区别？
6. 某函数在当前 Region 不支持图像输入。即使模型访问权限已授予，调用是否一定成功？应在哪个环境做探测？
7. 为什么 AI_COMPLETE 返回的 JSON 结构正确，仍不能直接更新退款账务状态？

## 参考资料

- [Cortex AI Functions overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql)
- [Privileges and model access for Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-privileges-and-access)
- [AI_COMPLETE](https://docs.snowflake.com/en/sql-reference/functions/ai_complete)
- [Models and regional availability](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-regional-availability)
- [COMPLETE (legacy function)](https://docs.snowflake.com/en/sql-reference/functions/complete-snowflake-cortex)
