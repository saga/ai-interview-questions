// 结构化知识检索（Structured Knowledge RAG）的契约层。
// 设计来源：docs/improvement_plan/knowledge_base_for_copilot.md（ADR-063）。
//
// 与"Vector RAG"的区别：corpus 不是切碎的 PDF，而是已经带有知识结构的数据
// （KnowledgeNode / Question / Concept Graph / Misconception）。
// 因此 Phase 1 完全不引入 embedding / 向量库，只用：
//
//   metadata 精确匹配 + lexical（BM25）+ graph 1-hop 扩展
//
// 纯类型 + 纯函数，不依赖 React / LLM / 网络 / 新外部依赖。

import type { KnowledgeArea, KnowledgePriority, QuestionAngle, Difficulty } from '../../schemas/common';

/** 统一 evidence 文档的四种形态。 */
export type KnowledgeDocumentKind = 'knowledge' | 'question' | 'misconception' | 'concept';

/**
 * 答案安全模式（ADR-063 §7，ADR-065 扩为四模式）。
 * - answer：可暴露 referenceAnswer / explanation / 选项答案（"直接给我答案"）
 * - explain：详细解读——同样暴露正确选项与解析，但语境是"讲解这道题"，不篡改 assessment truth
 *            （与 hint 的区别：hint 禁止解释正确选项；explain 允许，用于"这道题我不会，给我详细解读"）
 * - hint  ：只给知识骨架与常见误解，禁止 referenceAnswer / choice.answer / 完整 explanation
 * - quiz  ：只给题干与考点，隐藏一切真值
 */
export type RetrievalMode = 'answer' | 'explain' | 'hint' | 'quiz';

/**
 * 检索范围（ADR-063 §6）。轻量 query planner 的结果：
 * - current_question：只查当前题及其知识点（"我刚才那道题为什么错"）
 * - topic           ：限定主题 + 1-hop 图邻居
 * - knowledge       ：只查概念层（knowledge / misconception / concept），不查题目
 * - global          ：全局检索
 */
export type RetrievalScope = 'current_question' | 'topic' | 'knowledge' | 'global';

export interface KnowledgeDocumentMetadata {
  area?: KnowledgeArea;
  /** 知识节点 id（= Question.topic 的 concept slug） */
  knowledgeId?: string;
  /** 知识节点自身的中间层主题（如 Inference / RAG / Agents） */
  topic?: string;
  questionId?: string;
  angle?: QuestionAngle;
  difficulty?: Difficulty;
  priority?: KnowledgePriority;
  tags?: string[];
}

export interface KnowledgeDocument {
  id: string;
  kind: KnowledgeDocumentKind;
  title: string;
  /** 任何模式都可安全暴露的正文。 */
  text: string;
  /**
   * 仅 `answer` 模式可暴露的真值片段（explanation / referenceAnswer / 正确选项）。
   * hint / quiz 模式会被 `redactDocument` 剥离——这是"检索不能绕过 assessment
   * boundary"的硬保证，而不是靠 prompt 请求模型自觉。
   */
  sensitiveText?: string;
  metadata: KnowledgeDocumentMetadata;
  /** 存在真值片段即为 true。 */
  sensitive: boolean;
}

export interface KnowledgeSearchQuery {
  query: string;
  scope?: RetrievalScope;
  mode?: RetrievalMode;
  /** 主题 slug（= knowledgeId） */
  topic?: string;
  area?: KnowledgeArea;
  /** 锁定单个知识节点 */
  knowledgeId?: string;
  /** 锁定单道题目（current_question 场景） */
  questionId?: string;
  limit?: number;
  /** graph 扩展起点；缺省由 topic / knowledgeId / 元数据命中推断 */
  seeds?: string[];
  /** 强制排除的题目 id */
  excludeIds?: string[];
  /**
   * Learner Memory 信号（ADR-065）：把用户长期弱项透传给检索排序，做小幅提权，不主导。
   * - weakTopics：命中 knowledgeId / topic 的弱项节点 metadata 轻微上浮
   * - weakAngles：命中 question.angle 的弱角度节点轻微上浮
   */
  learnerContext?: { weakTopics?: string[]; weakAngles?: string[] };
}

/** 引用溯源（ADR-063 §8）：最终回答要能列出"依据了什么"。 */
export interface KnowledgeSource {
  kind: 'knowledge' | 'question' | 'concept';
  id: string;
  label: string;
}

export interface KnowledgeScoreBreakdown {
  lexical: number;
  metadata: number;
  graph: number;
  /** Phase 2（embedding）才接入；Phase 1 恒为 0，权重已按比例重分配。 */
  semantic: number;
}

export interface KnowledgeHit {
  id: string;
  kind: KnowledgeDocumentKind;
  title: string;
  /** 已按 mode 做过脱敏的正文。 */
  content: string;
  score: number;
  breakdown: KnowledgeScoreBreakdown;
  metadata: KnowledgeDocumentMetadata;
  source: KnowledgeSource;
}

export interface KnowledgeEvidence {
  query: string;
  scope: RetrievalScope;
  mode: RetrievalMode;
  /** graph 扩展用到的种子节点 */
  seeds: string[];
  hits: KnowledgeHit[];
}

/** 混合检索权重（ADR-063 §4）。semantic 权重在 Phase 2 接入前按比例回填给其余三项。 */
export const HYBRID_WEIGHTS = {
  lexical: 0.4,
  metadata: 0.25,
  graph: 0.2,
  semantic: 0.15,
} as const;

/** 默认返回条数（Phase 1 目标：top 5 evidence）。 */
export const DEFAULT_KNOWLEDGE_LIMIT = 5;
