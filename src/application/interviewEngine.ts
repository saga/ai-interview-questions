// 引擎编排层：把声明式 InterviewDefinition 变成具体会话，并负责评分。
// 依赖 domain（纯逻辑）与 ai（适配层）；不直接 import pi-ai，便于替换底层。
// ADR-027：会话持有 SessionQuestion（题库快照 + 本次形态），同一道题可跨会话换形态。

import type {
  AIConfig,
  AnswerValue,
  EvaluationResult,
  FormatId,
  InterviewDefinition,
  InterviewSession,
  LearnerProfile,
  LLMProvider,
  QuestionBank,
  SessionQuestion,
} from '../types';
import { availableFormats, planComposition } from '../domain/quiz';
import { gradeChoice } from '../domain/evaluation';
import { applyVariant, validateVariant } from '../domain/variant';
import { createLLMProvider } from '../ai/provider';
import { pickNextAdaptive, type AnswerSignal, type Strategy } from '../domain/adaptive';
import { interviewDefinitionSchema } from '../schemas/interview';
import { formatSchemaErrorMessage } from '../schemas/errors';

/** 自适应模式无组卷配额：开放形态按此概率随机分配（与普通会话的 7:3 体验一致）。 */
const ADAPTIVE_OPEN_PROBABILITY = 0.3;

/**
 * 本次会话实际允许的呈现形态（ADR-031）：config.generateOpenQuestions 关闭
 * （含 config 未传）时剔除 open——纯开放题因此不入池，双形态题一律出选择。
 * 返回值永远是具体的非空列表：定义未选形态视为不限（choice+open）；
 * 定义只选了 open 而全局关闭时退化为 choice，避免出现空会话。
 */
function effectiveFormats(def: InterviewDefinition, config?: AIConfig): FormatId[] {
  const base: FormatId[] = def.formats.length > 0 ? def.formats : ['choice', 'open'];
  if (config?.generateOpenQuestions) return base;
  const filtered = base.filter((f) => f !== 'open');
  return filtered.length > 0 ? filtered : ['choice'];
}

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
  const formats = effectiveFormats(validDef, config);
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

/** 为会话实例生成并校验 LLM 变体（ADR-036）：无兜底，校验失败直接抛错。 */
async function finalizeQuestion(sq: SessionQuestion, provider: LLMProvider | null): Promise<SessionQuestion> {
  if (!provider) return sq;
  const v = await provider.generateVariant(sq.question);
  const check = validateVariant(sq.question, v);
  if (!check.ok) throw new Error(`变体校验失败(${sq.question.id}): ${check.reason}`);
  return { ...sq, question: applyVariant(sq.question, v) };
}

/**
 * 自适应模式的下一步：根据已答题的作答信号（主题/得分/难度），
 * 由概念图与迁移策略选出下一题（含变体处理与形态分配）；题池耗尽返回 null。
 * @param profile 学习画像（move-on 兜底时优先薄弱主题）
 */
export async function nextAdaptiveStep(
  bank: QuestionBank,
  session: InterviewSession,
  signals: AnswerSignal[],
  profile?: LearnerProfile,
  config?: AIConfig,
): Promise<{ question: SessionQuestion; strategy: Strategy } | null> {
  const def = session.definition;
  const formats = effectiveFormats(def, config);
  let pool = bank.questions;
  if (def.categories.length > 0) pool = pool.filter((q) => def.categories.includes(q.category));
  if (def.difficulties.length > 0) pool = pool.filter((q) => def.difficulties.includes(q.difficulty));
  pool = pool.filter((q) => availableFormats(q, formats).length > 0);
  const asked = new Set(session.questions.map((sq) => sq.question.id));
  pool = pool.filter((q) => !asked.has(q.id));

  const picked = pickNextAdaptive(pool, signals, profile);
  if (!picked || session.questions.length >= def.count) return null;

  // 自适应模式无组卷配额：按开放形态概率随机分配（与普通会话的 7:3 体验一致）；
  // generateOpenQuestions 关闭时 formats 不含 open，wantOpen 恒为 false
  const avail = availableFormats(picked.question, formats);
  const wantOpen =
    avail.includes('open') && (!avail.includes('choice') || Math.random() < ADAPTIVE_OPEN_PROBABILITY);
  const target: SessionQuestion = { question: picked.question, format: wantOpen ? 'open' : 'choice' };

  const provider = def.useAI ? createLLMProvider(config) : null;
  const question = await finalizeQuestion(target, provider);
  return { question, strategy: picked.strategy };
}

/**
 * 评估单个会话实例：选择形态确定性判分；
 * 开放形态仅在 useAI 开启且有有效 provider 时走 LLM（否则返回 null，UI 提示未评分）。
 */
export async function evaluateAnswer(
  sq: SessionQuestion,
  answer: AnswerValue | undefined,
  def: InterviewDefinition,
  config?: AIConfig,
): Promise<EvaluationResult | null> {
  if (sq.format === 'choice') {
    const cf = sq.question.formats.choice;
    if (!cf) throw new Error(`题目 ${sq.question.id} 缺少 choice 形态，无法判分`);
    return gradeChoice(cf, (answer as number[]) ?? [], def.scoringRubric);
  }
  if (!def.useAI) return null;
  const open = sq.question.formats.open;
  if (!open) throw new Error(`题目 ${sq.question.id} 缺少 open 形态，无法评分`);
  const provider = createLLMProvider(config);
  if (!provider) return null;
  return provider
    .evaluateOpenAnswer(sq.question, open, (answer as string) ?? '', def.scoringRubric, def.evaluationCriteria)
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
    session.questions.map(async (sq) => {
      results[sq.question.id] = await evaluateAnswer(sq, answers[sq.question.id], session.definition, config);
    }),
  );
  return results;
}
