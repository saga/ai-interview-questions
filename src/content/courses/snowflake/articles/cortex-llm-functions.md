# Cortex LLM 函数、模型选择与成本治理

## 本节要解决的问题

按任务本身的结构和输出要求选择 Cortex AI Function，而不是把所有文本问题都交给通用生成模型。需要区分专用任务函数、自由生成、向量表示和文档处理，并将模型选择、区域可用性、权限、token 成本和质量评测放进同一套上线流程。

## 核心知识

### 专用函数和 AI_COMPLETE 的职责不同

Cortex AI Functions 提供多种任务接口。典型选择方式如下：

- **AI_COMPLETE**：通用生成与复杂指令任务，可以生成文本或结构化输出；输入输出需要自行定义和验证。
- **AI_CLASSIFY / AI_FILTER**：按给定类别或条件执行分类、筛选，更适合重复、范围明确的标签任务。
- **AI_SUMMARIZE / AI_TRANSLATE / SENTIMENT 等**：面向摘要、翻译和情感判断等专用任务，接口语义更直接。
- **AI_EMBED / AI_SIMILARITY**：向量表示或相似度计算，服务于检索、去重和语义匹配，不是生成式问答。
- **AI_EXTRACT / AI_PARSE_DOCUMENT**：从文档或文件中提取文本、结构和字段；它们与普通文本生成有不同输入、费用和限制。

专用函数通常有更明确的输入输出约束，但并不代表业务结果天然正确。需要抽取复杂业务判断、解释证据或生成受约束文本时可以评估 AI_COMPLETE；简单分类和摘要则不必默认调用更大模型。

### 模型选型要同时看质量、延迟、费用和区域

AI_COMPLETE 可调用多个提供方和规模不同的模型。先用较强模型建立质量基线，再用更小、更低延迟或更低成本的模型对同一数据集进行对照。不要只按模型排行榜选型：短文本分类、高吞吐摘要、复杂推理和长文档分析的质量/成本曲线不同。

函数可用区域和具体模型可用区域并不相同。账户 Region 支持某个 AI Function，不等于所有模型都可在本地区执行；有些组合需要 Cross-region inference。模型生命周期也会变化，Legacy 模型可能只允许已有使用记录的账户继续调用，并会在 EOL 后停止服务。上线前应查询 SHOW CORTEX BASE MODELS 和 Model Availability，不要把文档中的模型列表复制进代码后长期不维护。

### 成本按不同函数的计量规则计算

对于 AI_COMPLETE、AI_CLASSIFY、AI_FILTER、AI_AGG、AI_TRANSLATE 等生成型函数，输入和输出 token 都可能计费；Embedding/Similarity 类函数通常按输入 token 计费。AI_PARSE_DOCUMENT 按处理页数计费；AI_EXTRACT 计入响应格式、文档页面和输入输出 token。部分函数还会附加内部 Prompt，因此实际计量可能高于业务传入文本本身。

Account Usage 可用于追踪查询中的 AI 函数使用情况，并按模型汇总用量；但通过 REST API 发出的请求可能无法获得同样粒度的 Query Usage 信息。必须同时保留应用侧请求量、输入大小、模型、提示版本、重试次数和响应状态，才能解释真实成本。

## 工程实施步骤

1. **先定义任务。** 写明输入数据类型、输出结构、失败处理、敏感字段、最大输入规模和可接受人工复核率。
2. **选择最窄的接口。** 有明确类别时优先评估 AI_CLASSIFY；需要通用解释或复杂生成时评估 AI_COMPLETE；需要语义向量时选 AI_EMBED；文档字段提取评估 AI_EXTRACT。
3. **建立模型基线。** 使用覆盖常见、边界、歧义和异常输入的固定样本，记录模型、函数、提示/Schema 版本和评测结果。
4. **检查模型可用性。** 在目标账户执行 SHOW CORTEX BASE MODELS IN SCHEMA SNOWFLAKE.MODELS，核对 release stage、跨区域范围和 EOL；确认每个目标区域可用。
5. **明确访问权限。** 为执行角色授予所需 Cortex 使用角色和数据对象权限；不要通过扩大表权限来解决模型访问授权问题。
6. **强制校验输出。** 对 JSON/Schema 检查字段完整性和类型；对业务结果检查范围、引用证据、数值约束和一致性；低置信和异常样本进入人工队列。
7. **估算单位成本。** 用代表性数据测量输入/输出 token、页面数、平均重试次数和每千条业务记录成本，而不只是估算输入字符数。
8. **分层记录用量。** 为每个应用/任务设置稳定 Query Tag 或请求标识，保留模型、函数、token 规模、状态、响应时间和业务结果。
9. **灰度发布模型升级。** 对固定评测集进行回归，比较正确率、结构有效率、延迟和单位成本；未达到质量门槛时保留旧模型或增加人工复核。
10. **定期检查模型生命周期。** 监控 Legacy/EOL 公告和目标区域变化，提前替换旧模型，不在运行时临时猜测替代模型。

