import type { QuestionAngle } from '../schemas/common';

/**
 * 顶层学习体系注册表。AI 与 Snowflake 是并列课程，不是同一个 taxonomy 下的能力域。
 * 新增独立课程时在此登记 courseId / 展示信息 / 主题目录，并给课程自己的节点和题目写 courseId。
 */
export const LEARNING_TRACKS = [
  {
    id: 'ai',
    title: 'AI 工程与大模型',
    shortTitle: 'AI',
    description: '机器学习、LLM、RAG、Agent、AI 系统与 AI 安全。沿用现有六个 AI 能力域。',
    actionLabel: '进入 AI 学习',
  },
  {
    id: 'snowflake',
    title: 'Snowflake 数据平台',
    shortTitle: 'Snowflake',
    description: '独立的数据平台课程：Snowflake 架构、数据建模、摄取与转换、SQL 工程、治理和生产运维。',
    actionLabel: '进入 Snowflake 学习',
    learningPathUrl: 'https://github.com/saga/ai-interview-questions/blob/main/docs/snowflake-learning-path.md',
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

/** “其他知识体系”暂不伪造空课程；新课程登记到 LEARNING_TRACKS 后会自动出现在选择页。 */
