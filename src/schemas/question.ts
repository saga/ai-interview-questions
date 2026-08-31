import { z } from 'zod';
import { difficultySchema, questionAngleSchema } from './common.ts';

/** 题目溯源引用：课程题库题必须能追溯到原始教学材料（提案要求"Source Evidence"）。 */
const questionSourceRefSchema = z.object({
  materialId: z.string().min(1),
  section: z.string().optional(),
  page: z.number().int().nonnegative().optional(),
});

const choiceFormatSchema = z.object({
  type: z.enum(['single', 'multiple']),
  options: z.array(z.string().min(1)).min(4).max(6),
  answer: z.array(z.number().int().nonnegative()).min(1),
  question: z.string().min(1).optional(),
  /**
   * 选项→误解映射（可选，与 `options` 等长索引对齐）：`misconceptionMap[i]` = 选项 i 体现的误解
   * 在题目级 `misconceptions` 数组中的下标，`null` = 该选项未标注。仅干扰项（错误选项）需要标注；
   * 答题者选中该错误选项时，即可无 LLM 产出结构化的误解命中信号（反证证据）。
   * 未标注的选项不产生信号（旧题库保持零破坏）。由 scripts/backfill-misconceptions.ts 自动回填。
   */
  misconceptionMap: z.array(z.union([z.number().int().nonnegative(), z.null()])).optional(),
}).superRefine((choice, ctx) => {
  if (new Set(choice.answer).size !== choice.answer.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['answer'],
      message: 'answer 索引不能重复',
    });
  }
  if (choice.type === 'single' && choice.answer.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['answer'],
      message: 'single 题必须恰好有一个正确答案',
    });
  }
  if (choice.type === 'multiple' && choice.answer.length < 2) {
    ctx.addIssue({
      code: 'custom',
      path: ['answer'],
      message: 'multiple 题至少需要两个正确答案',
    });
  }
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

/** 选择题呈现形态：单选/多选题干与选项。 */
export type ChoiceFormat = NonNullable<Question['formats']['choice']>;
/** 开放题呈现形态：参考答案（可选语言标注，给出则为编程题）。 */
export type OpenFormat = NonNullable<Question['formats']['open']>;

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
