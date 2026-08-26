// 纯逻辑：自适应选题（Adaptive Interview 的核心迁移决策）。
// 下一道题不是随机抽的，而是一次基于上一题表现的决策：
//   deep-dive  纵向深入——同主题继续追问
//   gap-probe  补弱探查——答得差时降难度或回到前置知识
//   broaden    横向扩展——掌握良好时切换相关主题
//   move-on    移动到未覆盖方向
// 不依赖 React / LLM / 网络。

import type { ConceptAttemptSignal, ConceptRef, ConceptStats, Difficulty, LearnerProfile, Question, QuestionTest } from '../types';
import { pickQuestions } from './quiz';
import { prerequisiteClosure, relatedOf } from './conceptGraph';
import { angleKey, recommendWeakTopics } from './learner';
import { buildConceptStats, getConceptStatus, rankConcepts } from './coverage';

export type Strategy = 'deep-dive' | 'gap-probe' | 'broaden' | 'move-on';

export const STRATEGY_LABELS: Record<Strategy, string> = {
  'deep-dive': '纵向深挖',
  'gap-probe': '薄弱补查',
  broaden: '横向扩展',
  'move-on': '新方向',
};

/** 单题作答信号：主题 + 得分 + 难度。 */
export interface AnswerSignal {
  topic: string;
  score: number;
  difficulty: Difficulty;
}

const STRONG = 80;
const WEAK = 60;

/**
 * 由上一题的表现决定下一步策略。
 * - 答得好且有相关主题可问 → broaden；否则同主题还有题 → deep-dive；
 * - 答得差 → gap-probe（回退前置/降低难度）；
 * - 中等 → 同主题有题则 deep-dive，否则 move-on。
 */
export function decideStrategy(
  last: AnswerSignal,
  ctx: { sameTopicAvailable: boolean; relatedAvailable: boolean },
): Strategy {
  if (last.score < WEAK) return ctx.sameTopicAvailable ? 'gap-probe' : 'move-on';
  if (last.score >= STRONG && ctx.relatedAvailable) return 'broaden';
  return ctx.sameTopicAvailable ? 'deep-dive' : 'move-on';
}

const DIFF_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

function difficultyAtLeast(a: Difficulty, b: Difficulty): boolean {
  return DIFF_ORDER.indexOf(a) >= DIFF_ORDER.indexOf(b);
}

function pickFromTopics(pool: Question[], topics: string[], rng: () => number): Question | null {
  const set = new Set(topics);
  const candidates = pool.filter((q) => set.has(q.topic));
  return pickQuestions(candidates, 1, rng)[0] ?? null;
}

/**
 * (topic, angle) 的累计作答次数——即"该概念该角度"的证据量。
 * 未标注角度或画像缺失视为 0（= 最该被考察），实现"弱 concept → 缺证据 angle"。
 */
function angleEvidence(q: Question, profile: LearnerProfile | undefined): number {
  if (!profile || !q.angle) return 0;
  const stat = profile.angleCoverage?.[angleKey(q.topic, q.angle)];
  return stat ? stat.attempts : 0;
}

/** 在候选集中优先选 (topic, angle) 证据最少的题（证据相同则随机）。 */
function pickLeastCovered(pool: Question[], profile: LearnerProfile | undefined, rng: () => number): Question | null {
  if (pool.length === 0) return null;
  const evs = pool.map((q) => angleEvidence(q, profile));
  const min = Math.min(...evs);
  const least = pool.filter((_, i) => evs[i] === min);
  return pickQuestions(least, 1, rng)[0] ?? null;
}

// ── 概念优先抽题（Concept-coverage，PR1–PR4）──
// 先在知识节点概念面里选出 "最该验证的 concept"，再找探测该 concept 的题；
// 无对应概念题时回退到原有 topic/angle 自适应逻辑。四策略（deep-dive/gap-probe/
// broaden/move-on）保留，作用对象从 topic 升级为 concept。

/** 已作答题目（带 tests 与得分），用于派生概念统计。 */
export interface AnsweredConceptSignal {
  id: string;
  tests?: QuestionTest[];
  score: number;
}

