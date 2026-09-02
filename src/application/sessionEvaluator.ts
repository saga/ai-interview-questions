// 单题评分与会话形态策略的共享衔接层。
// 确定性 InterviewEngine 与 Agent 工具都从这里进入选择题判分、开放题 LLM 评分和判空。

import type { AnswerValue, LLMProvider, GeneratedVariant } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { FormatId } from '../schemas/common';
import type { ScoringRubric } from '../schemas/interview';
import type { SessionQuestion } from '../schemas/session';
import type { VariantPool } from '../schemas/variant';
import { availableFormats } from '../domain/quiz';
import { gradeChoice, DEFAULT_RUBRIC } from '../domain/evaluation';
import { applyVariant, validateVariant } from '../domain/variant';
import { resolveQuestionVariant } from '../domain/variantPool';
import { recordVariantRound } from '../ai/usageTelemetry';
import type { Question } from '../schemas/question';

/** undefined / null / 空串 / 空数组都表示未作答。 */
export function isAnswerEmpty(answer: AnswerValue | undefined): boolean {
  if (answer == null) return true;
  if (typeof answer === 'string') return answer.trim() === '';
  return answer.length === 0;
}

/**
 * 计算本次会话可用的题型集合：空 formats 代表不限，开放题还受 AI 与全局开关约束。
 * 返回非空集合；只选了不可用的 open 时退化为 choice。
 */
export function effectiveFormats(
  formats: FormatId[] | undefined,
  useAI: boolean,
  generateOpenQuestions?: boolean,
): FormatId[] {
  const base: FormatId[] = formats && formats.length > 0 ? formats : ['choice', 'open'];
  const allowOpen = Boolean(generateOpenQuestions) && useAI;
  const filtered = base.filter((format) => format !== 'open' || allowOpen);
  return filtered.length > 0 ? filtered : ['choice'];
}

/** 评估一个会话题目；rubric 缺省使用全局默认权重。 */
export async function evaluateSessionQuestion(
  sq: SessionQuestion,
  answer: AnswerValue | undefined,
  provider: LLMProvider | null,
  rubric: ScoringRubric = DEFAULT_RUBRIC,
  extraCriteria?: string,
): Promise<EvaluationResult | null> {
  if (isAnswerEmpty(answer)) return null;
  if (sq.format === 'choice') {
    const choice = sq.question.formats.choice;
    if (!choice) throw new Error(`题目 ${sq.question.id} 缺少 choice 形态，无法判分`);
    const selected = Array.isArray(answer) ? answer : [];
    // 传入题目 misconceptions 供选项映射：选中错误选项时产出误解命中信号（结构化反证证据）
    return gradeChoice(choice, selected, rubric, sq.question.misconceptions);
  }
  if (!provider) return null;
  const open = sq.question.formats.open;
  if (!open) throw new Error(`题目 ${sq.question.id} 缺少 open 形态，无法评分`);
  const userAnswer = typeof answer === 'string' ? answer : '';
  return provider.evaluateOpenAnswer(sq.question, open, userAnswer, rubric, extraCriteria);
}

/** 生成并校验会话题目变体；单题失败时回退原题，不阻断整场面试。
 *  P0-1：把本次会话形态 sq.format 透传给变体生成/校验/落地，使双形态题按当前呈现形态生成变体。
 *
 *  双模式 Variant（Pool-first + Runtime fallback）：
 *   - 提供 variantPool 且命中 → 零 LLM 直接 validate + apply（离线资产优先）；
 *   - Pool miss 且 runtimeVariantEnabled=false（默认）→ 零 LLM 回退原题；
 *   - Pool miss 且 runtimeVariantEnabled=true 且有 provider → 1 次 LLM 运行时生成（结果不写回题库）。
 *  无论哪条路径，validateVariant 都是**唯一**校验门禁。
 */
