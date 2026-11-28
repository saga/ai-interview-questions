# Streamlit in Snowflake 数据应用

## 本节要解决的问题

运营团队要做一个组合风险看板：用户选择基金、估值日和行业后，查看持仓、NAV、风险限额和异常记录。普通分析师只能看自己获授权的基金；风险经理可以看完整地区；管理员还要能导出经过授权的明细。

页面上隐藏一个基金选项不等于数据安全。Streamlit 应用运行时使用的 Snowflake 身份、应用所有者的权限、访问者的角色以及缓存/导出逻辑，决定了用户最终能看到什么。应用本身也需要限制查询范围，避免一个任意参数就触发全库扫描。

## 核心知识

### 先确定应用查询是 Owner’s Rights 还是 Restricted Caller’s Rights

Streamlit in Snowflake 默认以 Owner’s Rights 执行 SQL。应用查询使用创建应用的所有者角色及其权限，而不是查看应用的用户权限。查看者即使没有底层表 SELECT，只要能够使用应用，应用仍可能通过所有者权限读取并展示这些数据。

这适合所有用户共享相同数据的管理看板，但如果不同用户应按自身角色看到不同数据，就不能只依赖应用页面隐藏选项。必须在应用执行上下文中实施数据授权。

对 Container Runtime 应用，可评估 Restricted Caller’s Rights。它让查询以访问者身份运行，但仅允许应用使用管理员通过 Caller Grants 明确批准的调用者权限；没有对应 Caller Grant 的权限，即使用户本人拥有，也不能由应用代为使用。Restricted Caller’s Rights 需要 Streamlit 1.53.1 或更高版本，Warehouse Runtime 不支持。

例如，Container Runtime 应用可以分别建立 Owner 和 Caller session：

~~~python
import streamlit as st

# Owner's rights：使用应用所有者身份，适合共享且对所有人相同的结果
owner_session = st.connection("snowflake").session()

# Restricted caller's rights：使用访问者身份，并受 Caller Grants 限制
caller_session = st.connection("snowflake-callers-rights").session()
~~~

需要区分访问控制与应用业务规则：即使使用 Caller’s Rights，也要限制页面允许查询的对象、时间范围和参数集合。应用不能让用户通过任意 SQL 输入或可控对象名绕过授权。

### 查询参数要绑定，不要拼接 SQL 字符串

以下代码将页面输入拼接进 SQL，是不应该采用的写法：

~~~python
# 不安全：region 来自用户输入，直接拼接 SQL
sql = f"SELECT * FROM risk_positions WHERE region = '{region}'"
~~~

应使用参数绑定，并在服务端检查允许的日期范围、基金和聚合粒度：

~~~python
import streamlit as st

session = st.connection("snowflake-callers-rights").session()

allowed_regions = {"JP", "SG", "AU"}
region = st.selectbox("地区", sorted(allowed_regions))
fund_id = st.selectbox("基金", ["F01", "F02", "F03"])
valuation_date = st.date_input("估值日")

if region not in allowed_regions:
    st.error("地区参数不合法")
    st.stop()

positions = session.sql(
    """
    SELECT
      portfolio_id,
      instrument_id,
      sector,
      market_value_base,
      concentration_ratio
    FROM ANALYTICS.MART.PORTFOLIO_RISK
    WHERE region = ?
      AND portfolio_id = ?
      AND valuation_date = ?
    LIMIT 5000
    """,
    params=[region, fund_id, valuation_date],
)

st.dataframe(positions)
~~~

SQL 参数只能绑定值，不能安全地替代表名、列名或排序关键字。若用户可以选指标或排序字段，应从服务端维护的白名单映射到固定 SQL 片段，而不是将输入直接拼入语句。还要对允许查询的最早日期、最大返回行数和查询超时设限。

### 页面隐藏、数据策略和导出必须使用同一授权逻辑

