// 评分权重（ScoringRubric）的边界校验：aggregateOverall 直接做 `Σ dimension × weight`，
// 因此「每项 ∈ [0,1]」与「四项之和 = 1」必须在 schema 层拒绝，而不是靠聚合层 clamp 掩盖。

import { describe, expect, it } from 'vitest';
import { interviewDefinitionSchema, scoringRubricSchema } from './interview';

const OK = { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 };

describe('scoringRubricSchema', () => {
  it('接受归一化且每项在 [0,1] 的权重', () => {
    expect(scoringRubricSchema.safeParse(OK).success).toBe(true);
  });

  it('容忍浮点误差：0.7+0.1+0.1+0.1 在 IEEE754 下是 0.9999999999999999', () => {
    const r = { correctness: 0.7, completeness: 0.1, architecture: 0.1, communication: 0.1 };
    // 严格相等比较会误杀这组合法权重，故 schema 用 epsilon 容差
    expect(r.correctness + r.completeness + r.architecture + r.communication).not.toBe(1);
    expect(scoringRubricSchema.safeParse(r).success).toBe(true);
  });

  it('拒绝超出 [0,1] 的权重', () => {
    expect(scoringRubricSchema.safeParse({ ...OK, correctness: 1.5 }).success).toBe(false);
  });

  it('拒绝负权重（否则会被 clamp 成 0 而掩盖真实的 overall 失真）', () => {
    expect(scoringRubricSchema.safeParse({ ...OK, correctness: -1 }).success).toBe(false);
  });

  it('拒绝 NaN / Infinity', () => {
    expect(scoringRubricSchema.safeParse({ ...OK, correctness: Number.NaN }).success).toBe(false);
    expect(scoringRubricSchema.safeParse({ ...OK, completeness: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('拒绝未归一化的权重（四项全 1 会让 overall 放大 4 倍）', () => {
    const r = scoringRubricSchema.safeParse({
      correctness: 1,
      completeness: 1,
      architecture: 1,
      communication: 1,
    });
    expect(r.success).toBe(false);
  });

  it('拒绝和不为 1 的部分权重组合', () => {
    expect(
      scoringRubricSchema.safeParse({ correctness: 0.5, completeness: 0.5, architecture: 0.5, communication: 0.5 })
        .success,
    ).toBe(false);
    expect(
      scoringRubricSchema.safeParse({ correctness: 0.1, completeness: 0.1, architecture: 0.1, communication: 0.1 })
        .success,
    ).toBe(false);
  });

  it('interviewDefinitionSchema 连带拒绝非法 rubric', () => {
    const base = {
      title: 't',
      categories: ['c'],
      difficulties: ['easy'],
      formats: ['choice'],
      count: 5,
      useAI: false,
      scoringRubric: OK,
    };
    expect(interviewDefinitionSchema.safeParse(base).success).toBe(true);
    expect(
      interviewDefinitionSchema.safeParse({ ...base, scoringRubric: { ...OK, architecture: 2 } }).success,
    ).toBe(false);
  });
});
