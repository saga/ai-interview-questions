import { z } from 'zod';
import {
  assessmentSchema,
  cognitiveTaskSchema,
  difficultySchema,
  evaluationProfileSchema,
  questionAngleSchema,
} from './common.ts';

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
  // 越界检查必须在 schema 里：此前只有 validate-questions.ts 与 bank.test.ts 把关，
  // 导致 parseQuestion() 单独调用时会放过 {options:[A,B,C,D], answer:[9]} 这类非法数据。
  for (const index of choice.answer) {
    if (index >= choice.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['answer'],
        message: `answer 索引 ${index} 越界（options 共 ${choice.options.length} 项）`,
      });
    }
  }
  if (choice.misconceptionMap && choice.misconceptionMap.length !== choice.options.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['misconceptionMap'],
      message: `misconceptionMap 长度 ${choice.misconceptionMap.length} 必须与 options ${choice.options.length} 一致`,
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
    /**
     * 主考察角度。**必填** —— `topic × angle` 是题库治理主索引（ADR-043），
     * 覆盖矩阵、蓝图、adaptive 排序都依赖它。此前它是 optional，但
     * `scripts/validate-questions.ts`、`scripts/add-question.ts` 早已按必填拦截，
     * 形成「schema 说可选、CLI 说必填」的契约分裂。现全库 1308/1308 题均带 angle，
     * 收敛为 required 无存量风险。
     */
    angle: questionAngleSchema,
    /**
     * 认知任务（plan0903_3 / ADR-077）：考生作答必须执行的认知行为，与 `angle` 正交。
     * 进入 assessment contract（`topic × angle × difficulty × cognitiveTask`），改变即 fork。
     * Zod 层可选（存量 1311 题无可靠回填源，不回填）；**非法值**在 `question:add` 处拦截，
     * **缺失**目前只 warn（三个出题 skill 尚未产出该字段，见 `add-question.ts` 的升级条件）。
     */
    cognitiveTask: cognitiveTaskSchema.optional(),
    /**
     * 考察概念（plan0903_3 / ADR-077，对应 part1 §十四）：
     * 1 个核心 Concept + 0～3 个辅助 Concept。用于 assessment 去重与覆盖分析，不进运行时。
     */
    concepts: z
      .object({
        core: z.string().min(1),
        supporting: z.array(z.string().min(1)).max(3).default([]),
      })
      .optional(),
    /**
     * 测量意图（plan0907 / 外部评审 P0-2）：Blueprint 声明的「这道题到底要考生做什么、
     * 走哪条推理链」，是 blueprint → question 的契约，而非给 UI 展示的文案。
     *
     * 为什么必须落库：只有 `angle / cognitiveTask / difficulty` 不足以判定两道题是否
     * 测同一件事——两题完全可以 angle=cognitiveTask 相同却共用一条 reasoning path，
     * 也可以字段相同但测量意图不同。丢了它，后续审题、variant challenger、质量分析
     * 都失去了「这道题原本要求走哪条推理路径」的审计上下文。
     *
     * **不参与 runtime selection**（不进 adaptive / coverage 索引），仅用于：
     * blueprint 一致性校验、人工 review、variant 比较、质量分析。
     */
    assessment: assessmentSchema.optional(),
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
    /**
     * 评分预设（可选）：开放题按题型 shifting 四维权重（如 coding 的 correctness 占 0.7）。
     * 缺省 = 全局 rubric。只允许 6 档枚举，不允许题目自带任意权重（ADR-044）。
     */
    evaluationProfile: evaluationProfileSchema.optional(),
    /** 该题试图探测的常见误解（用于证据+反证评分器，选择题尤其有价值）。 */
    misconceptions: z.array(z.string().min(1)).optional(),
    /**
     * 派生来源（可选）：本 canonical 由哪道题 fork/derive 而来。
     *
     * **canonical 的内容身份（content identity）**：`id` 绑定的是「测哪条 Knowledge、哪组核心
     * propositions、原 options 承载的 assessment content」，而不是题面文字。
     * 新建 canonical / fork 的判据（与 Variant 的边界，见 src/domain/variant.ts 与 questionIdentity.ts）：
     *   - **Fork（新 canonical + derivedFrom）**：Knowledge 或 Knowledge Boundary 改变；或新题干
     *     必须**替换原 options 的 propositions** 才能作答（原选项承载不了新 assessment）。
     *   - **不是 fork**：仅换 observation entry（不同情境/场景/认知入口）而 Knowledge、核心
     *     propositions、options 真假与难度不变 —— 属 Variant（ADR-077），可进 variant pool 并
     *     **自声明不同的 angle / cognitiveTask**（Assessment Variant），不产生新 canonical id。
     *   - ⚠️ **不要仅凭 `angle / cognitiveTask / difficulty` 字段变化就判 fork**：那些字段属于
     *     measurement surface，canonical 原地改写时用于突变检测（questionIdentity.ts），但不构成
     *     「新内容」。v7.1 起判定以「Knowledge + propositions + options 承载能力」为准。
     *
     * Learner Memory 以 questionId 为键：真实换内容（fork）时必须新 id + derivedFrom，禁止原地改后
     * 沿用原 ID，否则旧分代表旧能力、污染历史证据。
     */
    derivedFrom: z.string().min(1).optional(),
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
    // misconceptionMap 的「下标合法性 + 正确项不得标注误解」需要同时看到
    // question 级 misconceptions 和 choice.answer，故放在这一层而非 choiceFormatSchema。
    const map = q.formats.choice?.misconceptionMap;
    if (!map) return;
    const misconceptionCount = q.misconceptions?.length ?? 0;
    map.forEach((value, optionIndex) => {
      if (value === null) return;
      if (value >= misconceptionCount) {
        ctx.addIssue({
          code: 'custom',
          path: ['formats', 'choice', 'misconceptionMap'],
          message: `misconceptionMap[${optionIndex}] = ${value} 越界（misconceptions 共 ${misconceptionCount} 条）`,
        });
        return;
      }
      if (q.formats.choice?.answer.includes(optionIndex)) {
        ctx.addIssue({
          code: 'custom',
          path: ['formats', 'choice', 'misconceptionMap'],
          message: `正确选项 ${optionIndex} 不应标注误解，应保持 null`,
        });
      }
    });
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
