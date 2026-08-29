// 纯逻辑：评分聚合与确定性判分。不依赖 React / LLM。

import { EVAL_DIMENSIONS } from '../types';
import type { ChoiceFormat } from '../schemas/question';
import type { EvaluationDimension } from '../schemas/common';
import type { EvaluationResult } from '../schemas/evaluation';
import type { ScoringRubric } from '../schemas/interview';
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

/**
 * 选择题确定性判分：答对则四维全 100，答错则全 0，再由 rubric 聚合成综合分。
 *
 * 为什么这么设计：
 * - 选择题有唯一正确答案（集合相等即可），不需要 LLM，判分零延迟、零成本、可离线；
 *   与开放题「走 LLM」形成互补，保证弱网/无 key 情况下仍有可用的评分路径。
 * - 不伪造 gap：选择题只能判定「对/错」，无法定位用户「漏了哪个知识点」，故 gaps 恒为空，
 *   避免把「答错」误写成「漏了某要点」污染 Learner Memory（见 sessionFromQuiz）。
 *
 * 权衡（trade-off）：粒度粗——正确/错误二元，无法区分「部分正确」。这是刻意取舍：
 * 选择题本身是离散判断，强行拆维度会失真；更细的反馈留给开放题的四维 rubric。
 */
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
