// 全局类型定义。domain / ai / storage 各层都从这里取类型，组件也只依赖此文件。

export type Difficulty = 'easy' | 'medium' | 'hard';
export type ProviderId = 'chrome' | 'local' | 'deepseek' | 'openrouter' | 'google' | 'cloudflare-workers-ai';

/** 呈现形态：Question 是知识对象，SessionQuestion 决定本次以哪种形态提问（ADR-027）。 */
export type FormatId = 'choice' | 'open';

/**
 * 选择形态的作答与判分数据。answer 指向 options 下标；single 长度 1，multiple ≥1。
 * question 为可选的形态专属场景题干（情境描述 + 明确问法）：给出时选择形态用它提问，
 * 共享题干保持面向开放形态；未给则两种形态共用共享题干。
 */
export interface ChoiceFormat {
  type: 'single' | 'multiple';
  options: string[];
  answer: number[];
  question?: string;
}

/** 开放/编程形态：参考答案 + 语言（仅展示用）。 */
export interface OpenFormat {
  referenceAnswer: string;
  language?: string;
}

/**
 * 题库对象：知识点的一种 assessment view（内容 + 元数据 + 可用形态集合）。
 * 同一道题可同时携带 choice / open 两种形态，会话按需选用，id 保持稳定（ADR-027）。
 */
export interface Question {
  id: string;
  category: string; // slug，如 'machine-learning' / 'agentic-ai'，显示层用 categoryLabel 映射
  topic: string; // 细分主题，如 'regularization' / 'tool-calling'
  tags: string[];
  difficulty: Difficulty;
  question: string;
  explanation: string;
  /** 概念说明，供变体与复盘使用（开放题尤其有用） */
  reference?: { concept?: string };
  /**
   * 该题专属评分量表（可选）。
   * - required：必须覆盖的要点（命中情况计入 completeness）
   * - dimensions：四维权重覆盖（未给的维度沿用 InterviewDefinition.scoringRubric）
   */
  rubric?: {
    required?: string[];
    dimensions?: Partial<Record<EvaluationDimension, number>>;
  };
  /** 该题是否由 LLM 变体生成（仅展示用） */
  aiGenerated?: boolean;
  /** 该题可用的呈现形态；至少一种。组卷按可用形态分配，不做运行时变换。 */
  formats: {
    choice?: ChoiceFormat;
    open?: OpenFormat;
  };
}

/** 答题状态：选择题存选中的索引数组，开放题存文本 */
export type AnswerValue = number[] | string;

/**
 * 一次训练实例。**快照不变量**：question 是题库对象的会话内快照——session 保存
 * "当时看到的内容"，题库后续修改（Question v1→v2、LLM 变体只改副本）不影响历史
 * session 的回放与复盘。这是明确不变量，不是实现细节。
 */
export interface SessionQuestion {
  question: Question;
  format: FormatId;
}

/** 题库：source of truth；LLM 只是增强层。 */
export interface QuestionBank {
  categories: string[]; // slug 列表
  questions: Question[];
}

// ───────────────────────────────────────────────────────────
// Knowledge Map：知识点层。知识点是一等公民，题目只是它的一个 View。
// 节点 id 即题目 topic slug——与题库、conceptGraph、Learner Memory 共用同一 join key。
// ───────────────────────────────────────────────────────────

/** 知识领域（题库 category 是能力维度，area 是知识维度，两者正交）。 */
export type KnowledgeArea =
  | 'dl-fundamentals'
  | 'transformer'
  | 'llm-architecture'
  | 'moe'
  | 'training'
  | 'inference'
  | 'rag-agent'
  | 'system-design';

export type KnowledgePriority = 'P0' | 'P1' | 'P2';

/**
 * 出题角度 = 难度梯度的编码化：
 * definition（是什么）→ mechanism（为什么）→ calculation（算得清）→
 * tradeoff（怎么权衡）→ scenario（工程情境）→ system-design（系统设计）。
 */
