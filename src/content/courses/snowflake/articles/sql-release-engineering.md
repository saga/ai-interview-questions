# SQL 定义版本控制与数据库迁移

## 本节要解决的问题

订单系统需要新增 CUSTOMER_TIER 字段。分析团队希望先让新版本报表使用它，旧版应用在两周内仍要能够正常运行；字段回填完成后，数据团队还要确保没有 NULL 和非法值，最后才删除旧的 CUSTOMER_GROUP 字段。

这不是简单的“把 SQL 放进 Git”。数据库发布至少涉及两类变化：

- **对象定义变化**：创建或修改 View、Procedure、Task、Policy 等对象，让目标环境达到预期定义。
- **有状态数据迁移**：回填历史记录、转换数据、去重、改变业务键或清理旧字段。这些操作会改变数据本身，需要可验证的迁移范围和恢复策略。

两者可以放在同一发布仓库，但不能假设它们使用同一个事务，也不能靠 Git Revert 恢复已经写入的数据。

## 核心知识

### 对象定义脚本和数据迁移脚本应该分开管理

建议将发布目录按用途拆分：

| 目录/文件 | 内容 | 运行特征 |
|---|---|---|
| ddl/ | View、Procedure、Task、Policy、Stage 等对象定义 | 描述目标对象状态 |
| migrations/ | 新列、数据回填、重编码、主键调整、历史清理 | 有顺序、有状态、有数据影响 |
| grants/ | Role、USAGE、SELECT、OWNERSHIP 等授权 | 需在对象创建后执行并复核 |
| validations/ | 行数、唯一键、金额和业务不变量检查 | 验证，不应修改业务数据 |
| rollback-or-repair/ | 可执行的恢复或前向修复脚本 | 针对具体迁移版本和失败情形 |

对象 DDL 可以使用 CREATE OR REPLACE 或 DCM Project 管理，但要明确其语义和影响；数据迁移则应有独立版本号、执行记录和完成条件。不要把一段含有 CREATE、UPDATE、DROP 和 GRANT 的大脚本作为不可分割的“部署命令”。

### 为每次数据迁移记录版本、校验和与执行结果

迁移记录表可以保存版本、文件校验和、执行环境和 Query ID：

~~~sql
CREATE TABLE IF NOT EXISTS ADMIN.SCHEMA_MIGRATION_HISTORY (
  MIGRATION_VERSION VARCHAR NOT NULL,
  FILE_NAME          VARCHAR NOT NULL,
  CHECKSUM_SHA256    VARCHAR NOT NULL,
  ENVIRONMENT        VARCHAR NOT NULL,
  STATUS             VARCHAR NOT NULL,
  STARTED_AT         TIMESTAMP_TZ,
  COMPLETED_AT       TIMESTAMP_TZ,
  EXECUTED_BY        VARCHAR,
  QUERY_ID           VARCHAR,
  NOTES              VARCHAR
);
~~~

这张表只是迁移审计记录；标准 Snowflake Table 的 PRIMARY KEY/UNIQUE 通常不强制唯一，迁移 Runner 仍需要保证同一环境同一版本只有一个执行者。可以通过受控发布锁、外部 CI 并发锁或其他串行机制实现。

运行迁移前应检查：
- 当前版本是否已经成功应用；
- 仓库中的脚本 SHA-256 是否与历史记录一致；
- 当前连接的账户、Database、Schema 和 Role 是否正确；
- 上一个版本是否失败或停留在中间状态；
- 执行前是否满足数据前置条件。

已应用的迁移文件不要事后改写。若发现旧脚本错误，应新增前向修复版本，保留历史文件和校验和，才能解释不同环境为什么出现不同对象/数据状态。

### Snowflake DDL 不能靠外层事务整体回滚

Snowflake 的 DDL 语句各自作为独立事务执行。若在显式事务中运行 DDL，它会先提交当前活动事务，再单独执行 DDL；随后开始新的事务。因此，不能假设下面这类脚本可以整体 ROLLBACK：

~~~sql
BEGIN TRANSACTION;

UPDATE ANALYTICS.MART.CUSTOMERS
SET CUSTOMER_TIER = 'STANDARD'
WHERE CUSTOMER_TIER IS NULL;

ALTER TABLE ANALYTICS.MART.CUSTOMERS
  ADD COLUMN CUSTOMER_SEGMENT VARCHAR;

ROLLBACK;
~~~

上面的 UPDATE 事务可能在 ALTER TABLE 执行前已经提交；DDL 自己也不能被后续 ROLLBACK 撤销。生产迁移应把 DDL 和可回滚的 DML 事务分开，明确每一步完成后的状态。

CREATE OR REPLACE 是单条语句的原子替换，不等于跨多条 SQL 的事务回滚。替换表对象时还要评估 grants、Stream 和依赖对象的影响；例如替换表会改变其变更历史，引用该表的 Stream 可能变成 stale。不能因为 CREATE OR REPLACE 一条语句原子，就把它当成无副作用的“安全重跑”。

