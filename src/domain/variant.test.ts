// 纯逻辑测试：LLM 变体候选校验与落地（ADR-036）。
// 安全模型：LLM 可重构 Presentation，但需通过 Knowledge Contract 校验。

import { describe, it, expect } from 'vitest';
import { applyVariant, validateVariant } from './variant';
import type { GeneratedVariant, Question } from '../types';

const cq: Question = {
  id: 'x',
  category: 'machine-learning',
  topic: 'regularization',
  tags: [],
  difficulty: 'medium',
  question: 'q',
  explanation: 'e',
  formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] } },
};

const oq: Question = {
  id: 'y',
  category: 'agentic-ai',
  topic: 'memory',
  tags: [],
  difficulty: 'medium',
  question: 'q',
  explanation: 'e',
  formats: { open: { referenceAnswer: 'REF-ANSWER' } },
};

function variant(partial: Partial<GeneratedVariant> = {}): GeneratedVariant {
  return {
    question: 'v',
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

  it('选择题：提供合法 options/answer → 通过', () => {
    expect(validateVariant(cq, variant({ options: ['x', 'y', 'z'], answer: [1] })).ok).toBe(true);
  });

  it('选择题：options 重复 → 拒绝', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'a', 'b'], answer: [0] })).ok).toBe(false);
  });

  it('选择题：answer 越界 → 拒绝', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'b'], answer: [5] })).ok).toBe(false);
  });

  it('选择题：单选题 answer 必须 1 项', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'b'], answer: [0, 1] })).ok).toBe(false);
  });

  it('含依赖原题指代 → 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '原题中的方案如何？' })).ok).toBe(false);
  });
});

describe('applyVariant', () => {
  it('选择题：无 options 时保留原选项与答案', () => {
    const r = applyVariant(cq, variant({ explanation: 'new-e' }));
    expect(r.question).toBe('v');
    expect(r.formats.choice?.options).toEqual(['a', 'b', 'c']);
    expect(r.formats.choice?.answer).toEqual([0]);
    expect(r.explanation).toBe('new-e');
    expect(r.aiGenerated).toBe(true);
  });

  it('选择题：提供 options/answer 时替换', () => {
    const r = applyVariant(cq, variant({ options: ['x', 'y', 'z', 'w'], answer: [2] }));
    expect(r.formats.choice?.options).toEqual(['x', 'y', 'z', 'w']);
    expect(r.formats.choice?.answer).toEqual([2]);
  });

  it('开放题：referenceAnswer 永远保留原题的值（LLM 不改写答案）', () => {
    const r = applyVariant(oq, variant());
    expect(r.formats.open?.referenceAnswer).toBe('REF-ANSWER');
    expect(r.question).toBe('v');
    expect(r.aiGenerated).toBe(true);
  });

  it('未提供解析时沿用原解析', () => {
    const r = applyVariant(cq, variant());
    expect(r.explanation).toBe('e');
  });
});
