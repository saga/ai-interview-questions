# Snowflake Workspaces 与 Git 协作

## 本节要解决的问题

三个开发者同时维护一套 Snowflake 数据产品：开发者 A 修改 SQL View，B 修改 Streamlit 应用，C 更新 Notebook 中的分析逻辑。团队希望在 Snowsight 中编辑文件、review diff、创建分支并将修改推回 Git，同时又要让生产 Task 能读取已发布的脚本。

这里有三种不同对象：Workspaces 是开发界面和工作副本；Git Repository Clone 是 Snowflake 可引用的仓库文件对象；生产数据库对象是执行 SQL 后真正创建的表、View、Task 或 Procedure。Git 同步文件并不会自动部署对象，也不能把一个开发者的私有 Workspace 当成团队共享目录。

## 核心知识

### Workspaces 已取代 Legacy Worksheets，统一管理多种开发文件

Snowflake Workspaces 是 Snowsight 当前的开发工作区，支持组织 SQL 文件、Python 文件、Notebook、Streamlit、dbt Project 等文件。它不是数据库 Schema，也不直接授予用户访问文件引用对象的权限。

My Workspace 是用户私有工作区。Shared Workspace 可以由团队按 Role 共同使用。首次访问 Workspaces 时，Snowflake 会为用户创建个人数据库用于存储工作区文件；它不代表用户因此获得其他数据库或表的额外权限。

Workspaces 使用当前 Snowsight 用户菜单中的 Role 决定能看到哪些 Workspace，以及创建 Git Workspace 时可使用哪些 API Integration 和 Secret。打开 SQL 文件后，编辑器里的 Role 选择器只影响该文件中 SQL 语句的执行身份，不会改变整个 Workspaces 界面的当前角色。

### Git-connected Workspace 是用户自己的仓库工作副本

创建 Git Workspace 时，可以指定远程 Git 仓库、API Integration 和认证方式。它可以使用 OAuth、PAT 等方法连接仓库；连接私有仓库需要配置对应 API Integration 和 Secret。

Git Workspace 始终由创建它的用户拥有，而不是由 Role 拥有，也不能直接共享给其他用户或 Role。团队共同维护一个仓库时，每名开发者应创建自己的 Git Workspace，再通过分支和 Pull Request 协作。

创建 Git Workspace 时要注意：
- 远程仓库必须至少有一个分支；
- 不能将已经存在的 Private/Shared Workspace 直接改造成 Git-connected Workspace；
- Workspace 的访问权限和 API Integration/Secret 权限由当前用户 Role 决定；
- Workspaces 的 Git 操作与 SQL 文件执行使用的 Role 不完全相同。

### Branch、Fetch、Pull、Commit 和 Push 有不同作用

| 操作 | 作用 | 常见使用时机 |
|---|---|---|
| Create branch | 从当前分支建立独立工作分支 | 开发一个隔离的功能或修复 |
| Fetch | 更新远端分支列表和引用，不合并文件内容 | 其他开发者在 Git Provider 创建新分支后 |
| Pull | 将远端当前分支更新合并到本地 Workspace | 开始工作前同步，或解决 Push 冲突前 |
| Commit | 记录当前 Workspace 文件变更和提交说明 | 完成一个可审查的修改单元 |
| Push | 将本地提交上传到远程 Git 分支 | 准备发起 PR 或更新现有 PR |

工作区的 Changes 面板会显示新增、修改和删除的文件，点击文件可看可视 Diff。发生冲突时，先检查当前版本与远端版本，再决定接受本地、远端或合并两边内容；不要为了让 Push 成功就直接选择一边覆盖。

提交时可以更新 Author Name 和 Email。团队应让 Commit 身份与实际开发者或规定的自动化身份一致，避免所有修改都显示成同一个不明账号。

### Git Workspace 不等于 Git Repository Clone

Git Repository Clone 是数据库中的 Git 仓库对象，由 Role 所有，Snowflake SQL 对象可以通过它读取仓库文件。它适用于 Task、Stored Procedure 或其他 Snowflake 运行对象在执行时引用代码/脚本文件的情况。

Git Workspace 是人的开发副本；Git Repository Clone 是 Snowflake 对象读取仓库文件的入口。两者可以指向同一个远程仓库，但其所有者、生命周期和权限模型不同。

例如，开发者在 Git Workspace 中修改每日财务脚本并 Push。生产 Task 若要读取该仓库中的已发布脚本，需要引用受控 Git Repository Clone，并且仓库分支/Commit 要由发布流程更新。Task 不会因为某个人 Push 了代码就自动切换到那个开发者的 Workspace。

### 文件进入 Git 不代表 Snowflake 对象已更新

开发者把 SQL 文件 Push 到 main 之后，生产 View 仍然是上一次执行 CREATE OR REPLACE VIEW 的定义。要让目标对象变化，还需要由 Snowflake CLI、CI/CD 或批准的发布脚本执行对应 SQL。

