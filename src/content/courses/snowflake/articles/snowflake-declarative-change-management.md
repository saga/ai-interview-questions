# CREATE OR ALTER 与数据库变更管理

## 本节要解决的问题

在 Snowflake 中管理对象定义变更，既要理解单对象 DDL 的更新边界，也要理解 DCM Projects 对一组对象的声明式管理。CREATE OR ALTER 解决单对象的“存在则按定义修改、不存在则创建”；DCM Projects 管理目标环境中的对象集合、授权和数据质量 Expectation。二者都不能替代有业务规则的数据迁移脚本。

## 核心知识

### CREATE OR ALTER 把 CREATE 与 ALTER 合并，但受 ALTER 能力限制

CREATE OR ALTER 使用 CREATE 对象的定义语法，但修改现有对象时遵循对应 ALTER 命令的限制。它的目标是尽量保留对象的数据、关联、标签、策略和授权；但若目标定义要求删除列，列中数据可能丢失。对于 Table，当前支持的对象类型和变更种类有明确限制，例如部分 CTAS、CLONE、LIKE、虚拟列或不兼容类型变更不在支持范围内。

它也不是完全无副作用的“声明式重建”。对象转换可能只部分应用；Snowflake 要求检查对象实际状态，选择向前修复或按 ALTER 语句手动恢复。修改前应保存对象定义、关键数据对账和回滚点。

示例：

~~~sql
CREATE OR ALTER TABLE MART.ORDERS (
  ORDER_ID NUMBER NOT NULL,
  CUSTOMER_ID NUMBER,
  ORDER_STATUS VARCHAR(30),
  ORDER_TOTAL NUMBER(12,2)
);
~~~

如果已存在的表包含额外列，这段定义可能改变既有列结构；不能把“没有写入定义的列”简单理解为一定保留。应先核对 CREATE OR ALTER 对应对象文档的具体行为和风险。

### DCM Projects 管理一组对象的目标状态

DCM Project 由 Manifest 和一个或多个 SQL 对象定义文件组成。定义文件通过 DEFINE、GRANT、ATTACH 描述对象、授权和附加的数据质量规则；Snowflake 根据目标状态与当前环境计算差异。项目文件通常与 Git 一起版本管理，可以使用 Snowflake CLI 或 Snowsight 进行 Plan 和 Deploy。

PLAN 是 dry run：列出将创建、修改和删除的受管对象，不修改账户。DEPLOY 才会应用差异。部署时，已定义但不存在的对象会创建；已存在且不同的对象会修改；无变化的对象跳过；当前受项目管理但已从定义中移除的对象会被删除。GRANT 与 Expectation 也遵循项目声明。因此，项目定义文件的删除不是无害的清理动作，必须在 PLAN 中审查。

### 声明式对象管理与数据迁移应分开

DCM definition files 主要描述目标对象和授权，不是任意 SQL 作业编排。需要分批回填历史数据、修复业务数据、校验旧值、迁移外部依赖或执行非幂等操作时，应使用独立、版本化的数据迁移脚本或 Task/Procedure。

一个 DCM Project 同时只能有一个部署实例；不同配置不能作为同一项目在同一环境并存。实践中通常为每个环境建立独立 DCM Project，复用同一套定义文件但使用各自配置。生产 DCM Project 的 Owner 应使用专用、最小权限角色，避免开发环境项目拥有生产部署能力。

## 工程实施步骤

1. **盘点对象和变更类型。** 将表、视图、Task、Procedure、Stage、Role/Grant 和数据回填需求分开列出，标明是否属于 CREATE OR ALTER、DCM 定义或迁移脚本。
2. **核对 DDL 限制。** 对每种目标对象查看 CREATE OR ALTER 的支持范围、ALTER 限制和可能丢失的数据；对删除列、类型变更、依赖对象和策略变更进行显式评审。
3. **建立 DCM 项目结构。** 将 Manifest、环境目标和对象定义文件纳入 Git；按业务层或应用边界组织文件，而不是把所有对象混在一个超大文件。
4. **拆分环境身份。** 开发、测试、生产使用不同 DCM Project 与 Owner Role；生产部署身份只拥有项目实际需要的创建、修改和授权能力。
5. **先执行 PLAN。** 检查将创建、修改、删除的对象、Grant 和 Expectation；计划中出现非预期 DROP 时停止部署，修正定义或拆分项目边界。
6. **分离数据回填。** 对新增列、历史值转换或跨表迁移使用单独 migration 脚本，定义批次、幂等键、断点和数据对账。
7. **执行部署与验证。** Deploy 后核对对象定义、Grant、依赖状态、Task 状态和数据质量结果；不能只检查命令退出码。
8. **记录漂移与项目所有权。** 使用 DCM Project 的受管对象列表和部署历史定位人工修改；明确对象是否继续由 DCM 管理，或通过 UNSET DCM PROJECT 等方式转交管理。
9. **演练失败恢复。** 对 CREATE OR ALTER 部分更新检查 DESCRIBE/SHOW 结果，按文档向前修复或手工 ALTER 回滚；对 DCM 部署失败保留 PLAN、部署历史和数据恢复证据。
10. **保护销毁操作。** PURGE 会删除项目管理的实体并撤销相关授权，只应用于经确认的临时环境；不能把 DROP DCM PROJECT 等同于自动清理所有受管对象。

