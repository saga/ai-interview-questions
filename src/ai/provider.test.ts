// 纯逻辑测试：题目级 rubric 与全局 rubric 的合并。
// ADR-013 / ARCHITECTURE「评分 Rubric」：required 注入提示词，dimensions 覆盖全局权重。

import { describe, expect, it } from 'vitest';
import { mergeQuestionRubric } from './provider';
import type { OpenQuestion, ScoringRubric } from '../types';

const GLOBAL: ScoringRubric = { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 };

function q(rubric?: OpenQuestion['rubric']): OpenQuestion {
  return {
    id: 'q1',
    category: 'agentic-ai',
    topic: 'memory',
    tags: [],
    difficulty: 'medium',
    type: 'essay',
    question: 'q',
    referenceAnswer: 'a',
    explanation: '',
    rubric,
  };
}

describe('mergeQuestionRubric', () => {
  it('无题目级 rubric 时原样返回全局权重', () => {
    expect(mergeQuestionRubric(q(), GLOBAL)).toEqual({ rubric: GLOBAL, requiredPoints: undefined });
  });

  it('dimensions 只覆盖给出的维度，其余沿用全局', () => {
    const { rubric } = mergeQuestionRubric(q({ dimensions: { architecture: 0.5 } }), GLOBAL);
    expect(rubric).toEqual({ correctness: 0.4, completeness: 0.2, architecture: 0.5, communication: 0.2 });
  });

  it('required 要点被透传（注入评分提示）', () => {
    const { requiredPoints } = mergeQuestionRubric(q({ required: ['短期记忆', '长期记忆'] }), GLOBAL);
    expect(requiredPoints).toEqual(['短期记忆', '长期记忆']);
  });
});
