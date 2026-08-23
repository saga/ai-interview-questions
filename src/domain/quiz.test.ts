// 纯逻辑测试：抽题、形态分配与选择判分。无 LLM / 无网络。

import { describe, it, expect } from 'vitest';
import {
  availableFormats,
  emptyAnswer,
  isChoiceCorrect,
  MAX_OPEN_RATIO,
  pickQuestions,
  planComposition,
} from './quiz';
import type { ChoiceFormat, FormatId, OpenFormat, Question } from '../types';

const choiceFmt: ChoiceFormat = { type: 'single', options: ['a', 'b'], answer: [0] };
const openFmt: OpenFormat = { referenceAnswer: 'a' };

/** 仅选择题 */
function choiceQ(id: string): Question {
  return {
    id,
    category: 'machine-learning',
    topic: 'overfitting',
    tags: [],
    difficulty: 'easy',
    question: 'q',
    explanation: 'e',
    formats: { choice: choiceFmt },
  };
}

/** 仅开放题 */
function openQ(id: string): Question {
  return {
    id,
    category: 'llm',
    topic: 'rag',
    tags: [],
    difficulty: 'hard',
    question: 'q',
    explanation: 'e',
    formats: { open: openFmt },
  };
}

/** 双形态题（choice + open） */
function dualQ(id: string): Question {
  return { ...choiceQ(id), formats: { choice: choiceFmt, open: openFmt } };
}

function choices(n: number, start = 0): Question[] {
  return Array.from({ length: n }, (_, i) => choiceQ(`c${start + i}`));
}

function opens(n: number, start = 0): Question[] {
  return Array.from({ length: n }, (_, i) => openQ(`o${start + i}`));
}

describe('pickQuestions', () => {
  it('返回的题目都来自题池，且数量不超过 count', () => {
    const pool: Question[] = [choiceQ('x'), openQ('y'), choiceQ('z')];
    const r = pickQuestions(pool, 2);
    expect(r.length).toBe(2);
    for (const q of r) expect(pool).toContain(q);
  });

  it('count 超过题池大小时返回全部（不报错）', () => {
    expect(pickQuestions([choiceQ('x')], 5).length).toBe(1);
  });

  it('空题池返回空数组', () => {
    expect(pickQuestions([], 5)).toEqual([]);
  });
});

describe('availableFormats', () => {
  it('按题目实际携带的形态返回', () => {
    expect(availableFormats(choiceQ('x'))).toEqual(['choice']);
    expect(availableFormats(openQ('y'))).toEqual(['open']);
    expect(availableFormats(dualQ('z'))).toEqual(['choice', 'open']);
  });

  it('allowedFormats 过滤：空数组表示不限', () => {
    expect(availableFormats(dualQ('z'), ['open'])).toEqual(['open']);
    expect(availableFormats(choiceQ('x'), ['choice'])).toEqual(['choice']);
    expect(availableFormats(openQ('y'), [])).toEqual(['open']);
    expect(availableFormats(dualQ('w'), ['choice', 'open'])).toEqual(['choice', 'open']);
  });
});

describe('isChoiceCorrect', () => {
  it('集合相等、顺序无关即正确', () => {
    const cf: ChoiceFormat = { type: 'multiple', options: ['a', 'b', 'c'], answer: [0, 2] };
    expect(isChoiceCorrect(cf, [2, 0])).toBe(true);
  });

  it('多选少选/错选均为错误', () => {
    const cf: ChoiceFormat = { type: 'multiple', options: ['a', 'b', 'c'], answer: [0, 2] };
    expect(isChoiceCorrect(cf, [0])).toBe(false); // 少选
    expect(isChoiceCorrect(cf, [0, 1])).toBe(false); // 错选
  });

  it('空选择错误', () => {
    expect(isChoiceCorrect(choiceFmt, [])).toBe(false);
  });
});

