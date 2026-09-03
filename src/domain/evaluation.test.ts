// 纯逻辑测试：评分聚合与选择题确定性判分。

import { describe, it, expect } from 'vitest';
import { aggregateOverall, gradeChoice, describeEvaluationSummary, describeLevels, DEFAULT_RUBRIC, EVALUATION_PROFILE_RUBRICS } from './evaluation';
import type { ChoiceFormat } from '../schemas/question';
import type { EvaluationDimension } from '../schemas/common';
import type { EvalLevel, EvaluationResult } from '../schemas/evaluation';
import type { ScoringRubric } from '../schemas/interview';

function resultWith(levels: Record<EvaluationDimension, EvalLevel>, gaps: string[]): EvaluationResult {
  return {
    overall: 72,
    dimensions: { correctness: 75, completeness: 50, architecture: 75, communication: 75 },
    levels,
    evidence: { correctness: 'e1', completeness: 'e2', architecture: 'e3', communication: 'e4' },
    strengths: ['答到要点'],
    gaps,
    missingConcepts: [],
    feedback: '整体不错',
  };
}

const rubric: ScoringRubric = {
  correctness: 0.4,
  completeness: 0.2,
  architecture: 0.2,
  communication: 0.2,
};

const cq: ChoiceFormat = {
  type: 'single',
  question: 'q',
  options: ['a', 'b'],
  answer: [0],
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

describe('aggregateOverall 维度适用性（P0：不适用维度不得扣分）', () => {
  const full: Record<EvaluationDimension, number> = {
    correctness: 100,
    completeness: 100,
    architecture: 50, // 不适用维度被模型给的中性档（level 2）
    communication: 100,
  };

  it('不适用维度参与加权时会凭空扣掉 10 分——这正是要修掉的 bug', () => {
    // 100*0.4 + 100*0.2 + 50*0.2 + 100*0.2 = 40 + 20 + 10 + 20 = 90
    expect(aggregateOverall(full, rubric)).toBe(90);
  });

  it('标记 applicable:false 后权重重归一化，全 4 分的知识题仍可拿满分', () => {
    // 剩余权重 0.8 → 归一化 0.5 / 0.25 / 0.25
    const applicable = { correctness: true, completeness: true, architecture: false, communication: true };
    expect(aggregateOverall(full, rubric, applicable)).toBe(100);
  });

  it('重归一化按剩余权重比例分配，不是简单均分', () => {
    // 只剩 correctness(0.4) 与 communication(0.2) → 0.667 / 0.333
    const applicable = { correctness: true, completeness: false, architecture: false, communication: true };
    const dims: Record<EvaluationDimension, number> = {
      correctness: 100,
      completeness: 0,
      architecture: 0,
      communication: 25,
    };
    expect(aggregateOverall(dims, rubric, applicable)).toBe(Math.round(100 * (0.4 / 0.6) + 25 * (0.2 / 0.6)));
  });

  it('applicable 缺省（历史持久化数据 / 选择题）等价于旧实现', () => {
    expect(aggregateOverall(full, rubric, undefined)).toBe(90);
    expect(aggregateOverall(full, rubric)).toBe(90);
  });

  it('四维全被标为不适用（模型异常）→ 退回原权重，不产生 NaN 或虚假满分', () => {
    const allFalse = { correctness: false, completeness: false, architecture: false, communication: false };
    expect(Number.isFinite(aggregateOverall(full, rubric, allFalse))).toBe(true);
    expect(aggregateOverall(full, rubric, allFalse)).toBe(90);
  });
});

describe('describeLevels 维度适用性', () => {
  it('不适用维度显式写「不适用」，不伪装成真实的中性档评分', () => {
    const text = describeLevels(
      { correctness: 4, completeness: 4, architecture: 2, communication: 4 },
      { correctness: true, completeness: true, architecture: false, communication: true },
    );
    expect(text).toBe('正确性=4, 完整性=4, 架构=不适用, 表达=4');
  });

  it('存在不适用维度时禁止塌缩成「四维均为 N」', () => {
    const text = describeLevels(
      { correctness: 2, completeness: 2, architecture: 2, communication: 2 },
      { correctness: true, completeness: true, architecture: false, communication: true },
    );
    expect(text).not.toContain('四维均为');
    expect(text).toContain('架构=不适用');
  });

  it('全部适用时行为不变（仍可塌缩）', () => {
    expect(describeLevels({ correctness: 4, completeness: 4, architecture: 4, communication: 4 })).toBe('四维均为 4');
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

describe('describeEvaluationSummary（ADR-054：把决策依据放进 LLM 可见文本）', () => {
  it('带出综合分、各维序级与薄弱点——这是 prompt 三路分支的全部输入', () => {
    const text = describeEvaluationSummary(
      resultWith({ correctness: 3, completeness: 1, architecture: 2, communication: 3 }, ['KV Cache 复用边界']),
    );
    expect(text).toContain('综合评分：72');
    expect(text).toContain('正确性=3');
    expect(text).toContain('完整性=1');
    expect(text).toContain('薄弱点：KV Cache 复用边界');
  });

  it('两个 overall 相同但维度构成不同的答案，摘要必须能区分（C2 的核心诉求）', () => {
    const a = describeEvaluationSummary(
      resultWith({ correctness: 4, completeness: 1, architecture: 4, communication: 1 }, []),
    );
    const b = describeEvaluationSummary(
      resultWith({ correctness: 1, completeness: 4, architecture: 1, communication: 4 }, []),
    );
    expect(a).not.toBe(b);
    expect(a).toContain('正确性=4');
    expect(b).toContain('正确性=1');
  });

  it('gaps 为空时显式写「无」，而不是省略该行', () => {
    const text = describeEvaluationSummary(
      resultWith({ correctness: 4, completeness: 4, architecture: 4, communication: 4 }, []),
    );
    expect(text).toContain('薄弱点：无');
  });

  it('不泄漏 evidence / feedback / strengths——它们对选题决策无增量，只会推高上下文', () => {
    const text = describeEvaluationSummary(
      resultWith({ correctness: 3, completeness: 1, architecture: 2, communication: 3 }, ['g1']),
    );
    expect(text).not.toContain('e1'); // evidence.correctness
    expect(text).not.toContain('整体不错'); // feedback
    expect(text).not.toContain('答到要点'); // strengths
  });

  it('标注序级刻度（0-4），避免模型把 3 当成百分位', () => {
    expect(describeEvaluationSummary(resultWith({ correctness: 3, completeness: 3, architecture: 3, communication: 3 }, [])))
      .toContain('0-4 序级');
  });
});

describe('describeLevels', () => {
  it('四维相同 → 塌缩成一行（选择题按对错判定，四维必然全 0 或全 4）', () => {
    expect(describeLevels({ correctness: 4, completeness: 4, architecture: 4, communication: 4 })).toBe('四维均为 4');
    expect(describeLevels({ correctness: 0, completeness: 0, architecture: 0, communication: 0 })).toBe('四维均为 0');
  });

  it('塌缩后明显短于逐维打印，避免每轮重复同一个数字', () => {
    const uniform = { correctness: 4, completeness: 4, architecture: 4, communication: 4 };
    expect(describeLevels(uniform).length).toBeLessThan(
      'correctness=4, completeness=4, architecture=4, communication=4'.length / 2,
    );
  });

  it('四维不同 → 逐维打印，保留区分度', () => {
    const text = describeLevels({ correctness: 3, completeness: 1, architecture: 2, communication: 4 });
    expect(text).toBe('正确性=3, 完整性=1, 架构=2, 表达=4');
  });

  it('只有一维不同也要展开，不能因为「多数相同」就丢信息', () => {
    const text = describeLevels({ correctness: 4, completeness: 4, architecture: 4, communication: 1 });
    expect(text).toBe('正确性=4, 完整性=4, 架构=4, 表达=1');
  });
});

describe('EVALUATION_PROFILE_RUBRICS（P2-5）', () => {
  it('6 档预设权重各自归一化，且 coding/debugging 的 correctness 显著高于默认', () => {
    for (const [name, r] of Object.entries(EVALUATION_PROFILE_RUBRICS)) {
      const sum = r.correctness + r.completeness + r.architecture + r.communication;
      expect(sum, name).toBeCloseTo(1);
    }
    expect(EVALUATION_PROFILE_RUBRICS.coding.correctness).toBeGreaterThan(DEFAULT_RUBRIC.correctness);
    expect(EVALUATION_PROFILE_RUBRICS.debugging.correctness).toBeGreaterThan(DEFAULT_RUBRIC.correctness);
  });
});
