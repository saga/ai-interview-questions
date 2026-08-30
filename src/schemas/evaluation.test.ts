import { describe, it, expect } from 'vitest';
import { llmEvaluationRawSchema, evaluationResultSchema } from './evaluation';

describe('llmEvaluationRawSchema', () => {
  it('accepts full valid raw（四维改用嵌套 level + evidence）', () => {
    expect(() =>
      llmEvaluationRawSchema.parse({
        correctness: { level: 4, evidence: '命中核心机制' },
        completeness: { level: 3 },
        architecture: { level: 2 },
        communication: { level: 1 },
        feedback: 'good',
        strengths: ['a'],
        gaps: ['b'],
        missingConcepts: ['c'],
      }),
    ).not.toThrow();
  });

  it('accepts empty object (all optional, fallback path)', () => {
    expect(() => llmEvaluationRawSchema.parse({})).not.toThrow();
  });

  it('accepts partial dimensions', () => {
    expect(() => llmEvaluationRawSchema.parse({ correctness: { level: 3 } })).not.toThrow();
  });

  it('strips unknown fields (not strict)', () => {
    const parsed = llmEvaluationRawSchema.parse({ correctness: { level: 4 }, overall: 999 } as unknown as Record<string, unknown>);
    expect((parsed as Record<string, unknown>).overall).toBeUndefined();
  });
});

describe('evaluationResultSchema', () => {
  it('accepts valid result（含 levels / evidence / missingConcepts）', () => {
    expect(() =>
      evaluationResultSchema.parse({
        overall: 80,
        dimensions: { correctness: 80, completeness: 70, architecture: 60, communication: 90 },
        levels: { correctness: 4, completeness: 3, architecture: 2, communication: 1 },
        evidence: { correctness: 'x', completeness: '', architecture: '', communication: '' },
        strengths: ['a'],
        gaps: ['b'],
        missingConcepts: ['c'],
        feedback: 'good',
      }),
    ).not.toThrow();
  });

  it('rejects out-of-range overall', () => {
    expect(() =>
      evaluationResultSchema.parse({
        overall: 150,
        dimensions: { correctness: 80, completeness: 70, architecture: 60, communication: 90 },
        levels: { correctness: 4, completeness: 3, architecture: 2, communication: 1 },
        evidence: { correctness: '', completeness: '', architecture: '', communication: '' },
        strengths: [],
        gaps: [],
        missingConcepts: [],
        feedback: '',
      }),
    ).toThrow();
  });
});
