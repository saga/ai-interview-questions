import { z } from 'zod';
import { difficultySchema, formatIdSchema } from './common';

export const scoringRubricSchema = z.object({
  correctness: z.number(),
  completeness: z.number(),
  architecture: z.number(),
  communication: z.number(),
});

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
  mode: z.enum(['quick', 'custom', 'coach', 'interview', 'agent']).optional(),
});

export type InterviewDefinition = z.infer<typeof interviewDefinitionSchema>;
