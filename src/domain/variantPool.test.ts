// 变体池解析测试：getAvailableVariants / selectVariant / resolveQuestionVariant / isVariantStale。

import { describe, expect, it } from 'vitest';
import type { Question } from '../schemas/question';
import type { VariantPool, QuestionVariant } from '../schemas/variant';
import { computeVariantSourceHash, variantSourceOf } from '../schemas/variant';
import { getAvailableVariants, selectVariant, resolveQuestionVariant, isVariantStale } from './variantPool';

function choiceQuestion(id: string): Question {
  return {
    id,
    category: 'agentic-ai',
    topic: 'tools',
    tags: [],
    difficulty: 'easy',
    angle: 'definition',
    question: `原题 ${id}`,
    explanation: '',
    formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [0] } },
  };
}

function variant(id: string, kind: QuestionVariant['kind'] = 'surface-options'): QuestionVariant {
  const q = choiceQuestion(id.replace(/__.*$/, '') || 'q');
  return {
    id,
    kind,
    question: `变体题干 ${id}`,
    options: ['改写a', '改写b', '改写c', '改写d'],
    generatedAt: 1700000000000,
    generator: 'offline',
    promptVersion: 'v3',
    sourceHash: computeVariantSourceHash(variantSourceOf(q)),
  };
}

const pool: VariantPool = {
  version: 1,
  generatedAt: 1700000000000,
  promptVersion: 'v3',
  variants: {
    q1: [variant('q1__surface-options__0'), variant('q1__surface-options__1')],
    q2: [variant('q2__context-options__0')],
  },
};

describe('getAvailableVariants', () => {
  it('返回题的所有变体，未命中返回空数组', () => {
    expect(getAvailableVariants(pool, 'q1')).toHaveLength(2);
    expect(getAvailableVariants(pool, 'nope')).toEqual([]);
  });
});

describe('selectVariant', () => {
  it('空候选返回 null', () => {
    expect(selectVariant([])).toBeNull();
  });

  it('默认不重复选已见变体；全部已见则允许复用', () => {
    const seen = new Set<string>(['q1__surface-options__0', 'q1__surface-options__1']);
    const v = selectVariant(getAvailableVariants(pool, 'q1'), seen, () => 0);
    // 全部已见 → 复用（取排序后首个，rng=0 偏向原序）
    expect(v).not.toBeNull();
  });

  it('未见过时确定性挑选（Fisher–Yates：rng=0.999 保持原序取首个，rng=0 全反转取末位）', () => {
    const first = selectVariant(getAvailableVariants(pool, 'q1'), new Set(), () => 0.999);
    expect(first?.id).toBe('q1__surface-options__0');
    const last = selectVariant(getAvailableVariants(pool, 'q1'), new Set(), () => 0);
    expect(last?.id).toBe('q1__surface-options__1');
  });

  it('相同 rng 多次调用结果一致（确定性）', () => {
    const a = selectVariant(getAvailableVariants(pool, 'q1'), new Set(), () => 0.42);
    const b = selectVariant(getAvailableVariants(pool, 'q1'), new Set(), () => 0.42);
    expect(a?.id).toBe(b?.id);
  });
});

describe('resolveQuestionVariant (Pool-first)', () => {
  it('池命中返回选中变体', () => {
    const chosen = resolveQuestionVariant({ canonical: choiceQuestion('q1'), pool });
    expect(chosen).not.toBeNull();
    expect(chosen?.id.startsWith('q1__')).toBe(true);
  });

  it('池未命中（无此题）返回 null', () => {
    expect(resolveQuestionVariant({ canonical: choiceQuestion('nope'), pool })).toBeNull();
  });

  it('pool 为 null 时返回 null（退化为无资产）', () => {
    expect(resolveQuestionVariant({ canonical: choiceQuestion('q1'), pool: null })).toBeNull();
  });
});

describe('isVariantStale', () => {
  it('canonical 未变 → 非 stale', () => {
    const v = variant('q1__surface-options__0');
    expect(isVariantStale(v, choiceQuestion('q1'))).toBe(false);
  });

  it('canonical 题干已改 → stale', () => {
    const v = variant('q1__surface-options__0');
    const changed = { ...choiceQuestion('q1'), question: '题干已被改写过' };
    expect(isVariantStale(v, changed)).toBe(true);
  });

  // P1-4 回归：sourceHash 只覆盖题面时，canonical 只改元数据而题面不动，
  // 变体会被判成「未 stale」，但它继承来的 angle / difficulty / tags 已经和新 canonical 不一致。
  it.each([
    ['angle', { angle: 'tradeoff' }],
    ['difficulty', { difficulty: 'hard' }],
    ['topic', { topic: 'memory' }],
    ['tags', { tags: ['kv-cache'] }],
  ] as const)('canonical 仅元数据（%s）已改 → stale', (_label, patch) => {
    const v = variant('q1__surface-options__0');
    const changed = { ...choiceQuestion('q1'), ...patch } as Question;
    expect(isVariantStale(v, changed)).toBe(true);
  });
});
