// 纯逻辑：知识图谱（Knowledge Graph）。
// 数据形态：typed nodes（concept/architecture/technique/problem/tradeoff/...）
//          + typed directed edges（prerequisite / part_of / extends / alternative /
//            tradeoff / contrasts / related_to / technique / deep_dive / challenge）。
// prerequisite 边构成有向 DAG，方向统一为"基础 → 进阶"，支持传递闭包：
// 高级主题的前置未掌握时，系统知道该先补哪里。
// 不依赖 React / LLM / 网络。

import type { LearnerProfile } from '../types';
import graphData from '../data/conceptGraph.json';

export type NodeType =
  | 'concept'
  | 'architecture'
  | 'pattern'
  | 'technique'
  | 'problem'
  | 'tradeoff'
  | 'decision'
  | 'metric';

export type EdgeType =
  | 'prerequisite' // from 是 to 的前置（DAG，基础 → 进阶）
  | 'part_of' // from 是 to 的子概念
  | 'extends' // from 扩展/强化了 to
  | 'alternative' // from 与 to 是可互相替代的方案
  | 'tradeoff' // from 是围绕 to 的权衡决策
  | 'contrasts' // from 与 to 形成对照/对立
  | 'related_to' // 一般相关（无向语义，双向可遍历）
  | 'technique' // from 是解决 to 的技术手段
  | 'deep_dive' // 面试迁移：from 答得好时纵向追问 to
  | 'challenge'; // 面试迁移：挑战/质疑型追问

export interface ConceptEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface ConceptGraph {
  nodeTypes: Record<string, NodeType>;
  edges: ConceptEdge[];
}

export const conceptGraph: ConceptGraph = graphData as unknown as ConceptGraph;

const WEAK_MASTERY = 0.85;
const WEAK_AVG = 85;

/** 无向语义的边类型：broaden / 覆盖面按"相关"处理。 */
const UNDIRECTED_TYPES: EdgeType[] = ['related_to', 'alternative', 'tradeoff', 'contrasts', 'extends'];

function outgoing(g: ConceptGraph, topic: string, type?: EdgeType): ConceptEdge[] {
  return g.edges.filter((e) => e.from === topic && (!type || e.type === type));
}
function incoming(g: ConceptGraph, topic: string, type?: EdgeType): ConceptEdge[] {
  return g.edges.filter((e) => e.to === topic && (!type || e.type === type));
}

/** 直接前置（进阶主题的基础）。 */
export function prerequisitesOf(g: ConceptGraph, topic: string): string[] {
  return incoming(g, topic, 'prerequisite').map((e) => e.from);
}

/** 前置传递闭包（沿 DAG 上溯，含自身去重；环由 seen 保护）。 */
export function prerequisiteClosure(g: ConceptGraph, topic: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([topic]);
  const queue = [...prerequisitesOf(g, topic)];
  while (queue.length > 0) {
    const t = queue.shift() as string;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    queue.push(...prerequisitesOf(g, t));
  }
  return out;
}

/**
 * 横向扩展候选（broaden）：无向语义边的对端。
 * 返回与 topic "相关"的主题集合——含直接相关、替代方案、权衡决策、扩展物。
 */
export function relatedOf(g: ConceptGraph, topic: string): string[] {
  const result = new Set<string>();
  for (const e of g.edges) {
    if (UNDIRECTED_TYPES.includes(e.type)) {
      if (e.from === topic) result.add(e.to);
      else if (e.to === topic) result.add(e.from);
    }
  }
  return [...result];
}

/** 面试迁移目标：deep_dive / challenge 边声明的追问对象。 */
export function interviewTargetsOf(g: ConceptGraph, topic: string, type: 'deep_dive' | 'challenge'): string[] {
  return outgoing(g, topic, type).map((e) => e.to);
}

/** 子概念（part_of 的子节点 + extends 的被扩展者），供 deep-dive 兜底。 */
export function childrenOf(g: ConceptGraph, topic: string): string[] {
  return [
    ...incoming(g, topic, 'part_of').map((e) => e.from),
    ...incoming(g, topic, 'extends').map((e) => e.from),
  ];
}

export function nodeTypeOf(g: ConceptGraph, topic: string): NodeType | undefined {
  return g.nodeTypes[topic];
}

function isMastered(profile: LearnerProfile, topic: string): boolean {
  const s = profile.topicStats[topic];
  return Boolean(s && s.attempts > 0 && (s.mastery >= WEAK_MASTERY || s.avgScore >= WEAK_AVG));
}

function isAttempted(profile: LearnerProfile, topic: string): boolean {
  return Boolean(profile.topicStats[topic] && profile.topicStats[topic].attempts > 0);
}

/** 题库中出现过的全部 (category, topic) 组合（去重）。 */
export interface TopicRef {
  category: string;
  topic: string;
}

