# Snowflake CLI、CI/CD 与发布门禁

## 本节要解决的问题

把 Snowflake SQL、Schema 对象和应用部署从手工 Snowsight 操作改为版本化、可审查、可重复执行的交付流程。流水线应覆盖变更计划、执行身份、环境隔离、部署、结果验证和恢复，而不只是把 SQL 文件上传后执行。

## 核心知识

### Snowflake CLI 是新的开发与自动化命令行入口

Snowflake CLI 是 Snowflake 推荐的命令行客户端，支持 SQL 执行、Snowpark、Streamlit、Native Apps 和项目管理等开发工作流。SnowSQL 属于旧版客户端，当前新功能主要进入 Snowflake CLI。CLI 项目可使用 snowflake.yml 描述实体、代码、处理器、Stage 和部署参数。

配置文件中的环境变量和 CLI 参数会覆盖默认连接配置。应将非敏感连接骨架放入版本库，把私钥或短期身份凭证注入流水线环境，避免在仓库中提交含秘密的 config.toml。

### CI/CD 应采用 Validate、Deploy、Verify 阶段

Snowflake 官方推荐的交付模式可以拆成 Validate、Deploy、Verify 三个阶段。Validate 计算目标环境将发生的变更，运行 SQL 静态检查、项目结构验证和数据测试；对支持 DCM Project 的项目可使用 snow dcm plan。Deploy 在合并后应用已审查的对象变更，可以使用 snow dcm deploy、snow sql -f 或相应应用部署命令。Verify 刷新派生数据、运行 Expectation 和业务对账，确认发布后状态符合预期；DCM Project 可使用 snow dcm test。

SQL 脚本、DCM Project、Snowpark 应用、Native App 和 Streamlit 的部署命令不同。不要试图用同一种脚本机制覆盖所有对象类型。

### 执行身份和环境边界是安全基础

CI 服务用户应与个人用户分离，按开发、测试和生产环境设置不同身份和 Role。Snowflake 推荐在支持的平台上使用 Workload Identity Federation，通过 CI 平台 OIDC 获取短期身份，避免保存长期密码或私钥。若环境不支持 WIF，再安全管理 Key-pair 凭证并安排轮换。

流水线 Role 只应获得所需对象的 CREATE/ALTER/OWNERSHIP 或 DCM 部署权限。生产部署应从审查过的 Commit 生成，不能直接使用开发者本机未提交的 SQL 文件。

## 工程实施步骤

1. 按对象类型盘点 SQL、表、视图、Warehouse、Task、Procedure、Stream、Semantic View 和应用文件，明确依赖顺序。
2. 选择管理方式：简单 SQL 变更可使用版本化 SQL migration；声明式对象集合评估 DCM Project；Snowpark/Native App/Streamlit 使用对应 CLI project。
3. 将项目定义、SQL、测试、环境变量名称和部署文档提交到 Git；本地覆盖文件与凭证文件加入 .gitignore。
4. 配置每个环境的 CI 服务用户和 Role；优先用 OIDC/WIF 短期身份，限制 issuer、subject 和权限。
5. 在 Pull Request 阶段执行格式/语法、对象依赖、静态规则、迁移顺序和测试环境部署计划；对破坏性变更要求显式审查。
6. 生成部署计划或 migration diff，记录将创建、修改、删除的对象及其影响；若无法自动计算计划，至少输出可审查 SQL 和预期对象状态。
7. 合并到主分支后部署到目标环境，按数据库/schema 依赖顺序执行；对不可逆 DDL 和数据迁移采用 expand-migrate-contract 等兼容策略。
8. 部署后运行结构断言、权限测试、DMF Expectation、行数/金额对账和关键业务查询；仅 SQL exit code 为 0 不算验证完成。
9. 保存 Git SHA、snow CLI 版本、执行身份、Query ID、计划、测试报告和目标环境信息。
10. 对失败发布执行补偿 SQL、回滚应用版本或恢复数据；若 DDL 无法事务回滚，必须使用预先设计的向前修复或恢复方案。
11. 定期轮换身份凭证，清理过期服务 Role，并测试生产部署中断后的恢复路径。

示例：在 CI runner 中使用短期身份执行 SQL 文件。

~~~bash
uv tool install snowflake-cli
snow --version

# Connection parameters are injected by the CI identity configuration.
snow sql -c prod --filename migrations/2026_11_28_add_order_status.sql
~~~

在支持的 GitHub Actions 等平台，优先采用 Snowflake Workload Identity Federation 集成；不要把上述简化命令误作完整发布流水线。

## 场景分析

一次 Schema 变更需要新增订单状态列、回填历史值、更新视图和修改下游 Task。开发人员在 Snowsight 手工执行时，先更新了视图，却忘了先发布新列，导致生产作业失败。

正确流程应将变更拆分为向后兼容的阶段：先增加可空列，再部署兼容旧/新结构的应用代码和视图，然后分批回填数据，验证历史数据完整，最后在消费者迁移完成后才考虑收紧约束或删除旧字段。Pull Request 阶段应生成变更清单并在测试环境跑迁移；合并后部署生产，最后运行对象定义、权限、数据和 Task 状态检查。

如果某一步失败，需要明确是继续向前修复、回滚应用版本还是恢复数据。对不可逆 DDL，不能假设执行 ROLLBACK 会恢复原状。

## 常见误区

- 把 Snowflake Git Repository 当成 CI/CD 必需条件。CI runner 通常直接 checkout Git 仓库并部署；Snowflake Repository 更适合 Snowsight Workspaces 或 Snowflake 代码引用仓库文件。
- 只在主分支运行 SQL，不做 Pull Request 变更计划。破坏性 DDL 和依赖顺序应在合并前可审查。
- 把 DDL 放进事务后期待全部回滚。Snowflake 的多数 DDL 会隐式提交活动事务，需要设计向前修复或数据恢复。
- 使用个人账号和长期密码执行生产部署。应使用专用服务身份，优先 OIDC/WIF。
- 只检查流水线退出码。还要验证数据质量、权限、派生对象和业务结果。
- 把所有项目都写成单个 SQL 文件。DCM、Snowpark、Native App 等项目有各自定义和部署能力。

## 完成标准

- [ ] 能说明 Snowflake CLI 与旧 SnowSQL 的定位差异。
- [ ] 能按项目类型选择 SQL migration、DCM Project 或 CLI Project。
- [ ] 能设计 Validate、Deploy、Verify 三阶段流水线。
- [ ] 能为 CI 服务身份采用 OIDC/WIF 或安全 Key-pair 认证。
- [ ] 能为 DDL、数据回填和应用发布设计兼容、验证和恢复路径。

## 自测

1. CI runner 已 checkout Git 仓库，是否还必须在 Snowflake 中创建 Git Repository 对象才能部署？
2. 一个 PR 新增列并修改视图，怎样在生产部署前验证对象依赖顺序？
3. 为什么只看 snow sql 返回成功不能证明 Schema 变更发布完成？
4. Snowflake DDL 在显式事务中执行后失败，为什么不能一概依赖 ROLLBACK？
5. GitHub Actions 连接 Snowflake 生产环境，优先采用哪类身份凭证，能解决什么风险？

## 参考资料

- [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli)
- [CI/CD](https://docs.snowflake.com/en/developer-guide/cicd)
- [About project definition files](https://docs.snowflake.com/en/developer-guide/snowflake-cli/project-definitions/about)
- [Setting up a Git repository](https://docs.snowflake.com/en/developer-guide/snowflake-cli/git/setup-git)
- [Transactions](https://docs.snowflake.com/en/sql-reference/transactions)
