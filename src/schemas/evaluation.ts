import { z } from 'zod';

export const evaluationDimensionScoreSchema = z.number().min(0).max(100).int();

// LLM 原始输出：只验证形状，overall 由 domain 聚合，不采纳 LLM 直出
export const llmEvaluationRawSchema = z.object({
  correctness: z.number().optional(),
  completeness: z.number().optional(),
  architecture: z.number().optional(),
  communication: z.number().optional(),
  feedback: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional(),
});

export type LlmEvaluationRaw = z.infer<typeof llmEvaluationRawSchema>;

// 规范化后的 EvaluationResult（与 types.ts 对齐）
export const evaluationResultSchema = z.object({
  overall: z.number().min(0).max(100).int(),
  dimensions: z.object({
    correctness: evaluationDimensionScoreSchema,
    completeness: evaluationDimensionScoreSchema,
    architecture: evaluationDimensionScoreSchema,
    communication: evaluationDimensionScoreSchema,
  }),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
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
