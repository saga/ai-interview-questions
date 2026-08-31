// 纯逻辑：知识点层查询与覆盖分析。不依赖 React / LLM。
// API 默认注入 knowledgeNodes 单例，测试可传入自定义节点列表替换数据源。

import type { KnowledgeArea, KnowledgePriority } from '../../schemas/common';
import type { KnowledgeNode } from '../../schemas/knowledge';
import type { Question } from '../../schemas/question';
import { knowledgeNodes } from '../../data/knowledgeMap';

export const KNOWLEDGE_AREA_LABELS: Record<KnowledgeArea, string> = {
  'ai-engineering': 'AI Engineering（基础能力）',
  llm: 'LLM 核心',
  'llm-applications': 'LLM 应用',
  'agent-engineering': 'Agent 工程',
  'ai-systems': 'AI 系统',
  'ai-security': 'AI 安全',
};

/** 按 id（= topic slug）查知识点。 */
export function knowledgeById(id: string, nodes: KnowledgeNode[] = knowledgeNodes): KnowledgeNode | undefined {
  return nodes.find((n) => n.id === id);
}

/**
 * 开放题评分的必须要点：统一来自该题 topic 对应知识点节点的 `required`。
 *
 * 变更（ADR-044）：原先「题目自带 `rubric.required` 优先，否则回退知识点」，
 * 该字段删除后锚点回归单一来源——知识点层。题目级的评分依据改由
 * `Question.explanation` 承担（直接注入评分提示，见 `ai/evaluate.buildEvalUser`），
 * 因此不再需要一个与知识点要点高度重叠、且需逐题维护的字段。
 */
export function requiredPointsFor(q: Question, nodes: KnowledgeNode[] = knowledgeNodes): string[] | undefined {
  return knowledgeById(q.topic, nodes)?.required;
}

export interface CoverageGap {
  id: string;
  name: string;
  domain: KnowledgeArea;
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
      .map(({ id, name, area, priority }) => ({ id, name, domain: area, priority })),
  };
}