export type QuestionAngle =
  | 'definition'
  | 'mechanism'
  | 'calculation'
  | 'tradeoff'
  | 'scenario'
  | 'system-design';

/**
 * 概念层级（ADR-030）：Knowledge 是学习对象（一等公民），
 * Question 是知识点的 assessment view（一种可评估表达），
 * SessionQuestion 是一次训练实例。未来 explanation / flashcard / follow-up /
 * scenario 等都是 knowledge 的其他 view——扩展时新增 view 类型，不往 Question 上堆职责。
 */

/**
 * 知识点：修饰成面试题的全部素材都在节点上——
 * summary 给变体出题与复盘锚点，required 注入评分，
 * misconceptions 做干扰项/追问/gap 分析，angles 决定从哪个深度发问。
 */
export interface KnowledgeNode {
  /** = 题目 topic slug；必须有至少一道题目支撑（无悬空节点，测试强制） */
  id: string;
  name: string;
  area: KnowledgeArea;
  priority: KnowledgePriority;
  summary: string;
  required: string[];
  misconceptions: string[];
  angles: QuestionAngle[];
}

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
 * LLM 生成的题目变体。安全模型（ADR-019）：LLM 只允许重写题干与解析，
 * 选择题的 options/answer、开放题的 referenceAnswer 一律来自原题（applyVariant 保证）。
 */
export interface GeneratedVariant {
  question: string;
  explanation?: string;
}

/**
 * 一次面试训练的"声明式定义"——引擎据此出题与评分。
 */
export interface InterviewDefinition {
  title: string;
  topic?: string;
  categories: string[]; // 类别过滤（slug），空数组表示全部
  difficulties: Difficulty[]; // 难度过滤，空数组表示不限
  /** 允许的呈现形态；空数组表示不限（按题目可用形态分配） */
  formats: FormatId[];
  count: number;
  // 有意保持的单开关（ADR-030）：同时门控变体出题与开放题评分。二者语义不同
  // （改题 vs 判分），但当前没有分开配置的真实需求；出现时再拆 enableVariants/enableEvaluation。
  useAI: boolean;
  /** 自适应模式：逐题作答，下一题由上一题表现 + 概念图迁移策略决定（见 domain/adaptive） */
  adaptive?: boolean;
  scoringRubric: ScoringRubric;
  timeLimitSec?: number;
  evaluationCriteria?: string; // 给 LLM 的额外评估要求
  /** 薄弱主题优先（slug 列表，来自 Learner Profile）；buildSession 会优先抽取这些主题的题 */
  topicPriorities?: string[];
  /** 训练模式标记（写入 SessionRecord） */
  mode?: 'quick' | 'custom' | 'coach' | 'interview';
}

/** 由 Definition 构建出的具体会话：questions 是带形态标记的会话实例（新在前不加，顺序即出题序） */
export interface InterviewSession {
  definition: InterviewDefinition;
  questions: SessionQuestion[];
  startedAt: number;
}

/** 单个引擎通道的连接配置——AI 引擎降级链中的一环（ADR-023）。 */
export interface ProviderEntry {
  id: ProviderId;
  /** 关闭的引擎不参与降级链，但保留其配置 */
  enabled: boolean;
  /** id='chrome' 时无意义，存空字符串即可（校验按引擎区分） */
  model: string;
  /** 云端必填；local 可选；chrome 不适用 */
  apiKey: string;
  /** 仅 id='local' 使用：OpenAI 兼容服务地址（默认 Unsloth：127.0.0.1:8888/v1） */
  baseUrl?: string;
  /** 仅 id='cloudflare-workers-ai' 使用：Cloudflare Account ID（API Token 之外还需账户标识） */
  accountId?: string;
}

/** AI 引擎配置（浏览器内使用，存于 localStorage）。
 *  providers 是有序降级链：调用时按顺序尝试，失败自动切换到下一个（ADR-023）。
 *  典型用法：chrome / local 等免费弱模型排前，云端强模型殿后兜底。 */
export interface AIConfig {
  providers: ProviderEntry[];
}

