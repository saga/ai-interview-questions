# SAP IT Service Consultant 学习路线

**课程 ID：** `sap-it-service-consultant`  
**目标角色：** SAP IT Service Consultant、SAP Implementation Consultant、Application Support Consultant、Junior Solution Consultant  
**定位：** 面向客户交付与企业 IT 服务，不是 ABAP 开发培训，也不是某一个 SAP 模块的认证题集。

## 课程目标

学完后能够参与客户需求发现、业务流程分析、SAP 方案讨论、Fit-to-Standard、实施项目、集成与数据迁移、测试、上线和应用运维。初级顾问应能解释流程、提出正确问题、识别风险并形成清晰交付物；中级顾问应能独立负责一个工作流、协调业务和技术团队、分析方案权衡并推动问题闭环。

## 学习路线

| 阶段 | 主题 | 应达到的能力 | 建议产出 |
|---|---|---|---|
| 1. 顾问基础 | IT 服务咨询、需求发现、沟通与范围管理 | 从业务问题澄清目标、角色、约束和验收标准 | Stakeholder map、需求清单、问题陈述 |
| 2. 企业业务 | O2C、P2P、R2R、生产、服务流程 | 解释跨部门流程、关键业务对象和交接控制 | BPMN/流程图、业务对象清单 |
| 3. SAP 基础 | S/4HANA、部署形态、Fiori、系统景观 | 区分 Public/Private/On-premise 的能力和限制 | 系统景观图、版本与边界说明 |
| 4. 实施方法 | SAP Activate、Fit-to-Standard、配置与 Clean Core | 主持差异分析，控制定制范围，按阶段交付 | Fit-to-Standard backlog、决策记录 |
| 5. 方案实现 | 授权、集成、BTP、数据迁移 | 设计角色、接口契约、数据映射和扩展边界 | 角色矩阵、接口清单、迁移映射 |
| 6. 质量与上线 | 测试、缺陷管理、Cutover、培训 | 验证端到端业务场景并准备上线切换 | 测试策略、缺陷清单、Cutover plan |
| 7. Run 阶段 | Cloud ALM、ITSM、事件/问题/变更、服务管理 | 恢复服务、定位根因、监控业务流程并持续改进 | Runbook、SLA、Problem record |
| 8. 综合实践 | 客户案例和方案评审 | 从需求到运行支持完成一个可追溯交付闭环 | Solution outline、风险与决策日志 |

## 30 个知识主题（含 Coursera 课程对齐补充）

### 1. IT 服务咨询与顾问基本功

顾问职责、客户沟通、问题澄清、范围管理、价值与交付边界。重点：区分业务问题、流程问题、应用问题和技术问题；通过访谈确认目标、现状、约束和成功指标；把口头需求转成可验证的需求与决策；管理范围、假设、依赖、风险和升级路径。

### 2. 需求发现与业务分析

Stakeholder 访谈、需求分类、流程建模、需求追溯、验收标准。重点：识别业务角色和决策人；通过场景、数据和例外流程发现真实需求；区分业务需求、功能需求、非功能需求和约束；维护需求到设计、测试和验收的追溯关系。

### 3. 端到端企业业务流程

Record-to-Report、Procure-to-Pay、Order-to-Cash、Plan-to-Produce、Hire-to-Retire。重点：理解跨部门业务流程和关键业务对象；识别流程交接、主数据依赖、财务过账和控制点；从端到端结果评估局部配置的影响。

### 4. SAP S/4HANA 产品与架构

S/4HANA、HANA、Fiori、业务对象、云版本和系统景观。重点：理解 S/4HANA 的核心定位、简化数据模型和业务对象；区分 Public Edition、Private Edition 与本地部署的边界；描述开发、测试、质量和生产环境及传输路径。

### 5. Fit-to-Standard 与流程适配

SAP Best Practices、差异分析、流程决策、扩展边界。重点：先理解标准流程和业务目标，再记录真实差异；区分必须满足的法规/业务差异与习惯性定制；评估配置、流程调整、扩展或接受差异的成本和生命周期影响。

### 6. SAP Activate 与实施方法

Discover、Prepare、Explore、Realize、Deploy、Run、质量门禁。重点：理解 SAP Activate 阶段、交付物、工作流和治理；将 Fit-to-Standard、配置、数据迁移、测试和上线准备纳入迭代计划；用可验收成果管理阶段退出。

