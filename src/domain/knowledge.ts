// 纯逻辑：知识点层查询与覆盖分析。不依赖 React / LLM。
// API 默认注入 knowledgeNodes 单例，测试可传入自定义节点列表替换数据源。

import type { KnowledgeArea, KnowledgeNode, KnowledgePriority, Question } from '../types';
import { knowledgeNodes } from '../data/knowledgeMap';

export const KNOWLEDGE_AREA_LABELS: Record<KnowledgeArea, string> = {
  'dl-fundamentals': '深度学习基础',
  transformer: 'Transformer 核心',
  'llm-architecture': 'LLM 架构',
  moe: 'MoE 与稀疏专家',
  training: '训练与后训练',
  inference: '推理与服务',
  'rag-agent': 'RAG 与 Agent',
  'system-design': 'AI 系统设计',
};

/** 按 id（= topic slug）查知识点。 */
export function knowledgeById(id: string, nodes: KnowledgeNode[] = knowledgeNodes): KnowledgeNode | undefined {
  return nodes.find((n) => n.id === id);
}

/**
 * 开放题评分的必须要点：题目自带 rubric.required 优先，
 * 否则回退到该题 topic 对应知识点节点的 required——
 * 让"没写 rubric 的题"也能按知识点要点评分，而不是裸评。
 */
export function requiredPointsFor(q: Question, nodes: KnowledgeNode[] = knowledgeNodes): string[] | undefined {
  return q.rubric?.required ?? knowledgeById(q.topic, nodes)?.required;
}

export interface CoverageGap {
  id: string;
  name: string;
  area: KnowledgeArea;
  priority: KnowledgePriority;
}

export interface KnowledgeCoverage {
  /** 知识点总数 */
  total: number;
  p0Total: number;
  /** 有至少一道题目支撑的 P0 知识点数 */
  p0Covered: number;
  /** 尚无任何题目支撑的知识节点 = 题库建设路线图 */
  gaps: CoverageGap[];
}

/** 知识点覆盖度：P0 覆盖率是题库建设的北极星指标，gaps 是下一步该补的题。 */
export function knowledgeCoverage(questions: Question[], nodes: KnowledgeNode[] = knowledgeNodes): KnowledgeCoverage {
  const backedTopics = new Set(questions.map((q) => q.topic));
  const p0 = nodes.filter((n) => n.priority === 'P0');
  return {
    total: nodes.length,
    p0Total: p0.length,
    p0Covered: p0.filter((n) => backedTopics.has(n.id)).length,
    gaps: nodes
      .filter((n) => !backedTopics.has(n.id))
      .map(({ id, name, area, priority }) => ({ id, name, area, priority })),
  };
}
