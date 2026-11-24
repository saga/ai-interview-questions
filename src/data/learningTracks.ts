import type { QuestionAngle } from '../schemas/common';

/**
 * 顶层学习体系注册表。AI、Snowflake、Security Architecture、Campus Employment 是并列课程，不是同一个 taxonomy 下的能力域。
 * 新增独立课程时在此登记 courseId / 展示信息 / 主题目录，并给课程自己的节点和题目写 courseId。
 */


/** SAP IT Service Consultant 独立课程主题目录。 */
export const SAP_IT_SERVICE_COURSE_TOPICS = [
  { id: 'sap-consulting-foundations', label: 'IT 服务咨询与顾问基本功' },
  { id: 'sap-discovery-requirements', label: '需求发现与业务分析' },
  { id: 'sap-business-processes', label: '端到端企业业务流程' },
  { id: 'sap-s4hana-overview', label: 'SAP S/4HANA 产品与架构' },
  { id: 'sap-fit-to-standard', label: 'Fit-to-Standard 与流程适配' },
  { id: 'sap-activate', label: 'SAP Activate 与实施方法' },
  { id: 'sap-configuration', label: '配置、扩展与 Clean Core' },
  { id: 'sap-fiori-ux', label: 'SAP Fiori 与用户体验' },
  { id: 'sap-authorization', label: '身份、角色与授权设计' },
  { id: 'sap-integration', label: 'SAP 集成与接口' },
  { id: 'sap-data-migration', label: '数据迁移与主数据' },
  { id: 'sap-testing', label: '测试策略与质量保障' },
  { id: 'sap-cloud-alm', label: 'SAP Cloud ALM 与交付可观测性' },
  { id: 'sap-itsm-operations', label: 'ITSM 与 SAP 应用运维' },
  { id: 'sap-service-management', label: 'SAP Service Management 业务能力' },
  { id: 'sap-btp', label: 'SAP Business Technology Platform' },
  { id: 'sap-security-compliance', label: '安全、审计与合规' },
  { id: 'sap-reporting-analytics', label: '报表、分析与业务指标' },
  { id: 'sap-project-delivery', label: '项目治理与客户交付' },
  { id: 'sap-troubleshooting', label: '故障诊断与服务恢复' }
] as const;


/** Coursera SAP Technology Consultant Professional Certificate 对齐的补充主题。 */
export const SAP_COURsera_COURSE_TOPICS = [
  { id: 'sap-professional-practice', label: 'SAP 顾问职业基础与协作' },
  { id: 'sap-enterprise-systems-environment', label: '企业系统环境与技术基础' },
  { id: 'sap-customer-engagement-discovery', label: '客户参与、发现与价值分析' },
  { id: 'sap-solution-design-pitch', label: 'SAP 方案设计、演示与提案' },
  { id: 'sap-solution-implementation', label: 'SAP 方案实施与部署' },
  { id: 'sap-test-planning-execution', label: '测试计划、测试脚本与质量保障' },
  { id: 'sap-project-methods-governance', label: '项目管理、敏捷协作与治理' },
  { id: 'sap-consultant-capstone', label: '综合实施项目与交付物实践' },
  { id: 'sap-post-implementation-review', label: '上线后评估、项目关闭与持续改进' },
  { id: 'sap-career-readiness', label: 'SAP 职业发展与求职准备' }
] as const;

export const SAP_IT_SERVICE_TOPIC_LABELS: Record<string, string> = Object.fromEntries(
  [...SAP_IT_SERVICE_COURSE_TOPICS, ...SAP_COURsera_COURSE_TOPICS].map(({ id, label }) => [id, label]),
);

export const SAP_IT_SERVICE_ANGLE_WHITELIST: Record<string, QuestionAngle[]> = Object.fromEntries(
  [...SAP_IT_SERVICE_COURSE_TOPICS, ...SAP_COURsera_COURSE_TOPICS].map(({ id }) => [id, ['scenario', 'fundamental', 'comparison', 'tradeoff', 'design', 'diagnosis', 'synthesis', 'implementation']]),
);

