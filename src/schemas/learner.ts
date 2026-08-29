import { z } from 'zod';
import { formatIdSchema, questionAngleSchema } from './common';
import { sessionQuestionSchema, sessionAnswerSchema } from './session';

export const trendSchema = z.enum(['improving', 'declining', 'flat']);
export type Trend = z.infer<typeof trendSchema>;

const evidenceSchema = z.object({
  questionId: z.string().min(1),
  score: z.number().min(0).max(100),
  at: z.number(),
});

/** 单 (topic, angle) 的逐角度掌握证据（Concept×Angle 覆盖的核心数据）。 */
export const angleStatSchema = z.object({
  attempts: z.number().int().nonnegative(),
  avgScore: z.number().min(0).max(100),
  lastScore: z.number().min(0).max(100),
  lastAskedAt: z.number(),
});
export type AngleStat = z.infer<typeof angleStatSchema>;

export const topicStatsSchema = z.object({
  attempts: z.number().int().nonnegative(),
  avgScore: z.number().min(0).max(100),
  lastScore: z.number().min(0).max(100),
  trend: trendSchema,
  mastery: z.number().min(0).max(1),
  /** 该 topic 参与过的不同训练会话数，用于估计熟练度置信度。 */
  practiceSessions: z.number().int().nonnegative().optional(),
  /** 该 topic 的加权评分量：选择题 1，开放题 5。 */
  scoreWeightTotal: z.number().positive().optional(),
  commonWeaknesses: z.array(z.string()),
  evidence: z.array(evidenceSchema).optional(),
  lastSeen: z.number(),
});

export const questionResultSchema = z.object({
  questionId: z.string().min(1),
  category: z.string().min(1),
  topic: z.string().min(1),
  subtopic: z.string().optional(),
  format: formatIdSchema,
  angle: questionAngleSchema.optional(),
  score: z.number().min(0).max(100),
  correct: z.boolean().optional(),
  gaps: z.array(z.string()),
  // ── 课程题库前瞻字段（可选）──
  /** 归属课程 id；面试题恒缺省。用于把课程掌握度与面试掌握度在聚合层隔离。 */
  courseId: z.string().min(1).optional(),
  /** 用户作答命中的误解 id（来自题目 misconceptions），选择题即可无 LLM 产出反证证据。 */
  misconceptionIds: z.array(z.string().min(1)).optional(),
});

export const sessionRecordSchema = z.object({
  id: z.string().min(1),
  startedAt: z.number(),
  durationSec: z.number().nonnegative().optional(),
  mode: z.enum(['quick', 'custom', 'coach', 'interview', 'agent', 'course']).optional(),
  title: z.string().min(1),
  /** 课程会话标注归属课程（与 Interview 会话在聚合层区分）。 */
  courseId: z.string().min(1).optional(),
  questionResults: z.array(questionResultSchema),
  overall: z.number().min(0).max(100),
  /** 会话原题快照（含 AI 变体改写后的完整题干/选项/答案/解析）。可选以保持旧记录兼容；用于历史会话原样复现。 */
  questions: z.array(sessionQuestionSchema).optional(),
  /** 用户作答（按 questionId）：选择题为选项索引数组，开放/编程题为文本。可选以保持旧记录兼容；用于回放"用户当时选了什么"与后续分析。 */
  answers: sessionAnswerSchema.optional(),
});

export const learnerProfileSchema = z.object({
  totalSessions: z.number().int().nonnegative(),
  totalQuestions: z.number().int().nonnegative(),
  overallScore: z.number().min(0).max(100),
  topicStats: z.record(z.string(), topicStatsSchema),
  /** Concept×Angle 逐角度证据：key = `${topic}|${angle}`。可选以兼容历史画像。 */
  angleCoverage: z.record(z.string(), angleStatSchema).optional(),
  sessions: z.array(sessionRecordSchema),
  updatedAt: z.number(),
});

export type TopicStats = z.infer<typeof topicStatsSchema>;
export type QuestionResult = z.infer<typeof questionResultSchema>;
export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type LearnerProfile = z.infer<typeof learnerProfileSchema>;

export function parseLearnerProfile(input: unknown): LearnerProfile {
  return learnerProfileSchema.parse(input);
}

export function safeParseLearnerProfile(input: unknown) {
  return learnerProfileSchema.safeParse(input);
}
