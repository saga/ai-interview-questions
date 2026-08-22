// 纯逻辑：LLM 变体的校验与落地。核心原则（见 ADR-006）：
// 变体的 answer key 必须来自原题，LLM 只改表达/选项顺序；校验失败则不使用变体。

import type { ChoiceQuestion, GeneratedVariant, OpenQuestion, Question } from '../types';
import { isChoice } from './quiz';

export interface VariantCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 校验 LLM 返回的变体是否安全可用。
 * - 选择题：options 长度须与原题一致；answer 索引须全部落在 [0, len) 内。
 * - 开放题：题干非空即可（答案由 LLM 后续评测，不在此校验）。
 */
export function validateVariant(canonical: Question, v: GeneratedVariant): VariantCheck {
  if (!v || typeof v.question !== 'string' || !v.question.trim()) {
    return { ok: false, reason: '变体题干为空' };
  }
  if (isChoice(canonical)) {
    const len = (canonical as ChoiceQuestion).options.length;
    if (!Array.isArray(v.options) || v.options.length !== len) {
      return { ok: false, reason: `选项数量不符（原题 ${len}，变体 ${v.options?.length}）` };
    }
    if (!Array.isArray(v.answer) || v.answer.length === 0) {
      return { ok: false, reason: '缺少答案索引' };
    }
    for (const i of v.answer) {
      if (!Number.isInteger(i) || i < 0 || i >= len) {
        return { ok: false, reason: `答案索引越界：${i}` };
      }
    }
  }
  return { ok: true };
}

/**
 * 把通过校验的变体落到题目上。开放题刻意保留原题的 referenceAnswer（答案 key 来自原题），
 * 仅替换题干与解析；选择题替换题干/选项/答案/解析，并把 aiGenerated 标为 true。
 */
export function applyVariant(canonical: Question, v: GeneratedVariant): Question {
  if (isChoice(canonical)) {
    const cq = canonical as ChoiceQuestion;
    return {
      ...cq,
      question: v.question,
      options: v.options ?? cq.options,
      answer: v.answer,
      explanation: v.explanation ?? cq.explanation,
      aiGenerated: true,
    };
  }
  const oq = canonical as OpenQuestion;
  return {
    ...oq,
    question: v.question,
    explanation: v.explanation ?? oq.explanation,
    aiGenerated: true,
  };
}
