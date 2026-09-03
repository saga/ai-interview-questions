// 纯逻辑：自适应选题（Adaptive Interview 的核心迁移决策）。
// 下一道题不是随机抽的，而是一次基于上一题表现的决策：
//   deep-dive  纵向深入——同主题同难度或更高难度继续追问
//   gap-probe  补弱探查——答得差时降难度 → 回到前置知识 → 同主题剩余题兜底
//   broaden    横向扩展——掌握良好时切换相关主题
//   move-on    移动到未覆盖方向
// 不依赖 React / LLM / 网络。

import type { Difficulty } from '../schemas/common';
import type { LearnerProfile } from '../schemas/learner';
import type { Question } from '../schemas/question';
import { pickQuestions } from './quiz';
import { prerequisiteClosure, relatedOf, topoRankOf } from './conceptGraph';
import { angleKey, angleWeakRank, recommendWeakTopics, WEAK_AVG } from './learner';

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
 * 画像缺失视为 0（= 最该被考察），实现"弱 concept → 缺证据 angle"。
 */
function angleEvidence(q: Question, profile: LearnerProfile | undefined): number {
  if (!profile) return 0;
  const stat = profile.angleCoverage?.[angleKey(q.topic, q.angle)];
  return stat ? stat.attempts : 0;
}

/**
 * 统一候选排序（P0-3）：Agent 的 searchQuestions 与确定性引擎 pickNextAdaptive 共用同一选题策略，
 * 避免两条路径各自实现一套 interviewer policy。排序键（值越小越优先，确定性）：
 *   1. 主题档位：薄弱主题（已练但均分 < WEAK_AVG）最前 → 未练过次之 → 已掌握最后；
 *   2. 档内序：薄弱主题按掌握度升序；未练/已掌握按知识点拓扑序（基础优先）；
 *   3. 角度薄弱度：angleWeakRank 升序（0=未练/最弱，最该被考察）；
 *   4. 证据量：(topic,angle) 累计作答次数升序（覆盖效率，避免总问同一类）；
 *   5. 难度：easy → hard（同权内先易后难，难度梯度留给 Agent 决策或策略子集过滤）；
 *   6. 题库稳定序兜底：完全可预测、可测试。
 * 可选 rng 只打散「前 5 键完全相同」的并列组，不改变排序语义——随机不再参与策略选择。
 */
export function rankCandidatePool(pool: Question[], profile?: LearnerProfile, rng?: () => number): Question[] {
  // 主题级排序键：weak → [0, mastery]；unattempted → [1, topoRank]；mastered → [2, topoRank]
  const topicKey = new Map<string, [number, number]>();
  for (const q of pool) {
    if (topicKey.has(q.topic)) continue;
    const s = profile?.topicStats[q.topic];
    const weak = Boolean(s && s.attempts > 0 && s.avgScore < WEAK_AVG);
    const tier = weak ? 0 : s && s.attempts > 0 ? 2 : 1;
    const order = weak ? s!.mastery : topoRankOf(q.topic);
    topicKey.set(q.topic, [tier, order]);
  }
  const keyOf = (q: Question, idx: number): number[] => {
    const [tier, order] = topicKey.get(q.topic) ?? [1, 0];
    return [tier, order, angleWeakRank(profile, q.topic, q.angle), angleEvidence(q, profile), DIFF_ORDER.indexOf(q.difficulty), idx];
  };
  const ranked = pool
    .map((q, idx) => ({ q, keys: keyOf(q, idx) }))
    .sort((a, b) => {
      for (let k = 0; k < a.keys.length; k++) {
        if (a.keys[k] !== b.keys[k]) return a.keys[k] - b.keys[k];
      }
      return 0;
    });
  if (rng) {
    // 并列（前 5 键完全相同）组内打散：确定性排序 + 并列随机，二者兼得
    const result: Question[] = [];
    let i = 0;
    while (i < ranked.length) {
      let j = i + 1;
      while (j < ranked.length && ranked[j].keys.slice(0, 5).every((v, k) => v === ranked[i].keys[k])) j++;
      result.push(...pickQuestions(ranked.slice(i, j).map((x) => x.q), j - i, rng));
      i = j;
    }
    return result;
  }
  return ranked.map((x) => x.q);
}

