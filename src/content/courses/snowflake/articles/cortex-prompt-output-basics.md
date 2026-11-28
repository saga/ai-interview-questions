# Prompt 输入与输出格式基础

## 本节要解决的问题

为 Cortex AI Functions 定义可复现的输入和输出契约，让模型明确任务、上下文、约束和返回格式。Prompt 能影响模型行为，但不能替代权限控制、事实校验或业务规则；结构化输出也只约束格式，不保证字段内容真实。

## 核心知识

### Prompt 应区分任务、上下文、证据和限制

一个实用 Prompt 至少要说明：要完成的任务、输入材料、需要依据的上下文、允许使用的信息、输出形式和禁止猜测的情况。对需要事实依据的任务，应明确要求模型只使用提供的资料，并在缺少证据时返回未知或拒答。

任务边界不清会导致模型自行补充假设。例如“总结客户问题并给出建议”没有说明是否能引用客户隐私、是否允许推测退款政策、建议是否会被直接执行。应将事实总结与行动建议分开，并为高风险动作增加确定性校验。

### 单字符串 Prompt 与 Prompt Object 的功能边界不同

AI_COMPLETE 可以接收单个字符串，也可以接收 Prompt Object。Prompt Object 可包含文本和一个或多个 FILE 对象，用于多模态输入；输入类型和文件限制取决于所选模型。对纯文本请求，字符串形式通常更直接。

Snowflake-hosted Cortex 模型使用 Prompt Object 时，不能传入 JSON Schema 来约束 Structured Output。需要由 Snowflake-hosted 模型返回 Schema 结构化结果时，应使用 AI_COMPLETE 的单字符串接口和 response_format。不要把两种调用形式的参数混用。

### response_format 约束结构，不验证业务语义

AI_COMPLETE 的 response_format 可以使用 JSON Schema 或受支持的 SQL Type Literal。Schema 可定义对象属性、类型和 required 字段。若必填字段无法抽取，调用可能报错；这比静默生成一个猜测值更容易发现问题。

Structured Outputs 仍有 Schema 支持边界，部分 JSON Schema 关键字和 SQL 类型不受支持。Schema 越复杂，也会增加输入 Token 量。返回的 JSON 即使符合 Schema，也可能包含错误金额、虚构日期或不正确的实体关系；应用仍要运行类型、业务范围、跨字段和来源校验。

### 模型参数控制输出分布，不是可靠性保证

Temperature、Top P、Max Tokens 和 Guardrails 等参数会改变生成行为。Temperature 较低通常使输出更稳定，但不保证每次结果完全相同，也不能让模型获取缺失的事实。若输出被截断，应该检查 Max Tokens 和上下文长度；若内容不安全，应结合 Guardrails 和应用侧审核。

## 工程实施步骤

1. 将任务描述拆成任务目标、输入材料、上下文证据、必须遵循的规则和输出契约。
2. 将可信资料与用户自由文本分开标记；明确哪些字段可从输入中抽取，哪些信息不允许推断。
3. 对纯文本使用字符串 Prompt；对需要文件或图像等多模态内容时再评估 Prompt Object，并核对模型输入类型支持。
4. 若需要固定 JSON，定义最小的 response_format Schema，设置必填字段和可接受的数据类型，不要加入不受支持的约束关键字。
5. 为无法判断的字段定义明确缺失表达方式；不要将未知值设置成看似真实的默认值。
6. 根据任务复杂度调节 Temperature、Max Tokens 和 Guardrails；固定评测参数，确保模型对比时具有可比性。
7. 对返回结果做 JSON/Type 校验，再做业务校验、来源校验和权限校验。
8. 对错误结构、缺失字段、截断响应、模型报错和拒答分别定义重试、降级或人工处理。
9. 在固定样本上比较 Prompt 版本，记录格式通过率、事实错误率、拒答率、延迟和 Token 成本。
10. 对生产 Prompt 进行版本控制，变更任务要求或 Schema 时执行回归测试。

示例：使用 JSON Schema 要求提取客服请求中的固定字段。

~~~sql
SELECT AI_COMPLETE(
  model => 'model-name',
  prompt => '从以下客服记录中提取订单号和问题类型。没有证据的字段不要猜测。记录：' || TICKET_TEXT,
  response_format => {
    'type': 'json',
    'schema': {
      'type': 'object',
      'properties': {
        'order_id': {'type': 'string'},
        'issue_type': {'type': 'string'},
        'evidence': {'type': 'string'}
      },
      'required': ['order_id', 'issue_type', 'evidence']
    }
  }
) AS EXTRACTED
FROM RAW.TICKETS;
~~~

该例只展示输出契约；生产环境还要处理必填字段抽取失败，并检查订单号是否真实存在、问题类型是否属于允许枚举、证据是否能在原文中找到。

## 场景分析

某应用要求模型把用户对话返回成 JSON，供后端自动创建售后工单。当前 Prompt 只写“请返回 JSON”，偶尔缺少订单号，偶尔会把用户没有提供的日期补全出来。

先定义 JSON Schema，并将 order_id、issue_type、evidence 等字段标为 required。再明确模型不得推测输入中未出现的日期，字段未知时应返回受控状态或触发校验失败。后端校验 JSON 结构后，使用订单系统验证 order_id；只有验证成功且符合权限要求，才允许创建工单。

验收使用缺失订单号、多个订单号、模糊日期、用户说“不知道”和恶意提示注入等样本。分别统计 Schema 通过率、事实错误率、人工复核率和每次请求成本。

## 常见误区

- **Prompt 越长就越可靠。** 与任务无关的说明会增加输入成本，重点是让目标、上下文和输出契约清晰。
- **要求 JSON 就可以不定义 Schema。** 需要稳定字段时应使用结构化输出机制并校验结果。
- **Schema 合法就代表内容真实。** 格式检查与业务、来源和权限检查必须分开。
- **在 Prompt Object 上直接传 JSON Schema。** Snowflake-hosted Cortex 模型的 Prompt Object 调用不支持该结构化输出参数路径。
- **Temperature=0 就保证结果永远一致。** 参数只能改变生成分布，不会消除输入和模型差异。
- **必填字段缺失就让模型自动补值。** 未知必须保持未知，必要时拒答或人工复核。

## 完成标准

- [ ] 能设计包含任务、上下文、证据和限制的 Prompt。
- [ ] 能区分 AI_COMPLETE 单字符串与 Prompt Object 输入。
- [ ] 能说明 response_format 的结构约束和不受支持的边界。
- [ ] 能区分格式合法与业务语义正确。
- [ ] 能制定缺失字段、截断、报错和拒答的处理策略。

## 自测

1. 需要向 AI_COMPLETE 传入文档 FILE 对象，同时要求 JSON Schema 结构化输出，为什么要先核对 Prompt Object 的参数限制？
2. JSON Schema 将 order_id 标为 required，若文档中不存在订单号可能发生什么？应用应该如何处理？
3. 模型返回符合 Schema 的订单号，但订单系统找不到该订单，说明哪类校验缺失？
4. Temperature 设置为 0，是否可以省略生产回归测试？为什么？
5. Schema 支持的关键字有限，如何避免复杂 Schema 在调用时直接报错？

## 参考资料

- [AI_COMPLETE single-string interface](https://docs.snowflake.com/en/sql-reference/functions/ai_complete-single-string)
- [AI_COMPLETE Prompt Object](https://docs.snowflake.com/en/sql-reference/functions/ai_complete-prompt-object)
- [AI_COMPLETE Structured Outputs](https://docs.snowflake.com/en/sql-reference/functions/ai_complete-structured-outputs)
- [Cortex AI Functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/llm-functions)
