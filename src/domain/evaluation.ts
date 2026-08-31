// 纯逻辑：评分聚合与确定性判分。不依赖 React / LLM。

import { EVAL_DIMENSIONS, DIMENSION_LABELS } from '../types';
import type { ChoiceFormat } from '../schemas/question';
import type { EvaluationDimension } from '../schemas/common';
import type { EvalLevel, EvaluationResult } from '../schemas/evaluation';
import type { ScoringRubric } from '../schemas/interview';
import { isChoiceCorrect } from './quiz';

/** 默认四维权重（和为 1）：正确性 / 完整性 / 架构 / 表达 */
export const DEFAULT_RUBRIC: ScoringRubric = {
  correctness: 0.4,
  completeness: 0.2,
  architecture: 0.2,
  communication: 0.2,
};

/**
 * 序级 → 归一化分数（LLM 做「判断」，代码做「数学」）。
 * 0→0, 1→25, 2→50, 3→75, 4→100：五个离散档位足以承载 LLM 的真实区分力，
 * 又避免让 LLM 伪装成精确的 0-100 评分器（82 vs 84 通常没有可靠语义差）。
 */
export const LEVEL_TO_SCORE = { 0: 0, 1: 25, 2: 50, 3: 75, 4: 100 } as const;

/** 把任意数值钳制到 [0,4] 整型序级，再映射到归一化分数。 */
export function levelToScore(level: number): number {
  const l = Math.max(0, Math.min(4, Math.round(Number(level) || 0))) as EvalLevel;
  return LEVEL_TO_SCORE[l];
}

/** 按 rubric 权重把四维分数聚合成综合分（0-100）。 */
export function aggregateOverall(
  dimensions: Record<EvaluationDimension, number>,
  rubric: ScoringRubric,
): number {
  const sum = EVAL_DIMENSIONS.reduce((acc, dim) => acc + dimensions[dim] * rubric[dim], 0);
  return Math.max(0, Math.min(100, Math.round(sum)));
}

/**
 * 把评分结果压缩成「Agent 决策所需的最小文本」（ADR-054）。
 *
 * 为什么需要这个函数：工具返回的 `details` **不进 LLM 上下文**——Agent 只能读到 content 文本。
 * 而系统提示要求 Agent「按维度与薄弱点决定下一步」，因此这些字段必须由文本显式带出，
 * 否则模型只看到一个综合分：两个 overall 相同、但维度构成完全不同的答案就无法区分。
 *
 * 刻意**不**全量 stringify EvaluationResult：`evidence` / `strengths` / `feedback` 对「下一步考什么」
 * 没有增量信息，却会线性推高上下文。只带 Agent 决策真正依赖的三样：综合分、各维序级、gaps。
 */
export function describeEvaluationSummary(result: EvaluationResult): string {
  const parts = [
    `综合评分：${result.overall}`,
    `维度评分（0-4 序级）：${describeLevels(result.levels)}`,
    result.gaps.length > 0 ? `薄弱点：${result.gaps.join('、')}` : '薄弱点：无',
  ];
  // 选择题反证证据：命中误解是「下一步问什么」的增量信息（如「错在混淆了 retrieval 与 reranking」），
  // 一行带出，供 Agent 决定追问方向；无命中（答对 / 未标注误解）时不占上下文。
  if (result.misconceptionIds && result.misconceptionIds.length > 0) {
    parts.push(`命中误解：${result.misconceptionIds.join('、')}`);
  }
  return parts.join('\n');
}

/**
 * 渲染四维序级。四维相同时塌缩为一行——选择题按对错判定，四维必然全 0 或全 4，
 * 逐维打印只是每轮把同一个数字重复四遍，纯浪费上下文（与 ADR-052 的取舍一致）。
 */
export function describeLevels(levels: EvaluationResult['levels']): string {
  const entries = EVAL_DIMENSIONS.map((dim) => [dim, levels[dim]] as const);
  if (entries.every(([, v]) => v === entries[0][1])) return `四维均为 ${entries[0][1]}`;
  return entries.map(([dim, v]) => `${DIMENSION_LABELS[dim]}=${v}`).join(', ');
}

/**
 * 选择题确定性判分：答对则四维全 100，答错则全 0，再由 rubric 聚合成综合分。
 *
 * 为什么这么设计：
 * - 选择题有唯一正确答案（集合相等即可），不需要 LLM，判分零延迟、零成本、可离线；
 *   与开放题「走 LLM」形成互补，保证弱网/无 key 情况下仍有可用的评分路径。
 * - 不伪造 gap：选择题只能判定「对/错」，无法定位用户「漏了哪个知识点」，故 gaps 恒为空，
 *   避免把「答错」误写成「漏了某要点」污染 Learner Memory（见 sessionFromQuiz）。
 * - 不伪造 score 粒度：正确/错误二元，无法区分「部分正确」；更细的反馈留给开放题的四维 rubric。
 *
 * 误解命中（P0-5）：不伪造 gap ≠ 丢弃全部信号。当题目带 `misconceptions × misconceptionMap`
 * 且用户选中某个错误选项时，把该选项对应的误解记为结构化反证证据（misconceptionIds），
 * 选择题从此可以无 LLM 回答「用户错在哪个认知误区」，供 Learner Memory 聚合与 Agent 追问。
 */
export function gradeChoice(
  cf: ChoiceFormat,
  selected: number[],
  rubric: ScoringRubric,
  misconceptions?: string[],
): EvaluationResult {
  const correct = isChoiceCorrect(cf, selected);
  const v = correct ? 100 : 0;
  const level: EvalLevel = correct ? 4 : 0;
  const dimensions: Record<EvaluationDimension, number> = {
    correctness: v,
    completeness: v,
    architecture: v,
    communication: v,
  };
  const levels: Record<EvaluationDimension, EvalLevel> = {
    correctness: level,
    completeness: level,
    architecture: level,
    communication: level,
  };
  const evidence: Record<EvaluationDimension, string> = {
    correctness: '',
    completeness: '',
    architecture: '',
    communication: '',
  };
  // 命中误解：仅答错时判定。misconceptionMap 与 options 等长索引对齐（null = 未标注），
  // 把选中的错误选项映射为题目 misconceptions 的下标，再还原为误解原文；
  // 未标注映射的选项不产生信号（不做猜测，宁缺毋滥）。
  const misconceptionIds = correct
    ? []
    : (cf.misconceptionMap ?? []).flatMap((misIdx, optIdx) =>
        misIdx != null && selected.includes(optIdx) && misconceptions && misconceptions[misIdx] != null
          ? [misconceptions[misIdx]]
          : [],
      );
  return {
    overall: aggregateOverall(dimensions, rubric),
    dimensions,
    levels,
    evidence,
    strengths: correct ? ['选择正确'] : [],
    // 选择题判定性打分，不知道用户漏了哪个知识点，不伪造 gap（避免污染 Learner Memory）。
    gaps: [],
    missingConcepts: [],
    misconceptionIds,
    feedback: correct ? '回答正确。' : '回答错误。',
  };
}
