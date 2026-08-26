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
import {
  pickNextAdaptive,
  type AnswerSignal,
  type Strategy,
  type ConceptSelectionContext,
  type AnsweredConceptSignal,
} from '../domain/adaptive';
import { conceptFaceOf } from '../domain/coverage';
import { buildQuestionFromGeneration } from '../domain/blueprint';
import { buildProbeBlueprint, shouldPromoteProbe } from '../domain/probe';
import { knowledgeNodes } from '../data/knowledgeMap';
import type { ConceptRef } from '../types';
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
 * 由当前会话的题池话题 + 已答记录，派生概念优先抽题上下文（Concept-coverage 接线，PR1–PR4 落地）。
 * - face：题池话题对应的知识节点概念面（仅 transformer 等已挂 concepts 的节点非空），
 *   按概念 id 去重、importance 取较大者；无概念面时返回 null，调用方据此走原 topic/angle 路径。
 * - answered：已问题目（按序）与其作答信号拼出，供 buildConceptStats 聚合概念掌握度。
 */
function buildConceptContext(
  inScopeTopics: Set<string>,
  session: InterviewSession,
  signals: AnswerSignal[],
): ConceptSelectionContext | null {
  const nodeById = new Map(knowledgeNodes.map((n) => [n.id, n]));
  const faceMap = new Map<string, ConceptRef>();
  for (const topic of inScopeTopics) {
    const node = nodeById.get(topic);
    if (!node) continue;
    for (const c of conceptFaceOf(node)) {
      const existing = faceMap.get(c.id);
      if (!existing || c.importance > existing.importance) faceMap.set(c.id, c);
    }
  }
  if (faceMap.size === 0) return null;

  const n = Math.min(session.questions.length, signals.length);
  const answered: AnsweredConceptSignal[] = [];
  for (let i = 0; i < n; i++) {
    const sq = session.questions[i];
    answered.push({ id: sq.question.id, tests: sq.question.tests, score: signals[i].score });
  }
  return { face: [...faceMap.values()], answered };
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
): Promise<{ question: SessionQuestion; strategy: Strategy; probe?: { conceptId: string; promoted: boolean } } | null> {
  const def = session.definition;
  const formats = effectiveFormats(def, config);
  let pool = bank.questions;
  if (def.categories.length > 0) pool = pool.filter((q) => def.categories.includes(q.category));
  if (def.difficulties.length > 0) pool = pool.filter((q) => def.difficulties.includes(q.difficulty));
  pool = pool.filter((q) => availableFormats(q, formats).length > 0);
  // 概念面取当前题池话题对应的知识节点（在此处、排除已问之前取，使 face 稳定代表会话概念范围）
  const inScopeTopics = new Set(pool.map((q) => q.topic));
  const conceptCtx = buildConceptContext(inScopeTopics, session, signals);
  const asked = new Set(session.questions.map((sq) => sq.question.id));
  pool = pool.filter((q) => !asked.has(q.id));

  const picked = pickNextAdaptive(pool, signals, profile, undefined, conceptCtx ?? undefined, Boolean(providerOverride) || def.useAI);
  if (!picked || session.questions.length >= def.count) return null;

  // PR6 Dynamic Probe：概念优先路径选中一个「无对应题库题」的 uncovered 概念时，
  // 由 LLM 生成一道 transient 临时题来探测它；无 AI 或生成失败则回退到原自适应路径。
  if (picked.probeConceptId) {
    const node = knowledgeNodes.find((n) => conceptFaceOf(n).some((c) => c.id === picked.probeConceptId));
    const concept = node?.concepts?.find((c) => c.id === picked.probeConceptId);
    if (node && concept) {
      const promoted = shouldPromoteProbe(picked.probeConceptId, session.questions.map((sq) => sq.question));
      const provider = providerOverride ?? (def.useAI ? createLLMProvider(config) : null);
      if (provider) {
        try {
          const bp = buildProbeBlueprint(concept, node);
          const gen = await provider.generateQuestion(bp, node);
          const probeQ = buildQuestionFromGeneration(gen, bp, `probe-${picked.probeConceptId}-${session.questions.length}`, {
            transient: true,
          });
          const probeSq: SessionQuestion = { question: probeQ, format: probeQ.formats.choice ? 'choice' : 'open' };
          return { question: probeSq, strategy: 'move-on', probe: { conceptId: picked.probeConceptId, promoted } };
        } catch (err) {
          console.warn('[Dynamic Probe] 生成临时题失败，回退到原自适应路径：', err);
        }
      }
    }
    // 无节点 / 无 provider / 生成失败 → 回退到非概念路径取任一 bank 题（向后兼容，无 AI 时不探针）
    const fb = pickNextAdaptive(pool, signals, profile);
    if (fb && fb.question) {
      const target = toSessionQuestion(fb.question, formats);
      const question = await finalizeQuestion(target, providerOverride ?? (def.useAI ? createLLMProvider(config) : null));
      return { question, strategy: fb.strategy };
    }
    return null;
  }

  // 非探针路径：picked.question 必为非空（探针情形已在上方处理并返回/回退）
  if (!picked.question) return null;
  // 自适应模式无组卷配额：按开放形态概率随机分配（与普通会话的 7:3 体验一致）；
  // generateOpenQuestions 关闭时 formats 不含 open，wantOpen 恒为 false
  const target = toSessionQuestion(picked.question, formats);
  const provider = def.useAI ? createLLMProvider(config) : null;
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
