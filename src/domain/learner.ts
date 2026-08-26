// 纯逻辑：Learner Memory（Training Coach 的数据核心）。
// 只做"结构化学习信号"的聚合（分数 / 弱项 / 掌握度 / 趋势 / 建议），不存对话原文（ADR-015）。
// 职责边界（ADR-030）：图（conceptGraph）只回答知识间关系；这里回答"用户掌握得怎么样"
// ——掌握判定阈值、coverage、推荐展开等学习策略全部收拢在本模块。
// 不依赖 React / LLM / 网络，全部可单测。

import type {
  AngleStat,
  EvaluationResult,
  InterviewDefinition,
  LearnerProfile,
  QuestionAngle,
  QuestionResult,
  ScoringRubric,
  SessionQuestion,
  SessionRecord,
  AnswerValue,
  Trend,
} from '../types';
import { DEFAULT_RUBRIC } from './evaluation';
import { prerequisiteClosure, topoRankOf } from './conceptGraph';

const SESSION_CAP = 50;
const TREND_EPSILON = 2; // 上次 vs 平均分差超过该值才算"在进步/下滑"

// ── 掌握度启发式（mastery heuristic，ADR-030） ───────────────
// mastery = avgScore/100 只是当前简化启发式，不是学习能力的真实度量——
// 平均分无法区分"先会后忘"与"渐入佳境"。语义分工：mastery=当前启发式、
// trend=近期表现信号、attempts=置信度信号、evidence=溯源。
// 不引入 Bayesian/ELO/IRT；升级评分模型的前提是现有信号被证明不够用。

/** 薄弱判定阈值：掌握度 <0.85 且均分 <85 视为未掌握（learner 内单一出处）。 */
export const WEAK_MASTERY = 0.85;
export const WEAK_AVG = 85;

function isMastered(profile: LearnerProfile, topic: string): boolean {
  const s = profile.topicStats[topic];
  return Boolean(s && s.attempts > 0 && (s.mastery >= WEAK_MASTERY || s.avgScore >= WEAK_AVG));
}

function isAttempted(profile: LearnerProfile, topic: string): boolean {
  return Boolean(profile.topicStats[topic] && profile.topicStats[topic].attempts > 0);
}

// ── 题库 → Learner 的边界工具 ───────────────────────────────

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

/**
 * 把教练推荐的主题沿前置闭包展开：薄弱主题的全部未掌握前置都纳入抽题优先级，
 * 实现"先补地基再攻难点"。（图关系来自 conceptGraph；跳过已掌握是学习策略，归本模块。）
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

/** Concept×Angle 证据的 key：`${topic}|${angle}`。 */
export function angleKey(topic: string, angle: QuestionAngle): string {
  return `${topic}|${angle}`;
}

/** Topic×Subtopic 证据的 key：`${topic}|${subtopic}`。 */
export function subtopicKey(topic: string, subtopic: string): string {
  return `${topic}|${subtopic}`;
}

