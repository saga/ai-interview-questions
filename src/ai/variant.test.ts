// 变体生成测试（轻量变体边界）：本模块是**纯 LLM 适配器**——一次调用 + 解析，不做校验。
// 校验（结构/语义/长度泄题）统一由 domain/variant.validateVariant 在 finalizeQuestion 中执行，
// 相关用例见 src/domain/variant.test.ts；这里只验证「LLM → GeneratedVariant」这一段契约。

import { describe, expect, it, vi } from 'vitest';
import { generateVariant } from './variant';
import type { CompleteFn } from '../types';
import type { Question } from '../schemas/question';

const BASE: Question = {
  id: 'q1',
  category: 'machine-learning',
  topic: 'regularization',
  tags: [],
  difficulty: 'medium',
  question: '什么是 L2 正则化？',
  explanation: 'L2 在损失中加入权重平方惩罚。',
  formats: { choice: { type: 'single', options: ['A', 'B', 'C', 'D'], answer: [0] } },
};

describe('generateVariant（轻量变体）', () => {
  it('生成题干和选项变体，但不生成 answer', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({
        question: '新的 L2 正则化问题',
        options: ['选项 A', '选项 B', '选项 C', '选项 D'],
      }),
    );
    const out = await generateVariant(BASE, complete);
    expect(out.question).toBe('新的 L2 正则化问题');
    expect(out.options).toEqual(['选项 A', '选项 B', '选项 C', '选项 D']);
    // GeneratedVariant 契约只含 question / options；answer / explanation 不进入产物（由程序从 canonical 取）。
    expect(out).toEqual({
      question: '新的 L2 正则化问题',
      options: ['选项 A', '选项 B', '选项 C', '选项 D'],
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('开放题只生成 question', async () => {
    const openQ: Question = { ...BASE, formats: { open: { referenceAnswer: 'REF' } } };
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({ question: 'L2 正则化的开放题新问法' }),
    );
    const out = await generateVariant(openQ, complete, 'open');
    expect(out.question).toBe('L2 正则化的开放题新问法');
    expect(out.options).toBeUndefined();
    expect(out).toEqual({ question: 'L2 正则化的开放题新问法' });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('不做校验：漂移的题干也原样返回（校验职责在 finalizeQuestion）', async () => {
    // 第五轮起 generateVariant 是纯适配器——它不判断漂移、不判断缺 options、不判断长度泄题。
    // 这些一律交给 finalizeQuestion 里的 validateVariant，避免同一个候选被校验两次。
    const complete = vi.fn(async () => '{"question":"完全漂移的题目","options":["a","b","c","d"]}');
    const out = await generateVariant(BASE, complete);
    expect(out.question).toBe('完全漂移的题目');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('不做校验：选择题缺 options 也原样返回（由 validateVariant 拒绝）', async () => {
    const complete = vi.fn(async () => '{"question":"L2 正则化的新问法"}');
    const out = await generateVariant(BASE, complete, 'choice');
    expect(out.question).toBe('L2 正则化的新问法');
    expect(out.options).toBeUndefined();
    // 绝不因为「不合格」而再次请求 LLM——重试会翻倍延迟，且校验在下游统一处理
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('LLM 调用本身失败 → 直接抛出（由 finalizeQuestion 回退原题）', async () => {
    const complete = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(generateVariant(BASE, complete)).rejects.toThrow(/network down/);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('开放题不做长度泄题检查（该检查只对 choice 有意义）', async () => {
    const openQ: Question = { ...BASE, formats: { open: { referenceAnswer: 'REF' } } };
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({ question: 'L2 正则化的开放题新问法' }),
    );
    const out = await generateVariant(openQ, complete, 'open');
    expect(out.options).toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('LLM 输出的 answer 被丢弃（产物只含 question/options）', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({
        question: 'L2 正则化的新问法',
        options: ['A', 'B', 'C', 'D'],
        answer: [3],
      }),
    );
    const out = await generateVariant(BASE, complete);
    // 即使模型回吐 answer，toGeneratedVariant 也只保留 question/options。
    expect(out).toEqual({ question: 'L2 正则化的新问法', options: ['A', 'B', 'C', 'D'] });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('LLM 输出的 explanation 被丢弃（产物只含 question/options）', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({
        question: 'L2 正则化的另一种问法',
        options: ['A', 'B', 'C', 'D'],
        explanation: '模型自作主张写的解析',
      }),
    );
    const out = await generateVariant(BASE, complete, 'choice');
    expect(out).toEqual({ question: 'L2 正则化的另一种问法', options: ['A', 'B', 'C', 'D'] });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('用户提示词不携带答案/解析（安全边界）', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({ question: 'L2 正则化的新变体', options: ['A', 'B', 'C', 'D'] }),
    );
    await generateVariant(BASE, complete, 'choice');
    const [, user] = (complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(user).toContain('requiredConcepts');
    expect(user).toContain('options');
    expect(user).not.toContain('"answer"');
    expect(user).not.toContain('"explanation"');
    expect(user).not.toContain('referenceAnswer');
  });
});
