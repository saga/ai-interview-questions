// 纯逻辑测试：抽题与判断题辅助。无 LLM / 无网络。

import { describe, it, expect } from 'vitest';
import {
  emptyAnswer,
  isChoice,
  isChoiceCorrect,
  isOpen,
  MAX_OPEN_RATIO,
  pickQuestions,
  planComposition,
} from './quiz';
import type { ChoiceQuestion, OpenQuestion, Question } from '../types';

const choice: ChoiceQuestion = {
  id: 'x',
  category: 'machine-learning',
  topic: 'overfitting',
  tags: [],
  difficulty: 'easy',
  type: 'single',
  question: 'q',
  options: ['a', 'b'],
  answer: [0],
  explanation: 'e',
};

const open: OpenQuestion = {
  id: 'y',
  category: 'llm',
  topic: 'rag',
  tags: [],
  difficulty: 'hard',
  type: 'essay',
  question: 'q',
  referenceAnswer: 'a',
  explanation: 'e',
};

function choices(n: number, start = 0): Question[] {
  return Array.from({ length: n }, (_, i) => ({ ...choice, id: `c${start + i}` }));
}

function opens(n: number, start = 0): Question[] {
  return Array.from({ length: n }, (_, i) => ({ ...open, id: `o${start + i}` }));
}

describe('pickQuestions', () => {
  it('返回的题目都来自题池，且数量不超过 count', () => {
    const pool: Question[] = [choice, open, { ...choice, id: 'z' }];
    const r = pickQuestions(pool, 2);
    expect(r.length).toBe(2);
    for (const q of r) expect(pool).toContain(q);
  });

  it('count 超过题池大小时返回全部（不报错）', () => {
    expect(pickQuestions([choice], 5).length).toBe(1);
  });

  it('空题池返回空数组', () => {
    expect(pickQuestions([], 5)).toEqual([]);
  });
});

describe('isChoiceCorrect', () => {
  it('集合相等、顺序无关即正确', () => {
    const c: ChoiceQuestion = { ...choice, type: 'multiple', answer: [0, 2], options: ['a', 'b', 'c'] };
    expect(isChoiceCorrect(c, [2, 0])).toBe(true);
  });

  it('多选少选/错选均为错误', () => {
    const c: ChoiceQuestion = { ...choice, type: 'multiple', answer: [0, 2], options: ['a', 'b', 'c'] };
    expect(isChoiceCorrect(c, [0])).toBe(false); // 少选
    expect(isChoiceCorrect(c, [0, 1])).toBe(false); // 错选
  });

  it('空选择错误', () => {
    expect(isChoiceCorrect(choice, [])).toBe(false);
  });
});

describe('emptyAnswer', () => {
  it('选择题初始为空数组', () => {
    expect(emptyAnswer(choice)).toEqual([]);
  });

  it('开放题初始为空字符串', () => {
    expect(emptyAnswer(open)).toBe('');
  });
});

describe('type guards', () => {
  it('isChoice 只认单选/多选', () => {
    expect(isChoice(choice)).toBe(true);
    expect(isChoice(open)).toBe(false);
  });

  it('isOpen 只认问答/编程', () => {
    expect(isOpen(open)).toBe(true);
    expect(isOpen(choice)).toBe(false);
  });
});

describe('planComposition（题型配比 7:3 + 题型变换规划）', () => {
  const rng = () => 0.5;

  it('开放题超额时用候选池的选择题原位替换，总数不变', () => {
    const pool = [...choices(14), ...opens(6)];
    const { picked, transforms } = planComposition(pool, 10, undefined, rng);
    expect(picked).toHaveLength(10);
    expect(transforms).toHaveLength(0);
    expect(picked.filter(isOpen).length).toBeLessThanOrEqual(Math.floor(10 * MAX_OPEN_RATIO));
  });

  it('候选池无选择题时超额开放题标记为变换（allowTransform）而非裁掉', () => {
    const pool = [...choices(2), ...opens(18)];
    const allow = planComposition(pool, 10, undefined, rng, true);
    expect(allow.picked).toHaveLength(10);
    expect(allow.transforms.length).toBeGreaterThan(0);
    expect(allow.transforms.every((t) => t.target === 'single' && isOpen(t.question))).toBe(true);

    const strict = planComposition(pool, 10, undefined, rng, false);
    expect(strict.transforms).toHaveLength(0); // 纯本地：裁掉超额开放题
    expect(strict.picked.filter(isOpen).length).toBeLessThanOrEqual(Math.floor(10 * MAX_OPEN_RATIO));
  });

  it('缺额开放题优先换入候选池的开放题', () => {
    // 抽中集几乎全选择题、候选池有富余开放题的场景
    const pickedShape = [...choices(9), ...opens(1)];
    const reserveOpens = opens(6, 50);
    const pool = [...pickedShape, ...reserveOpens];
    const { picked, transforms } = planComposition(pool, 10, undefined, () => 0.999);
    expect(transforms).toHaveLength(0);
    expect(picked.filter(isOpen).length).toBe(Math.floor(10 * MAX_OPEN_RATIO));
  });

  it('缺额且候选池无开放题时标记选择→essay 变换（allowTransform）', () => {
    const pool = [...choices(20), ...opens(1)]; // 开放题稀缺
    const { picked, transforms } = planComposition(pool, 10, undefined, rng, true);
    expect(picked).toHaveLength(10);
    expect(transforms.every((t) => t.target === 'essay' && isChoice(t.question))).toBe(true);
    expect(transforms.length + picked.filter(isOpen).length).toBe(Math.floor(10 * MAX_OPEN_RATIO));
  });

  it('整个题池只有一种题型时跳过配比', () => {
    const pool = opens(5);
    const { picked, transforms } = planComposition(pool, 4, undefined, rng, true);
    expect(picked).toHaveLength(4);
    expect(transforms).toHaveLength(0);
  });

  it('空题池返回空计划', () => {
    expect(planComposition([], 5, undefined, rng)).toEqual({ picked: [], transforms: [] });
  });
});
