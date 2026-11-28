# dbt Model Generator：从原始表到可审查的数据模型

## 本节要解决的问题

数据团队接入一组新的订单与客户原始表，业务希望尽快产出可复用的销售分析模型。直接把所有原始表拼成一张宽表，可能把订单头金额按明细行重复累计；一开始就生成星型模型，也可能把只有两张小表的简单分析问题做复杂。

dbt Model Generator 的目的不是让 AI 猜一套模型结构，而是把建模前的数据画像、模型形态选择、staging/dimension/fact 生成、测试和 PR 审查串成一个可重复流程。最重要的决策仍然是数据粒度和业务用途；生成代码只是把已确认的设计落到 dbt 项目中。

本篇引用的 dbt Model Generator 是 Snowflake-Labs/coco-skills 仓库中的社区 Skill（作者标注为 Vino Duraisamy），不是 Snowflake 内置服务或官方产品 SLA。使用前应审阅 Skill 的脚本、依赖、权限和执行边界。

## 先画像数据，再决定建模形态

### 元数据和统计画像比 SELECT * LIMIT 更有用

建模前至少要了解源表的：
- 行数和字节量；
- 列名、类型、可空性；
- 空值率、近似唯一值数量、最小/最大值；
- 候选业务键和潜在外键；
- 时间字段的覆盖范围；
- 不同表之间是否存在共享 ID。

先从 Information Schema 获取表和列定义：

~~~sql
SELECT
  table_schema,
  table_name,
  row_count,
  bytes
FROM SALES_DB.INFORMATION_SCHEMA.TABLES
WHERE table_schema = 'RAW'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
~~~

~~~sql
SELECT
  column_name,
  data_type,
  is_nullable,
  ordinal_position
FROM SALES_DB.INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = 'RAW'
  AND table_name = 'ORDERS'
ORDER BY ordinal_position;
~~~

再对关键字段做画像，而不是只抽几行观察：

~~~sql
SELECT
  COUNT(*) AS total_rows,
  COUNT(order_id) AS non_null_order_id,
  COUNT_IF(order_id IS NULL) AS null_order_id,
  APPROX_COUNT_DISTINCT(order_id) AS distinct_order_id,
  MIN(order_date) AS first_order_date,
  MAX(order_date) AS last_order_date
FROM SALES_DB.RAW.ORDERS;
~~~

若表超过 100 万行，Skill 建议用 SAMPLE 估算分布，避免为了初步画像就全表扫描；若一次要扫描超过 20 张表，应先确认范围和计算成本。样本画像只能用来提出候选键和关系，不能证明唯一性；最终还需要在完整数据或业务约束上验证。

### 业务粒度比表名和列名更重要

假设原始数据有三张表：

| 表 | 一行代表什么 | 候选键 |
|---|---|---|
| ORDERS | 一张订单 | order_id |
| ORDER_LINES | 一张订单中的一条商品明细 | order_id + line_no |
| CUSTOMERS | 一个客户 | customer_id |

ORDERS 和 ORDER_LINES 不是相同粒度。一个订单有多条明细，如果在事实层直接把订单头金额 Join 到明细，再 SUM(order_total)，订单金额会随着明细行数重复。模型生成器必须先识别出这个关系，再决定是生成一个订单级 fact，还是一个订单明细级 fact。

列名匹配（例如多个表都存在 customer_id）只能发现候选外键。仍需检查唯一性、空值、孤儿键和业务定义；不能因为两张表都有相同列名，就默认它们一定可 Join。

## 星型模型、OBT 和宽表怎样选择

### 选择依据是分析复用和事实粒度，不是模型偏好

CoCo Skill 使用以下规则作为初步启发：

| 数据形态 | 初步建议 | 主要考虑 |
|---|---|---|
| 1–2 张表，事实粒度接近 | OBT 或简单模型 | 少量 Join，模型结构保持简单 |
| 1–3 张小表，分析用途明确 | 宽表 | 在 staging 中完成少量 Join 和展开 |
| 多张表有不同事实粒度，并共享客户/产品/日期等维度 | 星型模型 | 维度复用、事实粒度清楚、分析口径更稳定 |
| 用户已明确目标形态 | 按目标设计 | 不应让自动推荐覆盖业务决定 |

