// 变体生成测试（轻量变体边界）：一次 LLM 调用，只生成 question/options，
// 不生成 answer/explanation，校验失败或长度泄题直接抛错（不 retry）。

import { describe, expect, it, vi } from 'vitest';
import { generateVariant, VARIANT_REJECT_REASON } from './variant';
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

  it('校验失败不 retry，直接抛错', async () => {
    const complete = vi.fn(async () =>
      '{"question":"完全漂移的题目","options":["a","b","c","d"]}',
    );
    await expect(generateVariant(BASE, complete)).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('选择题缺 options → 拒绝，不 retry', async () => {
    const complete = vi.fn(async () => '{"question":"L2 正则化的新问法"}');
    await expect(generateVariant(BASE, complete, 'choice')).rejects.toThrow(/缺少 options/);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('选项长度泄题 → 直接抛错，不 retry（且带机器可读 reason 供遥测）', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({
        question: 'L2 正则化为什么能平滑收缩权重？',
        options: [
          'L2 正则化通过对权重施加平方惩罚来平滑收缩权重，与 weight decay 在标准 SGD 下等价，并能显著降低过拟合风险',
          'A',
          'B',
          'C',
        ],
      }),
    );
    const error = (await generateVariant(BASE, complete, 'choice').catch(
      (e: unknown) => e,
    )) as Error & { reason?: string };
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/长度泄题/);
    expect(error.reason).toBe(VARIANT_REJECT_REASON.OPTION_LENGTH_BIAS);
    // 一次失败即回退原题，绝不再次请求 LLM
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
