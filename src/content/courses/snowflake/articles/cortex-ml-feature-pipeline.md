# Snowflake Feature Store：点时特征与训练数据防泄漏

## 离线验证准确率很高，线上效果却明显变差

风险模型用一份客户训练集得到了很高的验证准确率。上线后发现，训练数据里的“过去 30 天交易次数”包含了预测时点之后发生的交易。模型在训练时看到了未来信息，验证结果自然比真实生产环境好。

这类问题不是随机切分或换一个模型就能修复的。训练样本必须使用事件发生时已经可用的特征值。Snowflake Feature Store 的关键用途之一，是将特征定义、实体键、时间戳和版本纳入管理，并在构造训练集时按样本时点查找特征。

## 用实体、Feature View 和时间戳定义特征

Entity 用来表示客户、账户或设备等业务实体，并指定实体键。Feature View 封装原始数据到特征列的转换，一个 Feature View 中的特征按同一刷新计划更新。Snowflake-managed Feature View 由 Snowflake 根据 refresh_freq 管理刷新；External Feature View 的底层特征表则由使用者自行维护。

时间序列特征需要保留 timestamp_col。这个时间戳应表示特征值在业务上何时有效或可用，不能用训练任务跑批时间冒充事件发生时间。迟到数据也要区分 event time 和 arrival/availability time，否则“当时已经知道什么”会被错误重建。

## 用训练样本的时间点生成正确的特征快照

训练数据的 spine 通常包含实体键、样本时间和标签。调用 generate_training_set 时传入 spine_timestamp_col，Feature Store 会按样本时间进行 point-in-time feature lookup，使用该时点或之前可用的最新特征值，避免将未来特征带入历史样本。

~~~python
training_set = fs.generate_training_set(
    spine_df=training_spine,
    features=[registered_feature_view],
    spine_timestamp_col="EVENT_TS",
    spine_label_cols=["LABEL"],
)
~~~

如果特征视图只保留最新快照，那么无法重建任意历史时点的值。对于需要完整时间历史的训练场景，应评估 append-only batch Feature View 或保存历史快照。其关键不是保留更多数据，而是让训练时能恢复预测时点真实可见的版本。

Snowflake Datasets 与普通 Snowpark DataFrame 也不同。Dataset 会物化训练数据并支持版本化，更适合要求可复现的模型训练；普通 generate_training_set 结果默认是临时 DataFrame，不应把它当成永久冻结的数据集。

## 训练与在线推理的特征口径必须对齐

若模型训练使用一个 SQL 表达式，线上推理又由另一份 Python 代码重算，很容易出现 training-serving skew。将相同 Feature View 用于离线训练和在线读取，可以减少重复实现，但还要核对在线服务类型、同步延迟和读数据时的时区。

对于 batch Feature View，refresh_freq 控制离线特征表刷新周期；启用 Online Serving 时，OnlineConfig.target_lag 控制离线值同步到在线存储的目标。这两个设置独立生效，源数据到在线可用的总延迟通常受两段链路影响。只监控 Feature View 刷新成功，不等于在线值已经同步。

当前 Snowflake Feature Store 的在线服务类型还存在实现差异，例如 PostgreSQL-backed Online Feature Store 和 Hybrid Table。应按实际存储类型验证功能限制、时区、服务状态、成本和读延迟，不能把一种 Store 的行为套到另一种上。

## 一个时间泄漏检查例子

假设在 11 月 10 日 00:00 为客户预测风险。特征是“过去 30 天交易总额”。正确窗口应取样本时点之前的数据，且按当时已到达系统的数据可见性计算。11 月 10 日之后发生的交易，即使属于训练样本标签观察期，也不能进入预测特征。

除了 point-in-time join，还要检查：

- 标签的观察窗口是否晚于特征窗口。
- 迟到事件是否按到达时间或回补时间错误地覆盖历史值。
- 同一客户多个样本是否在切分时跨越训练集与验证集。
- 目标实体、客户关联映射是否在历史时点仍然有效。
- 训练集是否固定了 Feature View 版本、数据集版本和代码版本。

## 不要把数据切分当成全部验证

随机切分会让同一客户或相邻时间的样本同时出现在训练与验证中，从而高估泛化。时间预测通常要用时间切分；同一实体会产生多条相关样本时，还应按客户、账户或设备分组。最终测试集要晚于训练窗口，模拟真实上线时间。

模型指标还要结合业务错误成本。AUC 上升不代表审批、欺诈召回或人工复核工作量一定改善。发布前应核对特征新鲜度、缺失率、分布漂移、在线延迟与模型结果，并保留可回滚的数据集和模型版本。

## 常见错误

- 用当前最新特征值回填历史训练样本。
- 把特征计算时间当成特征业务时间。
- 认为 Feature View 的 refresh_freq 同时控制在线同步。
- 只保存临时 DataFrame，不保留训练 Dataset 版本。
- 随机切分导致同一实体和相邻时间的信息泄漏。
- 训练和推理分别实现特征逻辑，导致口径漂移。

## 参考资料

- [Snowflake Feature Store feature views](https://docs.snowflake.com/en/developer-guide/snowflake-ml/feature-store/feature-views)
- [Advanced feature engineering and point-in-time datasets](https://docs.snowflake.com/en/developer-guide/snowflake-ml/feature-store/advanced-feature-engineering)
- [Model training and inference](https://docs.snowflake.com/en/developer-guide/snowflake-ml/feature-store/modeling)
- [Serving online features](https://docs.snowflake.com/en/developer-guide/snowflake-ml/feature-store/online-feature-store)