行数阈值只是一种启发，不是性能定律。小表也可能因为多对多关系而需要星型模型；大表也不代表必须拆出很多维度。还要考虑查询模式、更新频率、共享维度、下游消费者和模型维护成本。

以订单场景为例：
- 只有订单头和客户信息、且报表只按订单分析时，订单级 OBT 可能足够；
- 需要按商品、日期、客户和地区跨多份销售过程分析时，星型模型通常更容易复用；
- 若订单明细有自己的业务指标，就应保留订单明细粒度，不能为了宽表把它聚合掉。

### 用户确认模型形态和字段分类后再生成代码

Skill 的流程在推荐模型形态后有一个明确停止点。生成器需要把画像结果、候选关系、维度/事实划分和数据质量问题呈现给数据 owner，确认后才继续。

这一步不是形式审批：如果把订单头金额归类为订单明细事实，后续模型、测试和文档可能都会建立在错误粒度上。错误的自动生成结果越完整，修正成本越高。

## 生成后的 dbt 项目结构

### Staging 负责标准化来源，不应承载复杂业务指标

每张源表通常有一个 staging model，职责包括：
- 通过 source() 引用原始数据；
- 统一列名和类型；
- 解析源系统的日期、Unix 时间戳和字符串编码字段；
- 保留来源字段，不在这一层随意丢弃信息；
- 对无效值使用安全转换并让测试发现异常。

例如：

~~~sql
-- models/staging/stg_orders.sql
SELECT
  order_id::VARCHAR AS order_id,
  customer_id::VARCHAR AS customer_id,
  TRY_TO_DATE(order_date) AS order_date,
  TRY_TO_DECIMAL(order_total, 18, 2) AS order_total,
  status::VARCHAR AS order_status
FROM {{ source('sales_raw', 'orders') }}
~~~

这里假设源字段可以安全转换为对应类型。TRY_TO_DATE 返回 NULL 不代表数据已修复；需要在 schema tests 或业务质量测试中检测日期解析失败的记录。

### Dimension 和 Fact 要分别写明粒度

星型模型中的维度表示业务实体，事实表记录业务过程。以订单为例：

- dim_customer：一行一个客户；
- dim_product：一行一个商品；
- fact_order_line：一行一个订单商品明细。

模型 SQL 应使用 ref() 连接 dbt 模型，不应直接写底层物理表名；源表则通过 source() 引用。这样 dbt 才能建立 DAG、执行依赖顺序并生成模型间血缘。

~~~sql
-- models/facts/fact_order_lines.sql
SELECT
  l.order_id,
  l.line_no,
  c.customer_key,
  p.product_key,
  l.quantity,
  l.net_line_amount
FROM {{ ref('stg_order_lines') }} AS l
LEFT JOIN {{ ref('dim_customer') }} AS c
  ON l.customer_id = c.customer_id
LEFT JOIN {{ ref('dim_product') }} AS p
  ON l.product_id = p.product_id
~~~

此示例假设 dimension 的自然键在目标时点唯一。如果维度存在重复 customer_id，Join 可能扩行；如果需要历史维度，应明确 Type 2 SCD 等时态策略，不能用当前客户属性覆盖历史订单属性。

若不需要维度复用，OBT 可以直接把必要的 staging 模型组合成一张宽表。但要保留目标粒度，例如一行一个订单或一行一个订单明细，不能在模型生成时混合两个粒度。

### 测试和文档必须跟模型一起生成

至少为每个关键模型添加：
- unique：业务键或代理键唯一；
- not_null：关键键和必需字段非空；
- relationships：事实外键能关联到维度；
- accepted_values：状态等枚举值处于已知范围；
- 业务测试：金额区间、日期范围、订单头/明细对账等。

例子：

~~~yaml
version: 2

