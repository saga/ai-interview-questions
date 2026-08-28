import { describe, it, expect } from 'vitest';
import { questionSchema } from './question';

const validChoiceSingle = {
  id: 'test-01',
  category: 'agentic-ai',
  topic: 'tool-calling',
  tags: ['tool-calling'],
  difficulty: 'medium' as const,
  question: '什么是 tool calling？',
  explanation: '解析',
  formats: {
    choice: { type: 'single' as const, options: ['A', 'B', 'C'], answer: [1] },
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

  it('accepts question with optional fields (angle, reference)', () => {
    const q = {
      ...validChoiceSingle,
      angle: 'tradeoff' as const,
      reference: { concept: '概念' },
    };
    expect(() => questionSchema.parse(q)).not.toThrow();
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
          options: ['A', 'B'],
          answer: [0],
          question: '场景化题干',
        },
        open: { referenceAnswer: '要点' },
      },
    };
    expect(() => questionSchema.parse(q)).not.toThrow();
  });
});
