import { z } from 'zod';
import { difficultySchema, questionAngleSchema } from './common';

/** 题目溯源引用：课程题库题必须能追溯到原始教学材料（提案要求"Source Evidence"）。 */
const questionSourceRefSchema = z.object({
  materialId: z.string().min(1),
  section: z.string().optional(),
  page: z.number().int().nonnegative().optional(),
});

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
    aiGenerated: z.boolean().optional(),
    // ── 课程题库前瞻字段（可选，不破坏面试题校验；提案要求 Source Evidence + 反证）──
    /** 归属课程 id（课程题库题才有；面试题恒缺省）。 */
    courseId: z.string().min(1).optional(),
    /** 归属课程知识点 id（Course Knowledge Map 中的概念 id）。 */
    knowledgeId: z.string().min(1).optional(),
    /** 题目溯源：来自哪份教学材料 / 章节 / 页码。 */
    source: questionSourceRefSchema.optional(),
    /** 该题试图探测的常见误解（用于证据+反证评分器，选择题尤其有价值）。 */
    misconceptions: z.array(z.string().min(1)).optional(),
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
