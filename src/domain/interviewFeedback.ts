// 逐题反馈的领域投影（纯逻辑，不依赖 React / LLM）。
//
// 存在的意义：`EvaluationResult` 是**评分器内部契约**（四维序级 + evidence + 归一化分），
// 而「给用户看的一张反馈卡」需要的字段与它并不一一对应——需要分档文案、选项字母、
// 关键知识点（来自知识点层而非评分器）、以及「不适用维度」的正确呈现。
// 若让两个 UI（独立 Agent 面试页 / Copilot 侧栏）各自从 EvaluationResult 里刨字段，
// 必然出现两套文案与两套口径。故此处收敛为**单一投影**：UI 只消费 InterviewFeedback。
//
// 边界：本模块**不**产生评分、**不**调用 LLM、**不**读写会话——只做纯函数映射。
// 这保证了「不新增第二个评估器」的约束（评分仍只有 evaluateSessionQuestion / evaluateAnswerCapability 一条链）。

import { DIMENSION_LABELS, EVAL_DIMENSIONS } from '../types';
import type { AnswerValue } from '../types';
import type { EvaluationDimension, FormatId } from '../schemas/common';
import type { EvalLevel, EvaluationResult } from '../schemas/evaluation';
import type { Question } from '../schemas/question';
import { requiredPointsFor } from './knowledge/nodes';

/** 单维反馈：分数 + 序级 + 是否适用 + 判断依据。 */
export interface FeedbackDimension {
  key: EvaluationDimension;
  /** 中文维度名（复用全局 DIMENSION_LABELS，避免第二套文案）。 */
  label: string;
  /** 0-100 归一化分。 */
  score: number;
  /** LLM 原始序级 0-4（选择题为 0 或 4）。 */
  level: EvalLevel;
  /**
   * false = 该维度对本题不适用，**不参与综合分加权**。
   * UI 必须显示「不适用」而不是 0 分/空进度条——否则「架构 0 分」会被误读成
   * 候选人架构能力为零，而真相是这道概念题根本不考架构。
   */
  applicable: boolean;
  /** 该维度的判断依据（开放题有；选择题恒为空串）。 */
  evidence: string;
}

/** 反馈色调：由 UI 映射到具体配色，域层不关心颜色。 */
export type FeedbackTone = 'strong' | 'fair' | 'weak';

export interface FeedbackBand {
  label: string;
  tone: FeedbackTone;
}

/** 逐题反馈的完整投影（两个 UI 共用）。 */
export interface InterviewFeedback {
  questionId: string;
  /** 题干原文，供反馈卡回显「刚答的是哪道题」。 */
  questionText: string;
  format: FormatId;
  /** 用户原始作答（选择题为选项下标数组，开放题为文本）。 */
  answer: AnswerValue;
  /** 作答的可读呈现：选择题为「A. 选项文本」，开放题为原文。 */
  answerText: string;
  overall: number;
  band: FeedbackBand;
  dimensions: FeedbackDimension[];
  /**
   * 关键知识点：来自该题 topic 对应知识点节点的 `required`；
   * 知识点层缺失时回落到 `question.tags`。两者皆空则为空数组（**不编造**要点）。
   */
  keyPoints: string[];
  strengths: string[];
  gaps: string[];
  missingConcepts: string[];
  /** 选择题命中的误解原文。 */
  misconceptionIds: string[];
  /** 面试官评语（evaluation.feedback）。 */
  comment: string;
  /**
   * 参考答案。**默认不展示**——用户还没进入下一题就先看到标准答案，
   * 会让「逐题反馈」退化成「背答案」，削弱后续同类题的测量效力。
   * 由 UI 通过显式开关（如「查看参考答案」）决定是否渲染。
   */
  referenceAnswer?: string;
}

/** 综合分分档（三档，够用且不与具体配色耦合）。 */
export function feedbackBand(overall: number): FeedbackBand {
  if (overall >= 80) return { label: '优秀', tone: 'strong' };
  if (overall >= 60) return { label: '基本合格', tone: 'fair' };
  return { label: '需要加强', tone: 'weak' };
}

/** 选项下标 → 字母（A/B/C…），与全站既有约定一致。 */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * 把作答渲染成可读文本。
 * - 选择题：`A. 选项文本`，多选以「；」连接；下标越界时忽略该下标（不抛错，避免脏数据打崩反馈卡）。
 * - 开放题：原文。
 */
export function resolveAnswerText(question: Question, format: FormatId, answer: AnswerValue): string {
  if (format === 'choice' && Array.isArray(answer)) {
    const options = question.formats.choice?.options ?? [];
    return answer
      .map((i) => (typeof options[i] === 'string' ? `${optionLetter(i)}. ${options[i]}` : undefined))
      .filter((s): s is string => s !== undefined)
      .join('；');
  }
  return typeof answer === 'string' ? answer : '';
}

/**
 * 由「题目 + 作答 + 评分结果」构建逐题反馈。
 *
 * 注意 `evaluation` 为**非 null**：调用方必须先过滤掉 null（未作答 / 评分失败）。
 * 刻意不在此处接受 null 并返回一份空反馈——那会让「评分失败」与「得了 0 分」在 UI 上无法区分，
 * 正是本特性要避免的失真。
 */
export function buildInterviewFeedback(
  question: Question,
  format: FormatId,
  answer: AnswerValue,
  evaluation: EvaluationResult,
): InterviewFeedback {
  const dimensions: FeedbackDimension[] = EVAL_DIMENSIONS.map((key) => ({
    key,
    label: DIMENSION_LABELS[key],
    score: evaluation.dimensions[key],
    level: evaluation.levels[key],
    applicable: evaluation.applicable?.[key] !== false,
    evidence: evaluation.evidence?.[key] ?? '',
  }));

  const required = requiredPointsFor(question);
  const keyPoints = required && required.length > 0 ? required : [...question.tags];

  return {
    questionId: question.id,
    questionText: question.question,
    format,
    answer,
    answerText: resolveAnswerText(question, format, answer),
    overall: evaluation.overall,
    band: feedbackBand(evaluation.overall),
    dimensions,
    keyPoints,
    strengths: evaluation.strengths,
    gaps: evaluation.gaps,
    missingConcepts: evaluation.missingConcepts,
    misconceptionIds: evaluation.misconceptionIds ?? [],
    comment: evaluation.feedback,
    referenceAnswer: evaluation.referenceAnswer,
  };
}
