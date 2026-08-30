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

/**
 * 单条「概念级缺失证据」：某个 topic 下某个具体概念被判为缺失的累计信号。
 *
 * 与 `commonWeaknesses`（自由文本、来自开放题 gaps）是**两层不同的证据**，刻意不合并：
 * - gaps 是「这次回答漏了什么要点」，粒度粗、受当次题目影响大；
 * - missingConcepts 是「候选人知识结构里缺哪个概念」，跨题目累计才有意义。
 * 直接把 missingConcepts 塞进 commonWeaknesses 会让 LLM 产出稀释历史薄弱项，故单列一层。
 */
export const conceptEvidenceSchema = z.object({
  /** 该概念累计被判为「缺失」的次数。 */
  misses: z.number().int().nonnegative(),
  /** 最近一次被判缺失时的该题得分（0-100）：分数越低说明缺失越严重。 */
  lastScore: z.number().min(0).max(100),
  lastSeenAt: z.number(),
  /**
   * 概念的原始写法（首次出现时记下），用于展示。
   * key 为归一化后的形式（trim + lowercase）以便去重，但像 "PPO" / "RLHF" 这类大小写敏感的
   * 专有名词若直接回填 key 会显示成 "ppo"，故保留首次出现的原文。
   */
  label: z.string().optional(),
});
export type ConceptEvidence = z.infer<typeof conceptEvidenceSchema>;

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
  /** 开放题 LLM 评估识别的「候选人本应掌握却缺失的概念」（EvaluationResult.missingConcepts）。
   *  仅开放题有产出；选择题确定性判分不产生（避免把「选错」过度推断成「缺某个知识点」）。
   *  **不并入 commonWeaknesses**：该数组由 updateLearner 单独聚合到 LearnerProfile.conceptEvidence，
   *  以免 LLM 产出的候选概念稀释历史薄弱项（两层证据刻意分离）。 */
  missingConcepts: z.array(z.string()).optional(),
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
  /** 概念级缺失证据（源自开放题 missingConcepts）：key = `${topic}|${concept}`。可选以兼容历史画像。 */
  conceptEvidence: z.record(z.string(), conceptEvidenceSchema).optional(),
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
