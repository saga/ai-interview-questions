# Snowflake Workspaces、CLI 与数据库 CI/CD

## 本节要解决的问题

开发团队在 Git 中修改了一个存储过程和两张视图。PR 合并后，开发人员认为代码已经发布；但生产账户里的对象定义没有变化。另一个环境则因为部署脚本使用了开发数据库名，意外覆盖了测试对象。

Snowflake 的 Git Workspaces、Git Repository Clone 和 Snowflake CLI 解决的不是同一件事：
- Workspaces 提供在 Snowsight 中编辑和同步代码的开发界面；
- Git Repository Clone 让 Snowflake 对象可以读取仓库中的文件；
- Snowflake CLI 和 CI runner 执行项目部署或 SQL；
- CI/CD 负责控制哪个版本、以什么身份、按什么顺序部署到哪个环境，并在部署后验证结果。

Git commit 只保存源代码；它不会自动修改 Snowflake 中的表、视图、Procedure 或 Task。

## 核心知识

### Git Workspace 是开发者的工作副本，不是数据库发布机制

在 Snowsight Workspaces 中，可以创建连接 Git 仓库的 Workspace，切换分支、Fetch/Pull、查看文件差异、解决冲突、Commit 和 Push。

一个 Git Workspace 始终归创建它的用户所有，而不是归某个 Role 所有；不能把同一个 Git Workspace 直接共享给其他用户或 Role。团队协作依赖共同的远程 Git 仓库和各自的工作副本。每个开发者可以在独立分支中修改，再通过 Git Provider 的 Pull Request 做评审。

当需要让 Snowflake 中的 Task 或 Stored Procedure 读取仓库文件时，Git Workspace 不是合适的运行时依赖。应使用由 Role 所有的 Git Repository Clone 对象，使 Snowflake 对象能稳定引用仓库文件；它与用户开发用的 Workspace 是不同对象。

### Git Repository Object 是 Snowflake 读取仓库文件的连接，不负责 CI 部署

创建 Git Repository Object 需要 API Integration 和认证配置。该对象可以 Fetch 仓库内容，并提供可被 Snowflake 对象引用的文件路径。对于外部 Git 仓库，按需使用 OAuth 或 Secret/PAT，并限制访问范围。

但 CI runner 直接把本地 Checkout 的仓库部署到 Snowflake 时，不需要先创建 Git Repository Object。只有当 Snowflake 账户内的 Task、Procedure 或应用需要直接读取仓库文件时，才创建 Git Repository Clone。

不要把“Snowflake 能 Fetch 到仓库”当成“数据库对象已经部署”。前者只是源文件可见，后者需要独立的部署命令或发布脚本。

### Snowflake CLI 是新项目的首选命令行工具

Snowflake CLI 是当前推荐的新命令行客户端。SnowSQL 属于 Legacy 客户端，现有工作流可以逐步迁移，但新项目不应继续围绕旧工具设计。

Snowflake CLI 支持多种开发对象和项目，包括 Snowpark、Stored Procedure、UDF、Streamlit、Notebooks、Native Apps 和 Snowflake DCM Projects。对于 Snowpark/应用类项目，可以用 snowflake.yml 描述 Project Definition 和 Entities；对于独立 SQL 脚本，可以显式执行 SQL 文件：

~~~bash
snow sql -f sql/010_create_views.sql
snow sql -f sql/020_create_procedures.sql
~~~

使用 Snowflake DCM Projects 时，发布流程可以先执行 Plan，再执行 Deploy，并使用 Test/Expectations 验证实际状态：

~~~bash
snow dcm plan --connection qa
snow dcm deploy --connection qa
snow dcm test --connection qa
~~~

这里的 DCM 命令只适用于采用 DCM Project 定义管理的对象。普通 SQL 文件、Snowpark 应用、Streamlit 和 Native App 应使用各自对应的 CLI 子命令或项目工作流。不能把所有 Snowflake 对象都假定为一个通用的 project deploy 命令。

### PR 验证、合并部署和部署后验收是三件事

一个基本的数据库发布流水线应拆成三个阶段：

| 阶段 | 触发点 | 主要动作 | 是否修改目标环境 |
|---|---|---|---|
| Validate | Pull Request | SQL/配置检查、静态检查、DCM Plan、差异审查 | 不应执行生产变更 |
| Deploy | PR 合并到受保护分支 | 使用目标环境配置和部署身份，执行对象变更 | 是 |
| Verify | 部署完成 | 检查对象定义、任务状态、权限、数据质量和业务回归 | 只读验证为主 |