/** LLM Provider 抽象：应用只依赖此接口。实现各自持有绑定的 ProviderEntry，
 *  多引擎组合与降级由 FallbackProvider 统一编排（见 ai/provider.ts）。
 *
 *  接口边界（固定，ADR-030）：LLM 只做语言增强——重写题干 / 评估作答。
 *  不扩展 recommendNextQuestion / buildLearningPlan / analyzeLearner 之类的策略接口：
 *  domain 决策、LLM 增强——一旦让 LLM 触及学习策略，业务流就会被 prompt 接管。
 *  LLM 永远不感知 LearnerProfile / InterviewSession / adaptive strategy。 */
export interface LLMProvider {
  readonly name: string;
  generateVariant(question: Question): Promise<GeneratedVariant>;
  /** 开放题评估：open 为该题的开放形态数据（参考答案/语言） */
  evaluateOpenAnswer(
    question: Question,
    open: OpenFormat,
    userAnswer: string,
    rubric: ScoringRubric,
    extraCriteria?: string,
  ): Promise<EvaluationResult>;
}

/**
 * 一次性文本补全函数：LLMProvider 的底层注入点。
 * pi-ai 与 Chrome Prompt API 各自实现此签名，variant / evaluate 只依赖它，
 * 不感知具体底层（ADR-021）。
 */
export type CompleteFn = (system: string, user: string) => Promise<string>;

// ───────────────────────────────────────────────────────────
// Learner Memory（结构化学习信号，非对话记录）
// ───────────────────────────────────────────────────────────

export type Trend = 'improving' | 'declining' | 'flat';

/** 单个主题（topic slug）的长期表现。 */
export interface TopicStats {
  attempts: number;
  /** 历史平均分 0-100 */
  avgScore: number;
  /** 最近一次得分 0-100 */
  lastScore: number;
  trend: Trend;
  /**
   * 0-1 掌握度 = avgScore/100——**当前简化启发式，不是学习能力的真实度量**
   * （ADR-030）：平均分无法区分"先会后忘"与"渐入佳境"。语义分工：
   * mastery=当前启发式、trend=近期表现信号、attempts=置信度信号、
   * commonWeaknesses/evidence=溯源。不引入 Bayesian/ELO/IRT。
   */
  mastery: number;
  /** 高频遗漏/错误要点（来自开放题评估的 gaps） */
  commonWeaknesses: string[];
  /**
   * 支撑该掌握度的作答证据（最近 N 条，新在后）：
   * 让"掌握度"可回溯到具体题目，而不是一个裸分数。
   */
  evidence?: Array<{ questionId: string; score: number; at: number }>;
  lastSeen: number;
}

/** 单题结果（写入 Learner Memory 的最小粒度）。 */
export interface QuestionResult {
  questionId: string;
  category: string;
  topic: string;
  /** 本次作答采用的呈现形态 */
  format: FormatId;
  score: number; // 0-100
  /** 选择题是否答对（开放题无此字段） */
  correct?: boolean;
  /** 开放题的遗漏/错误要点 */
  gaps: string[];
}

/** 一次训练会话记录。 */
export interface SessionRecord {
  id: string;
  startedAt: number;
  durationSec?: number;
  mode?: 'quick' | 'custom' | 'coach' | 'interview';
  title: string;
  questionResults: QuestionResult[];
  /** 会话整体得分 0-100（各题 average） */
  overall: number;
}

/**
 * Learner Profile：用户的长期学习画像。核心原则（ADR-015）——
 * 只存"结构化学习信号"（分数/弱项/掌握度），不存对话原文，避免把整段历史塞给 LLM。
 */
export interface LearnerProfile {
  totalSessions: number;
  totalQuestions: number;
  /** 最近若干次会话平均分 0-100 */
  overallScore: number;
  /** topic slug → 长期表现 */
  topicStats: Record<string, TopicStats>;
  /** 最近会话（新在前），上限 50 条 */
  sessions: SessionRecord[];
  updatedAt: number;
}
