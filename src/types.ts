// 全局类型定义 — 单源真理在 src/schemas（Zod 即契约，z.infer 即类型）。
// 本文件为兼容层：re-export schemas 的推导类型，业务代码仍可 `from '../types'`。

import type { Difficulty as DifficultyT } from './schemas/common';
import type { ProviderId as ProviderIdT } from './schemas/common';
import type { FormatId as FormatIdT } from './schemas/common';
import type { QuestionAngle as QuestionAngleT } from './schemas/common';
import type { KnowledgeArea as KnowledgeAreaT } from './schemas/common';
import type { KnowledgePriority as KnowledgePriorityT } from './schemas/common';
import type { EvaluationDimension as EvaluationDimensionT } from './schemas/common';
import type { Question as QuestionT } from './schemas/question';
import type { KnowledgeNode as KnowledgeNodeT } from './schemas/knowledge';
import type { InterviewDefinition as InterviewDefinitionT, ScoringRubric as ScoringRubricT } from './schemas/interview';
import type { EvaluationResult as EvaluationResultT } from './schemas/evaluation';
import type { ProviderEntry as ProviderEntryT, AIConfig as AIConfigT } from './schemas/ai-config';
import type { TopicStats as TopicStatsT, QuestionResult as QuestionResultT, SessionRecord as SessionRecordT, LearnerProfile as LearnerProfileT, AngleStat as AngleStatT, Trend as TrendT } from './schemas/learner';
import type { SessionQuestion as SessionQuestionT, InterviewSession as InterviewSessionT } from './schemas/session';

// ── 基础枚举（re-export 单源类型，运行时值与 schemas/common 保持一致） ──
export type Difficulty = DifficultyT;
export type ProviderId = ProviderIdT;
export type FormatId = FormatIdT;
export type QuestionAngle = QuestionAngleT;
export type KnowledgeArea = KnowledgeAreaT;
export type KnowledgePriority = KnowledgePriorityT;
export type EvaluationDimension = EvaluationDimensionT;
export type Trend = TrendT;

// ── 复杂对象（re-export 推导类型，删除重复 interface 定义） ──
export type Question = QuestionT;
export type KnowledgeNode = KnowledgeNodeT;
export type ProviderEntry = ProviderEntryT;
export type AIConfig = AIConfigT;
export type EvaluationResult = EvaluationResultT;
export type ScoringRubric = ScoringRubricT;
export type InterviewDefinition = InterviewDefinitionT;
export type TopicStats = TopicStatsT;
export type AngleStat = AngleStatT;
export type QuestionResult = QuestionResultT;
export type SessionRecord = SessionRecordT;
export type LearnerProfile = LearnerProfileT;
export type SessionQuestion = SessionQuestionT;
export type InterviewSession = InterviewSessionT;

// ── 轻量聚合 / 行为契约（仍保留于 types，属非数据契约） ──

/** 呈现形态：ChoiceFormat / OpenFormat 的运行时结构与 schemas/question 保持同步，此处保留别名以避免深层导入。 */
export type ChoiceFormat = NonNullable<Question['formats']['choice']>;
export type OpenFormat = NonNullable<Question['formats']['open']>;

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
