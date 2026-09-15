// 变体资产契约测试：VariantKind / QuestionVariant / VariantPool schema + sourceHash 纯函数。

import { describe, expect, it } from 'vitest';
import {
  computeVariantSourceHash,
  variantSourceOf,
  questionVariantSchema,
  variantPoolSchema,
  variantModeOf,
  EMPTY_VARIANT_POOL,
} from './variant';

/** 测试用例的最小 canonical 输入（含 P1-4 起必须入指纹的元数据）。 */
const src = (patch: Partial<Parameters<typeof computeVariantSourceHash>[0]> = {}) =>
  computeVariantSourceHash({
    id: 'q-1',
    topic: 'inference-optimization',
    subtopic: 'kv-cache',
    angle: 'mechanism',
    difficulty: 'medium',
    tags: ['kv-cache', 'prefill'],
    question: '为什么 KV Cache 能降低 prefill 成本？',
    options: ['因为它缓存了键和值', '因为它增加了 batch size'],
    ...patch,
  });

describe('computeVariantSourceHash', () => {
  it('对相同内容产出稳定、确定性的指纹', () => {
    expect(src()).toBe(src());
    expect(src()).toMatch(/^fnv1a-[0-9a-f]{8}$/);
  });

  it('内容差异（含选项顺序 / 题干改写）导致不同指纹', () => {
    const base = src();
    const reordered = src({ options: ['因为它增加了 batch size', '因为它缓存了键和值'] });
    const rewritten = src({ question: '为什么 KV Cache 能降低 decode 成本？' });
    expect(reordered).not.toBe(base);
    expect(rewritten).not.toBe(base);
  });

  it('开放题（无 options）与选择题（有 options）指纹不同', () => {
    expect(src({ options: undefined })).not.toBe(src());
  });

  it('仅空白差异不影响指纹（规范化）', () => {
    const a = src({ question: '  Redis 是什么？ ', options: [' 缓存 ', '数据库'] });
    const b = src({ question: 'Redis 是什么？', options: ['缓存', '数据库'] });
    expect(a).toBe(b);
  });

  // ── P1-4：元数据必须入指纹，否则 canonical 改了 angle / 难度后变体不会 stale ──
  it.each([
    ['topic', { topic: 'training-optimization' }],
    ['subtopic', { subtopic: 'paged-attention' }],
    ['angle', { angle: 'tradeoff' }],
    ['difficulty', { difficulty: 'hard' }],
    ['tags', { tags: ['kv-cache'] }],
    // ADR-077：cognitiveTask 是 assessment contract 第四维，必须入指纹
    ['cognitiveTask', { cognitiveTask: 'diagnose' }],
  ] as const)('元数据 %s 变更 → 指纹变化（变体判 stale）', (_label, patch) => {
    expect(src(patch)).not.toBe(src());
  });

  // ── ADR-077：cognitiveTask 条件入指纹 ──
  // 存量题无该字段 → 指纹必须与历史完全一致（否则 234 条存量变体会被全量误判 stale）；
  // 一旦声明，其值变化即代表 assessment contract 变化 → 必须判 stale。
  it('cognitiveTask 未声明 / 为空串 → 指纹与历史一致（存量变体不误判 stale）', () => {
    const legacy = {
      id: 'q-1',
      topic: 't',
      angle: 'mechanism',
      difficulty: 'medium',
      question: 'Q?',
      options: ['a'],
    };
    expect(computeVariantSourceHash(legacy)).toBe(computeVariantSourceHash({ ...legacy, cognitiveTask: '' }));
    expect(computeVariantSourceHash(legacy)).toBe(computeVariantSourceHash({ ...legacy, cognitiveTask: '   ' }));
  });

  it('cognitiveTask 声明后变更 → 指纹变化（contract 变化必须判 stale）', () => {
    expect(src({ cognitiveTask: 'diagnose' })).not.toBe(src({ cognitiveTask: 'infer' }));
  });

  it('tag 顺序变化不影响指纹（顺序无语义，重排不算漂移）', () => {
    expect(src({ tags: ['prefill', 'kv-cache'] })).toBe(src({ tags: ['kv-cache', 'prefill'] }));
  });

  it('tag 重复去重后等价（避免无意义漂移）', () => {
    expect(src({ tags: ['kv-cache', 'kv-cache', 'prefill'] })).toBe(src({ tags: ['kv-cache', 'prefill'] }));
  });
});

