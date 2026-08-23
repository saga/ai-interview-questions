// 纯逻辑：知识图谱（Knowledge Graph）。
// 数据形态：有向边列表，两类关系：
//   prerequisite  基础 → 进阶（加载期 isAcyclic 校验的 DAG）
//   related       一般相关（无向语义，遍历层双向展开）
// 图的存储与算法委托给 @dagrejs/graphlib：
//   - 邻接查询 predecessors
//   - prerequisite 子图的 DAG 校验（isAcyclic/findCycles，数据错误在加载期暴露）
//   - 拓扑排序（topsort）给出"基础→进阶"学习顺序
// 图是模块级单例（数据来自 data/conceptGraph.json），公开 API 不再要求传 graph 参数。
// 不依赖 React / LLM / 网络。

import { Graph, alg } from '@dagrejs/graphlib';
import type { LearnerProfile } from '../types';
import graphData from '../data/conceptGraph.json';

export type EdgeType =
  | 'prerequisite' // from 是 to 的前置（DAG，基础 → 进阶）
  | 'related'; // 一般相关（无向语义，双向可遍历）

export interface ConceptEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface ConceptGraph {
  edges: ConceptEdge[];
}

export const conceptGraph: ConceptGraph = graphData as unknown as ConceptGraph;

/** 薄弱判定阈值：掌握度 <0.85 且均分 <85 视为未掌握（learner 与 coverage 共用）。 */
export const WEAK_MASTERY = 0.85;
export const WEAK_AVG = 85;

/** 无向语义的边类型。 */
const UNDIRECTED_TYPES: EdgeType[] = ['related'];

// ── graphlib 实例（模块级单例） ─────────────────────────────

const g = new Graph({ directed: true });
for (const e of conceptGraph.edges) {
  g.setNode(e.from);
  g.setNode(e.to);
  g.setEdge(e.from, e.to, e.type);
}

/** prerequisite 子图（基础→进阶的学习依赖 DAG）。 */
const prerequisiteDag = (() => {
  const dag = new Graph({ directed: true });
  for (const { v, w } of g.edges()) {
    if (g.edge(v, w) === 'prerequisite') dag.setEdge(v, w);
  }
  return dag;
})();

if (!alg.isAcyclic(prerequisiteDag)) {
  throw new Error(`conceptGraph: prerequisite 边存在环，请修正数据：${JSON.stringify(alg.findCycles(prerequisiteDag))}`);
}

/** 全部前置关系的拓扑序（基础在前）；不在依赖关系中的节点排在最后。 */
const topoRank = new Map<string, number>(
  alg.topsort(prerequisiteDag).map((id, i) => [id, i]),
);

// ── 遍历 API ───────────────────────────────────────────────

/** 前置传递闭包（沿 DAG 上溯，BFS 近者在前；环已由加载期校验排除）。 */
export function prerequisiteClosure(topic: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([topic]);
  const queue = [...(prerequisiteDag.predecessors(topic) ?? [])];
  while (queue.length > 0) {
    const t = queue.shift() as string;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    queue.push(...(prerequisiteDag.predecessors(t) ?? []));
  }
  return out;
}

/**
 * 横向扩展候选（broaden）：related 边的双端（双向遍历）。
 */
export function relatedOf(topic: string): string[] {
  const result = new Set<string>();
  for (const e of conceptGraph.edges) {
    if (!UNDIRECTED_TYPES.includes(e.type)) continue;
    if (e.from === topic) result.add(e.to);
    else if (e.to === topic) result.add(e.from);
  }
  return [...result];
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
export function computeCoverage(topicRefs: TopicRef[], profile: LearnerProfile): CoverageReport {
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
    const closure = prerequisiteClosure(t.topic);
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
 * 2) 前置闭包已掌握的未学 topic——"可以开始学"，按拓扑序（基础优先）排列。
 */
export function suggestNextTopics(
  topicRefs: TopicRef[],
  profile: LearnerProfile,
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
        const closure = prerequisiteClosure(t.topic);
        return closure.length === 0 || closure.every((p) => isMastered(profile, p));
      })
      .sort((a, b) => (topoRank.get(a.topic) ?? Infinity) - (topoRank.get(b.topic) ?? Infinity));
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
export function expandWithPrerequisites(priorities: string[], profile: LearnerProfile): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const queue = [...priorities];
  while (queue.length > 0 && result.length < 10) {
    const topic = queue.shift() as string;
    if (seen.has(topic)) continue;
    seen.add(topic);
    if (!isMastered(profile, topic)) result.push(topic);
    queue.push(...prerequisiteClosure(topic).slice(0, 3));
  }
  return result;
}
