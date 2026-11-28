# Snowflake Model Registry 与模型生命周期

## 本节要解决的问题

欺诈检测模型 v12 的离线 F1 提升了 3 个百分点。数据科学团队把模型文件放进内部 Stage，通知服务团队替换线上文件。几天后，线上误报率上升，团队却无法确认服务实际加载的是哪个文件、使用了哪版依赖，也无法快速切回上一版模型。

Model Registry 要解决的首先是模型资产管理：把模型、版本、方法、依赖和评估信息作为 Snowflake 对象记录下来，提供可追溯的版本引用和受控推理入口。它不会替你决定哪个模型应该上线，也不会因为模型已经注册就自动完成生产验收。

## 核心知识

### Registry 管理模型对象，Version 固定一次模型产物

Model Registry 使用 Snowflake Schema 保存模型对象。一个模型可以有多个版本，每个版本有自己的模型文件、方法签名、依赖和元数据。

典型结构：

| 对象 | 例子 | 解决的问题 |
|---|---|---|
| Model | FRAUD_SCORER | 表示一个业务模型资产 |
| Model Version | v11、v12 | 固定模型实现和运行依赖 |
| Method | predict | 定义可调用的推理方法 |
| Metrics | f1、precision、recall、confusion_matrix | 记录该版本的评估结果 |
| Comment / Tags | 训练数据版本、负责人、发布阶段 | 记录模型治理元数据 |

Model Registry Python API 面向 Snowflake ML 生态中的 Python 模型对象。Snowflake ML Functions（例如 SQL FORECAST）不在这个 Registry API 的模型管理范围内；部分 Cortex fine-tuned model 虽可能显示在 Snowsight UI，也不等于由该 API 管理。

### 把模型和它的运行依赖一起记录

注册模型时，Snowflake 会序列化 Python 模型对象并创建 Model Version。样例输入可以用于推断方法签名，依赖列表用于构建模型的执行环境：

~~~python
from snowflake.ml.registry import Registry
from snowflake.ml.model import task

registry = Registry(
    session=session,
    database_name="ML",
    schema_name="REGISTRY",
)

model_version = registry.log_model(
    fraud_classifier,
    model_name="FRAUD_SCORER",
    version_name="v12",
    conda_dependencies=["scikit-learn"],
    comment="Fraud classifier trained on the November snapshot",
    metrics={"f1": 0.91, "precision": 0.88, "recall": 0.94},
    sample_input_data=training_features,
    task=task.Task.TABULAR_BINARY_CLASSIFICATION,
)
~~~

上例中的数值仅为演示格式，不代表真实模型评估结果。生产记录还应明确训练数据快照、特征定义版本、代码提交、评估集版本和依赖锁定信息。只存一个 F1 数值无法让别人重建模型为什么得到这个结果。

同名模型可以注册多个不同 version_name。名称与版本组合在同一 Schema 中必须唯一；新增模型版本不会自动替换旧版本。

### 版本指标和别名用于评估与引用，不代表发布审批

Model Version 可以保存测试准确率、F1、混淆矩阵和评估数据集标识等 JSON 可序列化指标：

~~~python
model_version.set_metric(
    "evaluation",
    {
        "dataset": "fraud_holdout_2026_11",
        "f1": 0.91,
        "precision": 0.88,
        "recall": 0.94,
    },
)
~~~

团队可以用 show_metrics() 查看结果，用 show_versions() 检查模型有哪些版本。Model 的 default 属性可以切换默认版本；版本别名也可以用来提供更稳定的引用名。

这些功能只是版本定位机制，不是审批流程。把 default 从 v11 改为 v12，不会自动证明 v12 已通过安全、偏差、延迟、成本和业务验收。正式切换前应在独立评估集上比较新旧版本，并由模型 owner 和业务 owner 完成必要审批。

### 推理调用和部署运行环境是两种选择

Model Version 的方法可以在 Warehouse 中执行。Python API 通过 mv.run 调用模型方法，输入可以是 Snowpark DataFrame 或 pandas DataFrame：

~~~python
model = registry.get_model("FRAUD_SCORER")
candidate = model.version("v12")

predictions = candidate.run(
    scoring_features,
    function_name="predict",
)
predictions.show()
~~~

这里的 Warehouse 是实际执行模型方法的计算环境。模型是否能在 Warehouse 上运行，取决于模型类型、依赖、资源和目标平台配置。较大模型、GPU 需求或特定依赖可能需要 Snowpark Container Services（SPCS）；Model Registry 提供模型资产和版本引用，SPCS 则提供容器化服务运行环境。

不要将“模型已在 Registry 中”理解为“推理 API 已经部署并对外开放”。Warehouse 推理、SPCS 在线服务、批量推理和外部 API 的部署方式、网络入口、扩缩容和成本模型都不相同。

### Registry 权限要区分注册、推理和查看元数据

在 Schema 中创建模型需要拥有该 Schema 或具备 CREATE MODEL 权限。使用模型则需要所有权或相应权限：

- USAGE：允许使用模型进行 Warehouse 推理，但不允许查看模型内部信息。
- READ：允许用于 SPCS 推理，并查看模型元数据，例如注释、标签和指标。