export interface FinalizeVariantOpts {
  /** 离线变体池（题库资产）；提供即开启 Pool-first。缺省视为无池 → 仅运行时兜底分支生效。 */
  variantPool?: VariantPool | null;
  /** 运行时变体开关（AIConfig.runtimeVariantEnabled）；缺省 false。仅 Pool miss 且本开关开启且存在 provider 时，才做 1 次 LLM 生成。 */
  runtimeVariantEnabled?: boolean;
  /** 本会话内已落地过的变体 id（用于避免同一变体重复出现）；缺省每次新建。 */
  seenVariantIds?: Set<string>;
}

export async function finalizeQuestion(
  sq: SessionQuestion,
  provider: LLMProvider | null,
  opts?: FinalizeVariantOpts,
): Promise<SessionQuestion> {
  const pool = opts?.variantPool ?? null;
  const runtimeEnabled = opts?.runtimeVariantEnabled ?? false;
  const seen = opts?.seenVariantIds ?? new Set<string>();

  // ── Pool-first：命中即零 LLM 落地（离线资产优先） ──
  const pooled = resolveQuestionVariant({ canonical: sq.question, pool, seen });
  if (pooled) {
    const gen: GeneratedVariant = { question: pooled.question, options: pooled.options };
    const check = validateVariant(sq.question, gen, sq.format);
    if (check.ok) {
      // Pool hit：零 LLM，记一条延迟为 0 的遥测（用于评估「池覆盖省了多少 LLM 调用」）。
      recordVariantRound({ questionId: sq.question.id, latencyMs: 0 });
      seen.add(pooled.id);
      return { ...sq, question: applyVariant(sq.question, gen, sq.format) };
    }
    // 校验不过（canonical 已变 → sourceHash 失效，或变体本身异常）→ 落到下方 runtime / canonical 分支
    recordVariantRound({
      questionId: sq.question.id,
      latencyMs: 0,
      fallbackReason: check.code ?? 'pool-validation-failed',
    });
  }

  // ── Runtime fallback：仅 Pool miss 且开关开启且 provider 可用 ──
  if (!provider || !runtimeEnabled) return sq;

  const startedAt = Date.now();
  // P2 变体遥测：无论成功还是回退都记一条（延迟 + 回退原因），用于评估「轻量变体省了多少、
  // gate 是否过严」。详见 ai/usageTelemetry.getVariantTelemetry()。
  const record = (fallbackReason?: string) =>
    recordVariantRound({
      questionId: sq.question.id,
      latencyMs: Date.now() - startedAt,
      ...(fallbackReason ? { fallbackReason } : {}),
    });
  try {
    // generateVariant 只做 LLM + parse（第五轮起不再内部校验），此处是**唯一**校验入口。
    const variant = await provider.generateVariant(sq.question, sq.format);
    const check = validateVariant(sq.question, variant, sq.format);
    if (!check.ok) {
      console.warn(`变体校验未通过(${sq.question.id})，回退到原题：${check.reason}`);
      record(check.code ?? 'validation-failed');
      return sq;
    }
    // 软信号：通过但值得观测（如题干未命中字面锚点）。不阻断，只落日志 + 后续可加遥测字段。
    if (check.warning) {
      console.warn(`变体质量告警(${sq.question.id})：${check.warning}`);
    }
    record();
    return { ...sq, question: applyVariant(sq.question, variant, sq.format) };
  } catch (error) {
    // 第五轮后领域拒绝一律走 validateVariant 的 code，此处只剩 LLM 调用/解析失败这一种来源。
    console.warn(`变体生成失败(${sq.question.id})，回退到原题：`, error);
    record('generation-error');
    return sq;
  }
}

export function availableSessionFormats(
  question: Question,
  formats: FormatId[] | undefined,
  useAI: boolean,
  generateOpenQuestions?: boolean,
): FormatId[] {
  return availableFormats(question, effectiveFormats(formats, useAI, generateOpenQuestions));
}
