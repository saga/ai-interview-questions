# SAP IT Service Consultant 学习路线

**课程 ID：** `sap-it-service-consultant`  
**目标角色：** SAP IT Service Consultant、SAP Implementation Consultant、Application Support Consultant、Junior Solution Consultant  
**定位：** 面向客户交付与企业 IT 服务，不是 ABAP 开发培训，也不是某一个 SAP 模块的认证题集。

## 适用对象与题目设计基本规则

本课程首先面向刚毕业的大学生和实习生，而不是已经独立交付过 SAP 项目的顾问。题目中的“初级”和“中级”以应届毕业生的学习阶段为参照，不代表行业从业者的初级/中级职级。

学习和考核应围绕实习生真实能够承担的工作：理解常见业务流程和 SAP 基本概念；按指导准备会议材料、整理问题、记录需求和行动项；根据既定步骤收集信息、执行获授权的测试、核对结果；如实汇报进度和错误；遇到不确定、超权限或可能影响客户/生产环境的事项，及时向带教顾问或项目负责人确认。

不把独立主持客户 Workshop、决定方案取舍、批准变更、承诺交付日期、修改生产环境、独立处理重大 Incident 或协调多个部门的决策作为实习生的默认能力。涉及这些工作时，考察重点应是能否识别责任人、准备必要信息、说明风险并正确升级，而不是假设候选人已有职场经验。

SAP 技术主题也遵循同一边界：先理解概念用途、基本流程、常见输入输出、主要风险和由谁负责；不要求候选人凭空设计完整企业级方案或背诵项目中才会接触的操作细节。中级题可以要求比较常见选项、判断下一步和识别影响，但仍应在给定信息和实习生权限内作答。

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

## 40 个知识主题（含 Coursera 课程对齐补充）

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

这里的级别以没有正式项目经验的毕业生为参照。初级题主要检查概念识别、基本流程和安全的第一步；中级题增加信息不完整、角色协作和简单权衡，但不要求候选人代替资深顾问作决定。

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

当前包含 600 道题，覆盖 40 个主题，其中 200 道为面向毕业生实习生的亚太客户沟通与项目协作情境题；该批题目仅分 easy、medium，重点考查顾问判断、业务分析、实施权衡和问题处理。题目是学习与面试训练材料，不是 SAP 官方认证考试题，也不代表所有 SAP 产品版本具有相同功能。全课程统一遵守毕业生实习生能力边界：不以真实项目履历、客户管理经验或独立交付经验作为答题前提。

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


## 面向毕业生与实习生的客户项目实践

这部分不是要求候选人证明自己已经做过 SAP 实施，而是检查他们是否具备进入客户项目的基本工作判断。初级顾问不需要独立决定方案、批准变更或承诺上线日期；需要做到的是理解任务、及时沟通、保留事实、识别风险、尊重权限并把问题交给正确的人。

新增 10 个主题、200 道情境题，全部围绕初级顾问和实习生可能遇到的具体工作展开：

| 主题 | 典型场景 | 初级顾问应做到 |
|---|---|---|
| 客户沟通与期望管理 | 面向初级顾问的客户沟通：确认目的、受众、期限和责任；用简洁、准确、可跟踪的方式更新进展；不擅自承诺、不隐瞒不确定性。 | 区分事实、判断、假设和承诺，避免把未确认事项说成已完成。 |
| 日本及亚太客户沟通 | 在日本及亚太多文化团队中开展沟通：会议前准备、语言确认、沉默和模糊表达的澄清、尊重对方决策流程，同时避免文化刻板印象。 | 根据客户组织和个人偏好确认语言、沟通渠道、会议方式和决策流程。 |
| Stakeholder 协调与决策流程 | 识别业务负责人、流程所有者、IT、采购、安全和审批人；理解共识建立、正式批准和决策记录之间的区别。 | 建立简单的 Stakeholder map，标明提供信息、评审、批准和执行角色。 |
| 会议、Workshop 与会议纪要 | 准备并参与客户会议、需求 Workshop、演示和评审；管理议程、时间、问题、行动项和会后确认。 | 会前明确会议目标、参会角色、议程、预读材料和需要的决定。 |
| 工作汇报、风险报告与升级 | 培养及时、准确的工作汇报习惯；用事实、影响、行动和请求说明问题；理解日本企业常见的 Ho-Ren-So（报告、联络、商量）作为一种沟通实践，而非僵化规则。 | 尽早报告阻塞、延期、错误和风险，不等到截止日才说明。 |
| 需求澄清与跨语言理解 | 从口头描述、邮件和会议记录中澄清需求；处理缩写、翻译、含糊表达和相互矛盾的信息；把需求转成可验证场景。 | 通过谁、何时、做什么、输入、输出、异常和业务影响澄清场景。 |
| 任务管理、依赖与交接 | 理解项目任务、责任分配、依赖、版本、交接和变更控制；让工作可见、可追踪，避免口头任务和责任真空。 | 将任务拆分为明确交付物、负责人、期限、依赖和完成标准。 |
| 客户支持、Incident 与服务体验 | 从用户报告中识别事件影响、优先级和服务目标；及时更新客户、保护数据、正确升级，并跟踪恢复与验证。 | 区分 Incident、Service Request、Problem 和 Change 的基本目的。 |
| 变更管理、培训与 UAT | 理解系统上线不仅是技术部署，还涉及业务流程变化、用户准备、培训、UAT、反馈和采用情况。 | 识别受影响用户、岗位、流程和工作方式变化。 |
| 实习生职业行为与团队协作 | 面向无正式项目经验的毕业生和实习生，考察学习、求助、任务管理、保密、反馈、诚实表达和职业边界。 | 不会时诚实说明，并先整理已知事实和具体问题再求助。 |

