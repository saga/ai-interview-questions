// 纯逻辑：概念图（topic 级）。题目自带 topic/tags 是节点来源；
// 本文件只维护"边"（相关 / 前置），并基于 Learner Profile 计算覆盖面与学习建议。
// 不依赖 React / LLM / 网络。

import type { LearnerProfile } from '../types';
import graphData from '../data/conceptGraph.json';

export interface ConceptGraph {
  /** topicA → 与其相关的兄弟 topic（横向扩展用） */
  related: Record<string, string[]>;
  /** topic → 学习它之前应先掌握的 topic（纵向补弱用） */
  prerequisites: Record<string, string[]>;
}

export const conceptGraph: ConceptGraph = graphData;

const WEAK_MASTERY = 0.85;
const WEAK_AVG = 85;

export function relatedOf(g: ConceptGraph, topic: string): string[] {
  return g.related[topic] ?? [];
}

export function prerequisitesOf(g: ConceptGraph, topic: string): string[] {
  return g.prerequisites[topic] ?? [];
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
  /** 该类目下题库中的 topic 总数 */
  totalTopics: number;
  /** 至少练过一次的 topic 数 */
  attempted: number;
  /** 达到掌握阈值（mastery≥0.85 或均分≥85）的 topic 数 */
  mastered: number;
}

export interface CoverageReport {
  categories: CategoryCoverage[];
  /** 练过但未达掌握阈值的 topic（薄弱项） */
  weakTopics: string[];
  /** 从未练过的 topic 数 */
  unattemptedCount: number;
  /** 未练过、但其全部前置都已掌握的 topic——"现在就可以学" */
  readyToLearn: string[];
  /** 未练过、且存在未掌握前置的 topic——"先补前置" */
  blockedCount: number;
}

/** 知识覆盖面：按类目聚合练习/掌握比例，并按前置关系识别可学与被阻塞的主题。 */
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
    const pres = prerequisitesOf(g, t.topic);
    if (pres.length === 0 || pres.every((p) => isMastered(profile, p))) {
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
 * 2) 前置已齐备的未学 topic（按前置数量少优先）——"可以开始学"。
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
        const pres = prerequisitesOf(g, t.topic);
        return pres.length === 0 || pres.every((p) => isMastered(profile, p));
      })
      .sort((a, b) => prerequisitesOf(g, a.topic).length - prerequisitesOf(g, b.topic).length);
    for (const t of ready) {
      suggestions.push({ topic: t.topic, reason: '前置知识已具备，适合开始学习' });
    }
  }

  return suggestions.slice(0, limit);
}

/**
 * 把教练推荐的主题沿前置链展开：薄弱主题的未掌握前置也纳入抽题优先级，
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
    for (const p of prerequisitesOf(g, topic)) queue.push(p);
  }
  return result;
}
