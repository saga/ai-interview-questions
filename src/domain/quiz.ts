// 纯逻辑：抽题与形态分配、选择题判分。不依赖 React、不依赖任何 LLM/网络。
// ADR-027：Question 是知识对象（可同时携带 choice/open 两种形态），
// 组卷 = 抽题 + 为每道题分配本次呈现形态；同一道题本次出选择、下次可出开放。

import type { AnswerValue, ChoiceFormat, FormatId, Question, SessionQuestion } from '../types';

/** 开放形态占比上限：单选/多选为主的训练体验，
 *  开放题数量不超过总题量的三成（约 7:3；想收紧到 8:2 改 0.2 即可）。 */
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

/** 题目的可用形态；allowedFormats 为空数组表示不限。 */
export function availableFormats(q: Question, allowedFormats?: FormatId[]): FormatId[] {
  const f: FormatId[] = [];
  if (q.formats.choice && (!allowedFormats || allowedFormats.length === 0 || allowedFormats.includes('choice'))) {
    f.push('choice');
  }
  if (q.formats.open && (!allowedFormats || allowedFormats.length === 0 || allowedFormats.includes('open'))) {
    f.push('open');
  }
  return f;
}

/** 选择题是否正确：选中集合与正确答案集合完全一致（顺序无关）。 */
export function isChoiceCorrect(cf: ChoiceFormat, selected: number[]): boolean {
  const a = [...cf.answer].sort((x, y) => x - y).join(',');
  const s = [...selected].sort((x, y) => x - y).join(',');
  return a === s;
}

/** 会话实例的空白作答：选择形态存空数组，开放形态存空串。 */
export function emptyAnswer(sq: SessionQuestion): AnswerValue {
  return sq.format === 'choice' ? [] : '';
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

/**
 * 组卷规划：抽题 + 形态配额（开放形态 ≈ floor(count*MAX_OPEN_RATIO)，其余出选择）。
 * - 先按主题优先级/随机抽出题目；
 * - 每道题按其可用形态 ∩ def.formats 分配本次形态：默认优先 choice，再由配额把尾部翻转为 open；
 *   只有 open 形态的题保持 open——超额时优先与候选池未抽中的双形态题原位换题，无题可换则裁掉；
 * - 整个候选池只有一种可用形态时跳过配比。
 */
export function planComposition(
  pool: Question[],
  count: number,
  priorities: string[] | undefined,
  allowedFormats: FormatId[],
  rng: () => number = Math.random,
): SessionQuestion[] {
  const rawPicked =
    priorities && priorities.length > 0 ? pickPrioritized(pool, priorities, count, rng) : pickQuestions(pool, count, rng);
  if (rawPicked.length === 0) return [];

  // 初始分配：能出选择就出选择
  const result: SessionQuestion[] = rawPicked.map((question) => ({
    question,
    format: availableFormats(question, allowedFormats).includes('choice') ? 'choice' : 'open',
  }));
  // 候选池里存在两种可用形态才有配比意义（或存在可翻转的双形态题）
  const canChoice = pool.some((q) => availableFormats(q, allowedFormats).includes('choice'));
  const canOpen = pool.some((q) => availableFormats(q, allowedFormats).includes('open'));
  if (!(canChoice && canOpen)) return result;

  const maxOpen = Math.max(0, Math.floor(count * MAX_OPEN_RATIO));
  const pickedIds = new Set(rawPicked.map((q) => q.id));
  let openCount = result.filter((sq) => sq.format === 'open').length;

  // 超额开放形态：尾部向前，先把双形态题翻回 choice，无题可翻则与池中未抽中的双形态题原位交换，再不行裁掉
  for (let i = result.length - 1; i >= 0 && openCount > maxOpen; i--) {
    const sq = result[i];
    if (sq.format !== 'open') continue;
    const formats = availableFormats(sq.question, allowedFormats);
    if (formats.includes('choice')) {
      sq.format = 'choice';
    } else {
      const spare = pool.find((q) => !pickedIds.has(q.id) && availableFormats(q, allowedFormats).includes('choice'));
      if (spare) {
        pickedIds.add(spare.id);
        result[i] = { question: spare, format: 'choice' };
      } else {
        result.splice(i, 1);
      }
    }
    openCount--;
  }

  // 缺额开放形态：尾部向前的双形态题翻转为 open，凑到配额即止
  for (let i = result.length - 1; i >= 0 && openCount < maxOpen; i--) {
    const sq = result[i];
    if (sq.format !== 'choice') continue;
    if (availableFormats(sq.question, allowedFormats).includes('open')) {
      sq.format = 'open';
      openCount++;
    }
  }

  return result;
}
