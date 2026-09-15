// 变体生成测试（轻量变体边界）：本模块是**纯 LLM 适配器**——一次调用 + 解析，不做校验。
// 校验（结构/语义/长度泄题）统一由 domain/variant.validateVariant 在 finalizeQuestion 中执行，
// 相关用例见 src/domain/variant.test.ts；这里只验证「LLM → GeneratedVariant」这一段契约。

import { describe, expect, it, vi } from 'vitest';
import {
  VARIANT_KIND_GUIDANCE,
  VARIANT_PROMPT_VERSION,
  VARIANT_SYSTEM,
  generateAssessmentVariant,
  generateVariant,
} from './variant';
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

describe('VARIANT_SYSTEM v6（ADR-080：Relax generation, not invariants）', () => {
  it('版本号与解析值一致', () => {
    expect(VARIANT_SYSTEM).toContain('[PROMPT-VERSION v6]');
    expect(VARIANT_PROMPT_VERSION).toBe('v6');
  });

  it('术语：同知识重写（same-knowledge rewrite）', () => {
    expect(VARIANT_SYSTEM).toContain('same-knowledge rewrite');
    expect(VARIANT_SYSTEM).not.toContain('轻量语义变换');
  });

  it('保留答案契约：槽位语义角色对应 + 不得互换', () => {
    // 程序按序号映射答案（applyVariant + validateVariant 逐槽位漂移检查），
    // 角色互换会直接判错题——这是放宽后仍不可动的位置不变式。
    expect(VARIANT_SYSTEM).toContain('语义角色对应');
    expect(VARIANT_SYSTEM).toContain('不得将两个选项的语义角色互换');
  });

  it('放宽生成自由度：场景/背景/槽内表达结构', () => {
    expect(VARIANT_SYSTEM).toContain('改变场景、角色、问题入口和约束表达');
    expect(VARIANT_SYSTEM).toContain('解题必需');
    expect(VARIANT_SYSTEM).toContain('允许改变单个选项内部的表达结构');
  });

  it('不强制保留关键词：允许自然语言重述结论', () => {
    expect(VARIANT_SYSTEM).toContain('允许用不同的自然语言表达');
    expect(VARIANT_SYSTEM).not.toContain('仍须保留原选项的结论关键词');
  });

  it('背景术语无数字配额：只禁解题依赖', () => {
    expect(VARIANT_SYSTEM).toContain('不得引入新的解题依赖知识');
    expect(VARIANT_SYSTEM).not.toContain('不超过 2 个');
  });

  it('不再出现旧收缩措辞', () => {
    expect(VARIANT_SYSTEM).not.toContain('不新增信息');
    expect(VARIANT_SYSTEM).not.toContain('不要进行深度重新设计');
    // 旧约束是"只允许改变表达，不允许改变…"（纯换皮）；新约束是"只允许改变表达结构"（槽内自由）。
    expect(VARIANT_SYSTEM).not.toContain('只允许改变表达，不允许');
  });

  it('JSON 输出契约不变', () => {
    expect(VARIANT_SYSTEM).toContain('只输出 JSON');
    expect(VARIANT_SYSTEM).toContain('"options"');
  });

  it('kind 指引与主 prompt 同口径（语义角色对应）', () => {
    for (const g of Object.values(VARIANT_KIND_GUIDANCE)) {
      expect(g).toContain('语义角色对应');
    }
  });
});

describe('generateAssessmentVariant（离线 assessment variant，mock LLM）', () => {
  const full = {
    question: '在约束 B 下比较 A 与 C，以下哪项成立？',
    options: ['A1', 'B1', 'C1', 'D1'],
    angle: 'comparison',
    cognitiveTask: 'compare',
    assessment: { target: '能在约束 B 下比较 A/C', reasoningGoal: '先对齐维度；再逐项验证；并排除干扰。' },
  };

  it('完整输出 → 返回表达 + 测量面', async () => {
    const complete: CompleteFn = vi.fn(async () => JSON.stringify(full));
    const out = await generateAssessmentVariant(BASE, complete, 'choice');
    expect(out.question).toBe(full.question);
    expect(out.options).toEqual(full.options);
    expect(out.angle).toBe('comparison');
    expect(out.cognitiveTask).toBe('compare');
    expect(out.assessment).toEqual(full.assessment);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('缺少 assessment → 抛出（不许冒充 assessment variant 入库）', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({ question: 'x', options: ['A', 'B', 'C', 'D'], angle: 'comparison', cognitiveTask: 'compare' }),
    );
    await expect(generateAssessmentVariant(BASE, complete, 'choice')).rejects.toThrow(/测量意图/);
  });

  it('缺少 angle / cognitiveTask → 抛出', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({ question: 'x', options: ['A', 'B', 'C', 'D'], assessment: full.assessment }),
    );
    await expect(generateAssessmentVariant(BASE, complete, 'choice')).rejects.toThrow(/angle/);
  });

  it('非法 angle 枚举 → 抛出', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      JSON.stringify({ ...full, angle: 'not-a-real-angle' }),
    );
    await expect(generateAssessmentVariant(BASE, complete, 'choice')).rejects.toThrow(/解析/);
  });

  it('用户提示词携带 canonical 测量面（模型才能换出新路径），仍不携带答案/解析', async () => {
    const complete: CompleteFn = vi.fn(async () => JSON.stringify(full));
    const withAssess: Question = {
      ...BASE,
      angle: 'mechanism',
      assessment: { target: '能判断 A 是否成立', reasoningGoal: '先复现机制；再确认；并排除干扰。' },
    };
    await generateAssessmentVariant(withAssess, complete, 'choice');
    const [, user] = (complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(user).toContain('canonicalAssessment');
    expect(user).toContain('canonicalAngle');
    expect(user).not.toContain('"answer"');
    expect(user).not.toContain('referenceAnswer');
  });
});
