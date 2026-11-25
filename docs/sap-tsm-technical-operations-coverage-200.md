# SAP Technical Service Manager：技术运维深化题覆盖矩阵（200 题）

- 课程：SAP IT Service Consultant
- 目标人群：大学毕业生 / Graduate TSM
- 难度：初级 80 道；中级 120 道
- 题型：单选 60 道；多选 140 道
- 题目 ID：`sap-tsm-081` 至 `sap-tsm-280`
- 知识节点：10 个新增节点，每个节点 20 道题
- 本轮完成日期：2026-11-25

## 岗位能力基准

内容以 SAP Careers 在东京发布的 Graduate Technical Service Manager 职位为主要岗位参照。该类岗位要求毕业生理解 SAP 技术景观和云服务运行，能够与客户沟通技术事项、协助处理服务事件、识别风险并协调内部技术专家。岗位资料列出的技术基础包括 SAP Basis、Unix/Linux、SAP HANA / Sybase、S/4HANA 架构和迁移、HA/DR、网络与虚拟化等。

课程不把毕业生设定为独立生产管理员。初级/中级目标是理解机制、读懂状态和日志、采集证据、分析可能影响、识别责任边界、准备下一步并向有权限的专家升级。

## 新增主题与题量

| Knowledge topic | 题目 ID | 数量 | 初级 | 中级 | 单选 | 多选 | 覆盖重点 |
|---|---:|---:|---:|---:|---:|---:|---|
| Linux 系统运行与资源诊断 | `sap-tsm-081–100` | 20 | 8 | 12 | 6 | 14 | 进程/服务、文件系统、inode、CPU、内存、swap、I/O、日志、权限和只读诊断 |
| 网络连通性、DNS 与 TLS | `sap-tsm-101–120` | 20 | 8 | 12 | 6 | 14 | DNS、TCP、端口、路由、防火墙、代理、负载均衡、TLS、SNI、私有端点和路径诊断 |
| AS ABAP 运行组件与工作进程 | `sap-tsm-121–140` | 20 | 8 | 12 | 6 | 14 | Dispatcher、Work Process 类型、Message Server、Enqueue、Gateway、ICM、sapstartsrv、日志和作业 |
| HANA / ASE 备份、恢复与数据保护 | `sap-tsm-141–160` | 20 | 8 | 12 | 6 | 14 | 数据/日志备份、Backup Catalog、BACKINT、SYSTEMDB/租户、PITR、RPO/RTO、ASE dump 和恢复顺序 |
| S/4HANA 转换工具与技术准备 | `sap-tsm-161–180` | 20 | 8 | 12 | 6 | 14 | Conversion 路径、Readiness Check、Maintenance Planner、Simplification Item、Custom Code、SUM/DMO、Mock/Cutover |
| SAP 接口运行与集成故障 | `sap-tsm-181–200` | 20 | 8 | 12 | 6 | 14 | RFC、IDoc、OData/API、Cloud Integration、MPL/Trace、Correlation ID、限流、幂等和安全重放 |
| SAP 身份、授权与技术安全 | `sap-tsm-201–220` | 20 | 8 | 12 | 6 | 14 | Authentication/Authorization、角色、组织范围、SoD、技术用户、SSO、证书、审计和紧急访问 |
| Hyperscaler 云基础与部署架构 | `sap-tsm-221–240` | 20 | 8 | 12 | 6 | 14 | Region/Zone、VM、私有网络、路由、安全组、块/对象存储、负载均衡、共享责任和跨区恢复 |
| Incident、Problem、Change 与 SLA | `sap-tsm-241–260` | 20 | 8 | 12 | 6 | 14 | 事件恢复、Problem/RCA、服务请求、变更审批、优先级、重大事件沟通、SLA/SLO 和行动闭环 |
| 容量、性能基线与服务改进 | `sap-tsm-261–280` | 20 | 8 | 12 | 6 | 14 | 响应/吞吐/P95、CPU/内存/I/O、HANA SQL、容量预测、备份竞争、云成本和服务改进 |
| **合计** | `sap-tsm-081–280` | **200** | **80** | **120** | **60** | **140** | **每个知识节点均有独立题目和薄弱项追踪** |

