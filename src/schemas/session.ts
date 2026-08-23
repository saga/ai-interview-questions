import { z } from 'zod';
import { interviewDefinitionSchema } from './interview';
import { questionSchema } from './question';
import { formatIdSchema } from './common';
import { evaluationResultSchema } from './evaluation';

export const sessionQuestionSchema = z.object({
  question: questionSchema,
  format: formatIdSchema,
});

export const interviewSessionSchema = z.object({
  definition: interviewDefinitionSchema,
  questions: z.array(sessionQuestionSchema),
  startedAt: z.number(),
});

// 仅用于序列化/回放的轻量会话快照（可选）
export const sessionAnswerSchema = z.record(z.string(), z.union([z.array(z.number()), z.string()]));

export const sessionEvaluationSchema = z.record(z.string(), evaluationResultSchema.nullable());

export type SessionQuestion = z.infer<typeof sessionQuestionSchema>;
export type InterviewSession = z.infer<typeof interviewSessionSchema>;
