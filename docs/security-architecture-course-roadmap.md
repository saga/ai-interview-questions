# Security Architecture 课程路线：面向 Solution Architect 的安全设计

**课程 ID：** `security-architecture`  
**研究日期：** 2026-10-22  
**目标角色：** Solution Architect / Domain Solution Architect / Enterprise Architect  
**课程定位：** 把业务风险、架构约束、控制执行点、验证证据和剩余风险连成闭环；不是渗透测试工具训练、SOC 轮班手册或法规条文背诵。

## 1. 课程目标

完成课程后，学员应能够：

1. 从关键业务服务、资产、风险容忍度和威胁情境形成安全需求，而不是先选择产品。
2. 绘制可用于设计评审的上下文图、数据流图、信任边界和管理平面/数据平面视图。
3. 设计人类与工作负载身份、认证和资源级授权、职责分离、特权访问以及 Zero Trust 策略执行点。
4. 按数据敏感度、用途、流向和生命周期设计访问、加密、密钥、脱敏、日志和恢复控制。
5. 在混合/多云、API、SaaS 和供应商集成中明确责任边界、故障域、出站约束与安全证据。
6. 评估安全与业务摩擦、成本、延迟、可用性、可运维性和退出能力之间的权衡。
7. 形成可追溯的安全架构决策记录、控制分配矩阵、验证计划和剩余风险记录。

题目会提供业务目标、约束和失效风险，让学员选择或设计合理的架构，而不是要求记住某标准的章节名称。

## 2. 标准与业界框架：分工与使用边界

这些框架解决的问题不同，应当组合使用，不能混成一张通用检查表。

