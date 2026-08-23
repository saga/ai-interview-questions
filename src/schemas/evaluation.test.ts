import { describe, it, expect } from 'vitest';
import { llmEvaluationRawSchema, evaluationResultSchema } from './evaluation';

describe('llmEvaluationRawSchema', () => {
  it('accepts full valid raw', () => {
    expect(() =>
      llmEvaluationRawSchema.parse({
        correctness: 80,
        completeness: 70,
        architecture: 60,
        communication: 90,
        feedback: 'good',
        strengths: ['a'],
        gaps: ['b'],
      }),
    ).not.toThrow();
  });

  it('accepts empty object (all optional, fallback path)', () => {
    expect(() => llmEvaluationRawSchema.parse({})).not.toThrow();
  });

  it('accepts partial dimensions', () => {
    expect(() => llmEvaluationRawSchema.parse({ correctness: 90 })).not.toThrow();
  });

  it('strips unknown fields (not strict)', () => {
    const parsed = llmEvaluationRawSchema.parse({ correctness: 80, overall: 999 } as unknown as Record<string, unknown>);
    expect((parsed as Record<string, unknown>).overall).toBeUndefined();
  });
});

describe('evaluationResultSchema', () => {
  it('accepts valid result', () => {
    expect(() =>
      evaluationResultSchema.parse({
        overall: 80,
        dimensions: { correctness: 80, completeness: 70, architecture: 60, communication: 90 },
        strengths: ['a'],
        gaps: ['b'],
        feedback: 'good',
      }),
    ).not.toThrow();
  });

  it('rejects out-of-range overall', () => {
    expect(() =>
      evaluationResultSchema.parse({
        overall: 150,
        dimensions: { correctness: 80, completeness: 70, architecture: 60, communication: 90 },
        strengths: [],
        gaps: [],
        feedback: '',
      }),
    ).toThrow();
  });
});
