# CoCo 模型选择与可用性：Role、产品状态和区域共同决定

## 本节要解决的问题

数据团队在 CoCo 中选择了一个新模型，个人开发环境可以运行，但部署到生产 Role 后模型不再出现在选择列表；另一个模型虽然能被选择，却通过跨区域推理处理数据，而项目的合规要求不允许数据离开指定地理范围。

“模型存在于 Snowflake”不代表 CoCo 当前一定能调用它。至少有三个独立条件：
1. 模型是否对当前 Snowflake Role 授权；
2. 模型是否在当前产品中受支持，以及处于 GA、Preview 还是 Legacy；
3. 模型能否在账号所在 Region 运行，或是否需要跨区域推理。

CoCo 的模型列表不是一份永久固定的产品清单。它显示当前用户在当前 Role 下可用的模型；真正选型必须把访问权限、产品阶段、区域、成本和任务质量一起考虑。

## CoCo 的模型选择方式

### 固定模型与 Auto 解决的是不同问题

CoCo 支持选择固定模型，也提供不同 Auto 路由选项：

| 选项 | 路由方式 | 主要取舍 |
|---|---|---|
| 指定模型 | 所有请求使用选定模型 | 行为较容易复现，成本和质量取决于该模型 |
| Auto | Snowflake 自动选择模型 | 减少手动选择，但路由细节不由用户固定 |
| Auto Intelligent | 倾向使用能力更强的模型 | 通常质量更高，但成本也更高 |
| Auto Efficient | 按步骤复杂度路由模型 | 常规步骤使用低成本模型，复杂步骤使用更强模型；费用包含模型调用费和路由费 |

Auto Efficient 不是“每个请求固定使用一个廉价模型”。一个复杂任务可能包含多个步骤，每个步骤会按复杂度选择不同模型。排查质量波动时，应记录实际选择的模型和路由模式，而不只是 CoCo 界面上显示的 Auto Efficient。

当任务需要稳定结果、可重复评测或严格控制供应商/模型版本时，应在允许范围内固定模型，并对模型升级做回归测试。对于日常代码解释、简单 SQL 帮助等复杂度差异较大的任务，Auto Efficient 才可能在质量和成本之间提供更好的折中。

### Profile 中的模型选择不会改变 Snowflake 连接身份

CoCo Profile 可以保存模型、instructions 和可用 skills。它不是 Snowflake 账号或权限配置：
- Profile 不会自动切换当前 Account；
- Profile 不会授予新的 Role；
- Profile 不会修改 Warehouse；
- Profile 不会绕过账号的模型访问控制或跨区域推理设置。

因此，切换 Profile 后看不到模型，不能只检查 Profile 文件。应先确认当前连接的 Account、Primary Role、Secondary Roles 和模型 RBAC，再检查 Profile 选择。

## 模型可用性由产品、Role 和 Region 三个维度共同决定

### 同一个模型在不同 Cortex 产品中的状态可能不同

Snowflake 的模型可用性按产品列出。一个模型可能：
- 在 Cortex AI Functions 中 GA；
- 在 Cortex Agents/CoWork 中 GA；
- 在 Agent Evaluations 中尚未支持；
- 在另一个产品中仍处于 Preview 或 Private Preview；
- 在旧账号保留为 Legacy，等待生命周期终止。

所以不能仅凭模型名称或模型提供商判断“这个模型已经 GA”。需要按目标产品列检查：
- CoCo/CoWork；
- Cortex Agents；
- Cortex AI Functions；
- Cortex Inference；
- Agent Evaluations。

Preview 模型不适合直接作为生产依赖；Private Preview 还需要 Snowflake 对账号显式开启。Legacy 模型只允许符合条件的旧调用继续运行直到 EOL，不应在新应用中作为默认选项。

### 模型访问由当前 Role 的模型级授权决定

Snowflake Cortex 使用模型级 RBAC。ACCOUNTADMIN 可以向需要的 Role 授予单模型应用角色，也可以根据组织策略授予 CORTEX-MODEL-ROLE-ALL，允许访问当前和未来模型。

默认情况下，SNOWFLAKE.PUBLIC 可能已有覆盖所有模型的启动授权；如果组织要收紧范围，需检查并调整该授权，而不是只删除用户自定义 Role 上的 grant。

查看当前 Role 可用的模型：

~~~sql
SHOW CORTEX BASE MODELS IN SCHEMA SNOWFLAKE.MODELS;
~~~

该结果能帮助确认模型名称、Release Stage 和 Cross-Region Scope。它反映的是当前执行 Role 可用的模型，并不代表账号中所有用户都能使用这些模型，也不代表它们在每个 Cortex 产品中都处于相同发布阶段。

