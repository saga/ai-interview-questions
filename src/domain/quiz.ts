// 纯逻辑：抽题与选择题判分。不依赖 React、不依赖任何 LLM/网络。

import type { AnswerValue, ChoiceQuestion, OpenQuestion, Question } from '../types';

/** 从题池中随机抽取 count 道（Fisher–Yates 洗牌）。 */
export function pickQuestions(pool: Question[], count: number): Question[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
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
export function pickPrioritized(pool: Question[], priorities: string[], count: number): Question[] {
  const pri = priorities.filter(Boolean);
  if (pri.length === 0) return pickQuestions(pool, count);
  const weak = pool.filter((q) => pri.includes(q.topic));
  const rest = pool.filter((q) => !pri.includes(q.topic));
  const pickedWeak = pickQuestions(weak, Math.min(count, weak.length));
  const remaining = count - pickedWeak.length;
  const pickedRest = remaining > 0 ? pickQuestions(rest, remaining) : [];
  return [...pickedWeak, ...pickedRest];
}
