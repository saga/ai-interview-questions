# Semantic View 高级建模：粒度、历史关系与半可加指标

## 报表数字不同，先检查模型的粒度

订单分析模型连接订单事实、订单明细和客户历史维表。订单表一行一笔订单，明细表一行一个商品，客户维表按有效时间保存多版地址。直接连接后，订单金额可能按明细行数重复，历史地址也可能把同一订单匹配到多个客户版本。

Semantic View 可以声明逻辑表、关系、Fact、Dimension 和 Metric，但它不会自动修复底层主键重复，也不会替模型作者推断事实粒度。每个逻辑表先写清一行代表什么，关系再说明关联键与基数。

## 多事实表要按粒度设计关系

假设订单事实表一行一笔订单，订单明细一行一件商品。订单金额属于订单粒度，商品数量属于明细粒度。把两张表连接后，订单金额就会在每个明细行重复。

解决方法不是给 SUM 套 DISTINCT，而是让指标在正确粒度上计算：订单金额先按订单聚合，明细数量按明细聚合，再按共同维度组合。若两张事实表通过共享维度分析，往往比直接把两个 Fact 表互连更清楚。

建模前用 SQL 验证主键唯一性、外键匹配率、空值和关系基数。Semantic View 的 PRIMARY KEY 声明是规划器和语义解析的模型信息，不会替物理表创建跨表唯一约束。

## 历史维表需要有效时间语义

客户地址或客户等级变化时，历史维表常用 Valid From/Valid To 表示版本有效期。只有开始时间时，事件通常匹配事件时间之前最近的一条记录；若有明确的有效区间，则应验证事件时间落在一个且仅一个有效版本内。

例如订单发生于 11 月 8 日，客户等级在 11 月 10 日从 Silver 变为 Gold。订单应该关联 Silver，而不是当前的 Gold。若维表使用半开区间，需要固定规则为 VALID_FROM <= ORDER_TS AND ORDER_TS < VALID_TO；最后一版的 VALID_TO 可以用明确的未来边界，而不是让 NULL 含义各异。

如果存在重叠有效区间或间隙，Semantic View 不会自动选出业务上正确的版本。应先在物理模型中修复历史关系，再定义逻辑关系。

## 半可加指标不能沿所有维度求和

营收通常可以按客户、地区和时间求和；账户余额、库存数量和在库人数却是时点快照。把每天的期末余额按月份 SUM，会把同一笔资产重复累计。

Semantic View YAML 的 non_additive_dimensions 可以声明某个 Metric 不应跨哪些维度累加。例如账户余额不应沿年份和月份维度相加；定义维度顺序还会影响计算边界。对于库存，可以选择期末值、期间平均或期间最大值，但必须由业务定义决定，不能只靠 SUM 或 AVG 自动推断。

## 多条关系路径要明确选哪一条

航班表连接机场维表时，通常有出发机场和到达机场两条关系。自然语言问题“按城市统计航班数”可能指起飞城市、到达城市或两者。模型必须让指标或问句选择正确关系路径。

Semantic View YAML 提供 using_relationships 用于指定 Metric 计算时使用的关系路径；该功能当前标记为 Preview。生产模型若依赖 Preview，发布前要核对账户可用性，并提供替代查询或分开的逻辑路径，不要假设所有语义消费者都能处理它。

## 验证生成 SQL，不只检查语义定义能否部署

定义成功创建只说明 Semantic View DDL 合法，不代表生成 SQL 的结果正确。为关键业务问题维护 Verified Queries，使用逻辑表和逻辑列表达人工确认的 SQL，再测试模型在不同维度、过滤条件、时间窗口和多关系路径下是否生成正确结果。

测试应专门覆盖 Join fanout、历史维表有效期、半可加指标、NULL 和重复键。还要检查指标是否能访问不应该暴露的列，使用真实业务角色验证权限。模型版本升级或关系修改后，应重新跑 Golden Queries。

## 适用边界

Semantic View 适合多个消费者反复使用同一组实体关系和指标口径，且有 owner 维护模型定义与 Verified Queries 的环境。若底层粒度和业务规则仍频繁改变，应先稳定数据模型；语义层不是物理建模的替代物。

## 常见建模错误

- 把粒度不同的事实表直接连接，导致度量重复计数。
- 只用主键声明代替物理唯一性检查。
- 历史维表有效区间重叠，却仍把关系交给生成 SQL。
- 把时点余额和库存当作普通可加指标。
- 多条关系路径不加说明，任由模型猜测。
- 只看 DDL 成功，不比较生成 SQL 的真实结果。

## 自测

1. 订单事实连接订单明细后，为什么订单金额会被重复累计？
2. 历史客户维表有 Valid From/Valid To，为什么应该用订单发生时间而不是当前日期做关联？
3. 期末库存按月份求和会产生什么错误？有哪些可接受的指标口径？
4. 什么时候应使用 using_relationships？它当前的产品状态意味着什么？
5. 为什么 Verified Query 的 SQL 应使用逻辑表和逻辑列，而不是直接引用物理表？

## 参考资料

- [Semantic Views overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [Semantic View YAML specification](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)
- [Creating and managing semantic views with SQL](https://docs.snowflake.com/en/user-guide/views-semantic/sql)
- [Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
