# Snowflake Git、CLI、DCM Projects 与 CI/CD 发布

## 把数据库对象当作可审查的交付物

生产 SQL、DDL、Procedure、Task、View 和 Policy 应进入版本控制。部署需要明确目标环境、身份、依赖顺序和回滚策略。不要把 Snowsight 中手工执行过的语句当成系统当前状态的唯一记录。

Snowflake Git Integration 可把 Git 仓库内容引入 Snowflake Workspace；本地开发也可以使用 Snowflake CLI。二者适合的工作方式不同，不应混淆为“所有部署都必须在 Snowsight”。

## 传统迁移与声明式管理

传统迁移脚本记录从版本 A 到版本 B 的增量 DDL。DCM Projects 则围绕期望对象定义和目标环境执行 PLAN / DEPLOY，对比目标状态并计算变更。选择哪一种，取决于团队现有流程、对象支持范围、审计要求和变更可预测性。

DCM 不意味着可以跳过审查。PLAN 输出应作为变更审查证据，重点检查对象替换、数据影响、权限变化和依赖顺序。

## 推荐 CI/CD 流程

~~~mermaid
flowchart TD
  A[Pull Request] --> B[SQL lint and static checks]
  B --> C[Deploy to DEV]
  C --> D[Integration and data tests]
  D --> E[Generate deployment plan]
  E --> F[Review privileges and destructive changes]
  F --> G[Deploy to PROD with service identity]
  G --> H[Post-deploy verification]
~~~

生产身份、DEV/TEST/PROD 目标和 Secret 应由 CI 环境管理。不要把个人连接配置、长期密钥或生产数据样本提交到仓库。

## 变更失败和回滚

DDL 不一定都能通过反向语句无损撤销。发布前要识别是否涉及数据转换、列删除、权限收缩和对象重建；高风险变更应采用兼容式演进，例如先加新列、双写或双读验证，再切换消费者。

发布后核验对象定义、授权、行数、关键指标和任务状态。出现问题时根据执行计划和数据影响决定回滚、前向修复或恢复历史数据。

## 检查题

1. Migration 脚本与 DCM Projects 在变更描述上有什么不同？
2. 为什么 DCM PLAN 仍然需要人工审查？
3. 哪些变更不能仅依赖反向 DDL 回滚？
