# Snowpark、Notebooks、Streamlit、Cortex 与 Snowflake ML：先选对工具

## 本节要解决的问题

一个团队准备做客户流失分析。数据工程师要清洗订单和客户数据，数据科学家要探索特征并训练模型，业务团队要查看风险客户名单，客服还希望用自然语言查询客户反馈和内部政策。

这些工作都发生在 Snowflake 数据平台内，但并不意味着应该全部放进同一种工具。Snowpark 是程序化数据处理 API；Notebooks 是交互式开发环境；Streamlit 用来构建业务应用界面；Cortex 提供托管 AI 能力；Snowflake ML 管理自定义机器学习工作流。它们有交集，却解决不同层次的问题。

选型时要先问清楚：要处理数据、开发实验、交付应用、调用通用 AI，还是训练并运营自己的模型？如果把这些层次混为一谈，通常会把开发环境当成生产运行时，或用生成式 AI 做本来可以确定性计算的业务逻辑。

## 这五类能力各自解决什么问题

| 能力 | 主要职责 | 典型使用者 | 适合的工作 |
|---|---|---|---|
| Snowpark | 用 Python、Java 或 Scala 程序化处理 Snowflake 数据 | 数据工程师、开发者 | 复杂 DataFrame 转换、UDF/Stored Procedure、程序化管道 |
| Snowflake Notebooks | 在 Snowsight 中交互式编写和运行 SQL、Python、Markdown | 数据工程师、分析师、数据科学家 | 数据探索、实验、模型开发、可视化和协作 |
| Streamlit in Snowflake | 构建、部署和分享 Python 数据应用 | 应用开发者、业务团队 | 查询界面、运营工具、交互式看板、模型结果展示 |
| Cortex | 调用 Snowflake 托管的生成式 AI、搜索、语义问数和 Agent 能力 | 应用开发者、分析师 | 文本/文档处理、RAG、自然语言问数、工具编排 |
| Snowflake ML | 管理自定义 ML 的特征、训练、实验、部署、监控和血缘 | 数据科学家、ML 工程师 | 监督学习、预测模型、特征工程、模型服务和漂移监控 |

这里的层次很重要：Notebook 是开发界面，不是 Snowpark 的替代品；Streamlit 是应用交互层，不是模型训练框架；Cortex 的托管模型和 AI Functions 不等于团队自己的 Snowflake ML 模型。

## Snowpark：需要程序化处理时使用

Snowpark 提供 Python、Java 和 Scala 库，让开发者以熟悉的语言编写数据处理逻辑，并在 Snowflake 的计算引擎上处理数据，不必先把完整数据集下载到应用所在机器。

当 SQL 已经足够表达转换时，不必为了使用 Python 而引入 Snowpark。Snowpark 更适合：
- 需要复用程序代码或封装复杂转换逻辑；
- 需要编写 UDF、Stored Procedure 或更复杂的数据处理流程；
- 需要通过 DataFrame API 组合过滤、Join、聚合和窗口处理；
- 需要将 Python/Java/Scala 代码与 Snowflake 数据和权限体系结合。

例如，订单明细需要按客户聚合净销售额：

~~~python
from snowflake.snowpark.functions import col, sum as sum_

orders = session.table("SALES_DB.MART.ORDER_LINES")

customer_sales = (
    orders
    .filter(col("ORDER_STATUS") != "CANCELLED")
    .group_by("CUSTOMER_ID")
    .agg(sum_(col("NET_AMOUNT")).alias("NET_SALES"))
)

customer_sales.write.mode("overwrite").save_as_table(
    "ANALYTICS.WORK.CUSTOMER_SALES"
)
~~~

这个例子只展示 DataFrame 转换。执行前仍要确定过滤口径、订单/明细粒度、目标表覆盖策略和运行身份。mode("overwrite") 会替换目标数据，不应把它当成无副作用的预览操作。若只是一次简单汇总，直接 SQL 往往更直观。

## Notebooks：用于交互探索和实验

Snowflake Notebooks 提供 SQL、Python 和 Markdown 单元格，适合边观察数据、边调整代码和记录分析过程。它可以用来：
- 检查原始表的数据分布和缺失值；
- 试验 Snowpark 转换；
- 训练或评估机器学习模型；
- 生成图表和可视化；
- 记录实验假设、代码与结果。

Notebook 不等于一条正式生产管道。实验形成稳定逻辑后，应将可复用部分整理为版本化代码、Task、dbt 模型或 ML Job，并用测试与权限控制管理发布。

**当前 Notebook 产品名称有变化：** 原来的 Snowflake Notebooks 已更名为 Legacy Notebooks。Snowflake 正在将 Notebook 体验迁移到 Workspaces 中的新 Notebooks；新账户自 2026 年 4 月起不能新建 Legacy Notebooks。新项目应优先了解 Notebooks in Workspaces，不要按旧界面截图写新的团队操作手册。Legacy Notebooks 的现有功能和迁移时间应以 Snowflake 当前公告为准。