这意味着把模型用于线上推理的服务角色，不一定需要拥有模型文件或读取模型元数据的权限。应按部署方式授予最小权限，并分别测试 Warehouse 与 SPCS 的访问路径。

## 工程实施步骤

1. 为模型确定稳定名称和专用 Registry Schema，约定 owner、版本命名、生命周期状态和清理规则。
2. 在训练流水线中记录训练数据快照、特征版本、代码提交、依赖和评估集版本。
3. 用 Registry.log_model 注册一个不可变的候选版本，明确 sample_input_data 或 signatures、目标平台和依赖。
4. 使用独立 holdout 数据比较当前版本和候选版本；按业务成本评估 precision、recall、F1、误报/漏报及阈值变化。
5. 将评估集名称、指标、训练数据版本、代码提交和评审记录保存到版本元数据或关联的治理表中。
6. 调用 candidate.run 在目标 Warehouse 验证方法签名、输入 Schema、批量大小和输出格式；目标是 SPCS 时单独验证容器镜像、包和服务端点。
7. 对调用方只授予必要的 USAGE 或 READ 权限，使用真实服务角色做允许和拒绝访问测试。
8. 审批通过后，调整 default 或发布别名，使消费者按约定版本引用；记录切换时间、负责人和回滚版本。
9. 观察模型输入分布、预测分布、延迟、失败率和线上标签成熟后的实际效果；不要用离线 F1 替代上线监控。
10. 出现质量退化时，将 default 或生产别名切回已验证版本；保留故障时间、受影响请求、模型版本和推理环境证据。

## 场景分析

欺诈模型 v11 的 recall 为 0.90、precision 为 0.91；v12 的 recall 提升到 0.94，但 precision 降到 0.84。业务团队认为漏报成本更高，愿意接受一定误报，但客服团队担心人工复核量超过承载能力。

不能只因 v12 的 F1 更高就直接切换。先将两个版本在相同评估集上比较，再用实际交易量估算误报会增加多少案件；按风险等级和业务时段检查差异。业务 owner 需要确认人工复核容量，模型 owner 需要确认阈值和监控方案。

确认 v12 可以进入灰度后，先用固定版本引用进行对照；达到约定指标后再调整 Registry default 或生产别名。若上线后误报超过阈值，回切到 v11，并保留当时的版本、依赖、特征和推理环境记录。Registry 让版本可追踪，但发布、灰度和回滚决策仍由部署流程负责。

## 常见误区

- **把模型注册当作生产部署。** 注册只创建模型对象和版本；Warehouse 推理或 SPCS 服务仍要单独配置。
- **只保存模型文件，不保存训练和评估来源。** 缺少数据快照、特征版本和评估集，指标很难复现。
- **把 default 版本切换当作审批。** default 是版本引用机制，不是质量门禁或发布批准。
- **只用一个总体分数决定晋级。** 还要检查 precision/recall、误报漏报成本、分群表现和线上负载。
- **认为所有模型都能在 Warehouse 运行。** 依赖、模型大小和 GPU 要求会影响目标平台选择，某些模型需要 SPCS。
- **给推理服务过宽的 Registry 权限。** Warehouse 推理和 SPCS 推理的 USAGE/READ 权限边界不同。
- **认为 Registry API 管理所有 Snowflake 模型功能。** Snowflake ML Functions 和 Registry API 管理的 Python 模型资产不是同一范围。

## 完成标准

- [ ] 能说明 Model、Model Version、Method 和 Metrics 的关系。
- [ ] 能用 log_model 注册模型并记录运行依赖与样例输入。
- [ ] 能检查版本、指标、default 和别名。
- [ ] 能区分 Registry、Warehouse 推理和 SPCS 服务部署。
- [ ] 能说明 USAGE 与 READ 的授权差异。
- [ ] 能设计候选版本评估、灰度、回滚和线上监控。

## 自测

1. Model Registry 中已经有 v12，但线上服务仍在使用 v11。注册成功为什么不代表服务已经切换？
2. v12 的 recall 提升、precision 下降。仅比较 F1 是否足以决定晋级？还需要哪些业务数据？
3. 两个模型版本都叫 FRAUD_SCORER，但 version_name 不同。为什么要保留每版的依赖、特征版本和评估集信息？
4. Warehouse 推理服务只需要调用模型，不需要查看权重或指标。应考虑授予 USAGE 还是 READ？
5. 一个模型需要 GPU 或不兼容 Warehouse 的依赖。Registry 中已经有模型对象，为什么还需要单独考虑 SPCS？

## 参考资料

- [Snowflake Model Registry](https://docs.snowflake.com/en/developer-guide/snowflake-ml/model-registry/overview)
- [Model Registry SQL](https://docs.snowflake.com/en/developer-guide/snowflake-ml/model-registry/sql)
- [Model Inference](https://docs.snowflake.com/en/developer-guide/snowflake-ml/model-registry/model-inference)
- [Model observability](https://docs.snowflake.com/en/developer-guide/snowflake-ml/model-observability)
