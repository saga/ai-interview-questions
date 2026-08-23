// 纯逻辑测试：评分聚合与选择题确定性判分。

import { describe, it, expect } from 'vitest';
import { aggregateOverall, gradeChoice } from './evaluation';
import type { ChoiceQuestion, EvaluationDimension, ScoringRubric } from '../types';

const rubric: ScoringRubric = {
  correctness: 0.4,
  completeness: 0.2,
  architecture: 0.2,
  communication: 0.2,
};

const cq: ChoiceQuestion = {
  id: 'x',
  category: 'machine-learning',
  topic: 'overfitting',
  tags: [],
  difficulty: 'easy',
  type: 'single',
  question: 'q',
  options: ['a', 'b'],
  answer: [0],
  explanation: 'e',
};

describe('aggregateOverall', () => {
  it('按权重加权求和并取整', () => {
    const dims: Record<EvaluationDimension, number> = {
      correctness: 100,
      completeness: 50,
      architecture: 50,
      communication: 50,
    };
    // 100*0.4 + 50*0.2 + 50*0.2 + 50*0.2 = 40 + 10 + 10 + 10 = 70
    expect(aggregateOverall(dims, rubric)).toBe(70);
  });

  it('结果钳制到 [0, 100]', () => {
    // 加权和 = 300*0.4 = 120 → 钳到 100
    const high: Record<EvaluationDimension, number> = {
      correctness: 300,
      completeness: 0,
      architecture: 0,
      communication: 0,
    };
    expect(aggregateOverall(high, rubric)).toBe(100);
    // 加权和 = -100*0.4 = -40 → 钳到 0
    const low: Record<EvaluationDimension, number> = {
      correctness: -100,
      completeness: 0,
      architecture: 0,
      communication: 0,
    };
    expect(aggregateOverall(low, rubric)).toBe(0);
  });
});

describe('gradeChoice', () => {
  it('答对：四维全 100，overall 100', () => {
    const g = gradeChoice(cq, [0], rubric);
    expect(g.overall).toBe(100);
    expect(g.dimensions.correctness).toBe(100);
    expect(g.dimensions.architecture).toBe(100);
    expect(g.strengths.length).toBeGreaterThan(0);
  });

  it('答错：四维全 0，overall 0', () => {
    const g = gradeChoice(cq, [1], rubric);
    expect(g.overall).toBe(0);
    expect(g.dimensions.communication).toBe(0);
    expect(g.gaps).toEqual([]); // 选择题不伪造 gap（避免污染 Learner Memory）
  });

  it('未作答（空数组）按错误处理', () => {
    const g = gradeChoice(cq, [], rubric);
    expect(g.overall).toBe(0);
  });
});