### 日本及亚太客户沟通：需要理解的工作方式

与日本客户协作时，可能遇到会前预沟通、书面材料审阅、多人协调、正式审批、较委婉的意见表达，以及会议中留出思考时间等做法。Nemawashi（事前协调）和 Ringi（书面审批）是理解部分组织决策过程的有用概念，但不是所有日本公司、部门或个人都采用同样方式。不要把沉默理解为同意，也不要把礼貌回应直接解释为拒绝。应确认客户组织实际的决策人、审批步骤、材料要求和时间安排。

跨语言会议应提前发送议程和预读材料，避免连续使用缩写，给参与者思考时间，并在会后用书面方式确认决定和行动项。遇到“我们再研究一下”“可能比较困难”等模糊表达，应询问具体顾虑、需要补充的材料和下一次确认时间，而不是当场逼迫对方表态。

亚太团队还可能跨越日本、新加坡、澳大利亚、印度、中国等地区。需要明确时区、当地假期、工作窗口、语言偏好和升级联系人。区域差异应通过项目约定和客户反馈确认，不应依据国籍给个人贴标签。

### 初级顾问的工作行为底线

1. **不假装知道。** 不熟悉的术语、流程或客户表达，应复述并确认；不知道答案时记录问题、责任人和回复时间。
2. **不擅自承诺。** 交付日期、范围、上线、费用、权限和风险接受必须由有权角色确认。
3. **不等问题变严重才汇报。** 进度可能延期、数据有疑问、客户不满意或依赖未到位，都应尽早报告。
4. **不把口头交流当作完整记录。** 需求、决定、变更、测试结果和交接要进入项目约定的记录渠道。
5. **不越权处理生产和客户数据。** 账号、个人信息、日志和文件只能通过批准的方式访问、保存和传递。
6. **不夸大个人经历。** 课程练习、模拟项目、旁听和实际负责的工作必须区分清楚。

### 练习方式

每道情境题都以“你是刚加入项目的实习生或 Junior Consultant”作为角色边界。回答时按四步思考：先确认事实和影响；再识别相关角色、流程和权限；然后选择适当的沟通或升级动作；最后明确记录、负责人和下一次跟进时间。不要假设实习生需要自己解决所有问题。

### 8 周入门实践路线

- **第 1 周：** 学习客户沟通、任务理解、会议礼仪和工作汇报。练习写一封确认邮件、一份会议纪要和一条风险更新。
- **第 2 周：** 学习日本及亚太跨文化协作。练习会前材料、模糊回应澄清、时区安排和会后确认。
- **第 3 周：** 学习 Stakeholder map、审批、决策记录和变更流程。完成一个简单的决策日志。
- **第 4 周：** 学习需求澄清和流程访谈。把一个模糊需求写成场景、规则和验收标准。
- **第 5 周：** 学习任务分解、依赖、交接和版本管理。维护一份可追踪的任务清单。
- **第 6 周：** 学习 Incident、SLA、客户更新和升级。模拟一次服务中断的沟通与工单闭环。
- **第 7 周：** 学习 UAT、培训、用户反馈和上线准备。设计一个小型业务验收场景。
- **第 8 周：** 完成综合模拟项目：参加客户访谈、整理需求、发起问题、维护任务、更新状态、准备 UAT 并进行交接。

这些练习可以使用虚构客户和脱敏样例完成，不要求候选人拥有真实客户项目经验。

## 新增 200 道情境题的能力分布

新增题目分为 10 个主题，每个主题 20 道；每个主题包含 8 道 easy 和 12 道 medium。题目主要考察沟通、流程管理、工作习惯和服务行为，不要求候选人掌握资深顾问的项目经验。它们是面试训练材料，不是 SAP 官方认证考试题。

## 参考资料

- [JETRO: Communicating with Japanese in Business](https://www.jetro.go.jp/ext_images/canada/pdfs/communicationwithjapanese.pdf) — 日本商务沟通中的决策、会议、反馈、信息共享和语言误解案例。
- [EU-Japan Centre: From Understanding to Navigating Japanese Business Culture](https://www.eu-japan.eu/sites/default/files/report_from_understanding_to_navigating_japanese_business_culture.pdf) — 强调避免刻板印象，讨论沟通、决策、信任和策略协作。
- [SAP Learning: Utilizing the Implementation Project Methodology](https://learning.sap.com/courses/implementing-sap-business-one/utilizing-the-implementation-project-methodology) — 当前 SAP Learning 课程说明客户期望、项目角色、需求分析、阶段里程碑、培训准备和支持交接。\n- [SAP Business One Implementation Methodology](https://help.sap.com/doc/download_multimedia_ebooks_businessone90_tb1200_01_01_story_html/9.0/en-US/story_content/external_files/implementation%20Tools%20-%20Implementation%20Methodology.pdf) — 项目准备、客户期望、范围、风险、阶段里程碑和交接实践。该资料针对 SAP Business One 的 AIP 方法，作为项目管理实践参考，不代表所有 SAP 产品的当前实施方法。
- [Atlassian: ITIL 4 Guiding Principles and Practices](https://www.atlassian.com/itsm/itil) — 服务价值、人员与组织、合作伙伴、流程和持续改进。
