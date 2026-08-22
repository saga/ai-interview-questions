// 引擎编排层：把声明式 InterviewDefinition 变成具体会话，并负责评分。
// 依赖 domain（纯逻辑）与 ai（适配层）；不直接 import pi-ai，便于替换底层。

import type {
  AnswerValue,
  EvaluationResult,
  GeneratedVariant,
  InterviewDefinition,
  InterviewSession,
  PiConfig,
  Question,
  QuestionBank,
} from '../types';
import { pickQuestions, isChoice } from '../domain/quiz';
import { gradeChoice } from '../domain/evaluation';
import { applyVariant, validateVariant } from '../domain/variant';
import { createLLMProvider } from '../ai/provider';

/**
 * 由声明式 Definition 构建一次具体会话：
 * 先按 类别 / 难度 / 类型 过滤题池，再随机抽题；
 * 若启用 AI，则为每题生成变体——校验通过后落地，失败则回退原题（答案 key 始终来自原题）。
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

  const picked = pickQuestions(pool, def.count);
  const provider = def.useAI ? createLLMProvider(config) : null;
  const variants: Record<string, GeneratedVariant> = {};

  const questions = await Promise.all(
    picked.map(async (q: Question) => {
      if (!provider || !config) return q;
      try {
        const v = await provider.generateVariant(q, config);
        const check = validateVariant(q, v);
        if (!check.ok) {
          console.warn(`变体校验失败(${q.id})，回退原题：${check.reason}`);
          return q;
        }
        variants[q.id] = v;
        return applyVariant(q, v);
      } catch (err) {
        console.warn(`变体生成失败(${q.id})，回退原题：`, err);
        return q;
      }
    }),
  );

  return {
    definition: def,
    questions,
    startedAt: Date.now(),
    variants: Object.keys(variants).length > 0 ? variants : undefined,
  };
}

/** 评估单题：选择题确定性判分；开放/编程题走 LLM（无 provider 则返回 null）。 */
export async function evaluateAnswer(
  q: Question,
  answer: AnswerValue | undefined,
  def: InterviewDefinition,
  config?: PiConfig,
): Promise<EvaluationResult | null> {
  if (isChoice(q)) {
    return gradeChoice(q, (answer as number[]) ?? [], def.scoringRubric);
  }
  const provider = createLLMProvider(config);
  if (!provider || !config) return null;
  return provider
    .evaluateOpenAnswer(q, (answer as string) ?? '', config, def.scoringRubric, def.evaluationCriteria)
    .catch((err) => {
      console.warn('评分失败：', err);
      return null;
    });
}

/** 批量评估整场会话，返回 题目 id → 评估结果 的映射。 */
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
