import { z } from 'zod';
import { difficultySchema, formatIdSchema } from './common';

/** 权重取值：有限数且落在 [0,1]。原先只写 `z.number()`，负值 / >1 / NaN 都能通过。 */
const weight = z.number().finite().min(0).max(1);

/** 归一化校验的浮点容差：0.4+0.2+0.2+0.2 在 IEEE754 下并非精确 1，不能严格相等比较。 */
const WEIGHT_SUM_EPSILON = 1e-6;

/**
 * 四维评分权重。约束「每项 ∈ [0,1]」且「四项之和 ≈ 1」：
 * `aggregateOverall` 是 `Σ dimension × weight`，若权重未归一化（如四项全是 1）
 * 或含负值，算出的 overall 会失真——负值还会被 clamp 成 0，掩盖真实问题。
 * 在 schema 层拒绝非法权重，比在聚合层做兜底更接近错误源头。
 */
export const scoringRubricSchema = z
  .object({
    correctness: weight,
    completeness: weight,
    architecture: weight,
    communication: weight,
  })
  .refine(
    (r) => Math.abs(r.correctness + r.completeness + r.architecture + r.communication - 1) <= WEIGHT_SUM_EPSILON,
    { message: '评分权重必须归一化：correctness + completeness + architecture + communication 应等于 1' },
  );

export type ScoringRubric = z.infer<typeof scoringRubricSchema>;

export const interviewDefinitionSchema = z.object({
  title: z.string().min(1),
  topic: z.string().min(1).optional(),
  categories: z.array(z.string()),
  difficulties: z.array(difficultySchema),
  formats: z.array(formatIdSchema),
  count: z.number().int().positive(),
  useAI: z.boolean(),
  adaptive: z.boolean().optional(),
  scoringRubric: scoringRubricSchema,
  timeLimitSec: z.number().int().positive().optional(),
  evaluationCriteria: z.string().optional(),
  topicPriorities: z.array(z.string()).optional(),
  mode: z.enum(['quick', 'custom', 'coach', 'interview', 'agent', 'course']).optional(),
});

export type InterviewDefinition = z.infer<typeof interviewDefinitionSchema>;
