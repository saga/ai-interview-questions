// 纯逻辑：评分聚合与确定性判分。不依赖 React / LLM。

import type {
  ChoiceFormat,
  EvaluationDimension,
  EvaluationResult,
  ScoringRubric,
} from '../types';
import { EVAL_DIMENSIONS } from '../types';
import { isChoiceCorrect } from './quiz';

/** 默认四维权重（和为 1）：正确性 / 完整性 / 架构 / 表达 */
export const DEFAULT_RUBRIC: ScoringRubric = {
  correctness: 0.4,
  completeness: 0.2,
  architecture: 0.2,
  communication: 0.2,
};

/** 按 rubric 权重把四维分数聚合成综合分（0-100）。 */
export function aggregateOverall(
  dimensions: Record<EvaluationDimension, number>,
  rubric: ScoringRubric,
): number {
  const sum = EVAL_DIMENSIONS.reduce((acc, dim) => acc + dimensions[dim] * rubric[dim], 0);
  return Math.max(0, Math.min(100, Math.round(sum)));
}

/** 选择题确定性判分：正确则四维全 100，否则全 0。 */
export function gradeChoice(cf: ChoiceFormat, selected: number[], rubric: ScoringRubric): EvaluationResult {
  const correct = isChoiceCorrect(cf, selected);
  const v = correct ? 100 : 0;
  const dimensions: Record<EvaluationDimension, number> = {
    correctness: v,
    completeness: v,
    architecture: v,
    communication: v,
  };
  return {
    overall: aggregateOverall(dimensions, rubric),
    dimensions,
    strengths: correct ? ['选择正确'] : [],
    // 选择题判定性打分，不知道用户漏了哪个知识点，不伪造 gap（避免污染 Learner Memory）。
    gaps: [],
    feedback: correct ? '回答正确。' : '回答错误。',
  };
}