Notebook 有 Warehouse Runtime 和 Container Runtime 等执行环境，资源、依赖和系统包能力不同。选择前要核对目标环境需要的 Python 包、CPU/GPU、网络访问、成本和可复现要求。不要假设本地 Jupyter 中可运行的依赖，在每种 Snowflake Runtime 都能直接使用。

## Streamlit：将数据和模型结果交付给使用者

Streamlit in Snowflake 是托管在 Snowflake 上的 Python 应用开发和部署方式。它适合把数据查询、指标计算和模型结果包装成用户可操作的界面，例如：
- 组合经理按基金和估值日筛选持仓；
- 运营人员查看异常交易并进入调查流程；
- 客服主管查看工单分类和趋势；
- 分析师调整模型参数并查看评分结果。

Streamlit 不是 Notebook 的“发布按钮”。应用需要独立设计用户身份、Owner’s Rights/Caller’s Rights、数据权限、SQL 参数、缓存、导出和部署版本。页面隐藏某个筛选项不等于数据授权；应用运行时权限可能决定用户实际能访问的记录。

如果界面只是个人分析和实验，Notebook 通常更轻；如果要让多个业务角色持续使用，有明确的交互流程、授权边界和发布责任，才值得做成 Streamlit 应用。

## Cortex：使用托管 AI 能力，不必自己管理每个模型服务

Cortex 包含不同类型的 AI 能力，不是一个单一模型接口：

| 能力 | 主要解决的问题 | 典型输入 |
|---|---|---|
| Cortex AI Functions | 文本/图像分类、抽取、总结、情感和生成 | SQL 中的文本、图像或 Stage 文件 |
| Cortex Search | 检索非结构化文档并返回相关片段 | 已索引的文档和查询文本 |
| Cortex Analyst | 将自然语言转换为基于 Semantic View 的结构化 SQL 查询 | 业务问题和语义定义 |
| Cortex Agents | 在一个请求中编排 Analyst、Search 和 Custom Tools 等工具 | 多步骤业务任务和工具配置 |

要判断是否需要 Cortex：
- 批量分类或从文本中抽取字段，先看对应的 AI Function；
- 对政策、合同或研究报告做检索问答，考虑 Cortex Search；
- 对结构化指标做自然语言问数，先定义 Semantic View，再看 Cortex Analyst；
- 一个问题必须组合结构化查询、文档检索和多步骤工具调用时，才考虑 Cortex Agents。

不要把 Cortex Search 的相似度结果当作权威业务事实；不要让 LLM 代替确定性 SQL 计算 NAV、余额或限额；也不要把 Cortex Agent 的工具规划权限当成业务审批权限。模型、函数和服务的区域可用性、Preview 状态和调用权限也需要单独核验。

## Snowflake ML：构建并运营自己的机器学习模型

当业务问题需要使用自定义数据训练和维护模型，例如预测客户流失、交易异常、需求量或信用风险时，Snowflake ML 提供面向完整模型生命周期的能力。

典型流程包括：
1. 通过 Snowpark 和受治理的数据准备特征；
2. 使用 Feature Store 定义和复用特征；
3. 在 Notebook 的 Container Runtime 或 Snowflake ML Jobs 中训练与评估模型；
4. 使用 Experiment Tracking 比较参数和训练结果；
5. 将模型登记到 Model Registry；
6. 通过模型推理接口或 Model Serving 提供预测；
7. 使用 ML Observability 监测性能和漂移；
8. 通过 ML Lineage 追踪数据、特征、数据集和模型之间的来源关系。

Snowflake ML 与 Cortex 并不冲突。Cortex AI Functions 适合调用托管模型完成通用文本/图像任务；Snowflake ML 适合团队用自己的特征和训练数据建立专用模型。模型注册或训练完成也不代表业务模型已经验收，仍要验证数据泄漏、样本外表现、阈值、模型漂移和决策风险。

## 如何组合，而不是在五个产品中选一个

客户流失分析可以组合使用多种能力：

1. Snowpark 处理订单、客户和交互数据，产出统一的客户特征；
2. Notebook 用于探索数据、验证假设和试验特征；
3. Snowflake ML 训练流失预测模型，记录实验并注册模型；
4. Streamlit 把客户风险分数、主要特征和复核状态展示给业务团队；
5. Cortex AI Functions 可以总结客户反馈文本，Cortex Search 可以检索产品政策或客服记录，为业务人员提供补充证据。

每一层都有自己的验收：
- Snowpark：数据粒度、转换正确性、执行成本；
- Notebook：实验可复现、依赖和权限可控；
- Snowflake ML：数据切分、样本外指标、模型版本和漂移监控；
- Streamlit：访问控制、参数校验、缓存和导出边界；
- Cortex：输入/输出契约、引用、区域与权限、错误处理。

