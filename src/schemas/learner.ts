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

export function parseLearnerProfile(input: unknown): LearnerProfile {
  return learnerProfileSchema.parse(input);
}

export function safeParseLearnerProfile(input: unknown) {
  return learnerProfileSchema.safeParse(input);
}