### Expand–Migrate–Contract 让新旧应用有时间并存

字段重命名或结构调整通常不应一步完成。以增加 CUSTOMER_TIER 替换旧 CUSTOMER_GROUP 为例：

**Expand：增加新列或兼容视图**

~~~sql
ALTER TABLE ANALYTICS.MART.CUSTOMERS
  ADD COLUMN CUSTOMER_TIER_V2 VARCHAR;
~~~

旧应用仍使用 CUSTOMER_GROUP；新应用可以开始读取 CUSTOMER_TIER_V2。这个阶段不要删除旧列，也不要强制新列非空。

**Migrate：回填并校验历史数据**

~~~sql
MERGE INTO ANALYTICS.MART.CUSTOMERS AS target
USING (
  SELECT
    CUSTOMER_ID,
    CASE
      WHEN CUSTOMER_GROUP IN ('GOLD', 'PLATINUM') THEN 'PREMIUM'
      WHEN CUSTOMER_GROUP = 'SILVER' THEN 'STANDARD'
      ELSE 'BASIC'
    END AS CUSTOMER_TIER_V2
  FROM ANALYTICS.STG.CUSTOMER_TIER_MAPPING
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CUSTOMER_ID
    ORDER BY SOURCE_VERSION DESC
  ) = 1
) AS source
ON target.CUSTOMER_ID = source.CUSTOMER_ID
WHEN MATCHED AND target.CUSTOMER_TIER_V2 IS NULL
THEN UPDATE SET CUSTOMER_TIER_V2 = source.CUSTOMER_TIER_V2;
~~~

这段回填使用 CUSTOMER_ID 和 SOURCE_VERSION 选择一条来源记录，并只更新目标新列为空的记录，便于在数据未变化时重复执行。生产实现还要确认映射表的版本语义、目标客户键唯一性，以及新旧值冲突时的处理规则；不能把“只更新 NULL”误当成所有变更都自动正确。

回填后做质量验证：

~~~sql
SELECT
  COUNT(*) AS total_rows,
  COUNT_IF(CUSTOMER_TIER_V2 IS NULL) AS missing_tier
FROM ANALYTICS.MART.CUSTOMERS;

SELECT CUSTOMER_TIER_V2, COUNT(*)
FROM ANALYTICS.MART.CUSTOMERS
GROUP BY CUSTOMER_TIER_V2;
~~~

还要对比旧字段到新字段的映射、业务总量和各类客户数，确认没有未定义类别或意外合并。

**Contract：所有消费者迁移后再移除旧字段**

只有当新旧应用均已切换、下游依赖已更新、数据验证完成并经过观察期后，才执行 DROP COLUMN 或删除兼容 View。Contract 是不可轻率提前做的清理动作，应单独发布和审批。

### CREATE OR REPLACE、IF NOT EXISTS 和 COPY GRANTS 不是通用幂等策略

以下写法的含义不同：

- CREATE OR REPLACE VIEW：用新定义原子替换视图。需要考虑 grants、依赖和输出语义。
- CREATE TABLE IF NOT EXISTS：只在对象不存在时创建，不会将已有表结构自动升级到脚本中的新定义。
- CREATE OR REPLACE TABLE：可能替换已有数据对象，且影响 Stream 的变更历史；需明确数据与权限后果。
- COPY GRANTS：在适用的 CREATE/REPLACE 形式中复制原对象显式权限（不包括 OWNERSHIP）；不能因此忽略 Future Grants 和目标角色检查。

因此，发布脚本要先决定目标是“创建缺失对象”“将对象定义升级到目标版本”还是“变更数据”。不能仅凭加上 IF NOT EXISTS 或 OR REPLACE 就声称脚本可安全任意重跑。

### 发布失败后的恢复通常是前向修复，不是 Git 回滚

如果迁移失败在新增列之后、数据回填之前，可能只需要继续执行后续步骤；如果回填执行一半，先检查已处理行与批次范围，再从未完成范围继续；若新旧值映射错误，通常需要按保存的源快照和迁移版本编写修复脚本。

恢复前要确认：
- 已提交哪些 DDL/DML；
- 哪些对象已被替换或权限已变化；
- 下游 Task、Stream、View 和应用是否已经使用新结构；
- 是否已经产生外部副作用或发布数据；
- 回滚是否会丢弃新版本应用已写入的数据。

对已被新版本应用使用的数据，盲目把 schema 改回去可能造成数据丢失。更可控的方法是设计向前修复、双写观察期和明确的数据回填/补偿流程。

## 工程实施步骤

