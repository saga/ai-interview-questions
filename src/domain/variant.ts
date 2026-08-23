// 纯逻辑：LLM 变体的校验与落地。核心原则（见 ADR-006 / ADR-019）：
// LLM 只允许改题干与解析；选择题的 options/answer、开放题的 referenceAnswer
// 全部来自原题——从结构上杜绝"答案索引错位"事故，而不是靠校验去兜。

import type { GeneratedVariant, Question } from '../types';

export interface VariantCheck {
  ok: boolean;
  reason?: string;
}

/** 校验变体是否可用：唯一硬性要求是题干非空（options/answer/reference 不归 LLM 管）。 */
export function validateVariant(canonical: Question, v: GeneratedVariant): VariantCheck {
  void canonical;
  if (!v || typeof v.question !== 'string' || !v.question.trim()) {
    return { ok: false, reason: '变体题干为空' };
  }
  return { ok: true };
}

/**
 * 把通过校验的变体落到题目上：只替换 question / explanation。
 * options、answer、referenceAnswer 原样保留（answer key 来自原题）。
 */
export function applyVariant(canonical: Question, v: GeneratedVariant): Question {
  return {
    ...canonical,
    question: v.question,
    explanation: v.explanation ?? canonical.explanation,
    aiGenerated: true,
  };
}