对于 DCM 项目，Plan 可以列出计划创建、修改或删除的对象，供 PR 评审；Deploy 再应用批准的变更。对于独立 SQL 脚本，应在 PR 阶段先做语法/静态检查或在隔离环境中执行，合并后才向目标环境执行正式脚本。

无论哪种方式，部署完成都不代表数据结果正确。还要验证关键 View 的输出、Procedure 行为、Task/Task Graph 是否恢复运行、权限是否按最小范围授予，以及业务控制总额是否一致。

### 每个环境使用独立服务身份，并优先用 OIDC 短期凭据

GitHub Actions、GitLab CI/CD 和 Azure DevOps 有 Snowflake 官方集成。其他能够运行 Shell 的 CI 系统也可以自行安装 Snowflake CLI。

Snowflake 推荐 CI runner 使用 Workload Identity Federation（OIDC）连接 Snowflake。Runner 获取短期身份 Token，Snowflake 根据可信的 Issuer 和 Subject 判断身份，不需要把长期密码保存在 CI Secrets 中。

服务用户可以使用类似配置：

~~~sql
CREATE USER CI_DEPLOY_QA
  TYPE = SERVICE
  WORKLOAD_IDENTITY = (
    TYPE = OIDC
    ISSUER = '<CI_PLATFORM_ISSUER>'
    SUBJECT = '<QA_WORKFLOW_SUBJECT>'
  );
~~~

生产和非生产应采用不同的服务用户和 Role。QA pipeline 不应该继承生产的 OWNERSHIP 或管理员权限；生产部署身份只拥有经过批准的目标 Database、Schema 和对象权限。若环境暂不支持 OIDC，可使用 Key Pair，并将私钥通过 CI Secret 注入环境变量。Password 认证不推荐用于生产 CI/CD。

### 项目配置和 Secret 要分开管理

提交到 Git 的配置文件可以包含连接名称、默认 Role、Database/Schema、目标 Warehouse 和项目定义，但不能包含密码、私钥、OAuth Token 或 PAT。

Snowflake CLI 的连接参数存在优先级：
1. 命令行参数优先级最高；
2. 指向具体连接参数的环境变量覆盖 config.toml；
3. config.toml 提供未被覆盖的默认值；
4. 通用环境变量最后参与解析。

例如同一个 SQL 文件可以在 QA 和 PROD 环境执行，但目标 Database、Schema 和 Role 由环境注入。不要复制两份 SQL 文件，仅靠改表名前缀来区分环境；也不要把生产密码写进仓库配置。

### 数据库变更需要依赖顺序、可回滚策略和前后兼容

数据库 Schema 变更和应用代码发布不总能原子完成。常见风险包括：
- 先删除旧列，后续应用仍在读取；
- View 或 Procedure 依赖的对象尚未部署；
- Task 仍在运行时修改其引用对象；
- Grant 与对象创建顺序不一致；
- 部署失败后 SQL 已执行一半，重复执行会造成副作用。

对高风险变更采用 Expand–Migrate–Contract：
1. 先添加向后兼容的字段或新对象；
2. 部署新代码并迁移/回填数据；
3. 验证新旧路径的输出；
4. 所有调用方完成切换后，再移除旧对象。

对于不可逆的 DDL、数据删除和大批量回填，要在 Plan/评审中明确影响范围、备份或恢复策略，不能假设 Git revert 会自动回滚数据库状态。

## 工程实施步骤

1. 将 SQL、Snowpark、Streamlit、Notebook 和 DCM Project 文件纳入版本管理，区分应用源文件与账户运行对象。
2. 规定 main/release 分支、PR 审批、代码 owner 和受保护环境的发布权限。
3. 开发者使用独立 Git Workspace 工作；需要 Snowflake Task/Procedure 直接读取仓库文件时，另建 Role-owned Git Repository Clone。
4. 将可管理对象的 Project Definition 或 SQL 发布清单纳入仓库，明确创建、变更、删除与依赖顺序。
5. 配置 Snowflake CLI 连接模板和 QA/PROD 环境变量；配置文件不得包含长期凭据。
6. 为每个环境创建独立 Service User 和 Deploy Role；优先用 OIDC WIF，限制目标 Database/Schema 权限。
7. PR 阶段运行格式、静态和 SQL 检查；DCM 项目运行 Plan，并将差异报告附在 PR。
8. 合并后使用目标环境连接执行部署，记录 Git commit SHA、CLI 版本、部署身份、目标环境和 Query ID。
9. 部署后验证对象定义、Grant、任务状态、应用可访问性、关键查询结果和数据质量。
10. 对跨版本 Schema 变更采用前后兼容策略；失败时使用明确的回滚/前向修复脚本，而不是只回退 Git commit。
11. 定期回顾 CI Service User 权限、API Integration、OIDC Subject、Key Pair 和不再使用的部署 Role。

