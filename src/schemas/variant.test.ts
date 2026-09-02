// 变体资产契约测试：VariantKind / QuestionVariant / VariantPool schema + sourceHash 纯函数。

import { describe, expect, it } from 'vitest';
import {
  computeVariantSourceHash,
  questionVariantSchema,
  variantPoolSchema,
  EMPTY_VARIANT_POOL,
} from './variant';

describe('computeVariantSourceHash', () => {
  it('对相同内容产出稳定、确定性的指纹', () => {
    const a = computeVariantSourceHash({
      id: 'q-1',
      question: '为什么 KV Cache 能降低 prefill 成本？',
      options: ['因为它缓存了键和值', '因为它增加了 batch size'],
    });
    const b = computeVariantSourceHash({
      id: 'q-1',
      question: '为什么 KV Cache 能降低 prefill 成本？',
      options: ['因为它缓存了键和值', '因为它增加了 batch size'],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^fnv1a-[0-9a-f]{8}$/);
  });

  it('内容差异（含选项顺序 / 题干改写）导致不同指纹', () => {
    const base = computeVariantSourceHash({ id: 'q-1', question: 'A', options: ['x', 'y'] });
    const reordered = computeVariantSourceHash({ id: 'q-1', question: 'A', options: ['y', 'x'] });
    const rewritten = computeVariantSourceHash({ id: 'q-1', question: 'B', options: ['x', 'y'] });
    expect(reordered).not.toBe(base);
    expect(rewritten).not.toBe(base);
  });

  it('开放题（无 options）与选择题（有 options）指纹不同', () => {
    const open = computeVariantSourceHash({ id: 'q-2', question: '解释一下注意力机制' });
    const choice = computeVariantSourceHash({ id: 'q-2', question: '解释一下注意力机制', options: ['a', 'b'] });
    expect(open).not.toBe(choice);
  });

  it('仅大小写/空白差异不影响指纹（规范化）', () => {
    const a = computeVariantSourceHash({ id: 'q-3', question: '  Redis 是什么？ ', options: [' 缓存 ', '数据库'] });
    const b = computeVariantSourceHash({ id: 'q-3', question: 'Redis 是什么？', options: ['缓存', '数据库'] });
    expect(a).toBe(b);
  });
});

describe('questionVariantSchema', () => {
  it('接受合法的变体', () => {
    const v = {
      id: 'q-1__surface-options__0',
      kind: 'surface-options',
      question: '改写后的题干',
      options: ['选项A', '选项B'],
      generatedAt: 1700000000000,
      generator: 'offline',
      promptVersion: 'v3',
      sourceHash: 'fnv1a-abcdef01',
    };
    expect(questionVariantSchema.safeParse(v).success).toBe(true);
  });

  it('开放题变体允许缺省 options', () => {
    const v = {
      id: 'q-2__surface__0',
      kind: 'surface',
      question: '改写后的开放题干',
      generatedAt: 1700000000000,
      generator: 'runtime',
      promptVersion: 'v3',
      sourceHash: 'fnv1a-12345678',
    };
    expect(questionVariantSchema.safeParse(v).success).toBe(true);
  });

  it('拒绝非法 kind / 空字段', () => {
    expect(questionVariantSchema.safeParse({ id: '', kind: 'surface', question: 'x', generatedAt: 1, generator: 'offline', promptVersion: 'v3', sourceHash: 'h' }).success).toBe(false);
    expect(questionVariantSchema.safeParse({ id: 'q', kind: 'bogus', question: 'x', generatedAt: 1, generator: 'offline', promptVersion: 'v3', sourceHash: 'h' }).success).toBe(false);
  });
});

describe('variantPoolSchema', () => {
  it('接受合法池', () => {
    const pool = {
      version: 1,
      generatedAt: 1700000000000,
      promptVersion: 'v3',
      variants: {
        'q-1': [{ id: 'q-1__surface-options__0', kind: 'surface-options', question: 'Q', options: ['a', 'b'], generatedAt: 1, generator: 'offline', promptVersion: 'v3', sourceHash: 'h' }],
      },
    };
    expect(variantPoolSchema.safeParse(pool).success).toBe(true);
  });

  it('EMPTY_VARIANT_POOL 自洽', () => {
    expect(variantPoolSchema.safeParse(EMPTY_VARIANT_POOL).success).toBe(true);
  });
});
