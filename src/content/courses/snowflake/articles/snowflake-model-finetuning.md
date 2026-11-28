# Snowflake ML 与模型微调的适用边界

## 本节要解决的问题

判断一个业务问题是否真的需要训练或微调模型，并在 Prompt/RAG、Cortex AI Functions、Snowflake ML 和 Cortex Training 之间选择合适路径。最重要的不是“能否训练”，而是训练是否能解决当前错误类型、训练数据是否可靠、评估是否独立，以及训练和推理成本是否值得。

## 核心知识

### 先区分知识缺失、输出约束、任务行为和预测建模

不同问题不应统一用微调处理：

- **知识内容变化快、需要引用来源**：优先评估 Cortex Search/RAG，让模型根据当前文档回答。
- **输出结构和格式不稳定**：优先使用结构化输出、Schema 校验和确定性后处理。
- **固定类别、字段抽取或摘要任务**：先评估 AI_CLASSIFY、AI_EXTRACT、AI_SUMMARIZE 等专用函数。
- **模型需要持续执行特定风格或稳定任务行为**：在 Prompt/示例和评估足够后，再考虑监督微调。
- **结构化数据的分类、回归、排序或预测**：优先评估 Snowflake ML / Snowpark ML，而不是把传统预测问题包装成 LLM 微调。

微调可以改变模型的行为分布，但不会自动补全最新事实、解决检索权限或保证业务规则正确。若问题来源是数据过期、索引缺失、语义定义错误或 SQL 粒度错误，训练模型不是正确修复方向。

### Cortex Fine-tuning 将退役，Cortex Training 是新路线但仍处于 Preview

截至 2026-11-28，Snowflake Cortex Fine-tuning 仍标注为 GA，但官方已宣布计划于 **2027 年第一季度弃用**，并建议新的 LLM 微调需求使用 Cortex Training。已有 FINETUNE 作业需要评估迁移计划，不能把旧 API 当未来长期方案。

Cortex Training 于 2026-10-30 开放 Preview，需要启用，并目前面向商业 AWS Region。它提供 Serverless 训练后端，可从用户工作区驱动训练循环；Snowflake 承担 GPU 前后向计算、优化器步骤和生成。当前支持的方向包括 SFT 和 RL，支持 LoRA 或 full-parameter 训练，并能保存 checkpoint、恢复训练、对 checkpoint 推理以及部署 OpenAI-compatible endpoint。它支持 Python client 和部分开源训练框架集成，模型、API 和配置在 Preview 期间可能变化。

传统 Snowflake ML/Snowpark ML 仍适合结构化机器学习工作流：特征工程、训练/评估、模型注册、推理和部署。它与 Cortex Training 面向 LLM 定制的工作流不同，不应以“都是模型训练”混为一谈。

### 训练数据和评估设计决定微调是否有效

SFT 样本需要代表真实任务输入及目标输出，RL 需要明确可评价的奖励或任务信号。训练集和验证集不能简单随机拆分到可能共享同一客户、文档或时间段的样本，否则可能发生泄漏。需要按用户/实体、时间或业务来源分组切分。

评估必须与目标业务错误对应：例如分类的 Macro-F1、字段抽取的字段级准确率、回答的 groundedness 和拒答率、格式任务的 Schema 有效率。微调效果应与 Prompt/RAG 和专用函数基线比较；如更好的行为无法抵消训练费用、模型部署和推理成本，就没有采用价值。

## 工程实施步骤

1. 将失败样本分类为知识过期、检索缺失、指令歧义、格式不合规、模型行为不稳定或结构化预测错误。
2. 优先尝试文档更新/RAG、Prompt/示例、专用 AI Function、Schema 约束或传统 ML；只有模型行为本身是主要误差来源时才进入微调评估。
3. 定义训练数据契约、输入输出格式、业务敏感级别、数据授权、样本去重和保留策略。
4. 按用户、实体、时间或数据来源划分 Train/Validation/Test；确保同源文档、相似记录和同一业务主体不会无意跨集合泄漏。
5. 建立当前模型和非微调方案的基线，固定评估集、提示版本、推理参数和成本采样口径。
6. 对新项目评估 Cortex Training 的模型支持、Region、Enablement、SFT/RL 方式、LoRA/full-parameter 选项和客户端/框架兼容性；Preview 功能需接受 API 和模型列表可能变化。
7. 对已有 FINETUNE 作业盘点模型、训练数据、训练 Token、Epoch、推理接口和调用方，制定 Q1 2027 之前的迁移与并行验证计划。
8. 记录训练配置、数据版本、随机种子或框架配置、checkpoint、模型版本和推理端点，保证训练可追溯。
9. 在独立 Test 集和真实业务灰度流量中比较正确率、鲁棒性、拒答、延迟、Token/GPU 用量和单位业务成本。
10. 只有质量增益达到预设阈值且成本可接受时才部署；保留原模型、流量回退策略和旧版接口下线计划。