## 场景分析

开发分支新增 VIEW_PORTFOLIO_RISK，并修改 Procedure CALCULATE_NAV。PR 合并前应检查对象定义、Schema 依赖和权限差异；若使用 DCM Project，执行 Plan 并审查计划创建/替换的对象。若使用独立 SQL，则在隔离 QA 环境运行脚本和数据回归。

合并后，GitHub Actions 使用 QA Service User 的 OIDC 身份连接 Snowflake，部署到 QA Database。Verify 阶段检查 View 输出、NAV Procedure 结果、Row Access Policy 和 Task 执行状态。QA 通过后，Release pipeline 使用独立 PROD Service User 和生产 Role 对相同 commit SHA 部署。

如果 CALCULATE_NAV 的接口发生不兼容变更，不能在同一发布中先删除旧接口再假定所有调用方已经切换。应先增加兼容接口、部署调用方、验证迁移，再清理旧接口。若生产部署中途失败，保存已执行的 SQL、Query ID 和对象差异，按预先设计的前向修复或回滚步骤恢复。

## 常见误区

- **认为 Git Commit 会自动部署数据库对象。** Git 保存源代码，CLI/CI 或其他发布工具才会对目标账户执行变更。
- **把 Git Workspace 与 Git Repository Clone 当成同一种对象。** 前者是用户开发副本且不能共享；后者由 Role 所有，供 Snowflake 对象读取仓库文件。
- **认为 CI runner 必须创建 Snowflake Git Repository Object。** CI 从自己的 Checkout 目录执行 CLI，只有 Snowflake 运行对象需要读仓库文件时才需要 Clone。
- **在每个环境复制一份 SQL 文件。** 应共享同一脚本，通过环境连接与参数注入目标对象和身份。
- **把部署成功当作发布验收成功。** 还要验证数据结果、权限、任务运行、应用和业务指标。
- **将长期用户密码写入 GitHub Secrets 当成默认做法。** 新流水线优先使用 OIDC WIF；无法使用时再考虑 Key Pair。
- **认为 Git Revert 会回滚已经执行的 DDL/DML。** 数据库状态需要单独的前向修复、回滚或恢复脚本。
- **在没有依赖检查时一次性删除旧列或旧接口。** 先扩展、迁移、验证，再收缩。

## 完成标准

- [ ] 能说明 Git Workspace、Git Repository Clone 和 CI runner 的职责差异。
- [ ] 能使用 Snowflake CLI 执行 SQL 或管理项目对象。
- [ ] 能说明 DCM Plan/Deploy/Test 与普通 SQL 发布方式的区别。
- [ ] 能设计 Validate、Deploy、Verify 三阶段流程。
- [ ] 能为不同环境配置独立 Service User、Role 和 OIDC WIF。
- [ ] 能安全管理 CLI 配置、环境变量和 Secret。
- [ ] 能设计数据库变更依赖、兼容迁移和失败恢复。

## 自测

1. 开发者通过 Workspaces 修改 SQL 并 Push 到 Git。为什么生产 Snowflake 对象不会自动变化？
2. Snowflake Task 要读取 Git 仓库中的脚本，应该使用个人 Git Workspace 还是 Git Repository Clone？为什么？
3. CI runner 已经 Checkout 了仓库。为什么通常不需要再创建 Snowflake Git Repository Object？
4. PR 阶段运行 DCM Plan、合并后运行 Deploy、部署后运行 Verify，这三步各自应该验证什么？
5. GitHub Actions 使用 OIDC 连接 Snowflake。它与将长期密码放在 CI Secret 中有什么区别？
6. Schema 删除一个旧列，但生产 Procedure 仍在使用它。为什么 Git Revert 不足以保证恢复？应采用什么迁移顺序？

## 参考资料

- [CI/CD with Snowflake](https://docs.snowflake.com/en/developer-guide/cicd/index)
- [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli)
- [About project definition files](https://docs.snowflake.com/en/developer-guide/snowflake-cli/project-definitions/about)
- [Integrate workspaces with a Git repository](https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces-git)
- [Workspaces](https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces)
- [Workload identity federation](https://docs.snowflake.com/en/user-guide/workload-identity-federation)