describe('emptyAnswer', () => {
  it('选择形态初始为空数组', () => {
    expect(emptyAnswer({ question: choiceQ('x'), format: 'choice' })).toEqual([]);
  });

  it('开放形态初始为空字符串', () => {
    expect(emptyAnswer({ question: openQ('y'), format: 'open' })).toBe('');
  });
});

describe('planComposition（形态配额：开放 ≈ floor(count*0.3)，其余出选择）', () => {
  const rng = () => 0.5;

  it('双形态题池：开放形态不超过配额，其余均为选择', () => {
    const pool = [...Array.from({ length: 20 }, (_, i) => dualQ(`d${i}`))];
    const plan = planComposition(pool, 10, undefined, ['choice', 'open'], rng);
    expect(plan).toHaveLength(10);
    const opensN = plan.filter((sq) => sq.format === 'open').length;
    expect(opensN).toBe(Math.floor(10 * MAX_OPEN_RATIO));
    // 同一道题在计划里只出现一次
    const ids = plan.map((sq) => sq.question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('纯选择池：全部出选择，不做配比调整', () => {
    const pool = choices(14);
    const plan = planComposition(pool, 10, undefined, ['choice', 'open'], rng);
    expect(plan).toHaveLength(10);
    expect(plan.every((sq) => sq.format === 'choice')).toBe(true);
  });

  it('纯开放池：跳过配比，全部保持开放', () => {
    const pool = opens(5);
    const plan = planComposition(pool, 4, undefined, ['choice', 'open'], rng);
    expect(plan).toHaveLength(4);
    expect(plan.every((sq) => sq.format === 'open')).toBe(true);
  });

  it('只有 open 形态的题超额时：优先与池内未抽中的选择题换题，无题可换则裁剪', () => {
    // 池中 18 道纯开放 + 2 道纯选择，抽 10 道 → 开放超额；
    // 可换入的选择题只有 2 道，其余超额开放题被裁掉（新模型下不做 LLM 变换）。
    const pool = [...choices(2), ...opens(18)];
    const plan = planComposition(pool, 10, undefined, ['choice', 'open'], rng);
    const ids = plan.map((sq) => sq.question.id);
    expect(new Set(ids).size).toBe(ids.length); // 无重复
    expect(plan.length).toBeGreaterThanOrEqual(Math.floor(10 * MAX_OPEN_RATIO)); // 至少保留配额规模
    expect(plan.filter((sq) => sq.format === 'open').length).toBeLessThanOrEqual(
      Math.floor(10 * MAX_OPEN_RATIO),
    );
    // 换入的两道选择题确实来自池中原有的选择集
    expect(plan.filter((sq) => sq.format === 'choice').every((sq) => sq.question.id.startsWith('c'))).toBe(true);
  });

  it('allowedFormats 只允许 open 时全部出开放且不做配比', () => {
    const pool = [...choices(10), ...opens(10)];
    const plan = planComposition(pool, 6, undefined, ['open'], rng);
    expect(plan).toHaveLength(6);
    expect(plan.every((sq) => sq.format === 'open')).toBe(true);
  });

  it('allowedFormats 只允许 choice 时双形态题也只出选择', () => {
    const pool = Array.from({ length: 12 }, (_, i) => dualQ(`d${i}`));
    const plan = planComposition(pool, 8, undefined, ['choice'], rng);
    expect(plan).toHaveLength(8);
    expect(plan.every((sq) => sq.format === 'choice')).toBe(true);
  });

  it('主题优先级：priority 主题的题优先入选', () => {
    const pool = [...choices(20), ...opens(5)];
    pool.forEach((q, i) => (q.topic = i < 3 ? 'rag' : 'other'));
    const plan = planComposition(pool, 5, ['rag'], ['choice', 'open'], rng);
    expect(plan.filter((sq) => sq.question.topic === 'rag')).toHaveLength(3);
  });

  it('空题池返回空数组', () => {
    expect(planComposition([], 5, undefined, ['choice', 'open'], rng)).toEqual([]);
  });
});