export const CAMPUS_EMPLOYMENT_COURSE_TOPICS = [
  { id: 'career-motivation-position-fit', label: '求职动机与岗位认知', description: '岗位选择、企业理解、工作内容、个人匹配和职业预期。' },
  { id: 'self-introduction-positioning', label: '自我介绍与个人定位', description: '学校专业、求职方向、代表经历、个人贡献和岗位关联的清晰表达。' },
  { id: 'resume-project-storytelling', label: '简历、项目与个人贡献表达', description: '将课程设计、毕业设计、竞赛、科研和实习讲成可信的工程经历。' },
  { id: 'teamwork-collaboration', label: '团队协作与角色承担', description: '任务分工、责任边界、信息同步、互相补位和团队结果。' },
  { id: 'communication-conflict', label: '沟通冲突与跨职能协同', description: '不同意见、向上沟通、负面反馈和跨团队依赖的处理。' },
  { id: 'ownership-reliable-delivery', label: '责任心、执行力与可靠交付', description: '任务承诺、风险暴露、质量验证、失误处理和工作交接。' },
  { id: 'problem-solving-initiative', label: '问题解决、主动性与不确定性', description: '需求澄清、问题拆解、假设验证、主动推进和适时求助。' },
  { id: 'learning-adaptability-ai', label: '学习能力、适应变化与 AI 工具', description: '自主学习、陌生代码库适应、AI 辅助开发和输出核验。' },
  { id: 'time-prioritization-pressure', label: '时间管理、优先级与压力应对', description: '多任务排序、截止日期、工作量评估和压力下的质量控制。' },
  { id: 'self-awareness-feedback', label: '自我认知、复盘与反馈', description: '优缺点、挫折、反馈接纳、个人复盘和成长计划。' },
  { id: 'business-user-value', label: '业务意识、用户价值与产品思维', description: '用户需求、业务目标、产品价值和工程取舍。' },
  { id: 'professional-ethics-engineering', label: '职业素养、诚信与工程伦理', description: '隐私、安全、开源许可、学术诚信和工程责任。' },
  { id: 'interview-communication', label: '面试表达、追问与反问', description: '结构化回答、澄清问题、不会作答、压力互动和有效反问。' },
  { id: 'career-planning-offer', label: '职业规划、工作城市与 Offer 决策', description: '就业与读研选择、城市、薪酬、发展路径和 Offer 比较。' },
  { id: 'undergrad-grad-transition', label: '本科生、研究生经历与科研实习转化', description: '课程项目、毕业设计、实验室、科研论文、竞赛和实习经历转化。' },
] as const;

export const CAMPUS_EMPLOYMENT_TOPIC_LABELS: Record<string, string> = Object.fromEntries(
  CAMPUS_EMPLOYMENT_COURSE_TOPICS.map(({ id, label }) => [id, label]),
);

export const CAMPUS_EMPLOYMENT_ANGLE_WHITELIST = [
  'scenario', 'fundamental', 'comparison', 'design',
  'tradeoff', 'diagnosis', 'mechanism', 'synthesis',
] as const;