当前路线选择示例：

| 业务问题 | 优先方案 | 进入训练的条件 |
|---|---|---|
| 回答最新政策且要引用 | Cortex Search / RAG | 检索和内容均可靠后，仍有稳定回答行为缺陷 |
| 输出 JSON 经常漏字段 | 结构化输出、Schema 校验 | 格式控制仍无法满足且有稳定样本 |
| 结构化客户流失预测 | Snowflake ML / Snowpark ML | 需要训练预测模型，不是 LLM 微调 |
| 专业语气或固定任务行为不稳定 | Prompt/示例后评测微调 | 独立测试集显示行为改善且成本可接受 |

## 场景分析

客服模型经常把最新退款政策答错。团队收集过去一年的问答，准备直接微调一个模型。

先判断错误是不是知识陈旧：如果新政策发布后答案仍引用旧版本，应该先修复知识库、索引新鲜度和来源过滤。若模型能检索到正确政策却经常不按规定格式回答，可以先调整指令、输出 Schema 和结果校验。只有在固定任务行为仍有系统性缺陷，并且可以提供质量可靠、无泄漏的训练样本时，才评估 SFT。

若评估微调，基线至少包含 RAG+Prompt、专用 AI Function 和候选微调模型。当前新路线应评估 Cortex Training Preview，而不是为新系统继续依赖计划于 2027 年第一季度弃用的 Cortex Fine-tuning。验收比较政策事实正确率、引用正确率、拒答率、人工复核率、响应延迟和每千次请求总成本。

## 常见误区

- **模型答错事实就立即微调。** 先区分数据过期、检索问题、权限过滤和行为问题。
- **微调等于把知识写进模型后永不过期。** 训练数据有时间边界，新事实仍需检索或重新训练。
- **随机拆分相似样本就认为没有数据泄漏。** 同一客户、文档或时间窗口可能跨集合，必须按实体或时间检查。
- **用训练集指标作为泛化结果。** 需要独立 Test 集和生产灰度。
- **把 Cortex Fine-tuning 当长期新项目首选。** 官方已宣布 2027 Q1 弃用计划，新需求应评估 Cortex Training。
- **认为 Preview 的 Cortex Training 等同 GA 服务。** Region、启用条件、模型、API 和规格可能变化。
- **用更高训练成本换取无法测量的“回答更自然”。** 必须定义业务指标和单位请求成本。

## 完成标准

- [ ] 能区分 RAG、Prompt/结构约束、专用 Cortex Function、Snowflake ML 和 LLM 微调。
- [ ] 能判断当前错误是否属于需要训练的模型行为问题。
- [ ] 能说明 Cortex Fine-tuning 的弃用时间和 Cortex Training 的 Preview 边界。
- [ ] 能设计避免实体/时间泄漏的训练、验证和测试集。
- [ ] 能用独立评估和单位业务成本判断微调收益。

## 自测

1. 模型引用了过期退款政策，但正确文档已经在企业知识库中，为什么应该先检查 RAG/索引，而不是微调？
2. 预测客户流失率应优先考虑 Snowflake ML 还是 Cortex Training？依据是什么？
3. 训练集与测试集包含同一客户的不同月份记录，会造成什么风险？应如何切分？
4. 截至 2026-11-28，Snowflake Cortex Fine-tuning 的弃用计划是什么？新 LLM 微调项目应评估哪项服务？
5. Cortex Training 仍处于 Preview，设计生产路线时需要对哪些依赖保留替代方案？

## 参考资料

- [Cortex Fine-tuning](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-finetuning)
- [Cortex Training](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-training)
- [Cortex Training Preview release notes, October 30 2026](https://docs.snowflake.com/en/release-notes/2026/other/2026-10-30-cortex-training-preview)
- [Snowflake ML](https://docs.snowflake.com/en/developer-guide/snowpark-ml/index)
- [Snowflake Model Registry](https://docs.snowflake.com/en/developer-guide/snowpark-ml/model-registry/overview)
