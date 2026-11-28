# Snowflake Native App：安装、引用与消费者权限

## 应用能安装成功，不等于消费者已经安全地接入数据

提供方发布一个 Native App，消费者安装后可以打开 Streamlit 页面，但访问企业已有的订单表时被拒绝。提供方拥有这张表的 SELECT 权限，不代表消费者安装的应用自动继承同样权限。

Native App 把应用代码、安装资源、Application Roles、References 和消费者授权组合为一个数据产品。安装流程中要把“应用需要创建什么”和“应用需要读取消费者已有的什么对象”分开验收。

## Manifest 与 Setup Script 分别描述什么

Manifest 定义应用包的安装资源、Setup Script、README、版本信息、请求的权限和 References。Setup Script 在安装和升级时执行，创建应用内部对象、Application Roles，并授予这些角色访问应用对象的权限。

Application Role 是 Native App 内部的授权主体，不等同于消费者账户的 Account Role。它把应用内部对象的能力暴露给消费者角色；消费者需把相应 Application Role 授给 Account Role 后才能使用应用功能。

~~~sql
CREATE APPLICATION ROLE IF NOT EXISTS app_user;

GRANT USAGE ON SCHEMA app_code TO APPLICATION ROLE app_user;
GRANT USAGE ON PROCEDURE app_code.get_dashboard() TO APPLICATION ROLE app_user;
~~~

提供方应将代码和版本化 Schema 管理在 Application Package 中，避免每次升级时不受控地替换消费者数据对象。

## App 内部对象和消费者现有对象通过不同路径授权

应用自己的表、View、Procedure 和 Streamlit 页面可通过 Application Role 授权给消费者使用。若应用要访问消费者账户里已有的 Warehouse、数据库对象或其他资源，则要声明并创建 Reference。

Reference 的基本流程是：
1. 提供方在 Manifest 中声明需要哪种对象引用和权限。
2. Setup Script 注册引用回调。
3. 消费者安装后审查应用请求的对象和权限。
4. 消费者选择具体对象并创建 Reference。
5. 消费者执行回调，让应用可通过该 Reference 访问被批准对象。

Reference 不是让消费者把数据库密码交给提供方。消费者应明确指定可访问对象和范围，应用只能获得已经批准的引用能力。

## 安装时应审查哪些权限

Native App 的权限请求包括运行资源和数据访问两类。运行资源权限可能允许应用创建 Warehouse、Task、Compute Pool 等资源；它们本身不等于允许应用读取消费者数据。消费者数据访问还要通过 References 和对应对象级授权。

安装前应核对应用请求的权限、专用 Warehouse/Compute Pool 的费用归属、Reference 指向的对象、Setup Script 会创建或替换的对象、Application Role 能访问的应用对象，以及是否请求 External Access 或外部服务。

安装 Native App 的 Role 会成为 APPLICATION 对象 Owner。不要删除这个 Role；应用的所有权管理依赖它。恢复应用所有权应按 Native App 生命周期文档处理，而不是尝试将应用 OWNERSHIP 简单转给另一个 Role。

## 版本升级时，代码替换和数据保留不是一回事

Native App 有 major version 与 patch。Patch 通常用于同一主版本内的兼容修复；提供方需要保持相邻版本的兼容承诺。一个应用同时最多保留两个 Major Versions。

升级过程中 Setup Script 会再次运行。Procedure、Function、Streamlit 等代码对象会按新版本替换；APPLICATION 边界内的数据表会保留，但前提是提供方遵守 Schema 兼容承诺。应用在升级时可能短暂不可用，长时间运行中的查询会继续使用启动时固定的版本完成。

Snowflake 通常自动升级 Native App；提供方也可以开放消费者维护策略，让消费者在设定窗口内控制升级。消费者应查看权限和 App Specification 是否发生变化，升级后验证应用页面、任务、对象引用和数据兼容。升级不是重新安装，不能简单地假设会清空数据或重置所有授权。

## 消费者安装验收要用真实消费者 Role

安装后分别用应用用户角色和管理角色测试：能否访问应用声明的功能、Reference 是否只指向批准对象、升级前后的 Schema 是否兼容，以及新增权限是否触发消费者审批。卸载前还要确认应用边界之外由消费者创建的对象归谁所有、是否需要迁移。

## 常见误区

- 认为 Application Role 与消费者普通 Role 是同一类角色。
- 认为安装成功就允许应用读取消费者所有数据库对象。
- 把运行资源权限理解为数据访问权限。
- 不审查 Reference 指向的具体对象。
- 删除安装应用的 Owner Role，破坏应用所有权管理。
- 认为升级只替换代码，或误以为升级会清空应用数据。

## 自测

1. 为什么 Native App 安装后仍需要消费者为应用创建 Reference？
2. Application Role 与消费者 Account Role 有什么区别？
3. Warehouse 创建权限为什么不代表应用获得消费者表的 SELECT 权限？
4. Native App 升级时，哪些代码会替换，哪些应用内数据会保留？
5. 为什么安装应用的 Owner Role 不应被随意删除？

## 参考资料

- [Native App manifest reference](https://docs.snowflake.com/en/developer-guide/native-apps/manifest-reference)
- [Create the setup script](https://docs.snowflake.com/en/developer-guide/native-apps/creating-setup-script)
- [Request references and object-level privileges from consumers](https://docs.snowflake.com/en/developer-guide/native-apps/requesting-refs)
- [Allow access to a consumer account](https://docs.snowflake.com/en/developer-guide/native-apps/ui-consumer-granting-privs)
- [Upgrades and app lifecycle](https://docs.snowflake.com/en/developer-guide/native-apps/consumer-guide-upgrades)
