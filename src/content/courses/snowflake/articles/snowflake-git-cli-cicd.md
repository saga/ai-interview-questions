# Snowflake Git 集成与 CLI 项目工作流

## 本节要解决的问题

区分 Snowflake 中的 Git Repository 对象、开发者本地 Git 工作区和 CI runner 的代码 checkout，并选择适合 SQL、Snowpark、Streamlit 或 Native App 的发布路径。Git 提供版本历史和协作；Snowflake CLI 负责从项目定义和连接配置执行相应开发与部署命令，两者不是同一个服务。

## 核心知识

### Git Repository 对象让 Snowflake 内部访问远程仓库

Snowflake Git Repository 是一个 Snowflake Schema 对象，用于将远程 Git 仓库克隆到 Snowflake 环境中。Snowsight Workspaces、SQL 和 Snowflake 内部开发工作流可以使用其中的分支、文件和版本。创建时需要 API Integration、允许访问的 Git URL 和凭证配置。

CI runner 通常会直接 checkout GitHub 仓库到 runner 文件系统。它执行 snow sql、Snowflake CLI Project 或相应 DCM/应用部署命令，并不要求先在 Snowflake 中创建 Git Repository 对象。只有部署流程确实需要 Snowflake 内部读取该远端仓库时，才需要建立 Snowflake Git Repository。

### Snowflake CLI Project 用配置文件描述部署对象

Snowflake CLI 使用 snowflake.yml 项目定义描述实体、代码、Stage、处理器、环境参数和部署命令。一个 Project 可以包含多个实体，例如 Streamlit app、Snowpark procedure、Native App 或 SQL 相关对象。项目定义可通过环境变量与 CLI 参数覆盖不同环境的默认值。

配置文件应把环境相关的对象名称、Warehouse 和连接名参数化。私钥、OAuth token 和服务凭证不能提交到 Git；应由本地密钥管理或 CI Secret/Workload Identity Federation 注入。

### Git 协作与对象部署需要分层管理

Git Commit 管理代码版本，Pull Request 管理同行评审，CI 检查语法、依赖和数据测试，CD 将已审查版本部署到环境。Snowflake 对象的依赖顺序、DDL 非事务性、数据迁移与任务启停，需要单独设计。

简易 SQL migration 适合少量明确 DDL；Declarative Change Management 项目适合声明式管理对象状态；Snowflake CLI Project 适合包含代码和部署流程的开发项目。应按变更类型选择工具，不需要为了统一而强制将所有对象放入一种项目模型。

## 工程实施步骤

1. 识别开发流程：Snowflake 内部 Snowsight 工作区、开发者本地 CLI，或 CI runner 自动部署。
2. 若需要 Snowflake 内部访问远程 Git 仓库，创建 Git API Integration 和 Git Repository；若 CI runner 直接 checkout，则不必额外创建该对象。
3. 规划仓库目录，把 SQL migrations、Snowflake CLI Project、测试、脚本和部署文档分开管理。
4. 使用 snowflake.yml 声明项目实体与部署参数，开发/测试/生产的 database、schema、warehouse 和 stage 通过环境配置区分。
5. Pull Request 阶段执行格式检查、SQL/项目配置验证、对象依赖扫描和测试环境部署，输出可审查变更清单。
6. 合并后只从已审查的 Commit 或 Tag 部署，记录 Commit SHA、Snowflake CLI 版本、连接身份、Query ID 和执行结果。
7. 对 DDL 先增加兼容结构，再部署代码和数据回填，最后收紧约束或删除旧对象；不要假设整个 DDL 批次能够由事务回滚。
8. 按对象类型选择 Deploy 命令。SQL migrations 使用受控执行顺序；Snowpark/Streamlit/Native App 使用相应项目部署工作流。
9. 部署完成后运行对象存在性、Grants、DMF Expectations、关键查询和业务汇总对账。
10. 对失败部署准备向前修复脚本、应用版本回退或数据恢复路径；CI 需要保留日志和发布状态，支持安全重试。

示例：CI runner checkout 代码后执行 Snowflake CLI Project。

~~~bash
git checkout "$GITHUB_SHA"
snow --version
snow sql -c test --filename migrations/001_create_schema.sql
~~~

生产流水线还要配置短期认证、审批策略、环境隔离、依赖验证和发布后测试。以上命令只是最小执行入口，并非完整的生产流水线。

## 场景分析

开发团队在本地使用 Git 管理 Snowflake SQL，CI 计划在 Pull Request 中检查 SQL，合并后自动部署到测试和生产。有人建议每个环境都创建一个 Snowflake Git Repository，让 CI 先把文件同步到 Snowflake 再执行。

若 CI runner 已 checkout 同一个 Commit，额外同步 Git Repository 只增加一层配置和权限，并非部署必要条件。可以直接用 Snowflake CLI 执行 SQL 或部署 Project；只有 Snowsight Workspace 或 Snowflake 内部代码引用确实需要远程仓库镜像时，才配置 Git Repository。

验收应覆盖 PR 中新增/修改/删除对象的差异、部署身份最小权限、环境变量隔离、SQL 执行顺序、发布后 Grants 和数据检查，以及失败重试行为。

## 常见误区

- 认为使用 GitHub 自动部署就必须创建 Snowflake Git Repository。CI runner 可直接 checkout Git 文件。
- 把 Git Repository 对象当成 GitHub Actions Runner。它只是 Snowflake 内部访问远程仓库的对象。
- 把项目配置和秘密凭证一起提交。仓库只保存变量名与非敏感模板，凭证由安全环境注入。
- 在开发环境测试过就直接部署生产。生产依赖、权限和数据规模需要独立验证。
- 只检查 DDL 返回成功。还应验证对象定义、Grants、派生作业和业务数据。
- 用一个通用脚本部署所有 Snowflake 对象。SQL migration、DCM 和 CLI 项目有不同用途和限制。

## 完成标准

- [ ] 能区分本地 Git、CI checkout 与 Snowflake Git Repository。
- [ ] 能说明何时需要 Snowflake Git Repository，何时不需要。
- [ ] 能用 snowflake.yml 描述项目和环境参数。
- [ ] 能设计 Pull Request 验证、Commit 部署和生产环境隔离。
- [ ] 能对 DDL、数据迁移和应用部署制定验证及恢复策略。

## 自测

1. GitHub Actions 已 checkout 仓库代码，为什么通常不需要再创建 Snowflake Git Repository 才能运行 SQL？
2. Snowflake Git Repository 主要解决什么问题？它是否负责执行 GitHub Actions？
3. 为什么生产部署必须从已审查的 Commit 或 Tag 执行？
4. DDL 部署失败后，为什么不能默认执行 ROLLBACK 就能恢复所有对象？
5. Snowflake CLI Project 中哪些配置适合参数化，哪些凭证不能提交到仓库？

## 参考资料

- [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli)
- [Project definitions](https://docs.snowflake.com/en/developer-guide/snowflake-cli/project-definitions)
- [Git integration](https://docs.snowflake.com/en/developer-guide/git/git-overview)
- [CI/CD](https://docs.snowflake.com/en/developer-guide/cicd)