CLI 工作流示例：

~~~bash
# 在包含 manifest.yml 的 DCM 项目目录执行
snow dcm plan --target PROD

# 只有审查 PLAN 输出后才部署
snow dcm deploy --target PROD
~~~

## 场景分析

开发环境需要给订单表新增 ORDER_STATUS，将旧字段 STATUS_TEXT 映射到新枚举，并更新视图、Task 和报表。团队打算用一条 CREATE OR ALTER TABLE 替换所有上线步骤。

这会混淆对象定义和数据迁移。更安全的流程是先确认新增列对旧应用兼容，再通过 DCM PLAN 审查表和依赖视图的变化；部署后用独立、可重放的 migration 作业分批回填 ORDER_STATUS，对账未映射值和订单总数；然后更新消费端，最后才评估是否删除 STATUS_TEXT。若项目定义中移除了旧列或对象，DCM 计划可能包含 DROP，必须在生产部署前明确审查。

验收需证明旧应用在兼容窗口内仍可工作、新旧字段对账一致、回填可重试且不会重复写入，生产 Role 不能越权部署其它项目。

## 常见误区

- **把 CREATE OR ALTER 当成无条件安全的幂等迁移。** 它受 ALTER 限制，部分变更可能部分应用，删除列还可能造成数据丢失。
- **把 CREATE OR ALTER 与 DCM Projects 当成同一个机制。** 前者处理单对象定义，后者管理受管对象集合和部署状态。
- **认为从 DCM 定义文件中删除对象只是停止管理。** 对已受项目管理的对象，下一次 Deploy 可能会删除对象并撤销 Grant。
- **把业务数据回填放进声明式对象定义。** 分批迁移、跨表转换和历史修复需要独立脚本及幂等策略。
- **所有环境共用一个 DCM Project 实例。** 一个 Project 同时只允许一个部署实例，不同环境应分开管理。
- **看到 PLAN 成功就直接上线。** 还要审查 DROP、Grant、数据影响、Owner 权限和回滚路径。

## 完成标准

- [ ] 能说明 CREATE OR ALTER 对单对象的作用和 ALTER 限制。
- [ ] 能区分 CREATE OR ALTER、DCM Project 和数据迁移脚本。
- [ ] 能解释 PLAN 与 DEPLOY 的差异及潜在 DROP 行为。
- [ ] 能为每个环境配置独立 Project 和最小权限部署身份。
- [ ] 能处理部分更新、数据回填、漂移和失败恢复。

## 自测

1. 已有表通过 CREATE OR ALTER 更新时，为什么不能仅凭 SQL 执行成功就认定没有数据损失？
2. 某对象从 DCM definition file 中移除后，下一次 Deploy 可能发生什么？上线前应查看哪一步输出？
3. 新增列后需要将历史订单状态从自由文本映射到枚举，为什么应把回填放在独立 migration 中？
4. 同一 DCM Project 为 DEV 和 PROD 使用不同配置，为什么通常应该为两个环境建立独立项目实例？
5. CREATE OR ALTER 部分更新失败时，如何确认已应用的改动并恢复到有效状态？

## 参考资料

- [CREATE OR ALTER object commands](https://docs.snowflake.com/en/sql-reference/sql/create-or-alter)
- [CREATE TABLE and CREATE OR ALTER TABLE limitations](https://docs.snowflake.com/en/sql-reference/sql/create-table)
- [DCM Projects overview](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-overview)
- [Deploy and manage DCM Projects](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-use)
- [DCM Project files and templates](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-files)
