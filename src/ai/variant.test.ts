// 变体生成测试：complete 注入后与底层无关（pi-ai / Chrome 均走同一逻辑）。
// 覆盖：正常重写、LLM 输出残缺时用原题兜底、prompt 只携带题干/解析（答案不进契约）。

import { describe, expect, it, vi } from 'vitest';
import { generateVariant } from './variant';
import type { ChoiceQuestion, CompleteFn } from '../types';

const BASE: ChoiceQuestion = {
  id: 'q1',
  category: 'machine-learning',
  topic: 'regularization',
  tags: [],
  difficulty: 'medium',
  type: 'single',
  question: '什么是 L2 正则化？',
  explanation: 'L2 在损失中加入权重平方惩罚。',
  options: ['A', 'B', 'C', 'D'],
  answer: [0],
};

describe('generateVariant', () => {
  it('解析 LLM 输出的 question/explanation', async () => {
    const complete: CompleteFn = vi.fn(async () => '{"question":"L2 正则化的作用是？","explanation":"权重平方惩罚。"}');
    const out = await generateVariant(BASE, complete);
    expect(out).toEqual({ question: 'L2 正则化的作用是？', explanation: '权重平方惩罚。' });
    const [system, user] = (complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(system).toContain('面试官');
    // 答案数据不进入提示词输出契约（ADR-019 安全模型）
    expect(user).toContain('question');
    expect(user).not.toContain('"answer"');
    expect(user).not.toContain('options');
  });

  it('LLM 输出缺字段时回退原题题干', async () => {
    const complete: CompleteFn = async () => '{"explanation":"只有解析"}';
    const out = await generateVariant(BASE, complete);
    expect(out.question).toBe('什么是 L2 正则化？');
    expect(out.explanation).toBe('只有解析');
  });

  it('容忍 markdown 代码块包裹的 JSON', async () => {
    const complete: CompleteFn = async () => '```json\n{"question":"变体题干"}\n```';
    const out = await generateVariant(BASE, complete);
    expect(out.question).toBe('变体题干');
    expect(out.explanation).toBeUndefined();
  });
});
