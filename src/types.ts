// 全局类型定义。domain / ai / storage 各层都从这里取类型，组件也只依赖此文件。

export type QuestionType = 'single' | 'multiple' | 'essay' | 'coding';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ProviderId = 'openai' | 'anthropic' | 'openrouter';

/** 题库是 source of truth；LLM 只是增强层，不改变这些字段的权威语义。 */
interface QuestionBase {
  id: string;
  category: string; // slug，如 'machine-learning' / 'agentic-ai'，显示层用 categoryLabel 映射
  topic: string; // 细分主题，如 'regularization' / 'tool-calling'
  tags: string[];
  difficulty: Difficulty;
  question: string;
  explanation: string;
  /** 概念说明，供变体与复盘使用（开放题尤其有用） */
  reference?: { concept?: string };
  /** 该题是否由 LLM 变体生成（仅展示用） */
  aiGenerated?: boolean;
  /**
   * 该题专属评分量表（可选）。
   * - required：必须覆盖的要点（命中情况计入 completeness）
   * - dimensions：四维权重覆盖（未给的维度沿用 InterviewDefinition.scoringRubric）
   */
  rubric?: {
    required?: string[];
    dimensions?: Partial<Record<EvaluationDimension, number>>;
  };
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'single' | 'multiple';
  options: string[];
  /** 正确选项索引数组（指向 options 顺序）；single 长度 1，multiple >=1 */
  answer: number[];
}

export interface OpenQuestion extends QuestionBase {
  type: 'essay' | 'coding';
  referenceAnswer: string;
  /** 编程题语言，如 python / sql，仅展示用 */
  language?: string;
}

export type Question = ChoiceQuestion | OpenQuestion;

export interface QuestionBank {
  categories: string[]; // slug 列表
  questions: Question[];
}

/** 答题状态：选择题存选中的索引数组，开放题存文本 */
export type AnswerValue = number[] | string;

// ───────────────────────────────────────────────────────────
// Interview Engine：声明式定义 + 会话 + 多维评分
// ───────────────────────────────────────────────────────────

/** 四个评分维度（正确性 / 完整性 / 架构 / 表达） */
export type EvaluationDimension = 'correctness' | 'completeness' | 'architecture' | 'communication';

export const EVAL_DIMENSIONS: EvaluationDimension[] = ['correctness', 'completeness', 'architecture', 'communication'];

export const DIMENSION_LABELS: Record<EvaluationDimension, string> = {
  correctness: '正确性',
  completeness: '完整性',
  architecture: '架构',
  communication: '表达',
};

/** 单次作答的评估结果：整体分 + 四维度分 + 反馈 */
export interface EvaluationResult {
  /** 0-100 综合得分（由 rubric 权重聚合） */
  overall: number;
  /** 四维得分（0-100） */
  dimensions: Record<EvaluationDimension, number>;
  strengths: string[];
  gaps: string[];
  feedback: string;
  referenceAnswer?: string;
}

/** 评分权重，四维建议和为 1 */
export interface ScoringRubric {
  correctness: number;
  completeness: number;
  architecture: number;
  communication: number;
}

/**
 * LLM 生成的题目变体。answer key 必须来自原题（见 domain/variant.validateVariant），
 * 这里仅记录来源与生成者，便于调试与审计。
 */
export interface GeneratedVariant {
  question: string;
  options?: string[]; // 选择题变体选项（长度须与原题一致）
  answer: number[]; // 指向"变体 options"的索引，须经验证
  explanation?: string;
  sourceQuestionId: string;
  generatedBy: { provider: string; model: string };
}

/**
 * 一次面试训练的"声明式定义"——引擎据此出题与评分。
 */
export interface InterviewDefinition {
  title: string;
  topic?: string;
  categories: string[]; // 类别过滤（slug），空数组表示全部
  difficulties: Difficulty[]; // 难度过滤，空数组表示不限
  questionTypes: QuestionType[]; // 允许的题目类型
  count: number;
  useAI: boolean; // 是否启用 LLM 变体出题与开放题评分
  scoringRubric: ScoringRubric;
  timeLimitSec?: number;
  followUpStrategy?: string; // 预留：Agentic 追问扩展
  evaluationCriteria?: string; // 给 LLM 的额外评估要求
}

/** 由 Definition 构建出的具体会话 */
export interface InterviewSession {
  definition: InterviewDefinition;
  questions: Question[];
  startedAt: number;
  /** 题 id → LLM 变体（调试/审计用，UI 不强制消费） */
  variants?: Record<string, GeneratedVariant>;
}

/** LLM Provider 抽象：应用只依赖此接口，pi-ai 仅是其中一种实现。 */
export interface LLMProvider {
  readonly name: string;
  generateVariant(question: Question, config: PiConfig): Promise<GeneratedVariant>;
  evaluateOpenAnswer(
    question: OpenQuestion,
    userAnswer: string,
    config: PiConfig,
    rubric: ScoringRubric,
    extraCriteria?: string,
  ): Promise<EvaluationResult>;
}

/** LLM 连接配置（浏览器内使用，存于 localStorage） */
export interface PiConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
}
