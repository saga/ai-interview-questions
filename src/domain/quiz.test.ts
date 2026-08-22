// 纯逻辑测试：抽题与判断题辅助。无 LLM / 无网络。

import { describe, it, expect } from 'vitest';
import { emptyAnswer, isChoice, isChoiceCorrect, isOpen, pickQuestions } from './quiz';
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
