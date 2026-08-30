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

// 6 大能力域（ADR-038）：以"面试能力域"组织题库，而非按技术名词平铺。
// 每个域下再分 topic（见 src/data/taxonomy.ts），topic 下才是 Concept（KnowledgeNode）。
export const knowledgeAreaSchema = z.enum([
  'ai-engineering', // 基础能力：DL/CNN/序列模型/Transformer
  'llm', // 大模型核心：基础/训练/推理/架构/多模态
  'llm-applications', // 大模型应用：RAG/嵌入/检索/上下文工程
  'agent-engineering', // 智能体工程：基础/工具/MCP/规划/记忆/多智能体
  'ai-systems', // AI 系统：架构/评估/可观测/成本/可靠性
  'ai-security', // AI 安全：注入/泄露/工具/智能体安全
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