### 7. 配置、扩展与 Clean Core

CBC、SSCUI、配置、ABAP Cloud、Key User Extensibility、Side-by-Side。重点：区分配置、定制开发和平台扩展；优先使用标准能力与受支持扩展点；评估升级兼容性、生命周期成本、可测试性和供应商支持边界。

### 8. SAP Fiori 与用户体验

Launchpad、业务角色、应用目录、空间页面、任务流。重点：从业务角色和任务设计 Fiori 使用体验；理解 Launchpad 内容、目录和授权关系；避免把 UI 可见性当成后端授权；通过用户场景验证效率和错误预防。

### 9. 身份、角色与授权设计

Business Roles、Catalogs、组织级限制、SoD、最小权限。重点：按岗位职责设计角色；将业务授权与组织范围结合；识别职责分离冲突和特权访问；用正向与反向测试验证授权，而不是只检查角色分配成功。

### 10. SAP 集成与接口

OData、REST、SOAP、IDoc、RFC、事件、API Management。重点：选择同步 API、异步消息或批量交换方式；定义契约、身份、错误处理、重试、幂等、顺序和监控；明确系统记录源与接口责任边界。

### 11. 数据迁移与主数据

Business Partner、Material、客户/供应商、Migration Cockpit、质量核对。重点：盘点来源、映射、清洗和转换规则；确定主数据所有者与黄金记录；执行试迁移、对账和业务验证；管理历史数据、增量切换和回退限制。

### 12. 测试策略与质量保障

Unit、SIT、UAT、回归、自动化、缺陷分级。重点：从端到端业务流程设计测试；覆盖正向、异常、权限、接口、数据和批处理；建立需求到测试证据的追溯；按业务影响、风险和修复成本管理缺陷。

### 13. SAP Cloud ALM 与交付可观测性

Implementation、Operations、任务、测试、监控、告警。重点：理解 Cloud ALM 在实施和运维中的作用；用任务、流程、测试和监控形成项目与运行视图；将告警关联到业务影响、责任团队和处置流程。

### 14. ITSM 与 SAP 应用运维

Incident、Problem、Change、Request、Knowledge、SLA。重点：区分事件恢复、根因消除、变更控制和服务请求；按影响与紧急度分级；维护知识和已知错误；以服务级别、业务影响和重复发生率衡量运行质量。

### 15. SAP Service Management 业务能力

Service Order、Service Contract、Repair、Recurring Service、Billing。重点：理解服务合同、服务订单、资源执行、维修、计费和分析之间的关系；识别服务主数据、物流、财务和工时集成；按企业服务模式确定适用范围。

### 16. SAP Business Technology Platform

Integration Suite、Build、CAP、Event Mesh、扩展与平台服务。重点：理解 BTP 作为集成、扩展和应用平台的定位；按需求选择 API 集成、事件、工作流或 side-by-side 扩展；评估身份、网络、数据驻留、成本和运维责任。

### 17. 安全、审计与合规

审计日志、数据保护、加密、SoD、控制证据、职责边界。重点：将业务风险映射到身份、数据、接口和运维控制；明确客户、实施方和云服务商责任；设计审计证据、保留、访问审查和例外处理。

### 18. 报表、分析与业务指标

Embedded Analytics、CDS Views、指标定义、数据语义。重点：从业务决策定义指标口径和粒度；识别数据来源、刷新延迟和权限约束；避免在不同报表中重复定义同一指标；验证数据与源业务流程的一致性。

### 19. 项目治理与客户交付

计划、范围、风险、依赖、决策日志、培训、Cutover。重点：建立工作流、责任矩阵和决策机制；管理跨团队依赖、范围变更和风险；规划培训、切换、超保支持和业务连续性；让交付物可验收、可移交。

### 20. 故障诊断与服务恢复

日志、队列、接口监控、性能、数据异常、根因分析。重点：先界定影响范围和业务优先级，再收集证据；区分症状、触发条件和根因；安全止损并验证恢复；通过问题管理和变更流程防止复发。

## 需要掌握的 SAP 产品与概念

