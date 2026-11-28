# Cortex Analyst、Semantic View 与 Text-to-SQL

## 本节要解决的问题

让用户用自然语言查询受治理的业务指标，并确保生成 SQL 遵循数据粒度、指标口径和访问权限。Cortex Analyst 并不代替业务建模：它依赖 Semantic View 或 Semantic Model 提供实体、关系和指标语义，生成 SQL 后仍需要结果验证和发布控制。

## 核心知识

### Semantic View 为 Text-to-SQL 提供业务定义

Semantic View 描述逻辑表、表间关系、Facts、Dimensions 和 Metrics。逻辑表将物理表/视图映射到业务实体；关系明确连接键与关系路径；Fact 表达行级业务属性；Metric 表达按指定规则计算的指标；Dimension 提供筛选、分组和分析上下文。

语义层解决的是“业务指标如何解释”，不是“如何修复底层数据”。如果物理表的 grain、主键、Join 基数或历史属性错误，Semantic View 不会自动修复。指标应清楚定义分子/分母、过滤条件、时间口径、可加性和业务 owner。

### Cortex Analyst 根据语义生成 SQL，并可能返回澄清问题

Cortex Analyst REST API 接收用户问题和 Semantic View/Semantic Model，返回一组内容块，可能包含解释文本、SQL 或建议问题。它可以支持多轮对话，但不是所有请求都直接返回 SQL；应用必须按响应 content.type 处理，而不是假定每次都存在 SQL 字段。

Analyst 生成 SQL 不代表应用必须立即执行。生产系统应检查 SQL 类型、目标对象、过滤范围、最大扫描规模和用户权限，再由受控的 Snowflake Session 执行。SQL 执行结果还要与业务指标和用户权限边界匹配。

### Verified Query Repository 与 Evaluations 形成质量闭环

Verified Query Repository 保存经人工验证的问题和对应 SQL，帮助 Analyst 处理相似问题。Verified Query 应使用 Semantic View 中定义的逻辑表和逻辑列，而不是直接引用底层物理对象。它们是可信样例和语义提示，不意味着所有相似问题都会完全复用该 SQL。

Cortex Analyst Evaluations 用 Verified Queries 作为 Ground Truth，执行生成 SQL 并将结果与预期查询结果比较，同时记录正确率、回归和延迟。被选中用于某次评测的 Verified Query 会从临时评测语义视图中移除，避免模型在评测时直接命中该样例，导致评估失真。

## 工程实施步骤

1. **先统一业务口径。** 让指标 Owner 确认实体、粒度、过滤条件、币种/时区、时间范围和可加性。
2. **建立物理模型映射。** 为 Semantic View 选择逻辑表，核实唯一键、关系基数和 Join 路径，先修复物理数据问题。
3. **定义 Semantic View。** 配置逻辑表、关系、Facts、Dimensions、Metrics、描述和同义词；多条关系路径必须有明确规则。
4. **维护 Verified Queries。** 按真实业务问题保存经确认的 SQL；验证查询结果、逻辑表/列名和权限边界。
5. **建立 API 应用。** 调用 Cortex Analyst REST API，处理 text、sql、suggestion 等响应类型和多轮消息；保留 request_id、语义对象版本和问题文本。
6. **控制 SQL 执行。** 对生成 SQL 进行静态检查和策略检查，使用最小权限 Role、允许的 Warehouse 和受控 Session 执行。
7. **比较结果证据。** 将执行结果与 Golden Dataset、已批准报表或业务对账值比较；对金额、计数、时间窗口和 Join 粒度做重点检查。
8. **运行 Evaluations。** 使用独立 Verified Query 子集建立基线，跟踪 SQL 正确率、回归和响应延迟；语义模型变更后重新运行。
9. **根据失败样本改进语义。** 优先修正错误关系、缺失指标定义、描述/同义词、过滤规则或 Verified Query，而不是只增加更长的 Prompt。
10. **评估应用形态。** 对新建的多工具和多步骤应用，评估使用 Cortex Agents 封装 Analyst、Search 和其它工具；现有独立 Analyst API 仍需妥善处理响应和 SQL 安全。

示例：以 Semantic View 作为请求的语义来源。

~~~json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "按月份比较本年度各地区的净收入"
        }
      ]
    }
  ],
  "semantic_view": "ANALYTICS.SALES.SALES_MODEL"
}
~~~

该请求只表示把业务问题交给 Analyst 生成解释或 SQL，不代表应用可以无条件执行返回语句。执行前仍需授权、SQL 检查和结果对账。

## 场景分析

财务和销售都询问“本月收入”，但财务按已付款订单计算，销售按已下单订单计算；另外订单头与订单明细存在一对多关系。单靠一个名为 revenue 的 Metric 会让问题更模糊。

先与业务确认需要 Paid Revenue 和 Booked Revenue 两个指标，并为退款、取消和日期维度分别定义口径。Semantic View 需要正确映射订单、支付和日期逻辑表，明确关系路径并避免订单头金额在明细 Join 后重复累计。然后建立覆盖地区、月份、退款和空值的 Verified Queries，使用 Evaluations 测试 SQL 是否保持语义。

应用执行生成 SQL 时，仍需限制用户可以访问的地区与对象；用户问题中的“全部地区”不能绕过其 Role 的行级数据策略。

## 常见误区

- **把 Semantic View 当作自然语言词典。** 它还需要逻辑表、关系、Facts、Dimensions 和 Metrics，缺少关系与指标定义就无法可靠生成 SQL。
- **用 Prompt 代替业务指标治理。** 指标公式和过滤条件应固化在语义模型，而不是让每次提问临时决定。
- **认为 Analyst 生成的 SQL 已经执行和验证。** API 可以返回 SQL 或建议，执行与结果校验由应用设计负责。
- **使用物理表列名编写 Verified Query。** Verified Query 应使用 Semantic View 的逻辑表和逻辑列。
- **把 Verified Query 数量当作准确率。** 需要通过独立评测数据集测量 SQL 执行结果和回归。
- **评测时让目标 Verified Query 参与生成。** 应按官方评测流程从临时语义视图移除被评估的样例，避免数据泄漏。

## 完成标准

- [ ] 能解释 Semantic View 的逻辑表、关系、Facts、Dimensions 和 Metrics。
- [ ] 能说明 Cortex Analyst 的输入、响应类型和 SQL 生成边界。
- [ ] 能设计 Verified Query 与独立 Evaluation 流程。
- [ ] 能对生成 SQL 实施权限、资源和结果语义校验。
- [ ] 能识别何时将 Analyst 作为独立 API 使用，何时交给 Cortex Agents 编排。

## 自测

1. 两个部门对“收入”采用不同口径，Semantic View 应如何表达，而不是强行共用一个 Metric？
2. Cortex Analyst 返回的内容块是 suggestion 而非 sql，应用应如何处理？
3. Verified Query 中为什么应使用逻辑表与逻辑列名？
4. 为什么被评测的 Verified Query 需要从临时语义视图中移除？
5. Analyst 返回 SQL 后，应用在执行前至少还应检查哪些权限和资源边界？

## 参考资料

- [Overview of Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Cortex Analyst REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api)
- [Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
- [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
- [Transition to Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