应用至少有三层保护：
1. **应用入口**：只有被授权 Role 才能使用应用对象。
2. **数据查询**：Owner’s Rights 使用应用所有者权限；Restricted Caller’s Rights 依赖访问者权限和 Caller Grants；底层 Row Access Policy/Masking Policy 是否按预期工作必须在实际执行上下文测试。
3. **输出操作**：表格、图表、下载按钮、缓存和日志都可能泄露数据，不能只保护查询语句。

例如，一个 Streamlit 表格只显示前 10 个客户，但下载按钮导出了完整 DataFrame。UI 上的“Top 10”并没有限制实际数据导出范围。导出前应按当前访问身份重新执行相同的授权过滤，或只允许导出已经受限的结果集合。

若应用使用 Owner’s Rights 读取更宽的数据范围，必须明确所有应用查看者都能看到什么，并让服务所有者承担数据披露责任。对于不同用户看到不同数据的场景，优先考虑 Restricted Caller’s Rights 或将查询放到受控后端，并做真实用户负向测试。

### 缓存可能跨用户复用，不能让用户专属数据串到别人的会话

Streamlit 的 st.cache_data 可以缓存查询结果，降低重复计算；但缓存键必须包含所有会改变结果的输入。用户身份、有效角色、基金授权范围、估值日和过滤条件如果会改变查询结果，就必须进入缓存键或采用隔离缓存策略。

例如，查询结果只按 fund_id 缓存，而 Owner’s Rights 应用里多个用户都能选择同一个 fund_id，可能把一个用户有权看到的额外列或明细结果复用于另一个用户的会话。即使 UI 看起来相同，数据授权上下文未必相同。

不要缓存长期动态的风险状态而不设置 TTL；也不要缓存包含凭据、个人信息或可被其他用户重用的原始明细。开发时用两个不同权限用户依次访问同一页面，检查第二个用户是否得到第一个用户的缓存结果。

### Streamlit Runtime 的计算资源和会话行为也会影响应用

Streamlit in Snowflake 提供 Warehouse Runtime 和 Container Runtime。二者在启动、会话隔离、资源、包管理、缓存和 Caller’s Rights 支持上存在差异：

| 维度 | Warehouse Runtime | Container Runtime |
|---|---|---|
| 执行模型 | 应用作为 Snowflake 对象运行 | 容器化应用实例 |
| Restricted Caller’s Rights | 不支持 | 支持，需符合版本和 Caller Grant 要求 |
| 启动特征 | 通常按需启动，冷启动较明显 | 容器启动/部署耗时较高，用户连接已运行实例更快 |
| 依赖与系统包 | 受 Snowflake Runtime 包环境约束 | 容器环境更灵活，需管理镜像和依赖 |
| 会话/缓存 | 依赖 Runtime 会话模型 | 容器实例可在多个用户会话间共享资源，缓存需特别注意隔离 |

选择 Runtime 时，不要只按启动快慢决定。若应用需要每个用户按自己的行级策略读取数据，应首先确认 Restricted Caller’s Rights 的支持条件；若使用共享 Owner’s Rights 数据，则要验证应用查看者的可见范围与缓存行为。

## 工程实施步骤

1. 先确定应用所有者、查看者、数据敏感级别和各角色可以访问的基金/地区。
2. 选择 Warehouse Runtime 或 Container Runtime，并核对版本、包依赖、启动和权限能力。
3. 对所有 SQL 查询建立参数白名单、日期窗口、结果行数和超时限制。
4. 确定每个查询使用 Owner’s Rights 还是 Restricted Caller’s Rights；若使用后者，配置必要 Caller Grants。
5. 在真实查看者 Role 下验证 Row Access Policy、Masking Policy 和对象权限，而不是只用应用 Owner 测试。
6. 审查所有导出、下载、缓存和日志路径，确认其数据范围不宽于页面展示权限。
7. 对用户身份、Role、基金、地区和日期等影响数据范围的上下文进行缓存隔离或纳入缓存键。
8. 用两个不同权限的测试用户交替访问同一页面，验证缓存命中、下载和错误提示不会泄露另一个用户的数据。
9. 通过 Query History 和 Query Profile 检查执行 SQL、扫描量、Warehouse 排队和查询耗时。
10. 将应用版本、运行时、依赖、使用 Role、查询 ID、导出事件和权限测试结果纳入发布记录。
11. 对应用所有者角色权限变化、Caller Grant 变更、Row Access Policy 修改和新导出功能做回归测试。