- **SAP S/4HANA**：理解 ERP 核心、业务对象、主数据和端到端业务流程。Public Edition 与 Private Edition 的配置、扩展和运维边界不同，学习时必须标明所讨论的版本。
- **SAP Fiori**：理解 Launchpad、业务角色、目录和应用授权；从任务流程而不是事务码清单理解用户体验。
- **SAP Activate**：用于组织实施阶段、工作流、交付物和质量门禁；不要把方法论阶段当成项目计划的替代品。
- **SAP Cloud ALM**：了解实施项目管理、流程/测试管理，以及运行阶段的监控和告警。Cloud ALM 的功能应以当前产品文档为准。
- **SAP BTP**：了解 Integration Suite、事件、工作流和扩展能力；只有在标准配置无法满足明确需求时才评估扩展。
- **接口与数据**：理解 OData、REST、SOAP、IDoc、RFC、事件集成及主数据迁移的基本作用，不要求初级顾问成为每种技术的开发专家。
- **业务模块**：先建立跨模块流程概念，再按项目方向深入 Finance、Procurement、Sales、Manufacturing 或 Service，不要求一开始平均掌握所有模块。

## 初级与中级能力边界

**初级（Foundation）**：能解释常见业务流程和 SAP 基本概念；能参与访谈、记录需求、识别标准流程与差异；能描述接口、数据迁移、测试和运维的基本流程；遇到未知问题能收集证据并正确升级。

**中级（Consultant）**：能独立负责一个业务/技术工作流；主持 Fit-to-Standard workshop；维护需求、设计、配置、测试的追溯关系；评估定制、集成和数据方案的成本与风险；协调客户、开发、Basis、安全和供应商团队；推动问题从恢复到根因修复。

## 实战案例：订单到收款的云 ERP 实施

客户计划将分散的销售、交付和财务流程整合到 S/4HANA Cloud。现有客户主数据重复，价格规则存在例外，外部 CRM 需要同步订单，财务团队要求月结数据可核对。顾问需要：

1. 访谈销售、仓储、财务和 IT，确认业务目标、现状流程、关键指标和例外场景。
2. 以标准 O2C 流程开展 Fit-to-Standard，区分流程调整、配置和确有必要的扩展。
3. 明确 Business Partner 等主数据治理、清洗、迁移、对账和业务所有者。
4. 设计 CRM 到 SAP 的接口契约、身份、重试、幂等和异常处理。
5. 设计角色授权和职责分离，验证销售、财务和管理员权限边界。
6. 覆盖订单、交货、开票、过账、接口失败和月结的端到端测试。
7. 制定 Cutover、培训、监控、事件分级、超保支持和问题管理安排。

最终交付不是一份配置清单，而是业务流程、需求、决策、数据、接口、测试和运行责任之间可追溯的方案。

## 建议学习顺序与节奏

- **第 1–2 周**：顾问基本功、需求发现和企业端到端流程；能够画出一个业务流程并识别关键角色与数据。
- **第 3–4 周**：S/4HANA、Fiori、部署形态、SAP Activate；完成一份 Fit-to-Standard 差异分析。
- **第 5–6 周**：配置与 Clean Core、授权、集成、BTP 和数据迁移；形成接口清单、角色矩阵和数据映射。
- **第 7–8 周**：测试、Cloud ALM、ITSM、上线和运行支持；完成案例方案及一次模拟客户汇报。

时间只是参考。没有系统练习环境时，使用 SAP 官方 Learning Journey、产品帮助文档和案例推演；不要把阅读完成等同于具备实施经验。

## 题库结构

当前包含 200 道题，覆盖 20 个主题，每个主题 10 题；难度分为 easy、medium、hard，重点考查顾问判断、业务分析、实施权衡和问题处理。题目是学习与面试训练材料，不是 SAP 官方认证考试题，也不代表所有 SAP 产品版本具有相同功能。

## 官方学习与参考资料

