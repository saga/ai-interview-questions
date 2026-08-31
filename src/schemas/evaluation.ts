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

/**
 * 单维 LLM 原始输出：序级（宽松 number，越界由 parseEvaluation 钳制）+ 证据 + 适用性。
 *
 * `applicable: false` 表示「该维度对本题不适用」（概念题不涉及 architecture、纯编码题不涉及 communication）。
 * 不适用维度**不参与加权**，其权重按比例重分配给其余维度（见 domain/aggregateOverall）——
 * 早期版本让模型给不适用维度打中性档 2，代码却仍按 `dimension × weight` 求和，
 * 于是"不适用"实际扣掉了 0.2 × 50 = 10 分，与 prompt 承诺的「不额外扣分」相悖。
 *
 * 缺省视为适用：只有模型**显式**声明 `false` 才排除。维度对象整体缺失属于残缺输出，
 * 仍按 level 0 兜底（与既有行为一致），不享受"不适用"待遇——否则模型少输出一维就白拿满分。
 */
export const evalDimensionRawSchema = z.object({
  level: z.number(),
  evidence: z.string().optional(),
  applicable: z.boolean().optional(),
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
  /** 选择题命中的误解（来自题目 misconceptions × misconceptionMap）；开放题恒缺省。 */
  misconceptionIds: z.array(z.string()).optional(),
  /**
   * 各维是否适用（false = 不适用，不参与 overall 加权）。
   * 刻意设为 optional：本 schema 用于校验 localStorage / IndexedDB 里**已持久化**的旧评分记录，
   * 必填会让历史数据全部 safeParse 失败。缺失时视为「四维全部适用」。
   */
  applicable: z
    .object({
      correctness: z.boolean(),
      completeness: z.boolean(),
      architecture: z.boolean(),
      communication: z.boolean(),
    })
    .optional(),
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
