import { z } from 'zod';
import { formatIdSchema, questionAngleSchema } from './common';

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
  commonWeaknesses: z.array(z.string()),
  evidence: z.array(evidenceSchema).optional(),
  lastSeen: z.number(),
});

export const questionResultSchema = z.object({
  questionId: z.string().min(1),
  category: z.string().min(1),
  topic: z.string().min(1),
  format: formatIdSchema,
  angle: questionAngleSchema.optional(),
  score: z.number().min(0).max(100),
  correct: z.boolean().optional(),
  gaps: z.array(z.string()),
});

export const sessionRecordSchema = z.object({
  id: z.string().min(1),
  startedAt: z.number(),
  durationSec: z.number().nonnegative().optional(),
  mode: z.enum(['quick', 'custom', 'coach', 'interview', 'agent']).optional(),
  title: z.string().min(1),
  questionResults: z.array(questionResultSchema),
  overall: z.number().min(0).max(100),
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
