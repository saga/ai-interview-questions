// 引擎编排层：把声明式 InterviewDefinition 变成具体会话，并负责评分。
// 依赖 domain（纯逻辑）与 ai（适配层）；不直接 import pi-ai，便于替换底层。

import type {
  AnswerValue,
  AIConfig,
  EvaluationResult,
  InterviewDefinition,
  InterviewSession,
  LearnerProfile,
  LLMProvider,
  Question,
  QuestionBank,
} from '../types';
import { isChoice, planComposition } from '../domain/quiz';
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
  config?: AIConfig,
): Promise<InterviewSession> {
  let pool = bank.questions;
  if (def.categories.length > 0) pool = pool.filter((q) => def.categories.includes(q.category));
  if (def.difficulties.length > 0) pool = pool.filter((q) => def.difficulties.includes(q.difficulty));
  if (def.questionTypes.length > 0) pool = pool.filter((q) => def.questionTypes.includes(q.type));

  // 薄弱主题优先（Training Coach），否则纯随机；adaptive 模式只出第一题，后续由 nextAdaptiveStep 决定
  const count = def.adaptive ? 1 : def.count;
  // 题型配比：单选/多选为主，开放题 ≈ 7:3；候选池缺题型时由 LLM 变换形态（useAI 开启时）
  const plan = planComposition(pool, count, def.topicPriorities, Math.random, def.useAI && !def.adaptive);
  const provider = def.useAI ? createLLMProvider(config) : null;
  const picked = await applyTransforms(plan, provider);

  const questions = await Promise.all(picked.map((q) => finalizeQuestion(q, provider)));
  return { definition: def, questions, startedAt: Date.now() };
}

/**
 * 执行组卷计划中的题型变换：变换成功原位替换（id 保持原题，溯源见日志），
 * 失败/无 provider 时保留原题型。
 */
async function applyTransforms(
  plan: ReturnType<typeof planComposition>,
  provider: LLMProvider | null,
): Promise<Question[]> {
  const { picked, transforms } = plan;
  if (transforms.length === 0) return picked;
  if (!provider) {
    console.warn(`跳过 ${transforms.length} 道题的题型变换（AI 未启用）`);
    return picked;
  }
  const result = [...picked];
  await Promise.all(
    transforms.map(async (t) => {
      try {
        const transformed = await provider.transformQuestion(t.question, t.target);
        const i = result.indexOf(t.question);
        if (i !== -1) result[i] = transformed;
      } catch (err) {
        console.warn(`题型变换失败(${t.question.id})，保留原题型：`, err);
      }
    }),
  );
  return result;
}

/** 为题目生成并校验 LLM 变体；无 provider / 校验失败 / 调用失败时一律回退原题。 */
async function finalizeQuestion(q: Question, provider: LLMProvider | null): Promise<Question> {
  if (!provider) return q;
  try {
    const v = await provider.generateVariant(q);
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
  config?: AIConfig,
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
  const question = await finalizeQuestion(picked.question, provider);
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
  config?: AIConfig,
): Promise<EvaluationResult | null> {
  if (isChoice(q)) {
    return gradeChoice(q, (answer as number[]) ?? [], def.scoringRubric);
  }
  if (!def.useAI) return null;
  const provider = createLLMProvider(config);
  if (!provider) return null;
  return provider
    .evaluateOpenAnswer(q, (answer as string) ?? '', def.scoringRubric, def.evaluationCriteria)
    .catch((err) => {
      console.warn('评分失败：', err);
      return null;
    });
}

/** 批量评估整场会话，返回 题目 id → 评估结果 的映射。 */
export async function evaluateSession(
  session: InterviewSession,
  answers: Record<string, AnswerValue>,
  config?: AIConfig,
): Promise<Record<string, EvaluationResult | null>> {
  const results: Record<string, EvaluationResult | null> = {};
  await Promise.all(
    session.questions.map(async (q) => {
      results[q.id] = await evaluateAnswer(q, answers[q.id], session.definition, config);
    }),
  );
  return results;
}