同样，Notebook 文件被同步到 Git，不代表 Notebook 的所有单元格都成功运行，也不代表结果数据已写入目标表。对执行型文件要区分源文件版本、执行身份、Query ID 和最终对象状态。

## 工程实施步骤

1. 为团队确定远程仓库、分支策略、PR 评审要求和文件目录布局。
2. 每位开发者使用自己的 Role 创建 Git-connected Workspace，并确认有权使用 API Integration 和 Secret。
3. 创建功能分支，修改 SQL、Notebook、Streamlit 或 dbt 文件；每个变更保持可独立 review。
4. 在 Changes 面板检查新增、删除和修改文件的 Diff，审查 SQL 变更、Notebook 输出、凭据和个人信息。
5. 开始工作前 Fetch/Pull 远端变更；Push 前解决冲突并验证合并后的文件。
6. 更新 Commit Author 信息并提交有说明的 Commit，再 Push 到远程分支。
7. 在 Git Provider 发起 PR，让 reviewer 检查 SQL 语义、对象依赖、数据影响和 Secret 泄露风险。
8. 对需要 Snowflake Task/Procedure 直接读取仓库文件的对象，单独创建 Role-owned Git Repository Clone，并授予最小权限。
9. 将 Git Commit SHA 与后续 CLI/CI 部署记录关联，部署完成后检查目标 Snowflake 对象定义和执行结果。
10. 定期撤销不再使用的 PAT/Secret/API Integration，删除已废弃分支和 Git Repository Clone。

## 场景分析

开发者 A 在自己的 Git Workspace 中修改 VIEW_PORTFOLIO_RISK.sql，开发者 B 同时修改同一文件。A 先 Commit/Push；B 随后 Push 时发现远端已变化。

B 应先 Pull 并检查 Diff，确认 A 的筛选条件和 B 新增的风险字段能否正确合并；若两处同时修改了相同的表达式，必须由代码 owner 判断应保留哪种业务逻辑。合并后要重新运行 SQL，检查 View 定义、行数和关键汇总，再提交新的 Commit。

即使这次 Push 成功，QA/PROD 的 VIEW_PORTFOLIO_RISK 也不会自动更新。之后的发布步骤由 CI/CD 或受控部署流程执行。若生产 Task 在运行时要读取这个 SQL 文件，应该从 Role-owned Git Repository Clone 读取发布后的版本，而不是依赖开发者 B 的个人 Workspace。

## 常见误区

- **把 Workspaces 当作 Database/Schema。** 它存储和组织开发文件，不替代数据库对象。
- **认为 Git-connected Workspace 可以直接共享给团队。** 它归创建者用户所有；团队协作走同一 Git 仓库和分支。
- **把 Git Workspace 与 Git Repository Clone 当成一个对象。** 一个是开发工作副本，一个是 Snowflake 对象读取仓库文件的入口。
- **认为 Push 会自动执行 SQL。** Push 只上传源文件；目标表、View、Task 和 Procedure 需要另行部署或运行。
- **只看文件名，不 review Diff。** SQL 过滤、字段顺序、Notebook 输出和凭据可能在修改中发生变化。
- **冲突时直接接受远端或本地全部内容。** 应比较差异并确认业务语义，不要把 Git 冲突消解当成自动正确合并。
- **把开发者 PAT 交给生产 Task 使用。** 生产对象应使用受控 Git Repository Clone、最小权限 Role 和独立发布身份。

## 完成标准

- [ ] 能说明 Workspaces、My Workspace 和 Shared Workspace 的关系。
- [ ] 能解释 Git Workspace 的用户所有权和不能直接共享的限制。
- [ ] 能区分 Fetch、Pull、Commit、Push 和冲突处理。
- [ ] 能说明 Git Workspace 与 Git Repository Clone 的不同用途。
- [ ] 能解释 Git 文件 Push 后为什么数据库对象不会自动更新。
- [ ] 能将 Commit SHA 与后续 Snowflake 部署和运行结果关联。

## 自测

1. 某开发者在 Git Workspace 中修改了 SQL 并 Push。为什么生产 View 不会自动变化？
2. Git Workspace 归 Role 所有还是归创建者用户所有？团队如何协作？
3. Snowflake Task 需要在运行时读取 Git 仓库中的脚本。为什么 Git Repository Clone 比开发者个人 Workspace 更合适？
4. Fetch 和 Pull 分别会更新什么？什么时候只需要 Fetch？
5. Push 冲突时，为什么不能直接选择 Accept all remote 就结束？还要验证什么？
6. Notebook 文件已提交到 Git，但 Notebook 结果表没有更新。应该检查哪些独立步骤？

## 参考资料

- [Workspaces](https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces)
- [Integrate workspaces with a Git repository](https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces-git)
- [Git in Snowflake](https://docs.snowflake.com/en/developer-guide/git/git-overview)
- [Git repository clone](https://docs.snowflake.com/en/developer-guide/git/git-repository)
