import { z } from 'zod';
import { difficultySchema, questionAngleSchema } from './common';

const choiceFormatSchema = z.object({
  type: z.enum(['single', 'multiple']),
  options: z.array(z.string().min(1)).min(2),
  answer: z.array(z.number().int().nonnegative()).min(1),
  question: z.string().min(1).optional(),
});

const openFormatSchema = z.object({
  referenceAnswer: z.string().min(1),
  language: z.string().optional(),
});

const rubricSchema = z.object({
  required: z.array(z.string().min(1)).optional(),
  dimensions: z
    .object({
      correctness: z.number().optional(),
      completeness: z.number().optional(),
      architecture: z.number().optional(),
      communication: z.number().optional(),
    })
    .optional(),
});

export const questionSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    topic: z.string().min(1),
    subtopic: z.string().optional(),
    tags: z.array(z.string()).default([]),
    difficulty: difficultySchema,
    angle: questionAngleSchema.optional(),
    question: z.string().min(1),
    explanation: z.string().min(1),
    reference: z.object({ concept: z.string().optional() }).optional(),
    rubric: rubricSchema.optional(),
    aiGenerated: z.boolean().optional(),
    formats: z.object({
      choice: choiceFormatSchema.optional(),
      open: openFormatSchema.optional(),
    }),
  })
  .superRefine((q, ctx) => {
    const hasChoice = !!q.formats.choice;
    const hasOpen = !!q.formats.open;
    if (!hasChoice && !hasOpen) {
      ctx.addIssue({
        code: 'custom',
        path: ['formats'],
        message: '至少需要一种呈现形态（choice / open）',
      });
    }
  });

export type Question = z.infer<typeof questionSchema>;

// ── 边界适配器：Zod 仅在边界工作，domain 内部不感知 Zod ──

export function parseQuestion(input: unknown): Question {
  return questionSchema.parse(input);
}

export function parseQuestionSafe(input: unknown): z.ZodSafeParseResult<Question> {
  return questionSchema.safeParse(input);
}

export function parseQuestionArray(input: unknown): Question[] {
  const result = z.array(questionSchema).safeParse(input);
  if (!result.success) throw result.error;
  return result.data;
}

export function loadQuestionBank(raw: unknown): Question[] {
  const result = z.array(questionSchema).safeParse(raw);
  if (!result.success) throw result.error;
  return result.data;
}