models:
  - name: stg_orders
    columns:
      - name: order_id
        data_tests:
          - not_null
          - unique
      - name: order_date
        data_tests:
          - not_null
      - name: order_status
        data_tests:
          - accepted_values:
              arguments:
                values: ['NEW', 'PAID', 'SHIPPED', 'CANCELLED']

  - name: fact_order_lines
    columns:
      - name: customer_key
        data_tests:
          - relationships:
              arguments:
                to: ref('dim_customer')
                field: customer_key
~~~

测试名义上通过，不代表每项测试都适合该列。比如一个客户维度自然键可能重复，因为上游记录尚未处理历史版本；此时必须先确定是 Type 1 还是 Type 2 模型，再决定唯一性测试的粒度。

模型文档应解释模型用途、行粒度、关键字段、owner 和刷新频率。自动生成的描述要对照源系统注释和业务定义，不应把列名改写成未经确认的业务含义。

## 验证阶段不能混为一谈

### dbt parse 只检查项目是否能被解析

生成代码后先执行 dbt deps 和 dbt parse。parse 可以发现项目配置、YAML、Jinja 和模型引用等解析问题；它不会连接 Snowflake 执行模型，也不能证明 SQL 结果正确。

接下来才是 compile、run 和 test：
- compile：生成编译后的 SQL；
- run：在目标库/Schema 中创建或更新模型对象；
- test：执行数据质量测试并报告失败。

对本地 dbt CLI，执行命令需要有效的 profiles/凭证；对 dbt Projects on Snowflake，使用 Snowflake CLI、项目对象和相应的运行配置。两种开发方式的认证、依赖下载和运行环境不同，不应把所有配置示例混成一份通用文件。

运行 dbt run 会修改目标 Schema 中的表或视图。CoCo Skill 明确要求在连接可用时先询问用户，再执行 run/test；因此自动生成流程不能把 parse 成功当作发布许可。

### PR 审查是独立步骤，不能用 AI 生成替代

生成器完成后应把模型代码、schema.yml、数据画像、关系判断和已知数据质量问题提交为 PR。审查至少要关注：
- 每个模型的粒度是否明确；
- 主键和关系是否经过数据验证；
- Join 是否会扩行或丢失记录；
- 指标是否在正确粒度聚合；
- 测试是否覆盖业务规则，而非仅满足格式；
- 生成代码是否只在批准的目标环境执行。

合并 PR 之后再由独立 CI/CD 流程部署生产。生成器本身不应直接把生成的 SQL 写入生产表。

## 工程实施步骤

1. 确认 source database/schema、目标 schema、表范围、项目位置、Warehouse 和 Role。
2. 检查活跃 Snowflake 连接和 dbt 项目是否已存在；有现有项目时先读取目录结构和模型约定。
3. 获取 Information Schema 元数据，对表做行数、列类型、空值率、近似唯一值和范围画像。
4. 大表使用抽样；扫描范围过大时先确认成本，不直接全库画像。
5. 基于不同事实粒度、共享维度和查询需求推荐 OBT、宽表或星型模型，并说明候选键与关系依据。
6. 在生成前让数据 owner 确认模型形态和列分类；修改意见应反馈到模型设计，而不是直接覆盖 SQL。
7. 按既有 dbt 项目约定生成 staging、dimension/fact 或 OBT 模型；每个模型用 source()/ref() 表达依赖。
8. 同步生成 schema tests、模型/列文档、source 定义和项目配置；凭据放在环境变量或受控连接，不写入仓库。
9. 执行 dbt deps、dbt parse 和 compile；记录工具版本、模型数量和解析错误。
10. 只有在用户明确批准目标 schema 写入后，再执行 dbt run/test；测试失败时不提交为可发布版本。
11. 将模型代码、测试、数据画像、设计理由和未解决问题放进 PR，供工程师和数据 owner 独立审查。
12. 合并后由 CI/CD 发布到生产 dbt project object；根据 Snowflake 运行历史检查真实模型结果和成本。

## 场景分析