最小权限策略应授予实际需要的单模型访问权，或选择经审批的模型集合。CORTEX-MODEL-ROLE-ALL 可能让未来新增模型自动进入授权范围，应把这一点视为治理决策，而不是方便的默认配置。

### Region 与跨区域推理决定数据会在哪里处理

模型可能在某些 Snowflake Region 原生可用，也可能通过 Cross-Region Inference 提供。可用性表会列出不同云、区域和跨区域范围。若模型不在账号所在 Region 原生运行，可能需要 ACCOUNTADMIN 启用 CORTEX_ENABLED_CROSS_REGION 设置。

跨区域推理有两个影响：
- 可以扩展模型可用范围；
- 请求内容可能在其他地区处理，必须遵守数据驻留、隐私、监管和客户合同要求。

不能因为“跨区域推理能让模型跑起来”就默认打开。先确认数据分类和组织政策，再选择 Cross-Cloud、Global、区域内或禁用跨区域的策略。对敏感数据，优先选能在批准边界内运行的模型。

## 用当前账号实际检查，而不是复制旧模型名单

### 查询当前 Role 可访问的模型

先确认身份上下文：

~~~sql
SELECT CURRENT_ACCOUNT(), CURRENT_REGION(), CURRENT_ROLE();
SELECT CURRENT_SECONDARY_ROLES();
~~~

再查询模型：

~~~sql
SHOW CORTEX BASE MODELS IN SCHEMA SNOWFLAKE.MODELS;
~~~

检查输出中的模型名称、Release Stage 和 Cross-Region Scope。若某模型不在结果中，先检查当前 Role 的模型授权，不应立即认为该模型已被 Snowflake 删除。

### 检查跨区域推理配置

当前账号的 Cross-Region 设置应由账户管理员按数据治理策略管理。部署时要把目标模型、目标产品和目标区域做成兼容性矩阵：

| 模型 | CoCo 可用 | Agents 可用 | Region/跨区范围 | 发布阶段 | 允许的数据级别 |
|---|---|---|---|---|---|
| Model A | 是 | 是 | 原生/跨区域范围 | GA | 经批准 |
| Model B | 是 | 否 | 仅部分区域 | Preview | 非生产 |
| Model C | 否 | 是 | 跨区域推理 | GA | 需审批 |

这张表是团队自己的运行配置，不要把它与 Snowflake 全局产品清单混为一谈。每次模型升级、Region 变更、Role grant 变化或产品支持范围变化后，都要重新验证。

### Auto 选择也需要可观测性

如果使用 Auto Intelligent 或 Auto Efficient，不能只记录“CoCo 使用 Auto 模式”。需要尽可能保留：
- 当前 Profile 和活动 Role；
- 请求时间和任务类型；
- Auto 路由模式；
- 每一步实际使用的模型（如产品提供可观察信息）；
- 输入/输出 Token 和费用；
- 延迟、工具调用和失败状态；
- 模型发布阶段和区域策略。

Auto 模式的路由可能随模型可用性和产品升级变化。若一项业务任务需要稳定质量，应保留固定评测集，比较 Auto 与指定模型的结果，而不是仅凭少量交互判断哪个更好。

## 模型选型应回到任务和成本

| 任务 | 选择依据 | 不应忽略 |
|---|---|---|
| 简单 SQL / 字段解释 | 轻量、低成本、低延迟模型通常足够 | 仍需核验 SQL 真实执行结果 |
| 复杂架构设计 / 多文件代码修改 | 复杂推理和长上下文能力 | 成本、延迟、变更审查和回归测试 |
| CoCo 多步骤任务 | Auto Efficient 可按步骤复杂度选择 | 路由费、实际模型、工具执行总成本 |
| 对固定输出做批量分类 | AI_CLASSIFY 等任务型函数 | 标签质量和类别错误成本 |
| 长文档分析或 RAG | 模型上下文、引用能力和 Search 质量 | 文档权限、区域和引用忠实度 |
| 受数据驻留约束的任务 | 区域原生可用模型 | 禁止未经批准的跨区域处理 |

不要把模型规模当成质量的唯一指标。对 SQL 生成，Semantic View、Golden Query 和执行校验可能比更大的模型更能提高正确率；对文档问答，检索版本和引用更重要；对代码修改，仓库上下文和测试质量也会决定结果。

## 工程实施步骤

