// 引擎编排层：把声明式 InterviewDefinition 变成具体会话，并负责评分。
// 依赖 domain（纯逻辑）与 ai（适配层）；不直接 import pi-ai，便于替换底层。

import type {
  AnswerValue,
  EvaluationResult,
  InterviewDefinition,
  InterviewSession,
  LearnerProfile,
  PiConfig,
  Question,
  QuestionBank,
} from '../types';
import { pickPrioritized, pickQuestions, isChoice } from '../domain/quiz';
import { gradeChoice } from '../domain/evaluation';
import { applyVariant, validateVariant } from '../domain/variant';
import { createLLMProvider } from '../ai/provider';
import { pickNextAdaptive, type AnswerSignal, type Strategy } from '../domain/adaptive';

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

  const questions = await finalizeQuestions(picked, provider, config);
  return { definition: def, questions, startedAt: Date.now() };
}

/** 为题目生成并校验 LLM 变体；无 provider / 校验失败 / 调用失败时一律回退原题。 */
async function finalizeQuestion(
  q: Question,
  provider: ReturnType<typeof createLLMProvider>,
  config?: PiConfig,
): Promise<Question> {
  if (!provider || !config) return q;
  try {
    const v = await provider.generateVariant(q, config);
    const check = validateVariant(q, v);
    if (!check.ok) {
      console.warn(`变体校验失败(${q.id})，回退原题：${check.reason}`);
      return q;
    }
    return applyVariant(q, v);
  } catch (err) {
    console.warn(`变体生成失败(${q.id})，回退原题：`, err);
    return q;
  }
}

async function finalizeQuestions(
  picked: Question[],
  provider: ReturnType<typeof createLLMProvider>,
  config?: PiConfig,
): Promise<Question[]> {
  return Promise.all(picked.map((q) => finalizeQuestion(q, provider, config)));
}

/**
 * 自适应模式的下一步：根据已答题的作答信号（主题/得分/难度），
 * 由概念图与迁移策略选出下一题（含变体处理）；题池耗尽返回 null。
 * @param profile 学习画像（move-on 兜底时优先薄弱主题）
 */
export async function nextAdaptiveStep(
  bank: QuestionBank,
  session: InterviewSession,
  signals: AnswerSignal[],
  profile?: LearnerProfile,
  config?: PiConfig,
): Promise<{ question: Question; strategy: Strategy } | null> {
  const def = session.definition;
  let pool = bank.questions;
  if (def.categories.length > 0) pool = pool.filter((q) => def.categories.includes(q.category));
  if (def.difficulties.length > 0) pool = pool.filter((q) => def.difficulties.includes(q.difficulty));
  if (def.questionTypes.length > 0) pool = pool.filter((q) => def.questionTypes.includes(q.type));
  const asked = new Set(session.questions.map((q) => q.id));
  pool = pool.filter((q) => !asked.has(q.id));

  const picked = pickNextAdaptive(pool, signals, profile);
  if (!picked || session.questions.length >= def.count) return null;

  const provider = def.useAI ? createLLMProvider(config) : null;
  const question = await finalizeQuestion(picked.question, provider, config);
  return { question, strategy: picked.strategy };
}

/**
 * 评估单题：选择题确定性判分；
 * 开放/编程题仅在 useAI 开启且有有效 provider 时走 LLM（否则返回 null，UI 提示未评分）。
 */
export async function evaluateAnswer(
  q: Question,
  answer: AnswerValue | undefined,
  def: InterviewDefinition,
  config?: PiConfig,
): Promise<EvaluationResult | null> {
  if (isChoice(q)) {
    return gradeChoice(q, (answer as number[]) ?? [], def.scoringRubric);
  }
  if (!def.useAI) return null;
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