| materialId | 来源 | 在课程中的作用 | 使用边界 |
|---|---|---|
| `sabsa` · [SABSA](https://sabsa.org/home/) | 业务驱动、风险导向的安全架构方法；从业务属性追溯到架构、服务和控制 | 不以背诵框架图为目标；重点是业务需求与设计决策之间的追溯 |
| `opengroup-security-architecture` · [The Open Group Security Architecture](https://www.opengroup.org/forum/security/architecture) | 把安全属性、原则和模式纳入企业架构方法和方案设计 | 使用 TOGAF 或绘制架构视图并不意味着已完成安全分析 |
| `nist-csf-2.0` · [NIST CSF 2.0](https://www.nist.gov/cyberframework) | 用 Govern、Identify、Protect、Detect、Respond、Recover 描述风险结果与目标状态 | 是风险结果分类，不是某一产品的技术实现步骤 |
| `nist-800-160` · [NIST SP 800-160 Vol. 1 Rev. 1](https://csrc.nist.gov/pubs/sp/800/160/v1/r1/final) | 系统安全工程：把安全要求、设计、实现、验证及生命周期活动纳入系统工程 | 不将安全评估推迟到上线前的一次测试 |
| `nist-800-207` · [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) | Zero Trust 参考架构、策略决策/执行点和资源访问路径 | 不等同于采购一个产品、部署 VPN 或单纯做微分段 |
| `iso-27001` · [ISO/IEC 27001:2022](https://committee.iso.org/standard/27001) | 信息安全管理体系、组织职责、风险管理和持续改进 | 不是具体系统的技术架构蓝图；供应商认证也不代表当前集成自动合规 |
| `nist-800-53` · [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/fpd) | 可裁剪的安全与隐私控制目录，用于把要求映射到控制目标和评估证据 | 不应将整个控制目录机械复制到每个方案 |
| `owasp-threat-modeling` · [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html) | 从系统分解、数据流、信任边界、外部实体和数据存储识别威胁并安排响应 | 图画好、风险打分完成都不等于风险已经降低 |
| `owasp-asvs` / `owasp-api-top10` · [OWASP ASVS](https://asvs.owasp.org/) / [OWASP API Security Top 10](https://api-security.owasp.org/) | 将应用与 API 设计要求具体化为技术验证项，如对象授权、SSRF、资源消耗和访问控制 | 用于应用/API 设计和验证，不替代业务风险及企业架构分析 |
| `cisa-secure-by-design` · [CISA Secure by Design](https://www.cisa.gov/resources-tools/resources/secure-by-design) | 将安全默认值、客户安全结果、责任和透明度纳入产品及供应链设计 | 不应缩减为发布前多跑一次扫描 |
| `aws-security-pillar` / `microsoft-mcra` / `gcp-security-pillar` · [AWS Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/security.html)、[Microsoft Cybersecurity Reference Architecture](https://learn.microsoft.com/en-us/security/adoption/mcra)、[Google Cloud Security Pillar](https://docs.cloud.google.com/architecture/framework/security) | 云平台层参考设计：身份、追溯、分层防御、数据、治理、日志与运行安全 | 先识别通用控制目标，再比较云厂商具体实现；厂商参考架构不是跨云标准 |
| `bis-fsi-cloud-risk` · [BIS：Managing cloud risk in the financial sector](https://www.bis.org/publications/fsi-insight-53-managing-cloud-risk-some-considerations-oversight-critical-cloud-service-providers-financial-sector.pdf) | 金融服务关键云服务商、第三方依赖、集中风险和运营韧性 | 作为行业风险视角；具体监管义务还需根据司法辖区和业务范围另行确认 |

## 3. 课程主题与学习顺序

### 模块 1：业务风险与架构治理

识别关键业务服务、资产、客户影响和不可接受的业务后果；定义机密性、完整性、可用性、可追责性等安全属性。输出应是风险情境、架构约束、决策责任和追溯链，而不是安全产品清单。

### 模块 2：安全需求与保障证据

把业务风险转换为可测试的安全质量属性，明确责任团队、控制执行点、验收证据和例外批准路径。设计完成后若风险、依赖或信任边界发生变化，应说明何时重新评审。

### 模块 3：威胁建模与信任边界

使用上下文图和数据流图描述外部实体、组件、数据存储、管理入口与信任转换点。根据当前场景选择 STRIDE、攻击树或滥用案例；为每项重要威胁指定缓解、消除、转移或接受策略及其验证方式。

### 模块 4：身份、授权和特权边界

分开处理用户认证、资源级授权、工作负载身份、管理员身份与紧急访问。检查是否错误地把共享账号当作用户身份，或把一个网关的认证结果误当成所有下游资源已获授权。

### 模块 5：Zero Trust 与访问路径

围绕主体、上下文、目标资源、Policy Decision Point 和 Policy Enforcement Point 设计授权路径。评估执行点不可达、信号过期、策略服务故障以及被攻陷服务横向移动时的行为；“流量经过网络边界”不是资源授权的替代品。

### 模块 6：数据保护与隐私

按数据分类、用途、流向、存储和共享方选择控制。为密钥管理定义权限边界、轮换、吊销和恢复；分别处理访问控制、令牌化、日志脱敏、保留/删除和合法身份滥用风险。

### 模块 7：云与平台安全

设计 Landing Zone、账户/订阅边界、组织级护栏、管理平面权限、网络隔离、集中日志和密钥边界。比较不同云实现时，先定义目标控制和共享责任，再分析具体机制、运行代价及故障行为。

### 模块 8：API、微服务和第三方集成

设计 API 身份与对象授权、服务间身份、webhook、外部回调、出站限制、重放和幂等、资源消耗约束及业务流程滥用防护。明确网关、服务端业务授权与目标数据源的责任分界。

### 模块 9：安全交付、供应链与 SaaS

把安全默认值、构建和制品来源、签名与发布身份、依赖风险、供应商数据处理、管理访问、审计证据、事件通知和退出能力纳入架构。漏洞扫描是一个信号，并不能证明制品来源可信或构建过程未被篡改。

### 模块 10：审计、检测、事件响应与韧性

设计可关联主体、资源、动作、结果和时间的安全事件，明确告警处置、调查、证据保留和恢复责任。恢复设计覆盖身份、密钥、控制平面、数据、备份和外部依赖，并进行演练，而不仅是复制数据或跨区域部署。

### 模块 11：金融服务方案设计

从重要业务服务的依赖链评估云、身份提供商、支付网络、市场数据与 SaaS 的集中风险。将适用的业务及监管要求映射到具体控制责任、验证证据、恢复目标、第三方沟通和退出路径。

## 4. 架构评审交付物

1. **Context / trust-boundary diagram**：用户、管理员、服务身份、第三方、数据域、公开入口、管理平面和信任转换点。
2. **Data-flow diagram**：敏感数据从采集、处理、共享、存储、备份到删除的路径。
3. **Threat model**：关键资产、威胁情境、攻击路径、业务影响、缓解/接受/转移决策。
4. **Identity & authorization matrix**：主体、资源、动作、授权点、特权路径与职责分离。
5. **Security traceability matrix**：业务/监管目标 → 风险 → 架构约束 → 控制执行点 → 验证证据 → 责任人。
6. **Control responsibility matrix**：企业平台、应用团队、云服务商与 SaaS 供应商分别负责什么，以及如何验证。
7. **Architecture Decision Records**：备选方案、安全收益、业务摩擦、成本/性能/可用性权衡、剩余风险及复审触发条件。
8. **Resilience & response design**：关键依赖、恢复目标、干净恢复路径、告警升级责任和演练验证方式。

## 5. 毕业案例：财富管理与研究平台

客户和顾问通过 Web/Mobile 访问组合和交易服务；分析师在数据平台处理市场数据与研究内容；行情来自外部数据供应商；关键业务工作负载运行在云上，审计与业务历史需要长期保留。

设计约束：

- 客户持仓和身份信息不能被未授权主体读取或从日志/导出路径泄露。
- 交易和组合变更需要对象级授权、完整性保护和可追责证据。
- 云、身份提供商、市场数据 SaaS 或支付/交易网络故障不能导致不可控业务状态。
- 企业平台、应用团队、云服务商及外部供应商需要明确责任和审计证据。
- 控制需满足业务延迟和可用性目标，不能用“默认拒绝所有请求”替代可运行的方案设计。

作业需提交上述八类架构工件，并分析至少六种情境：管理身份失陷、服务身份横向移动、外部数据/回调被滥用、关键日志遭删除、云区域或身份服务不可用、供应商不能及时提供审计证据。

评审重点是：是否从业务风险推导需求；控制执行点是否真的在访问/数据路径上；是否覆盖控制平面与第三方依赖；如何验证要求；故障时怎样工作；谁负责以及剩余风险由谁接受。

## 6. 验收标准

验收不看背过多少标准或列出多少控制，而看方案是否能说明：**保护什么、抵御什么、在哪里执行、如何验证、故障时怎样工作、谁负责，以及还剩什么风险。**
