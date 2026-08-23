// 纯逻辑：抽题与选择题判分。不依赖 React、不依赖任何 LLM/网络。

import type { AnswerValue, ChoiceQuestion, OpenQuestion, Question } from '../types';

/** 开放题（essay/coding）占比上限：单选/多选为主的训练体验，
 *  问答/编程题数量不超过总题量的三成（约 7:3；想收紧到 8:2 改 0.2 即可）。 */
export const MAX_OPEN_RATIO = 0.3;

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从题池中随机抽取 count 道（Fisher–Yates 洗牌；rng 可注入便于测试）。 */
export function pickQuestions(pool: Question[], count: number, rng: () => number = Math.random): Question[] {
  return shuffle(pool, rng).slice(0, Math.min(count, pool.length));
}

export function isChoice(q: Question): q is ChoiceQuestion {
  return q.type === 'single' || q.type === 'multiple';
}

export function isOpen(q: Question): q is OpenQuestion {
  return q.type === 'essay' || q.type === 'coding';
}

/** 选择题是否正确：选中集合与正确答案集合完全一致（顺序无关）。 */
export function isChoiceCorrect(q: ChoiceQuestion, selected: number[]): boolean {
  const a = [...q.answer].sort((x, y) => x - y).join(',');
  const s = [...selected].sort((x, y) => x - y).join(',');
  return a === s;
}

export function emptyAnswer(q: Question): AnswerValue {
  return isChoice(q) ? [] : '';
}

/**
 * 按主题优先级抽题（Training Coach 用）：先把 priority 主题的题抽满，再用剩余题补齐。
 * 保证薄弱主题（如 'tool-calling'）优先进入本次训练，其余主题作为补充。
 */
export function pickPrioritized(
  pool: Question[],
  priorities: string[],
  count: number,
  rng: () => number = Math.random,
): Question[] {
  const pri = priorities.filter(Boolean);
  if (pri.length === 0) return pickQuestions(pool, count, rng);
  const weak = pool.filter((q) => pri.includes(q.topic));
  const rest = pool.filter((q) => !pri.includes(q.topic));
  const pickedWeak = pickQuestions(weak, Math.min(count, weak.length), rng);
  const remaining = count - pickedWeak.length;
  const pickedRest = remaining > 0 ? pickQuestions(rest, remaining, rng) : [];
  return [...pickedWeak, ...pickedRest];
}

/** 开放题变换为选择题时，多选形态的占比（其余为单选；参考答案句数不足时自动回退单选）。 */
export const MULTIPLE_TRANSFORM_SHARE = 0.35;

/** 待 LLM 题型变换的题目（同一题换一种形态出现，id 保持原题）。 */
export interface PendingTransform {
  question: Question;
  /** 目标题型：开放→'single'/'multiple'，选择→'essay' */
  target: 'single' | 'multiple' | 'essay';
}

export interface CompositionPlan {
  picked: Question[];
  /** 配额无法用换题满足时，交给 LLM 做题型变换的槽位（useAI 关闭时为空） */
  transforms: PendingTransform[];
}

/**
 * 组卷规划：抽题 + 题型配比（单选/多选为主，开放题 ≈ floor(count*MAX_OPEN_RATIO)）。
 * - 超额/缺额优先与候选池中未抽中的题**原位交换**（从尾部动，保住前部薄弱主题优先题）；
 * - 候选池没有所需题型时：
 *   - allowTransform=true → 记为 PendingTransform，由引擎交给 LLM 变换形态（总数不变）；
 *   - allowTransform=false → 超额部分直接裁掉（缺额不补），保持纯本地行为。
 * - 整个题池只有一种题型时跳过配比（显式单题型训练不受影响）。
 */
export function planComposition(
  pool: Question[],
  count: number,
  priorities: string[] | undefined,
  rng: () => number = Math.random,
  allowTransform = false,
): CompositionPlan {
  const rawPicked =
    priorities && priorities.length > 0 ? pickPrioritized(pool, priorities, count, rng) : pickQuestions(pool, count, rng);
  if (rawPicked.length === 0) return { picked: [], transforms: [] };
  // 题池本身只有一种题型（或用户显式过滤成单题型）：配比无意义
  const poolHasChoice = pool.some(isChoice);
  const poolHasOpen = pool.some(isOpen);
  if (!(poolHasChoice && poolHasOpen)) return { picked: rawPicked, transforms: [] };

  const maxOpen = Math.max(0, Math.floor(count * MAX_OPEN_RATIO));
  const pickedIds = new Set(rawPicked.map((q) => q.id));
  const spareChoices = shuffle(pool.filter((q) => isChoice(q) && !pickedIds.has(q.id)), rng);
  const spareOpens = shuffle(pool.filter((q) => isOpen(q) && !pickedIds.has(q.id)), rng);

  const result = [...rawPicked];
  let openCount = result.filter(isOpen).length;
  const transforms: PendingTransform[] = [];

  // 超额开放题：尾部向前，先换选择题，无题可换则标记变换（单/多选按占比随机）或裁掉
  for (let i = result.length - 1; i >= 0 && openCount > maxOpen; i--) {
    if (!isOpen(result[i])) continue;
    if (spareChoices.length > 0) {
      result[i] = spareChoices.pop() as Question;
    } else if (allowTransform) {
      transforms.push({ question: result[i], target: rng() < MULTIPLE_TRANSFORM_SHARE ? 'multiple' : 'single' });
    } else {
      result.splice(i, 1);
    }
    openCount--;
  }

  // 缺额开放题：尾部向前的选择题换成候选池的开放题；无题可换则标记变换
  for (let i = result.length - 1; i >= 0 && openCount < maxOpen; i--) {
    if (!isChoice(result[i])) continue;
    if (spareOpens.length > 0) {
      result[i] = spareOpens.pop() as Question;
      openCount++;
    } else if (allowTransform && !transforms.some((t) => t.question === result[i])) {
      transforms.push({ question: result[i], target: 'essay' });
      openCount++;
    } else {
      break;
    }
  }

  return { picked: result, transforms };
}
