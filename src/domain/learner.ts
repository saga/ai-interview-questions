// 纯逻辑：Learner Memory（Training Coach 的数据核心）。
// 只做"结构化学习信号"的聚合（分数 / 弱项 / 掌握度 / 趋势 / 建议），不存对话原文（ADR-015）。
// 不依赖 React / LLM / 网络，全部可单测。

import type {
  EvaluationResult,
  InterviewDefinition,
  LearnerProfile,
  Question,
  QuestionResult,
  ScoringRubric,
  SessionRecord,
  Trend,
} from '../types';
import { isChoice } from './quiz';
import { DEFAULT_RUBRIC } from './evaluation';
import { expandWithPrerequisites, WEAK_AVG, WEAK_MASTERY } from './conceptGraph';

const SESSION_CAP = 50;
const TREND_EPSILON = 2; // 上次 vs 平均分差超过该值才算"在进步/下滑"

export function emptyProfile(): LearnerProfile {
  return {
    totalSessions: 0,
    totalQuestions: 0,
    overallScore: 0,
    topicStats: {},
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
  const byTopic = new Map<string, QuestionResult[]>();
  for (const r of s.questionResults) {
    const arr = byTopic.get(r.topic) ?? [];
    arr.push(r);
    byTopic.set(r.topic, arr);
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
    sessions,
    updatedAt: s.startedAt,
  };
}

/** 由一次已评分的训练会话构造 SessionRecord（纯函数；答案只影响判分结果，不在此读取）。 */
export function sessionFromQuiz(
  session: { questions: Question[]; startedAt: number; definition?: { title?: string; mode?: SessionRecord['mode'] } },
  grades: Record<string, EvaluationResult | null>,
  durationSec?: number,
): SessionRecord {
  const results: QuestionResult[] = session.questions.map((q) => {
    const g = grades[q.id];
    return {
      questionId: q.id,
      category: q.category,
      topic: q.topic,
      type: q.type,
      score: g?.overall ?? 0,
      correct: isChoice(q) ? (g?.dimensions.correctness ?? 0) === 100 : undefined,
      gaps: g?.gaps ?? [],
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

/** 构造"教练推荐"的 InterviewDefinition：薄弱主题优先，其余按默认配置。 */
export function buildCoachDefinition(
  profile: LearnerProfile,
  opts: {
    title?: string;
    count?: number;
    timeLimitSec?: number;
    useAI?: boolean;
    questionTypes?: InterviewDefinition['questionTypes'];
    mode?: SessionRecord['mode'];
    rubric?: ScoringRubric;
    adaptive?: boolean;
  } = {},
): InterviewDefinition {
  return {
    title: opts.title ?? '推荐训练',
    categories: [],
    difficulties: [],
    questionTypes: opts.questionTypes ?? ['single', 'multiple', 'essay', 'coding'],
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
