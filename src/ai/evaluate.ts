// 开放/编程题评分（pi-ai one-shot 结构化生成，不需要 Agent）。
// 分数所有权（ADR-019）：LLM 只输出四维 dimensions + 反馈；综合分 overall
// 一律由 domain 的 aggregateOverall 按权重计算——LLM 不拥有最终分数。

import { extractJSON } from './pi';
import { aggregateOverall } from '../domain/evaluation';
import type { CompleteFn, EvaluationResult, OpenFormat, Question, ScoringRubric } from '../types';
import { EVAL_DIMENSIONS } from '../types';
import { llmEvaluationRawSchema } from '../schemas/evaluation';

const EVAL_SYSTEM = `你是一位严格的 AI 技术面试官，负责评估候选人的开放题/编程题回答。基于参考答案与评分量表给出多维评分与详细反馈。只输出 JSON，不要任何额外文字或 Markdown 代码块。`;

export interface EvalOptions {
  /** 四维权重，仅注入提示词供参考。题目级权重覆盖已移除（ADR-044），一律使用全局 rubric。 */
  rubric?: ScoringRubric;
  /** 必须覆盖的要点（命中情况计入 completeness），来自知识点节点的 required。 */
  requiredPoints?: string[];
  /** 额外评估要求（来自 InterviewDefinition.evaluationCriteria）。 */
  extraCriteria?: string;
}

const DEFAULT_RUBRIC: ScoringRubric = {
  correctness: 0.4,
  completeness: 0.2,
  architecture: 0.2,
  communication: 0.2,
};

/** 构建发给 LLM 的用户消息（题目 + 参考答案 + 回答 + 评分量表）。纯函数，便于测试。 */
export function buildEvalUser(q: Question, open: OpenFormat, answer: string, opts: EvalOptions = {}): string {
  const noAnswer = !answer || !answer.trim();
  return `题目（开放题${open.language ? '，语言：' + open.language : ''}）：
${q.question}
${q.reference?.concept ? '\n概念提示：\n' + q.reference.concept + '\n' : ''}
参考答案：
${open.referenceAnswer}
${q.explanation ? '\n题目解析（该题的评分锚点：请据此判断回答是否覆盖本题特有的关键结论）：\n' + q.explanation + '\n' : ''}
候选人回答：
${noAnswer ? '（未作答）' : answer}

请按以下四个维度各给 0-100 整数分：
- correctness：答案是否正确、是否命中核心要点
- completeness：是否覆盖应有要点、有无明显遗漏
- architecture：方案/代码结构是否合理、设计是否清晰（编程题看实现质量）
- communication：表达清晰度、条理与专业性

${opts.requiredPoints && opts.requiredPoints.length ? '必须覆盖的要点（命中情况计入 completeness）：\n' + opts.requiredPoints.map((p) => '- ' + p).join('\n') + '\n' : ''}
评分权重（仅供参考）：
${JSON.stringify(opts.rubric ?? DEFAULT_RUBRIC)}

${opts.extraCriteria ? '额外评估要求：' + opts.extraCriteria : ''}

请输出 JSON，字段：
- correctness / completeness / architecture / communication：0-100 整数
- feedback：总体反馈文字
- strengths：回答亮点（字符串数组）
- gaps：遗漏或错误的要点（字符串数组）`;
}

/**
 * 从 LLM 文本输出解析出结构化评估结果。纯函数，便于测试。
 * 综合分不采纳 LLM 输出——固定由 domain/aggregateOverall 计算（Domain 拥有分数）。
 * 边界：Zod 校验 LLM 形状（数据长什么样），domain clamp/聚合负责业务不变量。
 */
export function parseEvaluation(raw: string, open: OpenFormat, rubric: ScoringRubric): EvaluationResult {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const zero = EVAL_DIMENSIONS.reduce(
    (acc, d) => ({ ...acc, [d]: 0 }),
    {} as Record<(typeof EVAL_DIMENSIONS)[number], number>,
  );
  if (!raw || !raw.trim()) {
    return {
      overall: 0,
      dimensions: zero,
      strengths: [],
      gaps: [],
      feedback: '未作答。',
      referenceAnswer: open.referenceAnswer,
    };
  }
  const json = extractJSON<unknown>(raw);
  const validated = llmEvaluationRawSchema.safeParse(json);
  const out = validated.success ? validated.data : {};

  const dimensions = {
    correctness: clamp(out.correctness ?? 0),
    completeness: clamp(out.completeness ?? 0),
    architecture: clamp(out.architecture ?? 0),
    communication: clamp(out.communication ?? 0),
  };

  return {
    overall: aggregateOverall(dimensions, rubric),
    dimensions,
    strengths: Array.isArray(out.strengths) ? out.strengths : [],
    gaps: Array.isArray(out.gaps) ? out.gaps : [],
    feedback: out.feedback ?? '',
    referenceAnswer: open.referenceAnswer,
  };
}

/** 一次性评估开放/编程题（无流式、无状态；complete 由 provider 注入，对话式追问属 Mock Interview 未来能力）。 */
export async function evaluateOpenAnswer(
  q: Question,
  open: OpenFormat,
  userAnswer: string,
  complete: CompleteFn,
  rubric: ScoringRubric,
  extraCriteria?: string,
  requiredPoints?: string[],
): Promise<EvaluationResult> {
  if (!userAnswer || !userAnswer.trim()) {
    return parseEvaluation('', open, rubric);
  }
  const raw = await complete(
    EVAL_SYSTEM,
    buildEvalUser(q, open, userAnswer, { rubric, extraCriteria, requiredPoints }),
  );
  return parseEvaluation(raw, open, rubric);
}
