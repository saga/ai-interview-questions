// 纯逻辑：Learner Memory（Training Coach 的数据核心）。
// 只做"结构化学习信号"的聚合（分数 / 弱项 / 掌握度 / 趋势 / 建议），不存对话原文（ADR-015）。
// 职责边界（ADR-030）：图（conceptGraph）只回答知识间关系；这里回答"用户掌握得怎么样"
// ——掌握判定阈值、coverage、推荐展开等学习策略全部收拢在本模块。
// 不依赖 React / LLM / 网络，全部可单测。

import type { AnswerValue } from '../types';
import type { QuestionAngle } from '../schemas/common';
import type { InterviewDefinition, ScoringRubric } from '../schemas/interview';
import type { AngleStat, LearnerProfile, QuestionResult, SessionRecord, Trend } from '../schemas/learner';
import type { EvaluationResult } from '../schemas/evaluation';
import type { SessionQuestion } from '../schemas/session';
import type { ProficiencyConfig } from '../schemas/ai-config';
import { proficiencyConfigSchema } from '../schemas/ai-config';
import { DEFAULT_RUBRIC } from './evaluation';
import { prerequisiteClosure, topoRankOf } from './conceptGraph';

const SESSION_CAP = 50;
const TREND_EPSILON = 2; // 上次 vs 平均分差超过该值才算"在进步/下滑"

// ── 熟练度启发式（proficiency heuristic，ADR-030） ──────────
// 得分代表表现，题目数和训练会话数代表证据量。证据量只提高置信度，
// 不会把低分题目变成高熟练度；单题一次满分也不会直接得到 100%。
// 不引入 Bayesian/ELO/IRT；升级评分模型的前提是现有信号被证明不够用。

/** 薄弱判定阈值：掌握度 <0.85 且均分 <85 视为未掌握（learner 内单一出处）。 */
export const WEAK_MASTERY = 0.75;
export const WEAK_AVG = 75;
export const RECENT_TOPIC_COOLDOWN_SESSIONS = 1;

function scoreWeight(format: QuestionResult['format'], config: ProficiencyConfig): number {
  return format === 'open' ? config.openWeight : config.choiceWeight;
}

function isMastered(profile: LearnerProfile, topic: string, threshold = WEAK_AVG): boolean {
  const s = profile.topicStats[topic];
  return Boolean(s && s.attempts > 0 && s.avgScore >= threshold);
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
export function expandWithPrerequisites(priorities: string[], profile: LearnerProfile, threshold = WEAK_AVG): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const queue = [...priorities];
  while (queue.length > 0 && result.length < 10) {
    const topic = queue.shift() as string;
    if (seen.has(topic)) continue;
    seen.add(topic);
    if (!isMastered(profile, topic, threshold)) result.push(topic);
    queue.push(...prerequisiteClosure(topic).slice(0, 3));
  }
  return result;
}

/** Concept×Angle 证据的 key：`${topic}|${angle}`。 */
export function angleKey(topic: string, angle: QuestionAngle): string {
  return `${topic}|${angle}`;
}