export function collectTopicRefs(questions: TopicRef[]): TopicRef[] {
  const seen = new Map<string, TopicRef>();
  for (const q of questions) {
    if (!seen.has(q.topic)) seen.set(q.topic, { category: q.category, topic: q.topic });
  }
  return [...seen.values()];
}

export interface CategoryCoverage {
  category: string;
  totalTopics: number;
  attempted: number;
  mastered: number;
}

export interface CoverageReport {
  categories: CategoryCoverage[];
  /** 练过但未达掌握阈值的 topic（薄弱项） */
  weakTopics: string[];
  unattemptedCount: number;
  /** 未练过、且前置闭包全部掌握的 topic——"现在就可以学" */
  readyToLearn: string[];
  /** 未练过、且存在未掌握前置的 topic——"先补前置" */
  blockedCount: number;
}

/** 知识覆盖面：按类目聚合练习/掌握比例；blocked 判定使用前置闭包（DAG 上溯）。 */
export function computeCoverage(topicRefs: TopicRef[], profile: LearnerProfile, g: ConceptGraph): CoverageReport {
  const byCategory = new Map<string, TopicRef[]>();
  for (const t of topicRefs) {
    const arr = byCategory.get(t.category) ?? [];
    arr.push(t);
    byCategory.set(t.category, arr);
  }

  const categories: CategoryCoverage[] = [...byCategory.entries()]
    .map(([category, refs]) => ({
      category,
      totalTopics: refs.length,
      attempted: refs.filter((t) => isAttempted(profile, t.topic)).length,
      mastered: refs.filter((t) => isMastered(profile, t.topic)).length,
    }))
    .sort((a, b) => b.totalTopics - a.totalTopics);

  const weakTopics = topicRefs
    .map((t) => t.topic)
    .filter((topic) => isAttempted(profile, topic) && !isMastered(profile, topic));

  const readyToLearn: string[] = [];
  let blockedCount = 0;
  for (const t of topicRefs) {
    if (isAttempted(profile, t.topic)) continue;
    const closure = prerequisiteClosure(g, t.topic);
    if (closure.length === 0 || closure.every((p) => isMastered(profile, p))) {
      readyToLearn.push(t.topic);
    } else {
      blockedCount += 1;
    }
  }

  return {
    categories,
    weakTopics,
    unattemptedCount: topicRefs.length - topicRefs.filter((t) => isAttempted(profile, t.topic)).length,
    readyToLearn,
    blockedCount,
  };
}

export interface TopicSuggestion {
  topic: string;
  reason: string;
}

/**
 * 学习路径建议：
 * 1) 练过但薄弱的 topic（按掌握度升序）——"继续加强"；
 * 2) 前置闭包已掌握的未学 topic——"可以开始学"。
 */
export function suggestNextTopics(
  topicRefs: TopicRef[],
  profile: LearnerProfile,
  g: ConceptGraph,
  limit = 5,
): TopicSuggestion[] {
  const suggestions: TopicSuggestion[] = [];

  const weak = topicRefs
    .filter((t) => isAttempted(profile, t.topic) && !isMastered(profile, t.topic))
    .sort((a, b) => (profile.topicStats[a.topic]?.mastery ?? 1) - (profile.topicStats[b.topic]?.mastery ?? 1));
  for (const t of weak) {
    const s = profile.topicStats[t.topic];
    suggestions.push({
      topic: t.topic,
      reason: `已练 ${s.attempts} 次、均分 ${s.avgScore}，尚未达到掌握线`,
    });
  }

  if (suggestions.length < limit) {
    const ready = topicRefs
      .filter((t) => !isAttempted(profile, t.topic))
      .filter((t) => {
        const closure = prerequisiteClosure(g, t.topic);
        return closure.length === 0 || closure.every((p) => isMastered(profile, p));
      })
      .sort((a, b) => prerequisiteClosure(g, a.topic).length - prerequisiteClosure(g, b.topic).length);
    for (const t of ready) {
      suggestions.push({ topic: t.topic, reason: '前置知识已具备，适合开始学习' });
    }
  }

  return suggestions.slice(0, limit);
}

/**
 * 把教练推荐的主题沿前置闭包展开：薄弱主题的全部未掌握前置都纳入抽题优先级，
 * 实现"先补地基再攻难点"。
 */
export function expandWithPrerequisites(priorities: string[], profile: LearnerProfile, g: ConceptGraph): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const queue = [...priorities];
  while (queue.length > 0 && result.length < 10) {
    const topic = queue.shift() as string;
    if (seen.has(topic)) continue;
    seen.add(topic);
    if (!isMastered(profile, topic)) result.push(topic);
    queue.push(...prerequisiteClosure(g, topic).slice(0, 3));
  }
  return result;
}
