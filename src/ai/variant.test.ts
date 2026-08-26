// 变体生成测试：complete 注入后与底层无关（pi-ai / Chrome 均走同一逻辑）。
// 覆盖：正常重写含 options、LLM 输出残缺时回退、prompt 携带 Knowledge Contract 与完整原题。
// 安全模型（ADR-036）：LLM 可重构 Presentation，需保持 Knowledge Contract。

import { describe, expect, it, vi } from 'vitest';
import { generateVariant } from './variant';
import type { CompleteFn, Question } from '../types';

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

describe('generateVariant', () => {
  it('解析 LLM 输出的 question/explanation/options/answer', async () => {
    const complete: CompleteFn = vi.fn(async () =>
      '{"question":"L2 正则化的作用是？","options":["x","y","z","w"],"answer":[1],"explanation":"权重平方惩罚。"}',
    );
    const out = await generateVariant(BASE, complete);
    expect(out).toEqual({
      question: 'L2 正则化的作用是？',
      options: ['x', 'y', 'z', 'w'],
      answer: [1],
      explanation: '权重平方惩罚。',
    });
    const [system, user] = (complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(system).toContain('知识考察契约');
    // 完整原题与契约进入提示词（ADR-036 语义不变量）
    expect(user).toContain('requiredConcepts');
    expect(user).toContain('question');
    expect(user).toContain('options');
    expect(user).toContain('answer');
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

  it('选项长度泄题时一次性重试并采用修正版', async () => {
    const complete = vi.fn(async () => {
      if (complete.mock.calls.length === 1) {
        // 第一次：正确项（index1）极长，触发长度泄题
        return `{"question":"biased","options":["B","${'正'.repeat(200)}","C","D"],"answer":[1],"explanation":"e"}`;
      }
      return '{"question":"fixed","options":["a","b","c","d"],"answer":[1],"explanation":"e"}';
    });
    const out = await generateVariant(BASE, complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(out.question).toBe('fixed');
    expect(out.options).toEqual(['a', 'b', 'c', 'd']);
  });
});