export function emptyProfile(): LearnerProfile {
  return {
    totalSessions: 0,
    totalQuestions: 0,
    overallScore: 0,
    topicStats: {},
    angleCoverage: {},
    sessions: [],
    updatedAt: 0,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function calculateProficiency(
  avgScore: number,
  attempts: number,
  practiceSessions: number,
  config: ProficiencyConfig = proficiencyConfigSchema.parse({}),
): number {
  const scoreFactor = clamp01(avgScore / 100);
  const questionConfidence = attempts / (attempts + config.questionConfidenceSmoothing);
  const practiceConfidence = practiceSessions / (practiceSessions + config.practiceConfidenceSmoothing);
  return Math.round(clamp01(scoreFactor * (
    config.baseCoefficient
    + config.questionCoefficient * questionConfidence
    + config.practiceCoefficient * practiceConfidence
  )) * 100) / 100;
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
 * - mastery 是结合得分、题目次数、训练会话次数的熟练度，不是单次答题正确率
 * - 会话列表新在前，上限 SESSION_CAP；overallScore = 最近 10 次会话均值
 *
 * 设计权衡（trade-off）：
 * - 为什么「不可变」：返回全新对象而非原地 mutate，便于 React 浅比较触发重渲染、也避免多个会话实例共享同一引用导致串数据。
 * - 为什么 mastery 只用均值而非贝叶斯/IRT：当前信号（单维度分数）不足以支撑复杂模型，且引入会显著增加复杂度与可解释的困难；
 *   若未来「先会后忘」现象成为问题，再升级评分模型——见模块顶部启发式说明。
 * - 最近 10 次均值作为 overallScore：用滑动窗口平滑单次失常，又不让远古成绩永远拖着整体，平衡「稳定」与「时效」。
 */
export function updateLearner(
  profile: LearnerProfile,
  s: SessionRecord,
  config: ProficiencyConfig = proficiencyConfigSchema.parse({}),
): LearnerProfile {
  const topicStats = { ...profile.topicStats };
  const angleCoverage = { ...(profile.angleCoverage ?? {}) };
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

  for (const [topic, results] of byTopic) {
    const prev = topicStats[topic];
    const n = results.length;
    const weight = results.reduce((sum, result) => sum + scoreWeight(result.format, config), 0);
    const weightedScore = results.reduce((sum, result) => sum + result.score * scoreWeight(result.format, config), 0);
    const last = results[n - 1].score;
    const attempts = (prev?.attempts ?? 0) + n;
    const previousWeight = prev?.scoreWeightTotal ?? prev?.attempts ?? 0;
    const scoreWeightTotal = previousWeight + weight;
    const newAvg = prev
      ? Math.round(((prev.avgScore * previousWeight + weightedScore) / scoreWeightTotal) * 10) / 10
      : Math.round((weightedScore / weight) * 10) / 10;
    const trend: Trend = prev
      ? last > prev.avgScore + TREND_EPSILON
        ? 'improving'
        : last < prev.avgScore - TREND_EPSILON
          ? 'declining'
          : 'flat'
      : 'flat';
    const practiceSessions = (prev?.practiceSessions ?? 0) + 1;
    const mastery = calculateProficiency(newAvg, attempts, practiceSessions, config);

    topicStats[topic] = {
      attempts,
      avgScore: newAvg,
      lastScore: last,
      trend,
      mastery,
      practiceSessions,
      scoreWeightTotal,
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
  // 仅纳入「已评分」的题：grades 为 null（开放题评估失败/未作答、或用户未作答）的题不计入画像，
  // 避免把「没答/没评」误记为 0 分污染 topicStats / overallScore / 薄弱分析。
  const results: QuestionResult[] = session.questions
    .filter(({ question: q }) => grades[q.id] != null)
    .map(({ question: q,  format }) => {
      const g = grades[q.id]!;
      return {
        questionId: q.id,
        category: q.category,
        topic: q.topic,
        subtopic: q.subtopic ?? undefined,
        format,
        angle: q.angle ?? undefined,
        score: g.overall,
        correct: format === 'choice' ? (g.dimensions.correctness ?? 0) === 100 : undefined,
        // 选择题判定性打分，不知道用户漏了哪个知识点，故不产生 gaps；
        // gaps 仅来自开放题的 LLM 评估，避免把"答案不正确"当真实薄弱要点写进 Learner Memory。
        gaps: format === 'choice' ? [] : (g.gaps ?? []),
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

/**
 * 按掌握度升序取最薄弱的前 limit 个主题（仅统计练过的；达到掌握阈值的不推荐）。
 *
 * 为什么按「掌握度升序」而非「最近分数」：掌握度是长期信号、稳定可预测；最近分数波动大，
 * 用它会让推荐随单次表现剧烈跳动。排序次键用 lastSeen（越久没练的优先），避免推荐「刚练过」的题反复出现。
 */
export function recommendWeakTopics(profile: LearnerProfile, limit = 3, threshold = WEAK_AVG): string[] {
  return Object.entries(profile.topicStats)
    .filter(([, s]) => s.attempts > 0 && s.avgScore < threshold)
    .sort((a, b) => a[1].mastery - b[1].mastery || b[1].lastSeen - a[1].lastSeen)
    .slice(0, limit)
    .map(([topic]) => topic);
}

export interface CategoryCoverage {
  category: string;
  totalTopics: number;
  attempted: number;
  mastered: number;
  proficiency: number;
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
 * 单个 (topic, angle) 的薄弱等级（topic×angle 掌握度的原子查询，供确定性引擎选题用）：
 * - 0 = 未练过（最该被考察）；
 * - 1 = 已练但均分低于掌握线（薄弱）；
 * - 2 = 已掌握（不入弱项）。
 * 无画像或未标注角度 → 0（视为最弱，优先考察）。
 */
export function angleWeakRank(profile: LearnerProfile | undefined, topic: string, angle: QuestionAngle | undefined): 0 | 1 | 2 {
  if (!profile || !angle) return 0;
  const stat = getAngleStat(profile, topic, angle);
  if (!stat || stat.attempts === 0) return 0;
  if (stat.avgScore < WEAK_AVG) return 1;
  return 2;
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
      proficiency: refs.length === 0
        ? 0
        : Math.round(refs.reduce((sum, t) => sum + (profile.topicStats[t.topic]?.mastery ?? 0), 0) / refs.length * 100),
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

// ── 覆盖缺口（coverage discovery）────────────────────────────
// 与 recommendWeakTopics 的「掌握度排序」正交，两者职责不重叠：
//   recommendWeakTopics → 「已练了，但练得不好」（mastery 维度）
//   findCoverageGaps    → 「题库里有，但根本没练到 / 前置没打就上不去」（coverage 维度）
// 刻意不返回优先级分数、推荐题目或学习路径——那是 nextAdaptiveStep / Agent 的决策，
// 本函数只做事实查询，避免第 5 个「缺口计算」实现出现并互相不一致。

export type CoverageGapReason = 'uncovered' | 'prerequisite';

export interface CoverageGap {
  topic: string;
  reason: CoverageGapReason;
  /** reason === 'prerequisite' 时为未掌握的前置 topic（已过滤为题库中也存在的）。 */
  prerequisites?: string[];
}

export interface CoverageGapOptions {
  /** 掌握线（0-100），与 recommendWeakTopics / isMastered 同口径。 */
  threshold?: number;
  /** 最多返回条数；缺省不截断。 */
  limit?: number;
}

/** 单条缺口的自然语言描述（只读事实，不含建议）。 */
export function describeCoverageGap(gap: CoverageGap, profile: LearnerProfile): string {
  if (gap.reason === 'prerequisite') {
    const prereq = (gap.prerequisites ?? []).join('、');
    return isAttempted(profile, gap.topic)
      ? `前置 ${prereq} 尚未掌握`
      : `未练习，前置 ${prereq} 尚未掌握`;
  }
  return '未练习';
}

/**
 * 覆盖缺口：只遍历「题库中实际存在题目」的 topic，逐一判定两类缺口。
 *
 * - `prerequisite`：存在「题库中也有、且未达掌握线」的前置。
 *   **这一档优先于 uncovered**——基础没打就去练上层 topic 是无效投入，
 *   所以「Transformer 没练 + Attention 没练」报的是 Attention 这个根因，而不是 Transformer。
 * - `uncovered`：无任何作答证据（attempts === 0），且前置完备。
 *
 * 已掌握的 topic 直接跳过：它既非未覆盖，也不该再占缺口位。
 * 已练但未掌握、且前置完备的 topic **不算覆盖缺口**——那是薄弱项，归 recommendWeakTopics。
 * 前置列表只保留题库中也存在的 topic：用户无从练习的前置不是可闭合的学习缺口，
 * 那是题库内容问题（归 domain/coverage.ts 的题库生产视角），不是学习状态问题。
 */
export function findCoverageGaps(
  topicRefs: TopicRef[],
  profile: LearnerProfile,
  opts: CoverageGapOptions = {},
): CoverageGap[] {
  const threshold = opts.threshold ?? WEAK_AVG;
  const bankTopics = new Set(topicRefs.map((t) => t.topic));
  const gaps: CoverageGap[] = [];

  for (const { topic } of topicRefs) {
    if (isMastered(profile, topic, threshold)) continue;
    // 前置链可能很深，只取最近的 3 个——与 expandWithPrerequisites 的截断口径一致
    const missingPrereqs = prerequisiteClosure(topic)
      .filter((p) => bankTopics.has(p) && !isMastered(profile, p, threshold))
      .slice(0, 3);
    if (missingPrereqs.length > 0) {
      gaps.push({ topic, reason: 'prerequisite', prerequisites: missingPrereqs });
      continue;
    }
    if (!isAttempted(profile, topic)) {
      gaps.push({ topic, reason: 'uncovered' });
    }
  }

  // 前置缺口排在前（更根本、更可行动）；同档内按拓扑序（基础优先），保证结果稳定可测。
  gaps.sort(
    (a, b) =>
      (a.reason === 'prerequisite' ? 0 : 1) - (b.reason === 'prerequisite' ? 0 : 1) ||
      topoRankOf(a.topic) - topoRankOf(b.topic) ||
      a.topic.localeCompare(b.topic),
  );
  return opts.limit ? gaps.slice(0, opts.limit) : gaps;
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
    masteryThreshold?: number;
  } = {},
): InterviewDefinition {
  const recentTopics = new Set(
    profile.sessions
      .slice(0, RECENT_TOPIC_COOLDOWN_SESSIONS)
      .flatMap((session) => session.questionResults.map((result) => result.topic)),
  );
  const masteryThreshold = opts.masteryThreshold ?? WEAK_AVG;
  const weakTopics = recommendWeakTopics(profile, 3, masteryThreshold).filter((topic) => !recentTopics.has(topic));
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
    topicPriorities: expandWithPrerequisites(weakTopics, profile, masteryThreshold),
    mode: opts.mode ?? 'coach',
    adaptive: opts.adaptive,
  };
}

/** 生成训练建议文案（纯文本，Training Coach 首页/结果页展示）。 */
export function recommendationText(profile: LearnerProfile, masteryThreshold = WEAK_AVG): string {
  if (profile.totalSessions === 0) {
    return '完成一次训练后，我会根据你的表现生成个性化建议。';
  }
  const weak = recommendWeakTopics(profile, 3, masteryThreshold);
  if (weak.length === 0) {
    return `各主题均已达到掌握线（均分 ${masteryThreshold} 分及以上），继续保持；可以尝试更高难度或编程题。`;
  }
  const recentTopics = new Set(
    profile.sessions
      .slice(0, RECENT_TOPIC_COOLDOWN_SESSIONS)
      .flatMap((session) => session.questionResults.map((result) => result.topic)),
  );
  const activeWeak = weak.filter((topic) => !recentTopics.has(topic));
  if (activeWeak.length === 0) {
    const gaps = weak
      .flatMap((topic) => (profile.topicStats[topic]?.commonWeaknesses ?? []).slice(0, 2))
      .slice(0, 3);
    return `薄弱项仍低于掌握线（均分 ${masteryThreshold} 分），但刚刚练过 ${weak.join('、')}；下一轮先混合复习，暂不集中重复。${
      gaps.length > 0 ? `注意：${gaps.join('、')}。` : ''
    }`;
  }
  const lines = activeWeak.map((t) => {
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
