import { z } from 'zod';
import { formatIdSchema } from './common';

export const trendSchema = z.enum(['improving', 'declining', 'flat']);
export type Trend = z.infer<typeof trendSchema>;

const evidenceSchema = z.object({
  questionId: z.string().min(1),
  score: z.number().min(0).max(100),
  at: z.number(),
});

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
  sessions: z.array(sessionRecordSchema),
  updatedAt: z.number(),
});

export type TopicStats = z.infer<typeof topicStatsSchema>;
export type QuestionResult = z.infer<typeof questionResultSchema>;
export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type LearnerProfile = z.infer<typeof learnerProfileSchema>;

// ── Persisted wrapper with version（localStorage 为不可信边界） ──

export const persistedLearnerSchema = z.object({
  version: z.literal(1),
  data: learnerProfileSchema,
});

export type PersistedLearner = z.infer<typeof persistedLearnerSchema>;

export function parseLearnerProfile(input: unknown): LearnerProfile {
  return learnerProfileSchema.parse(input);
}

export function safeParseLearnerProfile(input: unknown) {
  return learnerProfileSchema.safeParse(input);
}

/**
 * 解析持久化数据，兼容两种形态：
 * - 新形态 { version: 1, data: LearnerProfile }
 * - 旧形态直接存 LearnerProfile（无 version，历史数据）
 * 旧形态视为 v0，透过 migration 补上 version。
 */
export function parsePersistedLearner(input: unknown): LearnerProfile | null {
  // 先尝试新形态
  const v1 = persistedLearnerSchema.safeParse(input);
  if (v1.success) return v1.data.data;

  // 回退：旧形态直接是 LearnerProfile
  const legacy = learnerProfileSchema.safeParse(input);
  if (legacy.success) return legacy.data;

  return null;
}

export function serializePersistedLearner(profile: LearnerProfile): PersistedLearner {
  return { version: 1, data: profile };
}
