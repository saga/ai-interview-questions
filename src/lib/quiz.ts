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

/** 选择题是否正确：选中集合与正确答案集合完全一致。 */
export function isChoiceCorrect(q: ChoiceQuestion, selected: number[]): boolean {
  const a = [...q.answer].sort((x, y) => x - y).join(',');
  const s = [...selected].sort((x, y) => x - y).join(',');
  return a === s;
}

export function emptyAnswer(q: Question): AnswerValue {
  return isChoice(q) ? [] : '';
}