## 场景分析

基金 F01 的持仓明细对普通分析师只开放日本和新加坡地区；风险经理可查看全部地区。应用部署在 Container Runtime，选择 Restricted Caller’s Rights，并由管理员为应用配置必要的 SELECT Caller Grant。

普通分析师进入应用后，页面显示日本和新加坡基金。即使用户手工修改 URL 参数请求澳大利亚地区，查询仍应按调用者身份和 Row Access Policy 拒绝未授权记录。风险经理打开同一页面则可查看全部获批地区。

验收还要覆盖下载按钮和缓存：分析师导出的 CSV 不得包含澳大利亚记录；分析师先打开页面后，风险经理再打开页面时，不得因为缓存命中而得到被限制的结果。若应用改为 Owner’s Rights，则必须重新评估应用所有者所能访问的全部数据是否会向所有查看者开放。

## 常见误区

- **用隐藏 UI 字段代替数据授权。** 用户可以修改参数、URL 或直接调用暴露的应用路径；授权必须由服务端和数据层执行。
- **认为 Streamlit 默认按访问者权限查询。** 默认 Owner’s Rights 使用应用所有者权限；不同用户权限需要单独设计。
- **认为所有 Runtime 都支持 Restricted Caller’s Rights。** 该功能只支持 Container Runtime，并有版本要求。
- **只保护查询，不保护导出。** 下载文件可能包含比屏幕显示更完整的数据。
- **缓存键只包含页面参数。** 如果有效 Role 或用户授权也改变结果，就要隔离缓存或将授权上下文纳入缓存键。
- **只用应用 Owner 测试权限。** 要用真实的普通用户、风险经理和无权用户进行负向测试。
- **认为应用运行成功就代表成本合理。** 还要检查 Query Profile、Warehouse 负载、缓存、扫描量和用户并发。

## 完成标准

- [ ] 能说明 Streamlit in Snowflake 默认 Owner’s Rights 的含义。
- [ ] 能区分 Restricted Caller’s Rights 与普通 Caller’s Rights，并说明 Runtime/版本要求。
- [ ] 能使用参数绑定与白名单防止输入改变 SQL 结构。
- [ ] 能识别 UI 隐藏与真实数据授权的差异。
- [ ] 能验证导出和缓存不会跨授权上下文泄露数据。
- [ ] 能用真实用户 Role 验证 Row Access Policy 和 Masking Policy。
- [ ] 能根据执行证据评估查询性能与应用成本。

## 自测

1. Streamlit App Owner 可以读取所有基金，普通用户只能查看 F01。应用默认 Owner’s Rights 时，普通用户通过应用可能看到什么数据？为什么？
2. Restricted Caller’s Rights 在 Warehouse Runtime 上能否使用？Container Runtime 有什么额外条件？
3. selectbox 生成的 fund_id 是用户输入，为什么还需要服务端白名单与对象权限检查？
4. 一个查询结果通过 st.cache_data 缓存，缓存键只包括 fund_id。不同用户权限不同会产生什么风险？
5. 页面只展示 10 行，但导出按钮下载全部查询结果。如何确保导出与页面使用同样的授权边界？

## 参考资料

- [Understanding owner's rights and Streamlit in Snowflake apps](https://docs.snowflake.com/en/developer-guide/streamlit/object-management/owners-rights)
- [Restricted caller's rights and Streamlit in Snowflake](https://docs.snowflake.com/en/developer-guide/streamlit/features/restricted-callers-rights)
- [Security overview for Streamlit in Snowflake](https://docs.snowflake.com/en/developer-guide/streamlit/object-management/security)
- [Runtime environments for Streamlit apps](https://docs.snowflake.com/en/developer-guide/streamlit/app-development/runtime-environments)
