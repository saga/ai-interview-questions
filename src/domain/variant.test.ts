// 纯逻辑测试：LLM 变体候选校验与落地（ADR-036）。
// 安全模型：LLM 可重构 Presentation，但需通过 Knowledge Contract 校验。

import { describe, it, expect } from 'vitest';
import { applyVariant, validateVariant } from './variant';
import type { GeneratedVariant } from '../types';
import type { Question } from '../schemas/question';

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
  // 默认题干需包含 canonical topic 的证据，避免保守 concept 检查误伤
  return {
    question: 'regularization memory 相关变体题干',
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

  it('含新增 forbidden 指代（题目中/题干中/前文/下文）→ 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '题目中提到的方案如何？' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '前文中提到的方案' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '下文所述方案' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '题干中的条件' })).ok).toBe(false);
  });

  it('完全丢失 topic/tags/required 证据 → 拒绝（保守漂移检查）', () => {
    // cq topic regularization，required 含 L1/L2，使用完全无关的 CNN/BatchNorm 文本
    expect(
      validateVariant(cq, variant({ question: '在 CNN 训练中 batch size 很小时，BatchNorm 为什么不稳定？', options: undefined, answer: undefined })).ok,
    ).toBe(false);
  });

  it('保留任一证据（topic 或 required token）→ 通过', () => {
    // 包含 L2 即命中 required token
    expect(validateVariant(cq, variant({ question: 'L2 正则化在什么场景下优于 L1？' })).ok).toBe(true);
    // 包含 topic 本身
    expect(validateVariant(cq, variant({ question: 'regularization 的本质是什么？' })).ok).toBe(true);
  });

  it('fuzzball 兜底：拼写/形态差异仍视为证据（regularisation ↔ regularization）', () => {
    const cqEn: Question = { ...cq, topic: 'regularisation', tags: [] };
    // 精确 token 不命中（regularisation ≠ regularization），但 fuzz token_set 93 ≥75
    expect(validateVariant(cqEn, variant({ question: 'regularization 的本质是什么？' })).ok).toBe(true);
    // 完全漂移仍应拒绝
    expect(validateVariant(cqEn, variant({ question: 'CNN 卷积核大小如何选择？' })).ok).toBe(false);
  });

  it('fuzzball 兜底：短语级 token_set 对长文本有效（batch statistics ↔ statistics across batch）', () => {
    const q: Question = {
      id: 't',
      category: 'tmp',
      topic: 'layer-normalization',
      tags: ['batch statistics'],
      difficulty: 'medium',
      question: 'q',
      explanation: 'e',
      formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] } },
    };
    // 包含 token_set 100 的短语
    expect(validateVariant(q, variant({ question: 'LayerNorm does not rely on statistics computed across the batch' })).ok).toBe(true);
  });
});

describe('applyVariant', () => {
  it('选择题：无 options 时保留原选项与答案', () => {
    const r = applyVariant(cq, variant({ question: 'regularization 变体', explanation: 'new-e' }));
    expect(r.question).toBe('regularization 变体');
    expect(r.formats.choice?.options).toEqual(['a', 'b', 'c']);
    expect(r.formats.choice?.answer).toEqual([0]);
    expect(r.explanation).toBe('new-e');
    expect(r.aiGenerated).toBe(true);
  });

  it('选择题：提供 options/answer 时替换', () => {
    const r = applyVariant(cq, variant({ question: 'regularization 变体', options: ['x', 'y', 'z', 'w'], answer: [2] }));
    expect(r.formats.choice?.options).toEqual(['x', 'y', 'z', 'w']);
    expect(r.formats.choice?.answer).toEqual([2]);
  });

  it('开放题：referenceAnswer 永远保留原题的值（LLM 不改写答案）', () => {
    const r = applyVariant(oq, variant({ question: 'memory 相关变体' }));
    expect(r.formats.open?.referenceAnswer).toBe('REF-ANSWER');
    expect(r.question).toBe('memory 相关变体');
    expect(r.aiGenerated).toBe(true);
  });

  it('未提供解析时沿用原解析', () => {
    const r = applyVariant(cq, variant());
    expect(r.explanation).toBe('e');
  });
});
