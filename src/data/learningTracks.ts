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
  { id: 'snowflake', label: 'Snowflake 平台', description: '架构、Warehouse、摄取、CDC、Dynamic Tables、安全与成本' },
  { id: 'data-architecture', label: '企业数据架构', description: '分层、事实粒度、历史策略、语义层与访问治理' },
  { id: 'data-engineering', label: '数据工程与交付', description: 'SQL 版本控制、增量处理、数据质量、可观测性与血缘' },
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
