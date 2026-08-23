// 纯逻辑：自适应选题（Adaptive Interview 的核心迁移决策）。
// 下一道题不是随机抽的，而是一次基于上一题表现的决策：
//   deep-dive  纵向深入——同主题继续追问
//   gap-probe  补弱探查——答得差时降难度或回到前置知识
//   broaden    横向扩展——掌握良好时切换相关主题
//   move-on    移动到未覆盖方向
// 不依赖 React / LLM / 网络。

import type { Difficulty, LearnerProfile } from '../types';
import type { Question } from '../types';
import { pickPrioritized, pickQuestions } from './quiz';
import { prerequisitesOf, relatedOf, type ConceptGraph } from './conceptGraph';

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
 * 自适应选下一题：
 * @param pool 候选题池（调用方需已排除已问过的题）
 * @param signals 已答题的作答信号（按顺序）
 * @param profile 学习画像（可选，用于 move-on 时优先薄弱主题）
 * @param rng 可注入随机源（测试用）
 */
export function pickNextAdaptive(
  pool: Question[],
  signals: AnswerSignal[],
  graph: ConceptGraph,
  profile?: LearnerProfile,
  rng: () => number = Math.random,
): { question: Question; strategy: Strategy } | null {
  if (pool.length === 0) return null;

  const first = signals.length === 0;
  const last = signals[signals.length - 1];
  const sameTopicPool = first ? [] : pool.filter((q) => q.topic === last.topic);
  const relatedTopics = first ? [] : relatedOf(graph, last.topic);
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
      // 先降难度（同主题更简单的题），再退到未掌握的前置主题
      const easier = sameTopicPool
        .filter((q) => !difficultyAtLeast(q.difficulty, last.difficulty))
        .sort((a, b) => DIFF_ORDER.indexOf(a.difficulty) - DIFF_ORDER.indexOf(b.difficulty));
      if (easier[0]) return { question: easier[0], strategy: 'gap-probe' };

      const pres = prerequisitesOf(graph, last.topic);
      const preQ = pickFromTopics(pool, pres, rng);
      if (preQ) return { question: preQ, strategy: 'gap-probe' };

      // 前置也问不了 → 同主题任意剩余题兜底
      const fallback = pickQuestions(sameTopicPool, 1, rng)[0];
      if (fallback) return { question: fallback, strategy: 'gap-probe' };
      break;
    }
    case 'deep-dive': {
      // 同主题优先更高难度
      const harder = sameTopicPool
        .filter((q) => difficultyAtLeast(q.difficulty, last.difficulty))
        .sort((a, b) => DIFF_ORDER.indexOf(b.difficulty) - DIFF_ORDER.indexOf(a.difficulty));
      if (harder[0]) return { question: harder[0], strategy: 'deep-dive' };
      break;
    }
    default:
      break;
  }

  // move-on 及一切策略的最终兜底：排除刚答的主题，优先薄弱项
  const rest = pool.filter((q) => q.topic !== (first ? '' : last.topic));
  const target = rest.length > 0 ? rest : pool;
  const picked =
    profile && Object.keys(profile.topicStats).length > 0
      ? pickPrioritized(target, Object.keys(profile.topicStats), 1, rng)[0]
      : undefined;
  return { question: picked ?? pickQuestions(target, 1, rng)[0], strategy: 'move-on' };
}