1. 为每个数据库变更标注对象定义、数据迁移、授权和验证类型。
2. 将已应用迁移文件视为不可变版本，记录脚本校验和、环境、执行 Role、Query ID 和状态。
3. 发布前检查目标环境对象版本、前置依赖、权限和数据前置条件。
4. 将 DDL 与 DML 分开考虑事务边界，不依赖一次 ROLLBACK 撤销跨语句迁移。
5. 对结构调整优先采用 Expand–Migrate–Contract，确保旧应用在迁移期间可继续运行。
6. 用稳定业务键、来源版本和幂等 MERGE 回填数据；处理重复、迟到、修订和未知类别。
7. 回填后执行 NULL、唯一性、分布、总量和下游输出校验，并留存迁移前后对账。
8. 对 CREATE OR REPLACE、COPY GRANTS、DROP COLUMN 和对象重建评估权限、Stream 与依赖影响。
9. 失败时先检查已提交状态和实际对象差异，再选择继续执行、前向修复或业务补偿。
10. 所有消费者完成切换并通过观察期后，再执行 Contract 清理，记录最终版本和批准人。

## 场景分析

客户主数据需要把 CUSTOMER_GROUP 改成 CUSTOMER_TIER。开发团队在一个脚本里执行 CREATE OR REPLACE TABLE、回填数据、删除旧列，然后希望在失败时用 ROLLBACK 回退。

在 Snowflake 中，DDL 隐式提交，脚本失败后可能留下已新增对象或已替换的表；若表被重建，相关 Stream 可能 stale。这个“整段脚本可回滚”的假设不成立。

更稳妥的发布分三个版本：
1. V101 增加 CUSTOMER_TIER_V2 和兼容 View，保持旧列不变。
2. V102 根据有版本的映射数据回填新列，校验 NULL、类别分布、客户数和旧/新映射差异；新应用开始读取新列。
3. 观察期结束，确认所有下游已迁移，再由 V103 移除旧列和兼容对象。

如果 V102 失败，应从迁移记录和 Query History 检查哪些步骤已经提交；若回填只完成部分客户，使用同一版本的幂等迁移继续补齐。若映射规则本身有误，则新增修复版本并记录影响范围，不能改写 V102 伪装历史上从未发生过错误。

## 常见误区

- **把所有 SQL 文件都当成同一种发布对象。** DDL 定义、DML 回填、Grant 和校验需要不同执行和恢复方式。
- **认为 Snowflake 的多条 DDL/DML 可以通过一个事务整体回滚。** DDL 会隐式提交并在独立事务执行。
- **把 CREATE TABLE IF NOT EXISTS 当成 Schema Migration。** 已存在对象不会自动升级为新定义。
- **滥用 CREATE OR REPLACE TABLE。** 可能改变数据、权限和 Stream Change Tracking 状态。
- **字段新增后立即删除旧列。** 下游消费者可能仍依赖旧字段，应该有兼容迁移期。
- **修改历史迁移脚本来修正错误。** 已执行脚本应保留，修复通过新版本完成。
- **把 Git Revert 当作数据库回滚。** 源代码回退不会撤销已提交 DDL 或已写入业务数据。
- **只检查 SQL 执行成功，不检查迁移后的数据。** 还要校验唯一性、空值、业务总量和下游消费者。

## 完成标准

- [ ] 能区分对象 DDL、数据迁移、Grant 和验证脚本。
- [ ] 能设计迁移版本、校验和、环境和 Query ID 审计记录。
- [ ] 能解释 Snowflake DDL 对事务提交和回滚的影响。
- [ ] 能用 Expand–Migrate–Contract 管理不兼容结构变更。
- [ ] 能设计基于业务键和来源版本的幂等回填。
- [ ] 能说明 IF NOT EXISTS、OR REPLACE 和 COPY GRANTS 的边界。
- [ ] 能在迁移失败时依据已提交状态选择前向修复或补偿，而不是只回退 Git。

## 自测

1. 一个脚本先 UPDATE 数据，再 ALTER TABLE，最后发生错误。为什么不能假设前面的 UPDATE 会随脚本一起回滚？
2. CREATE TABLE IF NOT EXISTS 遇到已有旧结构表时会做什么？它为什么不能替代迁移脚本？
3. 新列需要回填并切换多个应用。Expand、Migrate、Contract 三阶段分别做什么？
4. 历史回填执行一半后失败。如何确认已处理范围，并设计安全重跑？
5. CREATE OR REPLACE TABLE 可能对引用该表的 Stream 产生什么影响？恢复前要检查哪些依赖？
6. 新应用仍在使用新列时，为什么直接执行 Git Revert 或 DROP 新列可能造成更大故障？

## 参考资料

- [Transactions](https://docs.snowflake.com/en/sql-reference/transactions)
- [CREATE TABLE](https://docs.snowflake.com/en/sql-reference/sql/create-table)
- [CREATE OR REPLACE and object replacement](https://docs.snowflake.com/en/sql-reference/sql/create-table)
- [CI/CD with Snowflake](https://docs.snowflake.com/en/developer-guide/cicd)