1. 列出 CoCo 使用场景、数据级别、目标产品和延迟/成本目标。
2. 确认当前 Account、Region、Primary Role 和 Secondary Roles。
3. 使用 SHOW CORTEX BASE MODELS 查看当前 Role 可用模型及发布阶段。
4. 查阅 Snowflake 当前 Model Availability，分别核对 CoCo、Agents、AI Functions 和 Evaluations 的产品状态。
5. 检查模型级 RBAC grant、CORTEX-MODEL-ROLE-ALL 和 SNOWFLAKE.PUBLIC 的默认授权。
6. 逐个模型确认 Region 原生可用性和 Cross-Region Scope；需要时由 ACCOUNTADMIN 配置跨区域推理，但必须先审批数据驻留风险。
7. 对 Auto、Auto Intelligent、Auto Efficient 和固定模型运行同一套真实任务集，记录质量、延迟和费用。
8. 对 Preview/Private Preview/Legacy 模型设定限制或迁移时间，不把它们作为未审批的生产默认模型。
9. 为 CoCo Profile 记录模型、instructions 和 skills，但将连接身份和 Role 权限保持在 Snowflake 连接治理中。
10. 模型、产品状态、Region 或 Role 变化后重新检查可用性并运行回归。

## 常见误区

- **把 CoCo 支持模型理解成一份固定名单。** CoCo 显示当前 Role 能用的模型，清单会随发布和授权变化。
- **认为模型在 AI Functions 中 GA 就一定在 CoCo、Agents 和 Evaluations 中 GA。** 产品状态是按使用场景区分的。
- **只看模型名称，不看当前 Role 的模型授权。** 同一账号的不同 Role 可见模型可能不同。
- **使用 CORTEX-MODEL-ROLE-ALL 却不评估未来新增模型。** 该授权覆盖当前和未来模型，应作为明确的治理选择。
- **认为跨区域推理只是性能配置。** 它会影响数据处理地点和合规边界。
- **将 Auto Efficient 当成固定单模型。** 它可以按步骤复杂度选择不同模型，并产生路由费用。
- **用 Preview 或 Private Preview 模型承载生产 SLA。** 需确认发布阶段和组织审批。
- **认为 CoCo Profile 会修改当前连接、Role 或 Warehouse。** Profile 不改变 Snowflake 会话授权上下文。

## 完成标准

- [ ] 能区分指定模型、Auto、Auto Intelligent 和 Auto Efficient。
- [ ] 能解释 Auto Efficient 的按步骤路由与额外路由费用。
- [ ] 能使用 SHOW CORTEX BASE MODELS 查看当前 Role 的可用模型。
- [ ] 能解释模型级 RBAC、CORTEX-MODEL-ROLE-ALL 和 SNOWFLAKE.PUBLIC 启动授权。
- [ ] 能区分模型在 CoCo、Agents、AI Functions 和 Evaluations 中的产品状态。
- [ ] 能检查 Region 原生可用性、Cross-Region Scope 和数据驻留要求。
- [ ] 能把固定模型和 Auto 路由放到同一套真实任务集上比较质量、成本和延迟。
- [ ] 能说明 CoCo Profile 不改变当前 Account/Role/Warehouse 的身份边界。

## 自测

1. 某模型在 AI Functions 中是 GA，但在 CoCo 列表里不可选。应先检查哪些方面，而不是判定 Snowflake 产品状态矛盾？
2. 一个用户在 Role A 看得到模型，在 Role B 看不到。为什么？应检查哪个 SQL 命令？
3. 模型在当前 Region 没有原生部署，但可跨区域调用。为什么这不仅是可用性问题，还涉及数据治理？
4. Auto Efficient 把复杂任务拆成多个步骤并使用不同模型。成本核算为什么要加上路由费用？
5. CORTEX-MODEL-ROLE-ALL 让未来模型自动进入授权。什么情况下不适合授予所有运行 Role？
6. CoCo Profile 切换后模型列表没有变化，但当前连接 Role 变化了。Profile 和会话身份分别控制什么？
7. 如何通过固定回归集比较 Auto Intelligent 与 Auto Efficient 的质量、费用和延迟？

## 参考资料

- [CoCo Desktop — Supported models and Auto options](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-desktop)
- [Model availability for Snowflake Cortex AI](https://docs.snowflake.com/en/user-guide/snowflake-cortex/model-availability)
- [Model access control](https://docs.snowflake.com/en/user-guide/snowflake-cortex/model-access-control)
- [SHOW CORTEX BASE MODELS](https://docs.snowflake.com/en/sql-reference/sql/show-cortex-base-models)
- [CoCo Profiles](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-snowsight/profiles)
