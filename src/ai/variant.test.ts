// 变体生成测试：complete 注入后与底层无关（pi-ai / Chrome 均走同一逻辑）。
// 覆盖：正常重写含 options、LLM 输出残缺时回退、prompt 携带 Knowledge Contract 与完整原题。
// 安全模型（ADR-036）：LLM 可重构 Presentation，需保持 Knowledge Contract。

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
    expect(system).toContain('知识契约');
    // 完整原题与契约进入提示词（ADR-036 语义不变量）
    expect(user).toContain('requiredConcepts');
    expect(user).toContain('question');
    expect(user).toContain('options');
    expect(user).toContain('answer');
    // v2：buildUser 显式注入「变体目标」约束段
    expect(user).toContain('变体目标');
    expect(user).toContain('实际考察');
    expect(user).toContain('适用条件');
    // 新增：正确答案不变量与 angle 提示
    expect(system).toContain('正确答案不变量');
  });

  it('LLM 输出缺 question 时经校验重试，修正版合法则采用修正版', async () => {
    const complete = vi.fn(async () => {
      if (complete.mock.calls.length === 1) return '{"explanation":"只有解析"}';
      return '{"question":"L2 正则化的另一问法？","explanation":"修正后解析"}';
    });
    const out = await generateVariant(BASE, complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(out.question).toBe('L2 正则化的另一问法？');
    expect(out.explanation).toBe('修正后解析');
  });

  it('LLM 输出两次均缺 question 时抛错（由 finalizeQuestion 回退原题）', async () => {
    const complete: CompleteFn = async () => '{"explanation":"只有解析"}';
    await expect(generateVariant(BASE, complete)).rejects.toThrow();
  });

  it('容忍 markdown 代码块包裹的 JSON', async () => {
    const complete: CompleteFn = async () => '```json\n{"question":"regularization 变体题干"}\n```';
    const out = await generateVariant(BASE, complete);
    expect(out.question).toBe('regularization 变体题干');
    expect(out.explanation).toBeUndefined();
  });

  it('选项长度泄题时一次性重试并采用修正版（修正版需再过校验）', async () => {
    const complete = vi.fn(async () => {
      if (complete.mock.calls.length === 1) {
        // 第一次：正确项（index1）极长，触发长度泄题，且题干含证据以便通过首轮校验
        return `{"question":"regularization 长度偏差题","options":["B","${'正'.repeat(200)}","C","D"],"answer":[1],"explanation":"e"}`;
      }
      return '{"question":"regularization 修正后题","options":["a","b","c","d"],"answer":[1],"explanation":"e"}';
    });
    const out = await generateVariant(BASE, complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(out.question).toBe('regularization 修正后题');
    expect(out.options).toEqual(['a', 'b', 'c', 'd']);
  });

  it('长度泄题重试后若修正版未通过校验则保留首版', async () => {
    const complete = vi.fn(async () => {
      if (complete.mock.calls.length === 1) {
        return `{"question":"regularization 首版题","options":["B","${'正'.repeat(200)}","C","D"],"answer":[1],"explanation":"e"}`;
      }
      // 修正版题干为空，校验失败，应回退首版
      return '{"question":"","options":["a","b","c","d"],"answer":[1],"explanation":"e"}';
    });
    const out = await generateVariant(BASE, complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(out.question).toBe('regularization 首版题');
  });

  it('变体未包含 topic/required 证据时重试一次', async () => {
    const complete = vi.fn(async () => {
      if (complete.mock.calls.length === 1) {
        // 首版完全漂移：问 CNN/BatchNorm
        return '{"question":"在 CNN 训练中 BatchNorm 为什么不稳定？","options":["a","b","c","d"],"answer":[0],"explanation":"e"}';
      }
      return '{"question":"L2 正则化在小 batch 下为何优于 BatchNorm？","options":["a","b","c","d"],"answer":[0],"explanation":"e"}';
    });
    const out = await generateVariant(BASE, complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(out.question).toBe('L2 正则化在小 batch 下为何优于 BatchNorm？');
  });

  it('buildUser 注入 angle 时契约包含 angle', async () => {
    const withAngle: Question = { ...BASE, angle: 'tradeoff' };
    const complete: CompleteFn = vi.fn(async () => '{"question":"L2 正则化权衡题","options":["a","b","c","d"],"answer":[0],"explanation":"e"}');
    await generateVariant(withAngle, complete);
    const [, user] = (complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(user).toContain('tradeoff');
    expect(user).toContain('angle');
  });
});
