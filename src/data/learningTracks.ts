import type { QuestionAngle } from '../schemas/common';

/**
 * 顶层学习体系注册表。AI、Snowflake、Security Architecture 是并列课程，不是同一个 taxonomy 下的能力域。
 * 新增独立课程时在此登记 courseId / 展示信息 / 主题目录，并给课程自己的节点和题目写 courseId。
 */
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
    description: '独立的数据平台课程：Snowflake 架构、数据建模、摄取与转换、SQL 工程、治理和生产运维。',
    actionLabel: '进入 Snowflake 学习',
    topicCount: 8,
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
