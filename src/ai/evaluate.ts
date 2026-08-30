// 开放/编程题评分（pi-ai one-shot 结构化生成，不需要 Agent）。
// 分数所有权（ADR-019）：LLM 只输出四维 dimensions + 反馈；综合分 overall
// 一律由 domain 的 aggregateOverall 按权重计算——LLM 不拥有最终分数。

import { extractJSON } from './pi';
import { aggregateOverall } from '../domain/evaluation';
import type { CompleteFn } from '../types';
import { EVAL_DIMENSIONS } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { OpenFormat, Question } from '../schemas/question';
import type { ScoringRubric } from '../schemas/interview';
import { llmEvaluationRawSchema } from '../schemas/evaluation';

// 评估系统提示（稳定前缀，KV-Cache 友好）：角色 + 判断标准 + 四维评分原则 + 责任边界 + JSON 输出契约。
// 所有「随题目变化」的内容都在 buildEvalUser 里（用户消息），本常量不含任何动态数据——
// 这样同一场面试里多次评分可复用同一个被缓存的 system 前缀（DeepSeek Context Caching 命中）。
export const EVAL_SYSTEM = `[PROMPT-VERSION v1]

你是一个严格、客观的 AI 技术面试评估器。你只负责评估，不负责出题、不负责讲解、也不决定最终分数。

【你的判断标准】
1. 判断候选人是否真正理解了知识点，而不是是否「提到了关键词」。
2. 区分「提到了正确术语」与「理解了机制 / 权衡 / 边界」。
3. 不因答案更长而提高评分，不因表达漂亮而掩盖技术错误。
4. 不猜测候选人没有表达出来的知识；没有证据就给低分。
5. 不因为回答风格口语化而扣分，只评估技术内容本身。

【四维评分原则】
四个维度各自独立、互不影响：
- correctness：正确性（核心结论是否成立、是否命中关键要点）
- completeness：完整性（是否覆盖应有要点、有无明显遗漏）
- architecture：设计 / 架构质量（方案是否合理、结构是否清晰；编程题看实现质量）
- communication：表达清晰度（条理、专业度）
给分要有区分度：完全正确且有机制理解 → 85-100；只答对要点但无机制理解 → 60-80；有明显技术错误 → <60。

【责任边界（重要）】
- 你只评估上述四个维度；综合分 overall 由系统按固定权重聚合，你不要计算 overall，也不要输出 overall 字段。
- 评分权重是系统的聚合规则，不是你的输出项。

【JSON 输出契约】
只输出一个 JSON 对象，不要任何额外文字或 Markdown 代码块。字段与类型：
{
  "correctness": 0,        // 0-100 整数
  "completeness": 0,       // 0-100 整数
  "architecture": 0,       // 0-100 整数
  "communication": 0,      // 0-100 整数
  "strengths": [],         // 字符串数组：有证据的回答亮点
  "gaps": [],              // 字符串数组：遗漏或错误的要点
  "feedback": ""           // 总体反馈文字
}
strengths / gaps 只列有证据支撑的条目。`;

export interface EvalOptions {
  /** 四维权重，仅注入提示词供参考。题目级权重覆盖已移除（ADR-044），一律使用全局 rubric。 */
  rubric?: ScoringRubric;
  /** 必须覆盖的要点（命中情况计入 completeness），来自知识点节点的 required。 */
  requiredPoints?: string[];
  /** 额外评估要求（来自 InterviewDefinition.evaluationCriteria）。 */
  extraCriteria?: string;
}

/** 构建发给 LLM 的用户消息（仅承载随题目变化的动态数据：题目 / 参考答案 / 解析 / 回答 / 要点）。
 *  评分维度、JSON 契约、责任边界等稳定内容都在 EVAL_SYSTEM，从而形成可缓存的稳定前缀。纯函数，便于测试。 */
export function buildEvalUser(q: Question, open: OpenFormat, answer: string, opts: EvalOptions = {}): string {
  const noAnswer = !answer || !answer.trim();
  return `题目（开放题${open.language ? '，语言：' + open.language : ''}）：
${q.question}
参考答案：
${open.referenceAnswer}
${q.explanation ? '\n题目解析（本题评分锚点：请据此判断回答是否覆盖特有关键结论）：\n' + q.explanation + '\n' : ''}
候选人回答：
${noAnswer ? '（未作答）' : answer}

${opts.requiredPoints && opts.requiredPoints.length ? '必须覆盖的要点（命中情况计入 completeness）：\n' + opts.requiredPoints.map((p) => '- ' + p).join('\n') + '\n' : ''}
${opts.extraCriteria ? '额外评估要求：' + opts.extraCriteria + '\n' : ''}
${opts.rubric ? '评分维度权重（系统聚合用，仅供参考；你只需按 [JSON 输出契约] 评估四维，不要计算综合分）：\n' + JSON.stringify(opts.rubric) + '\n' : ''}
按 [JSON 输出契约] 输出 JSON（不要计算 overall）。`;
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
  systemPrompt = EVAL_SYSTEM,
): Promise<EvaluationResult> {
  if (!userAnswer || !userAnswer.trim()) {
    return parseEvaluation('', open, rubric);
  }
  const raw = await complete(
    systemPrompt,
    buildEvalUser(q, open, userAnswer, { rubric, extraCriteria, requiredPoints }),
  );
  return parseEvaluation(raw, open, rubric);
}
