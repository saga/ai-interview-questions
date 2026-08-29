// 引擎编排层：把声明式 InterviewDefinition 变成具体会话，并负责评分。
// 依赖 domain（纯逻辑）与 ai（适配层）；不直接 import pi-ai，便于替换底层。
// ADR-027：会话持有 SessionQuestion（题库快照 + 本次形态），同一道题可跨会话换形态。

import type { AnswerValue, LLMProvider, QuestionBank } from '../types';
import type { AIConfig } from '../schemas/ai-config';
import type { EvaluationResult } from '../schemas/evaluation';
import type { FormatId } from '../schemas/common';
import type { InterviewDefinition } from '../schemas/interview';
import type { InterviewSession, SessionQuestion } from '../schemas/session';
import type { LearnerProfile } from '../schemas/learner';
import { availableFormats, planComposition } from '../domain/quiz';
import { createLLMProvider } from '../ai/provider';
import { pickNextAdaptive, type AnswerSignal, type Strategy } from '../domain/adaptive';
import { interviewDefinitionSchema } from '../schemas/interview';
import { formatSchemaErrorMessage } from '../schemas/errors';
import { effectiveFormats, evaluateSessionQuestion, finalizeQuestion } from './sessionEvaluator';

/** 自适应模式无组卷配额：开放形态按此概率随机分配（与普通会话的 7:3 体验一致）。 */
const ADAPTIVE_OPEN_PROBABILITY = 0.3;

/**
 * 本次会话实际允许的呈现形态（ADR-031）：
 * - config.generateOpenQuestions 关闭（含 config 未传）→ 剔除 open；
 * - def.useAI 关闭 → 剔除 open（开放题无法评分，避免「出题但不打分」的不一致）；
 * 返回值永远是具体的非空列表：定义未选形态视为不限（choice+open）；
 * 定义只选了 open 而不可用时退化为 choice，避免出现空会话。
 */
/**
 * 由声明式 Definition 构建一次具体会话：
 * 先按 类别 / 难度 / 形态 过滤题池（题目保留任一允许形态即可），再组卷分配本次形态
 * （adaptive 模式只出第一题，后续由 nextAdaptiveStep 决定）；
 * 若启用 AI，则为每题生成变体并经 Knowledge Contract 校验（ADR-036，无兜底）。
 */
function assertValidDefinition(def: InterviewDefinition): InterviewDefinition {
  const result = interviewDefinitionSchema.safeParse(def);
  if (!result.success) {
    throw new Error(formatSchemaErrorMessage(result.error, 'InterviewDefinition 校验失败'));
  }
  return result.data;
}

export async function buildSession(
  bank: QuestionBank,
  def: InterviewDefinition,
  config?: AIConfig,
): Promise<InterviewSession> {
  const validDef = assertValidDefinition(def);
  const formats = effectiveFormats(validDef.formats, validDef.useAI, config?.generateOpenQuestions);
  let pool = bank.questions;
  if (validDef.categories.length > 0) pool = pool.filter((q) => validDef.categories.includes(q.category));
  if (validDef.difficulties.length > 0) pool = pool.filter((q) => validDef.difficulties.includes(q.difficulty));
  // 形态过滤：题目具备至少一种允许形态即入池；完全无可用形态的题剔除
  pool = pool.filter((q) => availableFormats(q, formats).length > 0);

  const count = validDef.adaptive ? 1 : validDef.count;
  const plan = planComposition(pool, count, validDef.topicPriorities, formats, Math.random);
  const provider = validDef.useAI ? createLLMProvider(config) : null;
  const questions = await Promise.all(plan.map((sq) => finalizeQuestion(sq, provider)));
  return { definition: validDef, questions, startedAt: Date.now() };
}

/**
 * 为会话实例生成并校验 LLM 变体（ADR-036）。
 * 本地模型输出不稳定（偶发 JSON 残缺 / 校验不通过），若直接抛错会让整场组卷中止、
 * 用户点「开始」永远进不去。这里改成「失败回退原题」：单个变体坏掉不影响其它题，
 * 至多该题不享受变体（仍是一套可用的正常题）。生成与校验都不抛到上层。
 */
