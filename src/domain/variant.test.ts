// 纯逻辑测试：LLM 变体校验与落地。
// 安全模型（ADR-019）：LLM 只改题干/解析；options、answer、referenceAnswer 永远来自原题。

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
    sourceQuestionId: 'x',
    generatedBy: { provider: 'openai', model: 'm' },
    ...partial,
  };
}

describe('validateVariant', () => {
  it('题干非空 → 通过', () => {
    expect(validateVariant(cq, variant()).ok).toBe(true);
  });

  it('题干为空 → 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '   ' })).ok).toBe(false);
  });
});

describe('applyVariant', () => {
  it('选择题：只换题干/解析，options 与 answer 原样保留（答案 key 来自原题）', () => {
    const r = applyVariant(cq, variant({ explanation: 'new-e' })) as ChoiceQuestion;
    expect(r.question).toBe('v');
    expect(r.options).toEqual(['a', 'b', 'c']);
    expect(r.answer).toEqual([0]);
    expect(r.explanation).toBe('new-e');
    expect(r.aiGenerated).toBe(true);
  });

  it('开放题：referenceAnswer 永远保留原题的值（LLM 不改写答案）', () => {
    const r = applyVariant(oq, variant({ sourceQuestionId: 'y' })) as OpenQuestion;
    expect(r.referenceAnswer).toBe('REF-ANSWER');
    expect(r.question).toBe('v');
    expect(r.aiGenerated).toBe(true);
  });

  it('未提供解析时沿用原解析', () => {
    const r = applyVariant(cq, variant()) as ChoiceQuestion;
    expect(r.explanation).toBe('e');
  });
});