export const LEARNING_TRACKS = [
  {
    id: 'ai',
    title: 'AI 工程与大模型',
    shortTitle: 'AI',
    description: '机器学习、LLM、RAG、Agent、AI 系统与 AI 安全。沿用现有六个 AI 能力域。',
    actionLabel: '进入 AI 学习',
    topicCount: 6,
  },
  {
    id: 'snowflake',
    title: 'Snowflake 数据平台',
    shortTitle: 'Snowflake',
    description: '独立的数据平台课程：以 Snowflake 架构、数据工程、治理和生产运维为主，并包含 PostgreSQL 数据库工程补充模块。',
    actionLabel: '进入 Snowflake 学习',
    topicCount: 9,
    learningPathUrl: 'https://github.com/saga/ai-interview-questions/blob/main/docs/snowflake-learning-path.md',
  },
  {
    id: 'security-architecture',
    title: 'Security Architecture（安全架构）',
    shortTitle: 'Security Architecture',
    description: '面向 Solution Architect：把业务风险转化为架构决策，设计身份与授权、信任边界、数据保护、云与集成安全、可审计性和韧性；不以攻防工具或合规条文背诵为主。',
    actionLabel: '进入安全架构学习',
    topicCount: 11,
    learningPathUrl: 'https://github.com/saga/ai-interview-questions/blob/main/docs/security-architecture-course-roadmap.md',
  },
  {
    id: 'sap-it-service-consultant',
    title: 'SAP IT Service Consultant',
    shortTitle: 'SAP',
    description: '面向 SAP IT 服务与实施顾问：业务流程、需求发现、S/4HANA、Fit-to-Standard、集成、数据迁移、测试、Cloud ALM 和应用运维。',
    actionLabel: '进入 SAP 顾问学习',
    topicCount: 30,
    learningPathUrl: 'https://github.com/saga/ai-interview-questions/blob/main/docs/sap-it-service-consultant-roadmap.md',
  },
  {
    id: 'campus-employment',
    title: '中国大学生本科研究生校招面试技巧培训',
    shortTitle: '校招面试',
    description: '面向计算机与软件工程应届生，以真实项目表达、沟通协作、责任交付、学习适应、求职动机和行为面试为主；本科生优先，研究生科研经历补充。',
    actionLabel: '进入校招面试技巧学习',
    topicCount: 15,
    learningPathUrl: 'https://github.com/saga/ai-interview-questions/blob/main/docs/campus-employment-course-roadmap.md',
  },
] as const;

export type LearningTrackId = (typeof LEARNING_TRACKS)[number]['id'];
export type LearningTrack = (typeof LEARNING_TRACKS)[number];

export function isLearningTrackId(value: string | null | undefined): value is LearningTrackId {
  return LEARNING_TRACKS.some((track) => track.id === value);
}

export function getLearningTrack(id: LearningTrackId): LearningTrack {
  const track = LEARNING_TRACKS.find((item) => item.id === id);
  if (!track) throw new Error(`未知学习体系：${id}`);
  return track;
}

/** Snowflake 自己的课程主题目录；不属于 AI 的 TAXONOMY / DOMAIN。 */
export const SNOWFLAKE_COURSE_TOPICS = [
  { id: 'snowflake', label: '平台基础与对象模型', description: '三层架构、Warehouse、数据库对象、半结构化数据、Time Travel 与克隆' },
  { id: 'postgresql', label: 'PostgreSQL 数据库工程', description: 'PostgreSQL 原生 SQL、权限、事务/MVCC、备份/WAL/复制、连接池、VACUUM、分区、监控、内存与查询调优；明确区分 PostgreSQL 和 Snowflake 的产品语义。' },
  { id: 'data-architecture', label: '企业数据架构与治理', description: '分层、事实粒度、历史、语义视图、RBAC、脱敏与行访问策略' },
  { id: 'data-engineering', label: '现代数据工程与管道', description: 'COPY、Snowpipe、Streaming、SQL/Snowpark、Streams/Tasks、Dynamic Tables' },
  { id: 'snowflake-lakehouse', label: 'Apache Iceberg 与 Lakehouse', description: '开放表格式、Catalog、迁移、Schema/Partition Evolution、快照与维护' },
  { id: 'snowflake-devops', label: 'DevOps、发布与可观测性', description: 'Git、Snowflake CLI、声明式变更、CI/CD、日志、Trace、告警与通知' },
  { id: 'snowflake-data-products', label: '数据产品与应用交付', description: 'Marketplace、数据共享、Streamlit、Native Apps 与产品契约' },
  { id: 'snowflake-genai', label: 'Cortex GenAI 应用', description: 'LLM 函数、文档解析、Cortex Search、Cortex Analyst 与 Text-to-SQL' },
  { id: 'snowflake-agent-ml', label: 'Cortex Agents、ML 与 CoCo', description: 'Agent 工具/编排、MCP、评测、微调/ML 与 AI 辅助开发' },
] as const;

export const SNOWFLAKE_TOPIC_LABELS: Record<string, string> = Object.fromEntries(
  SNOWFLAKE_COURSE_TOPICS.map(({ id, label }) => [id, label]),
);

