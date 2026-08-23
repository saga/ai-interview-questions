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
import { pickPrioritized, pickQuestions, isChoice } from '../domain/quiz';
import { gradeChoice } from '../domain/evaluation';
import { applyVariant, validateVariant } from '../domain/variant';
import { createLLMProvider } from '../ai/provider';
import { pickNextAdaptive, type AnswerSignal, type Strategy } from '../domain/adaptive';
import { conceptGraph } from '../domain/conceptGraph';

/**
 * 由声明式 Definition 构建一次具体会话：
 * 先按 类别 / 难度 / 类型 过滤题池，再随机抽题（adaptive 模式只出第一题，后续由 nextAdaptiveStep 决定）；
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

  // 薄弱主题优先（Training Coach），否则纯随机；adaptive 模式只组第一题
  const count = def.adaptive ? 1 : def.count;
  const picked =
    def.topicPriorities && def.topicPriorities.length > 0
      ? pickPrioritized(pool, def.topicPriorities, count)
      : pickQuestions(pool, count);
  const provider = def.useAI ? createLLMProvider(config) : null;

  const { questions, variants } = await finalizeQuestions(picked, provider, config);
  return {
    definition: def,
    questions,
    startedAt: Date.now(),
    variants: Object.keys(variants).length > 0 ? variants : undefined,
  };
}

/** 为题目生成并校验 LLM 变体（无 provider / 失败时回退原题）。 */
async function finalizeQuestion(
  q: Question,
  provider: ReturnType<typeof createLLMProvider>,
  config?: PiConfig,
): Promise<{ question: Question; variant?: GeneratedVariant }> {
  if (!provider || !config) return { question: q };
  try {
    const v = await provider.generateVariant(q, config);
    const check = validateVariant(q, v);
    if (!check.ok) {
      console.warn(`变体校验失败(${q.id})，回退原题：${check.reason}`);
      return { question: q };
    }
    return { question: applyVariant(q, v), variant: v };
  } catch (err) {
    console.warn(`变体生成失败(${q.id})，回退原题：`, err);
    return { question: q };
  }
}

async function finalizeQuestions(
  picked: Question[],
  provider: ReturnType<typeof createLLMProvider>,
  config?: PiConfig,
): Promise<{ questions: Question[]; variants: Record<string, GeneratedVariant> }> {
  const results = await Promise.all(picked.map((q) => finalizeQuestion(q, provider, config)));
  const variants: Record<string, GeneratedVariant> = {};
  for (const r of results) if (r.variant) variants[r.variant.sourceQuestionId] = r.variant;
  return { questions: results.map((r) => r.question), variants };
}

/**
 * 自适应模式的下一步：根据已答题的作答信号（主题/得分/难度），
 * 由概念图与迁移策略选出下一题（含变体处理）；题池耗尽返回 null。
 */
export async function nextAdaptiveStep(
  bank: QuestionBank,
  session: InterviewSession,
  signals: AnswerSignal[],
  config?: PiConfig,
): Promise<{ question: Question; strategy: Strategy } | null> {
  const def = session.definition;
  let pool = bank.questions;
  if (def.categories.length > 0) pool = pool.filter((q) => def.categories.includes(q.category));
  if (def.difficulties.length > 0) pool = pool.filter((q) => def.difficulties.includes(q.difficulty));
  if (def.questionTypes.length > 0) pool = pool.filter((q) => def.questionTypes.includes(q.type));
  const asked = new Set(session.questions.map((q) => q.id));
  pool = pool.filter((q) => !asked.has(q.id));

  const picked = pickNextAdaptive(pool, signals, conceptGraph);
  if (!picked || session.questions.length >= def.count) return null;

  const provider = def.useAI ? createLLMProvider(config) : null;
  const { question } = await finalizeQuestion(picked.question, provider, config);
  return { question, strategy: picked.strategy };
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
