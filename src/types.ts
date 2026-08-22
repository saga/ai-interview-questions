export type QuestionType = 'single' | 'multiple' | 'essay' | 'coding';
export type Difficulty = 'easy' | 'medium' | 'hard';

interface QuestionBase {
  id: string;
  category: string;
  difficulty: Difficulty;
  question: string;
  explanation: string;
  tags?: string[];
  aiGenerated?: boolean;
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'single' | 'multiple';
  options: string[];
  /** 正确选项的索引数组。single 长度为 1，multiple 长度为 >=1 */
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
  categories: string[];
  questions: Question[];
}

/** 答题状态：选择题存选中的索引数组，开放题存文本 */
export type AnswerValue = number[] | string;

// ───────────────────────────────────────────────────────────
// Interview Engine：声明式定义 + 会话 + 多维评分
// ───────────────────────────────────────────────────────────

/** 三个评分维度（对应贴文中的 Correctness / Depth / Communication） */
export type EvaluationDimension = 'correctness' | 'depth' | 'communication';

/** 单次作答的评估结果：整体分 + 分维度分 + 反馈 */
export interface EvaluationResult {
  /** 0-100 综合得分 */
  overall: number;
  /** 各维度得分；选择题仅有 correctness，开放/编程题含三项 */
  dimensions: Partial<Record<EvaluationDimension, number>>;
  strengths: string[];
  gaps: string[];
  feedback: string;
}

/** 评分权重，三项建议和为 1 */
export interface ScoringRubric {
  correctness: number;
  depth: number;
  communication: number;
}

/**
 * 一次面试训练的"声明式定义"——引擎据此出题与评分。
 * 对应贴文中的 Interview Definition（topic / difficulty / question types /
 * scoring rubric / time limit / follow-up strategy / evaluation criteria）。
 */
export interface InterviewDefinition {
  title: string;
  /** 主题描述，作为 LLM 出题/评估的上下文 */
  topic?: string;
  /** 类别过滤，空数组表示全部 */
  categories: string[];
  /** 难度过滤，空数组表示不限 */
  difficulties: Difficulty[];
  /** 允许的题目类型 */
  questionTypes: QuestionType[];
  /** 题目数量 */
  count: number;
  /** 是否启用 LLM 变体出题与开放题评分 */
  useAI: boolean;
  /** 开放题评分权重 */
  scoringRubric: ScoringRubric;
  /** 可选倒计时（秒） */
  timeLimitSec?: number;
  /** 追问策略（预留，供后续 Agentic 追问扩展） */
  followUpStrategy?: string;
  /** 给 LLM 的额外评估要求 */
  evaluationCriteria?: string;
}

/** 由 Definition 构建出的具体会话 */
export interface InterviewSession {
  definition: InterviewDefinition;
  questions: Question[];
  startedAt: number;
}
