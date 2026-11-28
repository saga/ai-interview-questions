# DCM Projects：声明式部署与变更计划审查

## 数据库上线最危险的不是创建对象，而是不知道部署会删除什么

开发团队在 Git 中删除了一份旧 View 定义，以为只是清理代码。生产执行 DCM Project 后，对应对象也从目标环境删除，下游报表随即失败。

DCM Project 管理的是目标状态，不是简单执行一串 SQL 脚本。项目定义里不再声明的受管对象，部署时可能被删除。理解“声明式收敛”比记住 DEFINE 语法更重要。

## DCM Project 包含什么

一个项目通常由 manifest 和一个或多个 SQL 定义文件组成：

- Manifest 描述目标环境、DCM Project 对象、对象 Owner Role、模板配置和变量。
- SQL 文件通过 DEFINE 声明项目需要维护的对象、授权及数据质量 Expectations。
- Jinja 可以将环境差异参数化，避免复制 DEV、QA、PROD 三份近似定义。
- 项目文件可放在 Git、Snowflake Workspace 或本地目录，使用 Snowflake CLI、Snowsight、SQL 或 Cortex Code 管理。

DCM Projects 已于 2026 年 8 月 7 日 GA。但项目功能 GA 不代表每个辅助能力都已 GA：例如独立的 PLAN privilege 在当前文档中仍标记为 Preview。审查权限和 CI 设计时，应以具体功能页面的状态为准，不要从产品总状态推断所有子功能已经正式发布。

## PLAN 是必须审查的差异，不是部署前的形式步骤

DCM 的 PLAN 会渲染模板，比较定义与目标环境现状，并展示将创建、修改和删除的对象；它不执行 DDL。审查时至少看：

- 预期新增的对象是否在正确 Database/Schema。
- 是否出现非预期 DROP、替换或授权撤销。
- Jinja 变量是否正确解析为当前环境的名称和参数。
- 对象依赖顺序、权限和 DCM Project Owner Role 是否正确。
- 配置 A 与配置 B 是否会让同一项目声明出完全不同的一组对象。

基础命令：

~~~sql
EXECUTE DCM PROJECT DCM_DEMO.PROJECTS.DCM_PROJECT_DEV
  PLAN
FROM
  'snow://workspace/USER$.PUBLIC.DEFAULT$/versions/live/Quickstarts/DCM_Project_Quickstart_1';

EXECUTE DCM PROJECT DCM_DEMO.PROJECTS.DCM_PROJECT_DEV
  DEPLOY
FROM
  'snow://workspace/USER$.PUBLIC.DEFAULT$/versions/live/Quickstarts/DCM_Project_Quickstart_1';
~~~

SQL 命令需要指向包含 manifest 和定义文件的来源路径；在 CLI 中也可以从本地 Git 工作目录执行 Snowflake CLI 的 DCM 命令。不要把示例 Project 名称和 Workspace 路径原样用于生产。

PLAN 只渲染模板、比较目标状态并生成变更计划，不执行 DDL。它尽量模拟 DEPLOY，但不能保证部署阶段绝不失败。PLAN 之后若有人在目标账号手工修改对象，DEPLOY 重新计算的差异可能不同；部署中途失败也可能已经应用部分变更。因此 CI 应保存 PLAN 输出，部署身份执行前再做一次完整 PLAN，并在维护窗口中发布。PLAN DELTA 只检查自上次部署以来变化的定义及其依赖，不会发现所有外部漂移，不能代替完整 PLAN。

CI 中可以让开发角色只拥有 DCM Project 的 PLAN 权限，不拥有 DEPLOY 权限。这样自动化流程能生成并审查计划，但不能自行把变化写入账号。独立 PLAN privilege 当前仍标记为 Preview；在拥有 Project OWNERSHIP 的角色下运行 PLAN 则不需要将 DEPLOY 权限授予普通开发者。部署由受控发布身份完成。

## 一个项目不能当作多个环境配置的并行实例

每个 DCM Project 同一时间只能有一个部署实例。不同 Configuration Profile 不会作为多个独立实例并存。若把 DEV 配置部署到同一个项目，而之前部署的是 PROD 配置，部署会删除当前配置未定义的对象。

因此，应当为每个目标环境创建独立的 DCM Project 对象，共用同一套 Git 定义文件，通过各自的 manifest/变量指向不同目标环境。不能只创建一个 Project，然后把“配置切换”误当成多环境隔离。

## 版本控制与发布身份要分开

代码定义、模板和变量应有明确 Git Commit。执行身份则要按环境隔离：开发角色可以读项目并运行 PLAN，发布角色才可以 DEPLOY。Project Owner Role 是 PLAN/DEPLOY 执行权限模型的一部分，不能只看发起命令的用户是谁。

部署后保存 Project 名称、Git Commit、PLAN 输出、部署结果和目标环境的对象清单。若某个定义被删除，必须先确认这是否是有意退役，并检查其下游依赖后再部署。

## 适合 DCM 与不适合直接交给 DCM 的工作

适合用 DCM 管理的是可声明的目标状态，例如数据库对象、表、View、Task、相关 Grants 和 Expectations。对于外部系统 API 副作用、需要人工逐条判定的数据迁移、复杂的应用编排，仍可能需要独立的发布流程或任务代码。

不要为了“统一管理”而把所有运行时副作用包装成对象定义。DCM 解决的是对象状态的可重复收敛，不替代数据迁移验证、应用升级策略和跨系统事务。

## 常见失误

- PLAN 通过就直接部署，不审查 DROP/替换清单。
- DEV、QA、PROD 共用同一个部署实例，切配置时删除其他环境对象。
- 认为 Git 删除文件只是仓库清理，不会影响 DCM 目标状态。
- 将 DCM 的 GA 与周边仍在 Preview 的能力混为一谈。
- 用有 DEPLOY 权限的自动化角色执行所有 PR 检查。
- 把 DCM 当作数据库版本控制的全部，忽略数据迁移和运行时回滚。

## 自测

1. 一个 View 从定义文件中删除后，为什么 DCM DEPLOY 可能删除目标环境里的 View？
2. 为什么 PLAN 权限适合授予 CI 检查角色，而 DEPLOY 权限要单独控制？
3. 同一个 Project 先部署 DEV 配置，再部署 PROD 配置，为什么可能删除 DEV 对象？
4. 2026 年 8 月 DCM GA 后，哪些相关能力仍可能是 Preview？发布流程应如何对待它们？
5. DCM 能管理目标对象状态，为什么不能替代跨系统数据迁移和回滚设计？

## 参考资料

- [DCM Projects general availability](https://docs.snowflake.com/en/release-notes/2026/other/2026-08-07-dcm-projects-ga)
- [Create and deploy DCM Projects](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-use)
- [DCM Projects files and templates](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-files)
- [DCM Projects collaboration and CI/CD](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-collaboration)
