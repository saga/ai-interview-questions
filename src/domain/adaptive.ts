// 纯逻辑：自适应选题（Adaptive Interview 的核心迁移决策）。
// 下一道题不是随机抽的，而是一次基于上一题表现的决策：
//   deep-dive  纵向深入——同主题继续追问
//   gap-probe  补弱探查——答得差时降难度或回到前置知识
//   broaden    横向扩展——掌握良好时切换相关主题
//   move-on    移动到未覆盖方向
// 不依赖 React / LLM / 网络。

import type { Difficulty, LearnerProfile, Question } from '../types';
import { pickQuestions } from './quiz';
import { prerequisiteClosure, relatedOf } from './conceptGraph';
import { angleKey, recommendWeakTopics } from './learner';

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

/** 自适应选下一题的结果。question 为 null 表示题池耗尽（调用方据此结束会话）。 */
export interface AdaptivePick {
  question: Question | null;
  strategy: Strategy;
}

/**
 * 自适应选下一题：
 * @param pool 候选题池（调用方需已排除已问过的题）
 * @param signals 已答题的作答信号（按顺序）
 * @param profile 学习画像（可选，用于 move-on 时优先薄弱主题）
 * @param rng 可注入随机源（测试用）
 *
 * 设计权衡（trade-off）：
 * - 覆盖维度统一为 (topic, angle)——两者在题库中均为 100% 覆盖，无需额外标注即可索引，
 *   避免引入需要人工维护、且判定主观的概念标签层。
 * - 最终兜底采用「证据最少优先」(angleEvidence 升序)：越没练过的 (topic,angle) 越先被问，
 *   复用 Learner 的探针语义，避免机械按难度顺序导致「总在问同一类」，提升覆盖效率。
 * - 策略不是「越难越好」：答得好才 broaden、答得差才 gap-probe，刻意避免「越答越难」的挫败感设计。
 */
export function pickNextAdaptive(
  pool: Question[],
  signals: AnswerSignal[],
  profile?: LearnerProfile,
  rng: () => number = Math.random,
): AdaptivePick | null {
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