示例：通用生成与专用分类分别处理。

~~~sql
SELECT AI_COMPLETE(
  'model-name',
  '从以下文本提取客户提出的主要问题，并用两句话概括：' || REVIEW_TEXT
) AS SUMMARY
FROM RAW.CUSTOMER_REVIEWS;

SELECT AI_CLASSIFY(
  REVIEW_TEXT,
  ['billing', 'delivery', 'product_quality', 'other']
) AS CATEGORY
FROM RAW.CUSTOMER_REVIEWS;
~~~

示例仅展示函数选型方式；具体参数结构、模型名和输出格式必须以目标账户当前函数参考与模型可用列表为准。

## 场景分析

客服团队每月处理数百万条用户反馈，需要生成摘要、分类路由，并对少量复杂投诉给出建议。若全部使用同一个大模型执行所有步骤，成本和延迟都可能不稳定。

先用 AI_CLASSIFY 处理已定义的投诉类别，用 AI_SUMMARIZE 或 AI_COMPLETE 处理不同长度的摘要，再将少数复杂投诉路由到更强的模型生成建议。每一步都保留原文、输出、模型版本和规则结果；涉及退款或账户变更的建议不能直接当作已批准动作。

验收应对比类别 Macro-F1、摘要事实错误率、结构合法率、复杂样本人工复核率、p95 延迟和每千条反馈成本。模型变更后必须使用同一批固定样本复测，并确认日本、美国或其他部署 Region 的模型可用性。

## 常见误区

- **所有任务都调用 AI_COMPLETE。** 任务专用函数通常有更明确的输入输出语义，适合固定分类、筛选或摘要。
- **把 JSON 可解析当作结果正确。** 结构合法不证明字段内容、业务规则和来源证据正确。
- **按模型名称固定部署而不监控生命周期。** 模型区域、Legacy 状态和 EOL 日期会变动。
- **认为函数在目标 Region 可用就代表指定模型可用。** Function Availability 和 Model Availability 是两个检查点。
- **只按输入文本长度估算成本。** 输出 token、内部提示、页面处理和重试也会影响计费。
- **只测一次 Demo。** 需要固定样本、边界案例和生产流量对照，持续监控质量、延迟和单位成本。

## 完成标准

- [ ] 能根据分类、生成、Embedding 和文档提取选择不同函数。
- [ ] 能说明 AI_COMPLETE 与专用 Cortex AI Functions 的适用边界。
- [ ] 能检查目标函数、模型和 Region 的可用性及生命周期。
- [ ] 能解释不同函数的 token 或页面计费口径。
- [ ] 能建立模型质量、结构合法性、延迟和单位成本的回归评测。

## 自测

1. 一个任务只需将客服工单分到 6 个固定类别，为什么不应默认使用通用大模型自由生成？
2. AI_COMPLETE 返回可解析的 JSON，但金额字段与原始文本不一致，为什么 Schema 校验不够？
3. 目标账户可以运行 AI_COMPLETE，但指定模型调用失败，应该分别检查哪些可用性信息？
4. AI_PARSE_DOCUMENT 和 AI_EXTRACT 为什么不能按 AI_COMPLETE 的 token 口径简单估算总成本？
5. 模型升级后摘要质量提高但单位成本翻倍，应该用哪些指标决定是否推广？

## 参考资料

- [Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/llm-functions)
- [Models and regional availability for Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-regional-availability)
- [Model availability for Snowflake Cortex AI](https://docs.snowflake.com/en/user-guide/snowflake-cortex/model-availability)
- [Cost considerations for Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-cost)
