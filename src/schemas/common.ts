import { z } from 'zod';

export const difficultySchema = z.enum(['easy', 'medium', 'hard']);

export const providerIdSchema = z.enum([
  'chrome',
  'local',
  'deepseek',
  'openrouter',
  'google',
  'cloudflare-workers-ai',
]);

export const formatIdSchema = z.enum(['choice', 'open']);

export const questionAngleSchema = z.enum([
  'definition',
  'fundamental',
  'mechanism',
  'comparison',
  'calculation',
  'tradeoff',
  'scenario',
  'debugging',
  'system-design',
  'design',
]);

export const knowledgeAreaSchema = z.enum([
  'dl-fundamentals',
  'transformer',
  'llm-architecture',
  'moe',
  'training',
  'inference',
  'rag-agent',
  'system-design',
]);

export const knowledgePrioritySchema = z.enum(['P0', 'P1', 'P2']);

export const evaluationDimensionSchema = z.enum([
  'correctness',
  'completeness',
  'architecture',
  'communication',
]);

export const idSchema = z.string().min(1);

// ── 单源类型导出（Zod 即契约，推导即类型） ──
export type Difficulty = z.infer<typeof difficultySchema>;
export type ProviderId = z.infer<typeof providerIdSchema>;
export type FormatId = z.infer<typeof formatIdSchema>;
export type QuestionAngle = z.infer<typeof questionAngleSchema>;
export type KnowledgeArea = z.infer<typeof knowledgeAreaSchema>;
export type KnowledgePriority = z.infer<typeof knowledgePrioritySchema>;
export type EvaluationDimension = z.infer<typeof evaluationDimensionSchema>;
