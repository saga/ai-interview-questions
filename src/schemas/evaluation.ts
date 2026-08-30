import { z } from 'zod';

export const evaluationDimensionScoreSchema = z.number().min(0).max(100).int();

/**
 * 评估序级（ordinal rating）：LLM 只判「级」，分数由 domain 归一化。
 * 0 = 完全错误 / 严重误解；1 = 主要误解；2 = 部分正确；3 = 正确（机制到位）；4 = 强 / 有洞见。
 */
export const evalLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type EvalLevel = z.infer<typeof evalLevelSchema>;

/** 单维 LLM 原始输出：序级（宽松 number，越界由 parseEvaluation 钳制）+ 证据。 */
export const evalDimensionRawSchema = z.object({
  level: z.number(),
  evidence: z.string().optional(),
});

// LLM 原始输出：只验证形状，overall 由 domain 聚合，不采纳 LLM 直出
export const llmEvaluationRawSchema = z.object({
  correctness: evalDimensionRawSchema.optional(),
  completeness: evalDimensionRawSchema.optional(),
  architecture: evalDimensionRawSchema.optional(),
  communication: evalDimensionRawSchema.optional(),
  feedback: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional(),
  /** 候选人本应掌握却明显缺失的概念（喂给 Learner Memory，scope A 仅采集、暂未接线）。 */
  missingConcepts: z.array(z.string()).optional(),
});

export type LlmEvaluationRaw = z.infer<typeof llmEvaluationRawSchema>;

// 规范化后的 EvaluationResult（与 types.ts 对齐）。
// dimensions 仍为 0-100（domain 归一化后的分数），保证全部下游零改动；
// 额外携带 levels（LLM 原始序级）+ evidence（每维判断依据）+ missingConcepts 供展示与后续 Learner 证据接线。
export const evaluationResultSchema = z.object({
  overall: z.number().min(0).max(100).int(),
  dimensions: z.object({
    correctness: evaluationDimensionScoreSchema,
    completeness: evaluationDimensionScoreSchema,
    architecture: evaluationDimensionScoreSchema,
    communication: evaluationDimensionScoreSchema,
  }),
  levels: z.object({
    correctness: evalLevelSchema,
    completeness: evalLevelSchema,
    architecture: evalLevelSchema,
    communication: evalLevelSchema,
  }),
  evidence: z.object({
    correctness: z.string(),
    completeness: z.string(),
    architecture: z.string(),
    communication: z.string(),
  }),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  missingConcepts: z.array(z.string()),
  feedback: z.string(),
  referenceAnswer: z.string().optional(),
});

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

export function parseLlmEvaluationRaw(input: unknown): LlmEvaluationRaw {
  return llmEvaluationRawSchema.parse(input);
}

export function safeParseLlmEvaluationRaw(input: unknown) {
  return llmEvaluationRawSchema.safeParse(input);
}