/** 概念优先抽题所需的上下文：当前知识节点的概念面 + 已作答题目。 */
export interface ConceptSelectionContext {
  face: ConceptRef[];
  answered: AnsweredConceptSignal[];
}

/** 选下一步最该验证的概念：按 conceptPriority 降序取首。 */
export function selectNextConcept(
  face: ConceptRef[],
  stats: Record<string, ConceptStats>,
): ConceptRef | null {
  if (face.length === 0) return null;
  return rankConcepts(face, stats)[0] ?? null;
}

/** 在候选池里找探测某 concept 的题：优先 primary，其次任意角色；未作答由调用方已排除。 */
export function findQuestionForConcept(
  conceptId: string,
  pool: Question[],
  rng: () => number,
): Question | null {
  const candidates = pool.filter((q) => (q.tests ?? []).some((t) => t.concept === conceptId));
  if (candidates.length === 0) return null;
  const primary = candidates.filter((q) => (q.tests ?? []).some((t) => t.concept === conceptId && t.role === 'primary'));
  const chosen = primary.length > 0 ? primary : candidates;
  return pickQuestions(chosen, 1, rng)[0] ?? null;
}

/** 概念优先抽题的结果：question 为 null 且 probeConceptId 存在时表示「该概念无题库题，需探针」。 */
export interface ConceptPick {
  question: Question | null;
  strategy: Strategy;
  selectedConcept?: string;
  /** 概念被选中但其无对应题库题 → 调用方应据其生成临时探针题（PR6 Dynamic Probe）。 */
  probeConceptId?: string;
}

/** 自适应选下一题的结果；probeConceptId 存在表示概念优先路径需要生成探针（question 为 null）。 */
export interface AdaptivePick {
  question: Question | null;
  strategy: Strategy;
  selectedConcept?: string;
  probeConceptId?: string;
}

/** 概念优先抽题：返回概念优先结果；找不到概念题时按 allowProbe 决定「回退」或「发探针信号」。 */
export function pickNextConceptAware(
  pool: Question[],
  signals: AnswerSignal[],
  ctx: ConceptSelectionContext,
  profile: LearnerProfile | undefined,
  rng: () => number,
  allowProbe = false,
): ConceptPick | null {
  const asked = new Set(ctx.answered.map((a) => a.id));
  const poolUnasked = pool.filter((q) => !asked.has(q.id));
  if (poolUnasked.length === 0) return null;

  const stats = buildConceptStats(
    ctx.answered.flatMap((a) =>
      (a.tests ?? []).map((t): ConceptAttemptSignal => ({ concept: t.concept, score: a.score })),
    ),
  );
  const target = selectNextConcept(ctx.face, stats);
  if (!target) return pickNextAdaptive(poolUnasked, signals, profile, rng);

  const q = findQuestionForConcept(target.id, poolUnasked, rng);
  if (!q) {
    // 概念被选中但无题库题：开 AI 时发探针信号（交由引擎生成临时题），否则回退原 topic/angle 逻辑
    if (allowProbe) return { question: null, strategy: 'move-on', selectedConcept: target.id, probeConceptId: target.id };
    return pickNextAdaptive(poolUnasked, signals, profile, rng);
  }

  // unseen → 新方向(move-on)；已测但未掌握 → 补弱(gap-probe)
  const strategy: Strategy = getConceptStatus(stats[target.id]) === 'unseen' ? 'move-on' : 'gap-probe';
  return { question: q, strategy, selectedConcept: target.id };
}

/**
 * 自适应选下一题：
 * @param pool 候选题池（调用方需已排除已问过的题）
 * @param signals 已答题的作答信号（按顺序）
 * @param profile 学习画像（可选，用于 move-on 时优先薄弱主题）
 * @param rng 可注入随机源（测试用）
 * @param conceptCtx 可选的概念优先上下文；提供且能选出概念题时走 Concept-coverage 路径，否则回退原逻辑。
 * @param allowProbe 是否允许「概念无题库题时发探针信号」（需上层有 LLM）；false 时回退到原自适应逻辑（向后兼容）。
 */