不要为了“平台全覆盖”强行引入全部组件。若客户流失模型只由外部团队训练，Snowflake 只负责导入推理，也许只需要 Model Registry；若业务只需要一个 SQL 看板，Streamlit 和 Snowflake ML 都不是必需条件。

## 工程选型步骤

1. 把需求归为数据转换、交互实验、业务应用、托管 AI 或自定义 ML，不要从产品名开始选型。
2. 优先检查 SQL 是否能清楚、经济地完成数据处理；需要程序化逻辑时再引入 Snowpark。
3. 将探索性分析和生产执行分开；Notebook 里的临时单元格不能直接成为生产 SLA。
4. 需要用户交互界面时，才考虑 Streamlit，并设计应用身份、行列级授权、导出和缓存。
5. 通用语言/文档任务评估 Cortex；结构化自然语言问数需先有 Semantic View；复杂多工具任务再考虑 Agent。
6. 需要自定义训练、特征工程和模型运营时评估 Snowflake ML；明确训练、部署和监控责任。
7. 对每个组件核对 Runtime、版本、区域、包、权限和成本，避免将开发环境能力误认为生产环境能力。
8. 用真实工作负载验证端到端流程；确认数据结果、用户权限、延迟、成本和失败恢复后再发布。

## 常见误区

- **把 Snowpark 当作独立数据仓库。** Snowpark 是程序化开发 API，数据仍由 Snowflake 对象和执行环境管理。
- **把 Notebook 当成生产调度器。** Notebook 适合交互探索；稳定管道仍要有版本、执行身份、调度、测试和告警。
- **把 Streamlit 当成查询权限层。** 隐藏控件和页面过滤不能替代后端授权与数据策略。
- **把 Cortex 当成单一模型。** AI Functions、Search、Analyst 和 Agents 的输入、输出及用途不同。
- **把 Cortex 的通用模型调用等同于 Snowflake ML 模型训练。** 两者的定制程度和生命周期管理不同。
- **把 Feature Store、Model Registry 和 Model Serving 当成自动保证模型质量。** 它们提供管理能力，不代替样本外验证和业务审批。
- **按旧版 Legacy Notebook 的 UI 写新项目手册。** 新账户已经不能创建 Legacy Notebooks，应关注 Workspaces 中的新 Notebook 体验。
- **为显示技术栈丰富而把所有产品都组合起来。** 只选择能解决当前需求、且有人负责运维的组件。

## 完成标准

- [ ] 能区分 Snowpark API、Notebook 开发环境、Streamlit 应用、Cortex 托管 AI 和 Snowflake ML 生命周期能力。
- [ ] 能按 SQL 转换、程序化处理、实验、用户界面、AI 问答和自定义 ML 的实际需求做选型。
- [ ] 能说明 Notebook 新旧体验与 Runtime 的适用边界。
- [ ] 能说明 Streamlit 应用身份和数据授权不能只靠 UI 隐藏。
- [ ] 能区分 Cortex AI Functions、Search、Analyst 和 Agents。
- [ ] 能说明 Snowflake ML 的 Feature Store、Experiment、Model Registry、Serving、Observability 和 Lineage 在生命周期中的位置。
- [ ] 能设计一个只使用必要组件的端到端方案，并为每一层定义验收标准。

## 自测

1. 需要对数亿行订单数据做复杂的程序化转换，结果仍保留在 Snowflake。为什么可以考虑 Snowpark，而不是先把数据下载到应用服务器？
2. 数据科学家需要反复调整筛选、运行 SQL/Python 并记录分析结果。Notebook 与 Streamlit 哪个更合适？为什么？
3. 一个报表要供多个业务角色交互筛选和导出。为什么这不仅是“把 Notebook 分享出去”的问题？
4. 要从客户投诉文本里提取退款理由，与要从结构化订单数据中回答退款总金额，分别应考虑哪类 Cortex 能力？
5. 客户流失模型要使用团队自己的标签和特征训练，并持续监控漂移。为什么仅调用 Cortex AI_COMPLETE 不足以覆盖这个生命周期？
6. 当前账户已不能新建 Legacy Notebook。团队应怎样调整新项目的开发环境和操作手册？
7. 团队只需要 SQL 计算和简单看板。是否有必要同时部署 Snowpark、Notebook、Streamlit、Cortex 和 Snowflake ML？

## 参考资料

- [Snowpark API](https://docs.snowflake.com/en/developer-guide/snowpark)
- [Snowflake Notebooks: legacy and Workspaces migration](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks)
- [Develop and run code in Snowflake Notebooks](https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-develop-run)
- [About Streamlit in Snowflake](https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit)
- [Cortex AI Functions overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql)
- [Cortex Search overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [Cortex Analyst overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst)
- [Cortex Agents overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [Snowflake ML overview](https://docs.snowflake.com/en/developer-guide/snowflake-ml/overview)