## 与原 TSM 题库的关系

原有 TSM 概览题为 `sap-tsm-001` 至 `sap-tsm-080`，共 80 道，按 8 个总览主题组织。本轮不是替换原题，而是在相同 SAP IT Service Consultant 课程中新增 10 个更细的知识节点和 200 道题。

因此，TSM 专项目前共有 18 个主题、280 道题。原有 8 个主题继续承担技术景观和服务模式总览；新增主题负责将岗位核心技术能力拆解到可学习、可测量的细节。SAP 全课程由 49 个主题、720 道题扩展到 59 个主题、920 道题。

## 学习和评估边界

**初级（80 题）**：识别组件和术语，理解基本请求/数据流，区分常见指标和错误阶段，知道该收集哪些第一手证据。

**中级（120 题）**：根据不完整信息对比多个可能原因，关联日志/时间线/业务影响，判断安全重试或恢复前置条件，识别跨团队责任与变更风险。

毕业生不需要独立执行生产数据库恢复、操作系统权限修改、SAP 实例参数变更、权限扩大、私钥传递、生产消息重放或灾难切换。此类工作要经过授权、变更和专家验证。题目考查的是候选人是否知道这些动作的风险、证据和升级路径。

## SAP 官方参考资料

| 官方资料 | 本题库使用范围 |
|---|---|
| [SAP Careers：Technical Service Manager – Graduate（Tokyo）](https://careers.sap.com/job/Tokyo-Technical-Service-Manager-Toky-100-0004/1445010133/) | Graduate TSM 岗位职责与技术基础参照 |
| [SAP Learning：Technical Implementation and Operation I](https://learning.sap.com/courses/technical-implementation-and-operation-i-of-sap-s-4hana-and-sap-business-suite) | SAP 技术运行、监控、通信、用户/授权、Fiori、启动与故障排查 |
| [SAP Learning：Installing and Administering SAP HANA](https://learning.sap.com/courses/installing-and-administering-sap-hana) | HANA 安装/管理、备份恢复、安全与 Linux 前置知识 |
| [SAP Help：SAP ASE Backup and Recovery](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/b1c78119f8634ae1b933b60f02975a05/1495bd14c0564c19bf1fd94c01920c32.html?locale=en-US&state=PRODUCTION&version=2023.latest) | ASE 数据库 dump、事务日志 dump 和恢复顺序 |
| [SAP Help：Software Update Manager / DMO](https://help.sap.com/docs/SLTOOLSET/5399538756114983bbd2cc7a74f1d430/7ef3c766f02f45c7b218fed5b2b38157.html) | SUM/DMO 的工具定位和版本前置条件 |
| [SAP Learning：Managing User Access and Security](https://learning.sap.com/learning-journeys/managing-user-access-and-security-of-sap-s-4-hana-and-sap-s-4hana-cloud-public-edition) | SAP 用户、角色、授权和访问安全 |
| [SAP Learning：Monitoring Messages Across All Systems](https://learning.sap.com/courses/integrating-sap-sales-and-service-cloud-version-2-with-sap-s-4hana-private-cloud/monitoring-messages-across-all-systems_e473699b-3be3-43de-a235-8be369a68f65) | 跨系统消息监控与集成故障分析 |
| [SAP Learning：Operating with SAP Cloud ALM](https://learning.sap.com/courses/operating-with-sap-cloud-alm/explaining-sap-cloud-alm-for-operations-in-a-nutshell_eecb065d-925d-405f-8a7d-eafdfd84cd7e) | 运行监控、集成与异常监控、作业及业务服务管理 |

本文件记录课程设计和内容来源，不表示题目是 SAP 官方认证题或官方考试题。题目均为依据公开岗位能力和产品资料原创的训练场景；实际版本、支持矩阵和服务责任仍应以项目目标版本及客户合同为准。