- [SAP Learning: Implementing SAP S/4HANA Cloud Public Edition](https://learning.sap.com/learning-journeys/implementing-sap-s-4hana-cloud-public-edition) — 实施团队、系统景观、授权、Fit-to-Standard、配置、Fiori、集成、迁移和测试。
- [SAP Learning: Implementing SAP S/4HANA Cloud Private Edition](https://learning.sap.com/learning-journeys/implementing-sap-s-4hana-cloud-private-edition-1) — Private Edition 实施路径。
- [SAP Learning: End-to-End Business Processes](https://learning.sap.com/learning-journeys/applying-end-to-end-business-processes-in-sap-business-suite) — 跨财务、人力、采购、生产、销售和服务的流程集成。
- [SAP Learning: SAP S/4HANA Cloud Private Edition for Service](https://learning.sap.com/learning-journeys/implementing-sap-s-4hana-cloud-private-edition-for-service-1) — 服务订单、服务合同、维修、Recurring Services 和分析。
- [SAP Help: SAP Cloud ALM Implementation](https://help.sap.com/docs/cloud-alm/feature-scope-description/implementation) — 实施项目、系统景观、流程、任务和测试。
- [SAP Cloud ALM Expert Portal](https://support.sap.com/en/alm/sap-cloud-alm/implementation/sap-cloud-alm-implementation-expert-portal.html) — 按项目阶段和能力查找实践指导。
- [SAP Help: SAP Cloud ALM](https://help.sap.com/docs/CloudALM) — 当前产品功能和操作说明。

## 完成标准

学员能够在一个给定客户案例中说明：客户要解决什么问题、标准 SAP 流程如何覆盖、差异为何存在、方案为何这样选择、数据和接口如何处理、如何验证、上线风险如何控制，以及 Run 阶段由谁负责。能清楚解释边界和未知项，比堆砌模块名更重要。


## Coursera SAP Technology Consultant Professional Certificate 对齐

参考 [SAP Technology Consultant Professional Certificate](https://www.coursera.org/professional-certificates/sap-technology-consultant)。该项目由 SAP 提供，包含七门课程，面向希望进入 SAP 领域的初学者，强调咨询技能、企业系统环境、客户发现、方案设计、实施测试、综合项目模拟和职业发展。

| Coursera 课程 | 本题库对应主题 | 练习产出 |
|---|---|---|
| SAP Professional Fundamentals | SAP 顾问职业基础与协作 | 角色协作图、客户沟通计划 |
| Understanding the Enterprise Systems Environment | 企业系统环境与技术基础 | 系统上下文图、部署模型比较 |
| SAP Customer Engagement and Discovery | 客户参与、发现与价值分析 | 访谈纪要、Stakeholder map、Customer Journey Roadmap |
| Designing an SAP Solution | SAP 方案设计、演示与提案 | Gap Analysis、Demo、Technical Design Outline |
| Implementing an SAP Solution | SAP 方案实施与部署；测试计划、测试脚本与质量保障 | 环境与部署计划、测试包、缺陷记录 |
| SAP Technology Consultant Hands-on Project | 综合实施项目与交付物实践 | 端到端项目档案和方案汇报 |
| Becoming an SAP Professional | SAP 职业发展与求职准备 | 岗位目标、学习与认证计划、简历和面试案例 |

### 新增的 10 个知识主题

#### 21. SAP 顾问职业基础与协作

SAP 生态、技术顾问与功能顾问职责、客户沟通、系统思维、关系管理，以及 Waterfall、Agile、DevOps 和 Cloud 交付方式。 区分技术顾问、功能顾问、项目经理、开发人员和客户业务负责人的职责。；理解 SAP 生态中客户、SAP、实施伙伴和产品团队的协作关系。；掌握客户沟通、积极倾听、承诺管理、冲突处理和升级机制。；比较 Waterfall、Agile、DevOps 和 Cloud 交付方式的适用场景。

#### 22. 企业系统环境与技术基础

企业架构、基础设施、计算/网络/存储、On-Premises、Cloud、Hybrid、Multi-Cloud，以及 SAP 平台、ABAP、Java、API、Fiori 和 RAP。 从业务、应用、数据、技术和安全视角描述企业系统环境。；理解 Compute、Network、Storage 与应用运行环境的基本关系。；比较 On-Premises、Cloud、Hybrid 和 Multi-Cloud 的责任与运维差异。；理解 SAP S/4HANA、Fiori、API、ABAP、Java 和 RAP 的基本定位。

#### 23. 客户参与、发现与价值分析

Stakeholder 识别、客户访谈、Discovery Workshop、现状流程和数据分析、Fit-to-Standard 准备、Customer Journey Roadmap 和价值沟通。 识别客户战略、业务目标、流程、技术环境、数据和关键约束。；设计访谈问题、Discovery Workshop 和 Stakeholder map。；准备 Fit-to-Standard 会议、标准流程演示和差异记录。；形成 Customer Journey Roadmap、价值说明和客户 sign-off。

#### 24. SAP 方案设计、演示与提案

需求到系统和数据需求映射、Gap Analysis、BTP 能力评估、SAP Best Practices、Demo、Pitch、Re-design 和 Technical Design Outline。 将业务需求映射到应用、数据、集成、安全和运行要求。；比较 SAP 标准能力、BTP 能力与客户现有环境的差距。；使用预置内容和真实业务场景构建 Demo。；编写包含范围、组件、接口、数据、约束和假设的 Technical Design Outline。

#### 25. SAP 方案实施与部署

环境准备、基线配置、SAP Best Practices、测试数据清洗与匿名化、部署、监控、上线签署和跨团队协作。 区分开发、测试、质量和生产环境的用途与变更边界。；使用 SAP Best Practices 和基线配置作为实施起点。；准备测试数据，执行清洗、脱敏和匿名化。；协调配置、集成、部署、监控和上线签署。

#### 26. 测试计划、测试脚本与质量保障

Test Plan、Test Script、Unit、SIT、UAT、Regression、自动化、测试证据、缺陷记录和修复验证。 将需求转化为可执行的测试场景、步骤和预期结果。；区分 Unit、SIT、UAT、Regression 和自动化测试。；记录缺陷复现步骤、环境、数据、影响和修复建议。；通过重测、回归和验收证据判断质量状态。

#### 27. 项目管理、敏捷协作与治理

范围、计划、里程碑、Agile/Waterfall、RACI、风险、依赖、变更、沟通、决策记录和项目关闭。 建立项目目标、范围、里程碑、工作流和交付物基线。；理解 Agile Backlog、迭代评审和 Waterfall 阶段门。；明确 RACI、风险所有者、跨团队依赖和升级路径。；管理范围变更、状态沟通、决策记录和项目关闭。

#### 28. 综合实施项目与交付物实践

将客户分析、技术环境评估、需求发现、方案提案、设计展示、实施、QA 和项目复盘串成完整案例。 分析客户背景、转型驱动、关键角色和当前技术环境。；形成需求、范围、假设、差距、方案选项和客户确认。；准备 Solution Proposal、Technical Design Outline 和演示材料。；完成实施协作、测试、交付物评审和项目总结。

#### 29. 上线后评估、项目关闭与持续改进

Post-Implementation Review、业务收益评估、Lessons Learned、运维交接、项目关闭和 Post-Production Roadmap。 评估业务目标、方案质量、测试结果和上线表现。；记录 Lessons Learned、遗留事项、风险和责任人。；完成运维交接、知识转移和支持模型确认。；制定 Post-Production Roadmap 和持续改进优先级。

#### 30. SAP 职业发展与求职准备

行业和产品领域、岗位认知、SAP Learning Journey、认证路径、简历、面试和个人职业发展计划。 理解行业、SAP 产品组合和不同顾问岗位的工作内容。；根据目标岗位选择 SAP Learning Journey 和认证路径。；把课程项目和实践产出转化为可信的简历经历。；制定包含实践、反馈和能力验收的职业发展计划。

### 七门课程的学习顺序

1. SAP Professional Fundamentals：理解顾问角色、客户关系、交付方式和职业要求。
2. Understanding the Enterprise Systems Environment：建立企业 IT、云、SAP 平台和应用开发模型的基础认知。
3. SAP Customer Engagement and Discovery：练习客户分析、访谈、需求发现、Fit-to-Standard 和价值沟通。
4. Designing an SAP Solution：完成差距分析、技术方案、演示和设计说明。
5. Implementing an SAP Solution：理解环境、配置、测试数据、实施、监控和上线。
6. SAP Technology Consultant Hands-on Project：把前五门课的能力串成端到端客户项目。
7. Becoming an SAP Professional：根据目标岗位制定学习、认证和求职计划。

建议先完成前五阶段的知识学习，再做综合项目；职业规划贯穿整个过程。

## 题库更新

当前 SAP 课程共 **400 道原创情境选择题**：原有 200 道覆盖 SAP 业务、应用和服务运维；新增 200 道对齐 Coursera 七门课程，覆盖上述十个补充主题。新增题目只使用 easy 和 medium 两档，每个新增主题 20 道，其中 8 道 easy、12 道 medium。题目不是 Coursera 作业或 SAP 官方认证考试题的复制。