/**
 * 自适应模式的下一步：根据已答题的作答信号（主题/得分/难度），
 * 由概念图与迁移策略选出下一题（含变体处理与形态分配）；题池耗尽返回 null。
 * @param profile 学习画像（move-on 兜底时优先薄弱主题）
 * @param config AI 配置（useAI 开启时用于变体与评分）
 * @param providerOverride 注入 LLMProvider（测试用；缺省按 config 现建）
 */
export async function nextAdaptiveStep(
  bank: QuestionBank,
  session: InterviewSession,
  signals: AnswerSignal[],
  profile?: LearnerProfile,
  config?: AIConfig,
  providerOverride?: LLMProvider,
): Promise<{ question: SessionQuestion; strategy: Strategy } | null> {
  const def = session.definition;
  const formats = effectiveFormats(def.formats, def.useAI, config?.generateOpenQuestions);
  let pool = bank.questions;
  if (def.categories.length > 0) pool = pool.filter((q) => def.categories.includes(q.category));
  if (def.difficulties.length > 0) pool = pool.filter((q) => def.difficulties.includes(q.difficulty));
  pool = pool.filter((q) => availableFormats(q, formats).length > 0);
  const asked = new Set(session.questions.map((sq) => sq.question.id));
  pool = pool.filter((q) => !asked.has(q.id));

  const picked = pickNextAdaptive(pool, signals, profile);
  if (!picked || !picked.question || session.questions.length >= def.count) return null;

  // 自适应模式无组卷配额：按开放形态概率随机分配（与普通会话的 7:3 体验一致）；
  // generateOpenQuestions 关闭时 formats 不含 open，wantOpen 恒为 false
  const target = toSessionQuestion(picked.question, formats);
  const provider = providerOverride ?? (def.useAI ? createLLMProvider(config) : null);
  const question = await finalizeQuestion(target, provider);
  return { question, strategy: picked.strategy };
}

/** 按会话允许形态分配本次呈现形态（自适应无组卷配额，按 7:3 开放概率随机）。 */
function toSessionQuestion(q: SessionQuestion['question'], formats: FormatId[]): SessionQuestion {
  const avail = availableFormats(q, formats);
  const wantOpen = avail.includes('open') && (!avail.includes('choice') || Math.random() < ADAPTIVE_OPEN_PROBABILITY);
  return { question: q, format: wantOpen ? 'open' : 'choice' };
}

/**
 * 评估单个会话实例：选择形态确定性判分；
 * 开放形态仅在 useAI 开启且有有效 provider 时走 LLM（否则返回 null，UI 提示未评分）。
 *
 * 设计权衡（trade-off）：
 * - 未作答 / 无 provider / useAI=false 时一律返回 null（而非 0）：与 Agent 评分层保持一致，
 *   避免把「没答」或「评不了」误记为 0 分污染 topicStats、overallScore 与薄弱分析。
 * - 开放题是 LLM 强依赖，这是硬约束而非可选项：useAI=false 时没有评分引擎，强行兜底成 0 反而误导用户，
 *   所以宁可「该题不计入成绩并提示」，也不伪造分数。
 * - 评分失败（网络/key）被 catch 成 null：单次 LLM 抖动不应让整场崩溃，UI 可据此提示「该题未评分」。
 */
export async function evaluateAnswer(
  sq: SessionQuestion,
  answer: AnswerValue | undefined,
  def: InterviewDefinition,
  config?: AIConfig,
): Promise<EvaluationResult | null> {
  if (!def.useAI) return evaluateSessionQuestion(sq, answer, null, def.scoringRubric, def.evaluationCriteria);
  const provider = createLLMProvider(config);
  return evaluateSessionQuestion(sq, answer, provider, def.scoringRubric, def.evaluationCriteria).catch((err) => {
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
    session.questions.map(async (sq) => {
      results[sq.question.id] = await evaluateAnswer(sq, answers[sq.question.id], session.definition, config);
    }),
  );
  return results;
}