export function emptyProfile(): LearnerProfile {
  return {
    totalSessions: 0,
    totalQuestions: 0,
    overallScore: 0,
    topicStats: {},
    angleCoverage: {},
    subtopicCoverage: {},
    sessions: [],
    updatedAt: 0,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** 由会话结果聚合"高频遗漏要点"：按出现次数取前 3；本会话无遗漏则沿用历史。 */
function aggregateGaps(prev: string[] | undefined, results: QuestionResult[]): string[] {
  const counts = new Map<string, number>();
  for (const r of results) {
    for (const g of r.gaps) {
      const key = g.trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 3);
  return sorted.length > 0 ? sorted : (prev ?? []).slice(0, 3);
}

/**
 * 把新会话并入 Learner Profile，返回新画像（不可变更新）。
 * - 每个 topic 独立聚合：attempts / avgScore / lastScore / trend / mastery / commonWeaknesses / lastSeen
 * - mastery = avgScore/100（ADR-019 简化公式）；置信度由 attempts 字段本身表达，不做加权
 * - 会话列表新在前，上限 SESSION_CAP；overallScore = 最近 10 次会话均值
 */
export function updateLearner(profile: LearnerProfile, s: SessionRecord): LearnerProfile {
  const topicStats = { ...profile.topicStats };
  const angleCoverage = { ...(profile.angleCoverage ?? {}) };
  const subtopicCoverage = { ...(profile.subtopicCoverage ?? {}) };
  const byTopic = new Map<string, QuestionResult[]>();
  for (const r of s.questionResults) {
    const arr = byTopic.get(r.topic) ?? [];
    arr.push(r);
    byTopic.set(r.topic, arr);
  }

  // Concept×Angle 逐角度证据：与 topic 聚合并行，key = topic|angle
  for (const r of s.questionResults) {
    if (!r.angle) continue;
    const key = angleKey(r.topic, r.angle);
    const prev = angleCoverage[key];
    const attempts = (prev?.attempts ?? 0) + 1;
    const avgScore = prev
      ? Math.round(((prev.avgScore * prev.attempts + r.score) / attempts) * 10) / 10
      : Math.round(r.score * 10) / 10;
    angleCoverage[key] = {
      attempts,
      avgScore,
      lastScore: r.score,
      lastAskedAt: s.startedAt,
    };
  }

  // Topic×Subtopic 逐子主题证据（用于 subtopic 粒度追问与薄弱分析）
  for (const r of s.questionResults) {
    if (!r.subtopic) continue;
    const key = subtopicKey(r.topic, r.subtopic);
    const prev = subtopicCoverage[key];
    const attempts = (prev?.attempts ?? 0) + 1;
    const avgScore = prev
      ? Math.round(((prev.avgScore * prev.attempts + r.score) / attempts) * 10) / 10
      : Math.round(r.score * 10) / 10;
    subtopicCoverage[key] = {
      attempts,
      avgScore,
      lastScore: r.score,
      lastAskedAt: s.startedAt,
    };
  }

  for (const [topic, results] of byTopic) {
    const prev = topicStats[topic];
    const n = results.length;
    const avg = results.reduce((a, r) => a + r.score, 0) / n;
    const last = results[n - 1].score;
    const attempts = (prev?.attempts ?? 0) + n;
    const newAvg = prev
      ? Math.round(((prev.avgScore * prev.attempts + avg * n) / attempts) * 10) / 10
      : Math.round(avg * 10) / 10;
    const trend: Trend = prev
      ? last > prev.avgScore + TREND_EPSILON
        ? 'improving'
        : last < prev.avgScore - TREND_EPSILON
          ? 'declining'
          : 'flat'
      : 'flat';
    // 掌握度 = 均分/100，简单直接（ADR-019）；置信度由 attempts 字段本身表达，不做加权公式
    const mastery = Math.round(clamp01(newAvg / 100) * 100) / 100;


    topicStats[topic] = {
      attempts,
      avgScore: newAvg,
      lastScore: last,
      trend,
      mastery,
      commonWeaknesses: aggregateGaps(prev?.commonWeaknesses, results),
      evidence: [...(prev?.evidence ?? []), ...results.map((r) => ({ questionId: r.questionId, score: r.score, at: s.startedAt }))].slice(-10),
      lastSeen: s.startedAt,
    };
  }

  const sessions = [s, ...profile.sessions].slice(0, SESSION_CAP);
  const recent = sessions.slice(0, 10).map((x) => x.overall);
  const overallScore = recent.length
    ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)
    : 0;

  return {
    totalSessions: profile.totalSessions + 1,
    totalQuestions: profile.totalQuestions + s.questionResults.length,
    overallScore,
    topicStats,
    angleCoverage,
    subtopicCoverage,
    sessions,
    updatedAt: s.startedAt,
  };
}

/** 由一次已评分的训练会话构造 SessionRecord（纯函数；答案只影响判分结果，不在此读取）。 */
export function sessionFromQuiz(
  session: { questions: SessionQuestion[]; startedAt: number; definition?: { title?: string; mode?: SessionRecord['mode'] } },
  grades: Record<string, EvaluationResult | null>,
  durationSec?: number,
  answers?: Record<string, AnswerValue>,
): SessionRecord {
  const results: QuestionResult[] = session.questions.map(({ question: q, format }) => {
    const g = grades[q.id];
    return {
      questionId: q.id,
      category: q.category,
      topic: q.topic,
      subtopic: q.subtopic ?? undefined,
      format,
      angle: q.angle ?? undefined,
      score: g?.overall ?? 0,
      correct: format === 'choice' ? (g?.dimensions.correctness ?? 0) === 100 : undefined,
      // 选择题判定性打分，不知道用户漏了哪个知识点，故不产生 gaps；
      // gaps 仅来自开放题的 LLM 评估，避免把"答案不正确"当真实薄弱要点写进 Learner Memory。
      gaps: format === 'choice' ? [] : (g?.gaps ?? []),
    };
  });
  const overall =
    results.length > 0 ? Math.round(results.reduce((a, r) => a + r.score, 0) / results.length) : 0;
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
    startedAt: session.startedAt,
    durationSec,
    mode: session.definition?.mode,
    title: session.definition?.title ?? '训练',
    questionResults: results,
    overall,
    // 完整原题快照（含 AI 变体），供历史会话原样复现；不写入画像聚合，仅作回放用。
    questions: session.questions,
    // 用户作答（选项索引 / 开放题文本），供回放"用户当时选了什么"与后续分析。
    answers: answers ?? {},
  };
}

/** 按掌握度升序取最薄弱的前 limit 个主题（仅统计练过的；达到掌握阈值的不推荐）。 */
export function recommendWeakTopics(profile: LearnerProfile, limit = 3): string[] {
  return Object.entries(profile.topicStats)
    .filter(([, s]) => s.attempts > 0 && s.mastery < WEAK_MASTERY && s.avgScore < WEAK_AVG)
    .sort((a, b) => a[1].mastery - b[1].mastery || b[1].lastSeen - a[1].lastSeen)
    .slice(0, limit)
    .map(([topic]) => topic);
}

export interface CategoryCoverage {
  category: string;
  totalTopics: number;
  attempted: number;
  mastered: number;
}

/** 取某个 (topic, angle) 的逐角度证据；未练过返回 undefined。 */
export function getAngleStat(profile: LearnerProfile, topic: string, angle: QuestionAngle): AngleStat | undefined {
  return profile.angleCoverage?.[angleKey(topic, angle)];
}

/** 该 (topic, angle) 是否已有作答证据。 */
export function isAngleAttempted(profile: LearnerProfile, topic: string, angle: QuestionAngle): boolean {
  const s = getAngleStat(profile, topic, angle);
  return Boolean(s && s.attempts > 0);
}

/**
 * 给定某 concept（topic）与其期望考察角度，返回"证据最薄弱"的角度优先级列表：
 * - 未练过的角度排最前（attempts=0）；
 * - 已练但均分低于掌握线的角度其次（按均分升序）；
 * - 已充分掌握的角度不入列。
 * 用于"弱 concept → 缺证据 angle"的自适应追问（你提案 section 6/10 的核心）。
 */
export function weakAnglesOf(profile: LearnerProfile, topic: string, expected: QuestionAngle[]): QuestionAngle[] {
  const scored = expected.map((angle) => {
    const stat = getAngleStat(profile, topic, angle);
    if (!stat || stat.attempts === 0) return { angle, rank: 0, score: 0 };
    if (stat.avgScore < WEAK_AVG) return { angle, rank: 1, score: stat.avgScore };
    return { angle, rank: 2, score: stat.avgScore };
  });
  return scored
    .filter((x) => x.rank < 2)
    .sort((a, b) => a.rank - b.rank || a.score - b.score)
    .map((x) => x.angle);
}

/** 取某个 (topic, subtopic) 的逐子主题证据；未练过返回 undefined。 */
export function getSubtopicStat(profile: LearnerProfile, topic: string, subtopic: string): AngleStat | undefined {
  return profile.subtopicCoverage?.[subtopicKey(topic, subtopic)];
}

/** 该 (topic, subtopic) 是否已有作答证据。 */
export function isSubtopicAttempted(profile: LearnerProfile, topic: string, subtopic: string): boolean {
  const s = getSubtopicStat(profile, topic, subtopic);
  return Boolean(s && s.attempts > 0);
}

/** 给定某 topic 下的所有 subtopic，返回“证据最薄弱”的子主题优先级。 */
export function weakSubtopicsOf(profile: LearnerProfile, topic: string, subtopics: string[]): string[] {
  const scored = subtopics.map((st) => {
    const stat = getSubtopicStat(profile, topic, st);
    if (!stat || stat.attempts === 0) return { subtopic: st, rank: 0, score: 0 };
    if (stat.avgScore < WEAK_AVG) return { subtopic: st, rank: 1, score: stat.avgScore };
    return { subtopic: st, rank: 2, score: stat.avgScore };
  });
  return scored
    .filter((x) => x.rank < 2)
    .sort((a, b) => a.rank - b.rank || a.score - b.score)
    .map((x) => x.subtopic);
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

/**
 * 知识覆盖面（学习策略，非图操作）：按类目聚合练习/掌握比例；
 * blocked 判定沿前置闭包上溯——根因未掌握则高级主题被标记为"先补前置"。
 * 图关系查询在 conceptGraph；这里回答"根据用户状态，现在学得如何"。
 */
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
 * 学习路径建议（学习策略）：
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
      .sort((a, b) => topoRankOf(a.topic) - topoRankOf(b.topic));
    for (const t of ready) {
      suggestions.push({ topic: t.topic, reason: '前置知识已具备，适合开始学习' });
    }
  }

  return suggestions.slice(0, limit);
}

