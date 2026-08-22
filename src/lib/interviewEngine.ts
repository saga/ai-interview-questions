import type {
  AnswerValue,
  EvaluationResult,
  InterviewDefinition,
  InterviewSession,
  QuestionBank,
  Question,
} from '../types';
import type { ChoiceQuestion } from '../types';
import { isChoice, isChoiceCorrect, pickQuestions } from './quiz';
import { evaluateOpenAnswer, isConfigValid, transformQuestion } from './piClient';
import type { PiConfig } from './piClient';

/** 默认面试定义：覆盖全部类型，10 题，启用 AI，标准权重。 */
export function defaultDefinition(): InterviewDefinition {
  return {
    title: 'AI 面试训练',
    categories: [],
    difficulties: [],
    questionTypes: ['single', 'multiple', 'essay', 'coding'],
    count: 10,
    useAI: true,
    scoringRubric: { correctness: 0.5, depth: 0.3, communication: 0.2 },
  };
}

/**
 * 引擎：由声明式 Definition 构建一次具体会话。
 * 先按 类别 / 难度 / 类型 过滤题池，再随机抽题，可选调用 LLM 做变体变换。
 */
export async function buildSession(
  bank: QuestionBank,
  def: InterviewDefinition,
  config?: PiConfig,
): Promise<InterviewSession> {
  let pool = bank.questions;
  if (def.categories.length > 0) pool = pool.filter((q) => def.categories.includes(q.category));
  if (def.difficulties.length > 0) pool = pool.filter((q) => def.difficulties.includes(q.difficulty));
  if (def.questionTypes.length > 0) pool = pool.filter((q) => def.questionTypes.includes(q.type));

  let picked = pickQuestions(pool, def.count);

  if (def.useAI && config && isConfigValid(config)) {
    picked = await Promise.all(
      picked.map((q) =>
        transformQuestion(q, config).catch((err) => {
          console.warn('变体生成失败，回退原题：', err);
          return q;
        }),
      ),
    );
  }

  return { definition: def, questions: picked, startedAt: Date.now() };
}

/**
 * 引擎：评估单题作答。
 * - 选择题：确定性判分，仅 correctness 维度。
 * - 开放/编程题：调用 LLM 做 correctness/depth/communication 三维评分；
 *   若无有效 LLM 配置则返回 null（交由 UI 提示未评分）。
 */
export async function evaluateAnswer(
  q: Question,
  answer: AnswerValue | undefined,
  def: InterviewDefinition,
  config?: PiConfig,
): Promise<EvaluationResult | null> {
  if (isChoice(q)) {
    const correct = isChoiceCorrect(q as ChoiceQuestion, (answer as number[]) ?? []);
    return {
      overall: correct ? 100 : 0,
      dimensions: { correctness: correct ? 100 : 0 },
      strengths: correct ? ['选择正确'] : [],
      gaps: correct ? [] : ['答案不正确，请参见解析'],
      feedback: correct ? '回答正确。' : '回答错误。',
    };
  }

  if (!config || !isConfigValid(config)) return null;
  return evaluateOpenAnswer(
    q,
    (answer as string) ?? '',
    config,
    def.scoringRubric,
    def.evaluationCriteria,
  ).catch((err) => {
    console.warn('评分失败：', err);
    return null;
  });
}

/** 引擎：批量评估整场会话，返回 题目id → 评估结果 的映射。 */
export async function evaluateSession(
  session: InterviewSession,
  answers: Record<string, AnswerValue>,
  config?: PiConfig,
): Promise<Record<string, EvaluationResult | null>> {
  const results: Record<string, EvaluationResult | null> = {};
  await Promise.all(
    session.questions.map(async (q) => {
      results[q.id] = await evaluateAnswer(q, answers[q.id], session.definition, config);
    }),
  );
  return results;
}