describe('variantSourceOf', () => {
  it('从 canonical 取出全部入指纹字段（含元数据）', () => {
    const q = {
      id: 'q-9',
      category: 'inference',
      topic: 'inference-optimization',
      subtopic: 'kv-cache',
      tags: ['kv-cache'],
      difficulty: 'medium' as const,
      angle: 'mechanism' as const,
      cognitiveTask: 'explain' as const,
      question: 'Q?',
      explanation: 'E',
      formats: { choice: { type: 'single' as const, options: ['a', 'b', 'c', 'd'], answer: [0] } },
    };
    expect(variantSourceOf(q)).toEqual({
      id: 'q-9',
      topic: 'inference-optimization',
      subtopic: 'kv-cache',
      angle: 'mechanism',
      difficulty: 'medium',
      cognitiveTask: 'explain',
      tags: ['kv-cache'],
      question: 'Q?',
      options: ['a', 'b', 'c', 'd'],
    });
  });

  it('与手拼字段结果一致（唯一取源口不得与手拼分叉）', () => {
    const q = {
      id: 'q-9',
      category: 'inference',
      topic: 't',
      tags: ['x'],
      difficulty: 'easy' as const,
      angle: 'definition' as const,
      question: 'Q?',
      explanation: 'E',
      formats: { open: { referenceAnswer: 'R' } },
    };
    expect(computeVariantSourceHash(variantSourceOf(q))).toBe(
      computeVariantSourceHash({ id: 'q-9', topic: 't', angle: 'definition', difficulty: 'easy', tags: ['x'], question: 'Q?' }),
    );
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

  // ADR-081：判定键是 mode 而不是 generator——offline+presentation 合法，runtime+assessment 非法。
  const presentationBase = { id: 'q-1__surface__0', kind: 'surface', mode: 'presentation' as const, question: 'x', generatedAt: 1, generator: 'runtime' as const, promptVersion: 'v3', sourceHash: 'h' };

  it('presentation 变体声明 angle / cognitiveTask / assessment 一律拒绝（无论 generator）', () => {
    expect(questionVariantSchema.safeParse({ ...presentationBase, angle: 'mechanism' }).success).toBe(false);
    expect(questionVariantSchema.safeParse({ ...presentationBase, cognitiveTask: 'diagnose' }).success).toBe(false);
    expect(questionVariantSchema.safeParse({ ...presentationBase, assessment: { target: 't', reasoningGoal: 'g' } }).success).toBe(false);
    // offline + presentation 同样拒绝：判定键是 mode。
    expect(questionVariantSchema.safeParse({ ...presentationBase, generator: 'offline' as const, angle: 'mechanism' }).success).toBe(false);
  });

  it('presentation 无测量面可以通过（offline / runtime 均可）', () => {
    expect(questionVariantSchema.safeParse(presentationBase).success).toBe(true);
    expect(questionVariantSchema.safeParse({ ...presentationBase, generator: 'offline' as const }).success).toBe(true);
  });

  it('assessment 变体允许声明测量面（offline）', () => {
    const v = {
      ...presentationBase,
      mode: 'assessment' as const,
      generator: 'offline' as const,
      angle: 'mechanism',
      cognitiveTask: 'diagnose',
      assessment: { target: 't', reasoningGoal: 'g' },
    };
    expect(questionVariantSchema.safeParse(v).success).toBe(true);
  });

  it('mode 缺省时回退为 assessment（兼容历史 offline assets）', () => {
    const legacy = {
      id: 'q-1__surface-options__0',
      kind: 'surface-options',
      question: '改写后的题干',
      options: ['选项A', '选项B'],
      angle: 'mechanism',
      generatedAt: 1700000000000,
      generator: 'offline',
      promptVersion: 'v3',
      sourceHash: 'fnv1a-abcdef01',
    };
    const parsed = questionVariantSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.mode).toBe('assessment');
  });

  it('variantModeOf：显式 mode 优先；缺省时 legacy 回退（runtime→presentation，offline→assessment）', () => {
    expect(variantModeOf({ mode: 'presentation', generator: 'offline' })).toBe('presentation');
    expect(variantModeOf({ mode: 'assessment', generator: 'runtime' })).toBe('assessment');
    expect(variantModeOf({ generator: 'runtime' })).toBe('presentation');
    expect(variantModeOf({ generator: 'offline' })).toBe('assessment');
  });

  it('provenance 字段可选：batch / model / contentHash / sourceSnapshot（审计专用）', () => {
    const v = {
      id: 'q-1__surface-options__0',
      kind: 'surface-options',
      question: '改写后的题干',
      options: ['选项A', '选项B'],
      generatedAt: 1700000000000,
      generator: 'offline',
      promptVersion: 'v1',
      sourceHash: 'fnv1a-abcdef01',
      batch: 'ids-abc123',
      model: 'deepseek/deepseek-chat',
      contentHash: 'fnv1a-00000001',
      sourceSnapshot: {
        id: 'q-1',
        topic: 'kv-cache',
        angle: 'mechanism',
        difficulty: 'medium',
        question: '原题干',
        options: ['选项A', '选项B'],
      },
    };
    const parsed = questionVariantSchema.safeParse(v);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.batch).toBe('ids-abc123');
      expect(parsed.data.sourceSnapshot?.topic).toBe('kv-cache');
    }
  });

  it('存量变体（无 provenance）仍合法（向后兼容）', () => {
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