/** 构造"教练推荐"的 InterviewDefinition：薄弱主题优先，其余按默认配置。 */
export function buildCoachDefinition(
  profile: LearnerProfile,
  opts: {
    title?: string;
    count?: number;
    timeLimitSec?: number;
    useAI?: boolean;
    formats?: InterviewDefinition['formats'];
    mode?: SessionRecord['mode'];
    rubric?: ScoringRubric;
    adaptive?: boolean;
  } = {},
): InterviewDefinition {
  return {
    title: opts.title ?? '推荐训练',
    categories: [],
    difficulties: [],
    formats: opts.formats ?? ['choice', 'open'],
    count: opts.count ?? 10,
    useAI: opts.useAI ?? true,
    scoringRubric: opts.rubric ?? DEFAULT_RUBRIC,
    timeLimitSec: opts.timeLimitSec,
    // 沿概念图前置链展开薄弱主题：先补地基（未掌握的前置）再攻难点
    topicPriorities: expandWithPrerequisites(recommendWeakTopics(profile, 3), profile),
    mode: opts.mode ?? 'coach',
    adaptive: opts.adaptive,
  };
}

/** 生成训练建议文案（纯文本，Training Coach 首页/结果页展示）。 */
export function recommendationText(profile: LearnerProfile): string {
  if (profile.totalSessions === 0) {
    return '完成一次训练后，我会根据你的表现生成个性化建议。';
  }
  const weak = recommendWeakTopics(profile, 3);
  if (weak.length === 0) {
    return '各主题表现都很稳定，继续保持；可以尝试更高难度或编程题。';
  }
  const lines = weak.map((t) => {
    const s = profile.topicStats[t];
    const trendNote =
      s.trend === 'improving' ? '（在进步）' : s.trend === 'declining' ? '（需警惕下滑）' : '';
    return `${t} ${s.avgScore}分${trendNote}`;
  });
  const gaps = weak
    .flatMap((t) => (profile.topicStats[t]?.commonWeaknesses ?? []).slice(0, 2))
    .slice(0, 3);
  return `根据历史表现，优先练习：${lines.join('、')}。${
    gaps.length > 0 ? `注意：${gaps.join('、')} 是你反复遗漏的要点。` : ''
  }`;
}
