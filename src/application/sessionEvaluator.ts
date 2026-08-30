// 单题评分与会话形态策略的共享衔接层。
// 确定性 InterviewEngine 与 Agent 工具都从这里进入选择题判分、开放题 LLM 评分和判空。

import type { AnswerValue, LLMProvider } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { FormatId } from '../schemas/common';
import type { ScoringRubric } from '../schemas/interview';
import type { SessionQuestion } from '../schemas/session';
import { availableFormats } from '../domain/quiz';
import { gradeChoice, DEFAULT_RUBRIC } from '../domain/evaluation';
import { applyVariant, validateVariant } from '../domain/variant';
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
    return gradeChoice(choice, selected, rubric);
  }
  if (!provider) return null;
  const open = sq.question.formats.open;
  if (!open) throw new Error(`题目 ${sq.question.id} 缺少 open 形态，无法评分`);
  const userAnswer = typeof answer === 'string' ? answer : '';
  return provider.evaluateOpenAnswer(sq.question, open, userAnswer, rubric, extraCriteria);
}

/** 生成并校验会话题目变体；单题失败时回退原题，不阻断整场面试。
 *  P0-1：把本次会话形态 sq.format 透传给变体生成/校验/落地，使双形态题按当前呈现形态生成变体。 */
export async function finalizeQuestion(
  sq: SessionQuestion,
  provider: LLMProvider | null,
): Promise<SessionQuestion> {
  if (!provider) return sq;
  try {
    const variant = await provider.generateVariant(sq.question, sq.format);
    const check = validateVariant(sq.question, variant, sq.format);
    if (!check.ok) {
      console.warn(`变体校验未通过(${sq.question.id})，回退到原题：${check.reason}`);
      return sq;
    }
    return { ...sq, question: applyVariant(sq.question, variant, sq.format) };
  } catch (error) {
    console.warn(`变体生成失败(${sq.question.id})，回退到原题：`, error);
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
