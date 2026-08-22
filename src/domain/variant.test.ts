// 纯逻辑测试：LLM 变体校验与落地。核心不变量——答案 key 必须来自原题，校验失败则不用变体。

import { describe, it, expect } from 'vitest';
import { applyVariant, validateVariant } from './variant';
import type { ChoiceQuestion, GeneratedVariant, OpenQuestion } from '../types';

const cq: ChoiceQuestion = {
  id: 'x',
  category: 'machine-learning',
  topic: 'regularization',
  tags: [],
  difficulty: 'medium',
  type: 'single',
  question: 'q',
  options: ['a', 'b', 'c'],
  answer: [0],
  explanation: 'e',
};

const oq: OpenQuestion = {
  id: 'y',
  category: 'agentic-ai',
  topic: 'memory',
  tags: [],
  difficulty: 'medium',
  type: 'essay',
  question: 'q',
  referenceAnswer: 'REF-ANSWER',
  explanation: 'e',
};

function variant(partial: Partial<GeneratedVariant> = {}): GeneratedVariant {
  return {
    question: 'v',
    answer: [],
    sourceQuestionId: 'x',
    generatedBy: { provider: 'openai', model: 'm' },
    ...partial,
  };
}

describe('validateVariant', () => {
  it('选择题：选项数量一致且索引在界内 → 通过', () => {
    const v = variant({ options: ['b', 'a', 'c'], answer: [1] });
    expect(validateVariant(cq, v).ok).toBe(true);
  });

  it('选择题：选项数量与原题不一致 → 拒绝', () => {
    const v = variant({ options: ['a', 'b'], answer: [0] });
    const r = validateVariant(cq, v);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('选项数量不符');
  });

  it('选择题：答案索引越界 → 拒绝', () => {
    const v = variant({ options: ['a', 'b', 'c'], answer: [5] });
    expect(validateVariant(cq, v).ok).toBe(false);
  });

  it('选择题：缺少答案 → 拒绝', () => {
    const v = variant({ options: ['a', 'b', 'c'], answer: [] });
    expect(validateVariant(cq, v).ok).toBe(false);
  });

  it('开放题：题干非空即通过（无答案 key 可校验）', () => {
    const v = variant({ sourceQuestionId: 'y' });
    expect(validateVariant(oq, v).ok).toBe(true);
  });

  it('题干为空 → 拒绝', () => {
    const v = variant({ question: '   ' });
    expect(validateVariant(oq, v).ok).toBe(false);
  });
});

describe('applyVariant', () => {
  it('开放题：referenceAnswer 永远保留原题的值（LLM 不改写答案）', () => {
    const v = variant({ sourceQuestionId: 'y' });
    const r = applyVariant(oq, v) as OpenQuestion;
    expect(r.referenceAnswer).toBe('REF-ANSWER');
    expect(r.question).toBe('v');
    expect(r.aiGenerated).toBe(true);
  });

  it('选择题：题干/选项/答案被替换，并标记 aiGenerated', () => {
    const v = variant({ options: ['b', 'a', 'c'], answer: [1], explanation: 'new-e' });
    const r = applyVariant(cq, v) as ChoiceQuestion;
    expect(r.question).toBe('v');
    expect(r.options).toEqual(['b', 'a', 'c']);
    expect(r.answer).toEqual([1]);
    expect(r.explanation).toBe('new-e');
    expect(r.aiGenerated).toBe(true);
  });
});