/**
 * 在候选集中以「弱角度优先、证据最少次之」选下一题——直接复用 {@link rankCandidatePool}
 * 的统一排序取第一题（并列组内由 rng 打散）。与 weakAnglesOf 同源，确保确定性引擎
 * 与 Agent 候选列表按同一 topic×angle 掌握度主干驱动。
 */
function pickByWeakAngle(pool: Question[], profile: LearnerProfile | undefined, rng: () => number): Question | null {
  if (pool.length === 0) return null;
  return rankCandidatePool(pool, profile, rng)[0] ?? null;
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
 * - 选题主干是 (topic, angle) 掌握度：用 weakAnglesOf 的同源原语 angleWeakRank 在每个策略子集内
 *   先做「弱角度优先、证据最少次之」的细选，把"弱 concept 缺证据 angle"的闭环落到确定性引擎
 *   （此前 weakAnglesOf 仅被 Agent 工具调用，确定性引擎只做证据计数）。提升覆盖效率，避免总问同一类。
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
      // 相关主题中同样按弱角度优先选题（主干一致）
      const q = pickByWeakAngle(relatedPool, profile, rng);
      if (q) return { question: q, strategy };
      break;
    }
    case 'gap-probe': {
      // 先降难度（同主题更简单的题），再沿前置闭包回退（近的前置优先）
      const easier = sameTopicPool
        .filter((q) => !difficultyAtLeast(q.difficulty, last.difficulty))
        .sort((a, b) => DIFF_ORDER.indexOf(a.difficulty) - DIFF_ORDER.indexOf(b.difficulty));
      // 同一降难度子集内，弱角度优先（而非单纯随机）
      const easierPick = pickByWeakAngle(easier, profile, rng);
      if (easierPick) return { question: easierPick, strategy: 'gap-probe' };

      const pres = prerequisiteClosure(last.topic);
      const preQ = pickFromTopics(pool, pres, rng);
      if (preQ) return { question: preQ, strategy: 'gap-probe' };

      // 前置也问不了 → 同主题任意剩余题兜底（仍按弱角度优先）
      const fallback = pickByWeakAngle(sameTopicPool, profile, rng);
      if (fallback) return { question: fallback, strategy: 'gap-probe' };
      break;
    }
    case 'deep-dive': {
      // 同主题同难度或更高难度优先（含等于：同难度不同角度仍有深挖价值）；
      // 该子集为空才交回 move-on 兜底；子集内弱角度优先
      const harder = sameTopicPool
        .filter((q) => difficultyAtLeast(q.difficulty, last.difficulty))
        .sort((a, b) => DIFF_ORDER.indexOf(b.difficulty) - DIFF_ORDER.indexOf(a.difficulty));
      const harderPick = pickByWeakAngle(harder, profile, rng);
      if (harderPick) return { question: harderPick, strategy: 'deep-dive' };
      break;
    }
    default:
      break;
  }

  // move-on 及一切策略的最终兜底：排除刚答的主题；先按 topic 级薄弱粗筛，再按弱角度为主干细选
  const rest = pool.filter((q) => q.topic !== (first ? '' : last.topic));
  const target = rest.length > 0 ? rest : pool;
  const weakTopics = profile ? recommendWeakTopics(profile, 5) : [];
  const weakPool = target.filter((q) => weakTopics.includes(q.topic));
  const pickPool = weakPool.length > 0 ? weakPool : target;
  // 弱角度优先 + 证据最少次之（topic×angle 掌握度作为选题主干，而非单纯证据计数）
  return { question: pickByWeakAngle(pickPool, profile, rng)!, strategy: 'move-on' };
}