/** 独立 Snowflake 课程的出题角度白名单，不混入 AI 能力域的 taxonomy 文件。 */
export const SNOWFLAKE_ANGLE_WHITELIST: Record<string, QuestionAngle[]> = {
  snowflake: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'system-design', 'design'],
  'data-architecture': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'system-design', 'design'],
  'data-engineering': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'system-design', 'design'],
  postgresql: ['definition', 'fundamental', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'design', 'implementation'],
};

/** Security Architecture 独立课程主题目录；只列架构设计主题，不复用 AI 安全 taxonomy。 */
export const SECURITY_ARCHITECTURE_COURSE_TOPICS = [
  { id: 'security-architecture-governance', label: '业务风险与架构治理', description: '业务资产、风险偏好、安全属性、风险责任与架构决策可追溯性' },
  { id: 'security-requirements', label: '安全需求与验证', description: '可验证的安全质量属性、控制分配、保障证据与剩余风险' },
  { id: 'security-threat-modeling', label: '威胁建模与信任边界', description: '系统分解、数据流、信任边界、攻击路径、风险排序与缓解决策' },
  { id: 'security-identity-access', label: '身份、授权与特权边界', description: '企业身份、服务身份、授权模型、最小权限、职责分离与特权访问' },
  { id: 'security-zero-trust', label: 'Zero Trust 与访问路径', description: 'Policy Decision/Enforcement、按资源授权、分段、混合与多云访问路径' },
  { id: 'security-data-protection', label: '数据保护与隐私', description: '数据分类、流向、加密、密钥边界、令牌化、留存和恢复' },
  { id: 'security-cloud-platform', label: '云与平台安全架构', description: 'Landing Zone、组织级护栏、管理平面、工作负载隔离与共享责任' },
  { id: 'security-application-integration', label: '应用、API 与外部集成', description: 'API 身份与授权、服务间信任、第三方连接、出站限制和业务滥用' },
  { id: 'security-supply-chain', label: '安全交付与供应链', description: 'Secure by Design、依赖与构建来源、制品完整性、SaaS 和供应商边界' },
  { id: 'security-resilience-operations', label: '安全运营、审计与韧性', description: '可追溯审计、检测响应、恢复路径、不可变备份与运行责任' },
  { id: 'security-financial-services', label: '金融服务方案设计', description: '关键业务服务、第三方/云集中风险、控制证据和退出/降级方案' },
] as const;

export const SECURITY_ARCHITECTURE_TOPIC_LABELS: Record<string, string> = Object.fromEntries(
  SECURITY_ARCHITECTURE_COURSE_TOPICS.map(({ id, label }) => [id, label]),
);

/** 独立 Security Architecture 课程的设计类出题角度白名单，不混入 AI taxonomy。 */
export const SECURITY_ARCHITECTURE_ANGLE_WHITELIST: Record<string, QuestionAngle[]> = {
  'security-architecture-governance': ['scenario', 'tradeoff', 'system-design', 'design', 'synthesis'],
  'security-requirements': ['scenario', 'mechanism', 'comparison', 'design', 'system-design'],
  'security-threat-modeling': ['scenario', 'mechanism', 'diagnosis', 'design', 'system-design'],
  'security-identity-access': ['scenario', 'mechanism', 'comparison', 'tradeoff', 'design'],
  'security-zero-trust': ['scenario', 'mechanism', 'comparison', 'tradeoff', 'design'],
  'security-data-protection': ['scenario', 'mechanism', 'comparison', 'tradeoff', 'design'],
  'security-cloud-platform': ['scenario', 'mechanism', 'comparison', 'tradeoff', 'system-design', 'design'],
  'security-application-integration': ['scenario', 'mechanism', 'diagnosis', 'tradeoff', 'design'],
  'security-supply-chain': ['scenario', 'mechanism', 'comparison', 'tradeoff', 'design'],
  'security-resilience-operations': ['scenario', 'mechanism', 'diagnosis', 'tradeoff', 'design'],
  'security-financial-services': ['scenario', 'tradeoff', 'system-design', 'design', 'synthesis'],
};
