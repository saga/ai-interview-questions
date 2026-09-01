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
 * 安全模型（ADR-036 轻量变体收缩）：LLM 只负责语义变换（题干 + 选项文本），
 * 不生成 answer / explanation / 选项顺序。answer（来自 canonical）与
 * 选项顺序（由程序 Fisher–Yates 重排 + answer 索引重映射）都在 domain 层完成。
 */
export interface VariantCandidate {
  question?: string;
  options?: string[];
}

export interface GeneratedVariant {
  question: string;
  options?: string[];
}

/** LLM Provider 抽象：应用只依赖此接口。 */
export interface LLMProvider {
  readonly name: string;
  /** 生成变体；format 为本次会话实际呈现形态（P0-1：变体须对齐 Session format，而非永远按 choice）。 */
  generateVariant(question: Question, format?: FormatId): Promise<GeneratedVariant>;
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

/**
 * 一次 LLM 调用的 token 用量（provider 无关归一化）。用于 KV Cache 命中遥测（P1④）：
 * - cacheHitTokens：命中前缀缓存的 token 数（DeepSeek 的 prompt_cache_hit_tokens，pi-ai 归一为 cacheRead）；
 * - cacheMissTokens：未命中、需重新计算的 token 数（≈ 输入 - 命中；DeepSeek 的 prompt_cache_miss_tokens）；
 * 这两个字段让我们能真实验证「stable-prefix prompt 是否真的命中了 KV Cache」，而不是凭感觉。
 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** 推理/思考 token（若 provider 上报；thinking 模式会占用，已是 output 的子集）。 */
  reasoningTokens?: number;
}

// ── 常量（与 EvaluationDimension 同源） ──
export const EVAL_DIMENSIONS: EvaluationDimension[] = ['correctness', 'completeness', 'architecture', 'communication'];

export const DIMENSION_LABELS: Record<EvaluationDimension, string> = {
  correctness: '正确性',
  completeness: '完整性',
  architecture: '架构',
  communication: '表达',
};

