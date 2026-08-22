import type { AnswerValue, ChoiceQuestion, Question } from '../types';

/** 从题库中随机抽取 count 道题，可按类别过滤。 */
export function pickQuestions(
  bank: Question[],
  count: number,
  categories?: string[],
): Question[] {
  let pool = bank;
  if (categories && categories.length > 0) {
    pool = bank.filter((q) => categories.includes(q.category));
  }
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** 选择题是否正确：选中集合与正确答案集合完全一致。 */
export function isChoiceCorrect(q: ChoiceQuestion, selected: number[]): boolean {
  const a = [...q.answer].sort((x, y) => x - y).join(',');
  const s = [...selected].sort((x, y) => x - y).join(',');
  return a === s;
}

export function emptyAnswer(q: Question): AnswerValue {
  return q.type === 'essay' ? '' : [];
}