订单源有三张表：ORDERS（12 万行）、ORDER_LINES（48 万行）和 CUSTOMERS（3 万行）。画像显示 order_id 在 ORDERS 中唯一，(order_id, line_no) 在 ORDER_LINES 中唯一，customer_id 在 CUSTOMERS 中唯一。订单明细包含 product_id，但源数据还没有产品主数据表。

生成器推荐星型模型：staging 层标准化三张源表，dim_customer 描述客户，fact_order_lines 以订单明细为粒度。因为没有产品主数据，不能凭 product_id 自动生成一张看似完整的 dim_product；应先将其作为事实表的退化维度字段，或要求业务补充产品维度来源。

如果需求只是按客户看订单总额，且没有商品级分析，团队可以选择订单级 OBT。若要按商品和订单行做分析，则不能把 ORDER_LINES 提前聚合到订单级。数据 owner 确认模型方案后，生成器再建立 dbt 模型和测试；parse 通过仅说明项目配置与依赖可解析。执行 run/test 之前还要确认目标 schema，最终通过 PR 审查后再进入生产发布。

## 常见误区

- **把表名和列名当成事实粒度。** 需要用数据画像和业务过程确认一行代表什么。
- **把样本中未发现重复等同于全量唯一。** 样本只用于画像，候选键必须进一步验证。
- **所有数据集都生成星型模型。** OBT 和宽表在简单场景可能更合适，复杂场景才需要可复用维度。
- **让订单头事实与订单明细 Join 后直接聚合。** 一对多关系会复制订单头金额。
- **维度表没有唯一自然键仍直接 Join。** 这会导致事实表扩行，必须先决定去重或 SCD 规则。
- **把 parse 成功当成模型运行和业务正确。** run/test 才真正执行目标模型和数据检查。
- **让生成器自动执行 dbt run 并写入生产。** 目标环境变更、业务口径和发布必须经过独立确认与审查。
- **将社区 Skill 当成 Snowflake 内置功能。** 应审阅来源、依赖、脚本和权限，再决定是否在团队环境使用。

## 完成标准

- [ ] 能通过 Information Schema 和统计画像识别候选键、空值率、分布和表间关系。
- [ ] 能根据数据粒度和分析需求选择 OBT、宽表或星型模型。
- [ ] 能定义 staging、dimension、fact 模型的职责和一行粒度。
- [ ] 能解释 source() 与 ref() 的区别及其在 dbt DAG 中的作用。
- [ ] 能为模型生成 unique、not_null、relationships、accepted_values 和业务测试。
- [ ] 能区分 dbt parse、compile、run 和 test 的验证范围。
- [ ] 能说明生成后的模型需要 PR 审查和独立 CI/CD 发布。
- [ ] 能识别社区 Skill 的来源、执行权限和写入目标风险。

## 自测

1. ORDERS 一行一张订单，ORDER_LINES 一行一条商品明细。若把 order_total Join 到明细表再 SUM，为什么会重复？事实表应该采用哪种粒度？
2. 只有两张表且粒度相同的简单报表，为什么不一定要拆成星型模型？什么变化会使星型模型更有价值？
3. 画像发现 customer_id 在样本中没有重复，是否足以建立维度唯一键？还要做什么验证？
4. dbt parse 通过了，但还没有运行 SQL。它能证明表和数据正确吗？run 与 test 分别做什么？
5. CoCo 已生成模型，但用户尚未确认写入目标 Schema。为什么不能直接执行 dbt run？
6. 源表没有产品主数据，模型却自动创建 dim_product。这个维度的业务属性和唯一性依据从哪里来？应怎样处理？

## 参考资料

- [Snowflake-Labs CoCo Skills: dbt Model Generator](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/dbt-model-generator)
- [Best practices for dbt Projects on Snowflake](https://docs.snowflake.com/en/user-guide/data-engineering/dbt-projects-on-snowflake-best-practices)
- [Understand dbt project objects](https://docs.snowflake.com/en/user-guide/data-engineering/dbt-projects-on-snowflake-understanding-dbt-project-objects)
- [Understand CI/CD for dbt Projects on Snowflake](https://docs.snowflake.com/en/user-guide/data-engineering/dbt-projects-on-snowflake-ci-cd)