export function pickNextAdaptive(
  pool: Question[],
  signals: AnswerSignal[],
  profile?: LearnerProfile,
  rng: () => number = Math.random,
  conceptCtx?: ConceptSelectionContext,
  allowProbe = false,
): AdaptivePick | null {
  // 概念优先：若提供概念面且能选出概念题，则走概念优先路径（否则回退原有逻辑）
  if (conceptCtx && conceptCtx.face.length > 0) {
    const conceptPick = pickNextConceptAware(pool, signals, conceptCtx, profile, rng, allowProbe);
    if (conceptPick) {
      if (conceptPick.probeConceptId) {
        return {
          question: null,
          strategy: conceptPick.strategy,
          selectedConcept: conceptPick.selectedConcept,
          probeConceptId: conceptPick.probeConceptId,
        };
      }
      return {
        question: conceptPick.question,
        strategy: conceptPick.strategy,
        selectedConcept: conceptPick.selectedConcept,
      };
    }
  }
  if (pool.length === 0) return null;

  const first = signals.length === 0;
  const last = signals[signals.length - 1];
  const sameTopicPool = first ? [] : pool.filter((q) => q.topic === last.topic);
  const relatedTopics = first ? [] : relatedOf(last.topic);
  const relatedPool = first ? [] : pool.filter((q) => relatedTopics.includes(q.topic));

  const strategy = first
    ? 'move-on'
    : decideStrategy(last, {
        sameTopicAvailable: sameTopicPool.length > 0,
        relatedAvailable: relatedPool.length > 0,
      });

  switch (strategy) {
    case 'broaden': {
      const q = pickFromTopics(pool, relatedTopics, rng);
      if (q) return { question: q, strategy };
      break;
    }
    case 'gap-probe': {
      // 先降难度（同主题更简单的题），再沿前置闭包回退（近的前置优先）
      const easier = sameTopicPool
        .filter((q) => !difficultyAtLeast(q.difficulty, last.difficulty))
        .sort((a, b) => DIFF_ORDER.indexOf(a.difficulty) - DIFF_ORDER.indexOf(b.difficulty));
      if (easier[0]) return { question: pickLeastCovered(easier, profile, rng)!, strategy: 'gap-probe' };

      const pres = prerequisiteClosure(last.topic);
      const preQ = pickFromTopics(pool, pres, rng);
      if (preQ) return { question: preQ, strategy: 'gap-probe' };

      // 前置也问不了 → 同主题任意剩余题兜底（仍优先缺证据角度）
      const fallback = pickLeastCovered(sameTopicPool, profile, rng);
      if (fallback) return { question: fallback, strategy: 'gap-probe' };
      break;
    }
    case 'deep-dive': {
      // 同主题更高难度优先；没有更难题则交回 move-on 兜底
      const harder = sameTopicPool
        .filter((q) => difficultyAtLeast(q.difficulty, last.difficulty))
        .sort((a, b) => DIFF_ORDER.indexOf(b.difficulty) - DIFF_ORDER.indexOf(a.difficulty));
      if (harder[0]) return { question: pickLeastCovered(harder, profile, rng)!, strategy: 'deep-dive' };
      break;
    }
    default:
      break;
  }

  // move-on 及一切策略的最终兜底：排除刚答的主题，优先薄弱项，且按 (topic,angle) 证据升序挑最缺考察的
  const rest = pool.filter((q) => q.topic !== (first ? '' : last.topic));
  const target = rest.length > 0 ? rest : pool;
  const weakTopics = profile ? recommendWeakTopics(profile, 5) : [];
  const scored = target.map((q) => ({
    q,
    // 弱 concept 加权（减分 = 更优先），再叠加 (topic,angle) 证据量——证据越少越该被问
    ev: angleEvidence(q, profile) + (weakTopics.includes(q.topic) ? -0.6 : 0),
  }));
  const minEv = Math.min(...scored.map((s) => s.ev));
  const least = scored.filter((s) => s.ev === minEv).map((s) => s.q);
  return { question: pickQuestions(least, 1, rng)[0], strategy: 'move-on' };
}
