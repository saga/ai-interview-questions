// 跨层行为契约与轻量聚合类型的单一出处——不是 schemas 的兼容层。
// 数据形状类型（Question / AIConfig / LearnerProfile 等）直接从 src/schemas/* 导入。

import type { Question } from './schemas/question';
import type { OpenFormat } from './schemas/question';
import type { QuestionAngle, Difficulty, EvaluationDimension } from './schemas/common';
import type { FormatId } from './schemas/common';
import type { ScoringRubric } from './schemas/interview';
import type { EvaluationResult } from './schemas/evaluation';
import type { QuestionChallenge } from './ai/questionChallenger';

/** 题库：source of truth；LLM 只是增强层。 */
export interface QuestionBank {
  categories: string[];
  questions: Question[];
}

/** 答题状态：选择题存选中的索引数组，开放题存文本 */
export type AnswerValue = number[] | string;

/**
 * 题目蓝图（ADR-032 慢速生产管线）
 */
export interface QuestionBlueprint {
  topic: string;
  angle: QuestionAngle;
  difficulty: Difficulty;
  format: FormatId;
  purpose: string;
  expectedConcepts: string[];
}

/**
 * LLM 生成的题目变体候选（未校验）与已校验变体。
 * 安全模型（ADR-036）：LLM 可重构所有 Presentation（题干/场景/选项/解析），但必须保持 Knowledge Contract 不变量，输出需经 domain 校验。
 */
export interface VariantCandidate {
  question?: string;
  options?: string[];
  answer?: number[];
  explanation?: string;
}

export interface GeneratedVariant {
  question: string;
  options?: string[];
  answer?: number[];
  explanation?: string;
}

/** LLM Provider 抽象：应用只依赖此接口。 */
export interface LLMProvider {
  readonly name: string;
  generateVariant(question: Question): Promise<GeneratedVariant>;
  evaluateOpenAnswer(
    question: Question,
    open: OpenFormat,
    userAnswer: string,
    rubric: ScoringRubric,
    extraCriteria?: string,
  ): Promise<EvaluationResult>;
  challengeQuestion(question: Question): Promise<QuestionChallenge>;
}

export type CompleteFn = (system: string, user: string) => Promise<string>;

// ── 常量（与 EvaluationDimension 同源） ──
export const EVAL_DIMENSIONS: EvaluationDimension[] = ['correctness', 'completeness', 'architecture', 'communication'];

export const DIMENSION_LABELS: Record<EvaluationDimension, string> = {
  correctness: '正确性',
  completeness: '完整性',
  architecture: '架构',
  communication: '表达',
};

