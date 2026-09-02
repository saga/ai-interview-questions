import { describe, it, expect } from 'vitest';
import { questionSchema } from './question';

const validChoiceSingle = {
  id: 'test-01',
  category: 'agentic-ai',
  topic: 'tool-calling',
  tags: ['tool-calling'],
  difficulty: 'medium' as const,
  angle: 'definition' as const,
  question: '什么是 tool calling？',
  explanation: '解析',
  formats: {
    choice: { type: 'single' as const, options: ['A', 'B', 'C', 'D'], answer: [1] },
    open: { referenceAnswer: '要点' },
  },
};

const validChoiceMultiple = {
  ...validChoiceSingle,
  id: 'test-02',
  formats: {
    choice: { type: 'multiple' as const, options: ['A', 'B', 'C', 'D'], answer: [0, 2] },
    open: { referenceAnswer: '要点' },
  },
};

const validOpenOnly = {
  ...validChoiceSingle,
  id: 'test-03',
  formats: {
    open: { referenceAnswer: '开放参考答案' },
  },
};

describe('questionSchema', () => {
  it('accepts valid single choice with both formats', () => {
    expect(() => questionSchema.parse(validChoiceSingle)).not.toThrow();
  });

  it('accepts valid multiple choice', () => {
    expect(() => questionSchema.parse(validChoiceMultiple)).not.toThrow();
  });

  it('accepts open-only question', () => {
    expect(() => questionSchema.parse(validOpenOnly)).not.toThrow();
  });

  it('angle 必填：topic × angle 是题库治理主索引，缺 angle 直接拒绝', () => {
    const { angle, ...rest } = validChoiceSingle;
    expect(angle).toBe('definition');
    expect(() => questionSchema.parse(rest)).toThrow(/angle/);
  });

  it('defaults tags to [] when missing', () => {
    const { tags, ...rest } = validChoiceSingle as Record<string, unknown> & { tags: string[] };
    const parsed = questionSchema.parse(rest);
    expect(parsed.tags).toEqual([]);
  });

  it('rejects missing question text', () => {
    expect(() =>
      questionSchema.parse({ ...validChoiceSingle, question: undefined }),
    ).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => questionSchema.parse({ ...validChoiceSingle, id: '' })).toThrow();
  });

  it('rejects unknown difficulty', () => {
    expect(() =>
      questionSchema.parse({ ...validChoiceSingle, difficulty: 'unknown' }),
    ).toThrow();
  });

  it('rejects choice with less than 2 options', () => {
    expect(() =>
      questionSchema.parse({
        ...validChoiceSingle,
        formats: { choice: { type: 'single', options: ['A'], answer: [0] } },
      }),
    ).toThrow();
  });

  it('rejects missing formats (no choice nor open)', () => {
    expect(() =>
      questionSchema.parse({ ...validChoiceSingle, formats: {} }),
    ).toThrow();
  });

  it('rejects invalid angle', () => {
    expect(() =>
      questionSchema.parse({ ...validChoiceSingle, angle: 'invalid-angle' }),
    ).toThrow();
  });

  it('accepts choice with scenario question field', () => {
    const q = {
      ...validChoiceSingle,
      formats: {
        choice: {
          type: 'single' as const,
          options: ['A', 'B', 'C', 'D'],
          answer: [0],
          question: '场景化题干',
        },
        open: { referenceAnswer: '要点' },
      },
    };
    expect(() => questionSchema.parse(q)).not.toThrow();
  });

  // ── choice 契约：这些此前只在 validate-questions.ts / bank.test.ts 里把关，
  // parseQuestion() 单独调用时会放过越界数据（如 options 4 项却 answer:[9]）。──
  describe('choice answer 与 misconceptionMap 契约', () => {
    it('拒绝 answer 索引越界（options 4 项却指向 9）', () => {
      expect(() =>
        questionSchema.parse({
          ...validChoiceSingle,
          formats: { choice: { type: 'single', options: ['A', 'B', 'C', 'D'], answer: [9] } },
        }),
      ).toThrow(/越界/);
    });

    it('拒绝 misconceptionMap 长度与 options 不一致', () => {
      expect(() =>
        questionSchema.parse({
          ...validChoiceSingle,
          misconceptions: ['误解一', '误解二'],
          formats: {
            choice: {
              type: 'single',
              options: ['A', 'B', 'C', 'D'],
              answer: [0],
              misconceptionMap: [null, null, 0], // 3 项 ≠ options 4 项
            },
          },
        }),
      ).toThrow(/长度/);
    });

    it('拒绝 misconceptionMap 下标超出 misconceptions 范围', () => {
      expect(() =>
        questionSchema.parse({
          ...validChoiceSingle,
          misconceptions: ['误解一'],
          formats: {
            choice: {
              type: 'single',
              options: ['A', 'B', 'C', 'D'],
              answer: [0],
              misconceptionMap: [null, 5, null, null], // 5 ≥ misconceptions.length
            },
          },
        }),
      ).toThrow(/越界/);
    });

    it('拒绝给正确选项标注误解（正确项必须保持 null）', () => {
      expect(() =>
        questionSchema.parse({
          ...validChoiceSingle,
          misconceptions: ['误解一'],
          formats: {
            choice: {
              type: 'single',
              options: ['A', 'B', 'C', 'D'],
              answer: [0],
              misconceptionMap: [0, null, null, null], // 0 号是正确项
            },
          },
        }),
      ).toThrow(/正确选项/);
    });

    it('接受合法标注：只有干扰项带 misconceptionMap，正确项为 null', () => {
      const q = {
        ...validChoiceSingle,
        misconceptions: ['误解一', '误解二'],
        formats: {
          choice: {
            type: 'single' as const,
            options: ['A', 'B', 'C', 'D'],
            answer: [0],
            misconceptionMap: [null, 0, 1, null],
          },
        },
      };
      const parsed = questionSchema.parse(q);
      expect(parsed.formats.choice?.misconceptionMap).toEqual([null, 0, 1, null]);
    });
  });
});
