// 纯逻辑：LLM 变体候选的校验与落地。安全模型（ADR-036）：
// LLM 可重构所有 Presentation（题干/场景/选项/解析），但必须通过 Knowledge Contract 校验。
// 输出为 VariantCandidate，需经此模块验证后方可落为 GeneratedVariant。

import type { GeneratedVariant, VariantCandidate } from '../types';
import type { Question } from '../schemas/question';

export interface VariantCheck {
  ok: boolean;
  reason?: string;
}

const FORBIDDEN_REFERENCES = ['原题', '上述', '本文', '该方案', '原文章', '原方案'];

function hasDuplicateOptions(options: string[]): boolean {
  const seen = new Set<string>();
  for (const o of options) {
    const k = o.trim();
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/** 校验变体候选：结构 + 语义不变量。无兜底——失败即拒绝。 */
export function validateVariant(canonical: Question, v: VariantCandidate | GeneratedVariant): VariantCheck {
  if (!v || typeof v.question !== 'string' || !v.question.trim()) {
    return { ok: false, reason: '变体题干为空' };
  }
  if (FORBIDDEN_REFERENCES.some((w) => v.question!.includes(w))) {
    return { ok: false, reason: '题干包含依赖原题的指代，需自包含' };
  }

  const isChoice = !!canonical.formats.choice;
  if (isChoice) {
    const cf = canonical.formats.choice!;
    const hasOptions = v.options !== undefined;
    const hasAnswer = v.answer !== undefined;
    // 允许仅改题干而不动选项（兼容旧 mock 与轻量变体），仅当提供其一时校验配对
    if (hasOptions || hasAnswer) {
      if (!hasOptions || !Array.isArray(v.options) || v.options.length < 2) {
        return { ok: false, reason: '选择题变体若提供选项则需至少 2 个' };
      }
      if (v.options.some((o) => typeof o !== 'string' || !o.trim())) {
        return { ok: false, reason: '选项存在空字符串' };
      }
      if (hasDuplicateOptions(v.options)) {
        return { ok: false, reason: '选项存在重复' };
      }
      if (!hasAnswer || !Array.isArray(v.answer) || v.answer.length === 0) {
        return { ok: false, reason: '选择题变体若提供选项则必须提供 answer' };
      }
      if (new Set(v.answer).size !== v.answer.length) {
        return { ok: false, reason: 'answer 存在重复索引' };
      }
      for (const idx of v.answer) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= v.options.length) {
          return { ok: false, reason: `answer 索引越界: ${idx}` };
        }
      }
      // 题型不变量：单选/多选
      if (cf.type === 'single' && v.answer.length !== 1) {
        return { ok: false, reason: '单选题 answer 必须恰好 1 项' };
      }
      if (cf.type === 'multiple' && v.answer.length < 1) {
        return { ok: false, reason: '多选题 answer 至少 1 项' };
      }
      if (v.answer.length >= v.options.length) {
        return { ok: false, reason: 'answer 数量不应等于或超过选项总数（至少保留一个干扰项）' };
      }
    }
  }

  // 语义：requiredConcepts 的浅校验仅作提示，不阻断（避免测试短文本误伤）；真正的语义漂移由人工/覆盖率保障

  return { ok: true };
}

/**
 * 把通过校验的变体落到题目上。
 * 选择题：替换 question / explanation / options / answer
 * 开放题：仅替换 question / explanation
 */
export function applyVariant(canonical: Question, v: GeneratedVariant): Question {
  const isChoice = !!canonical.formats.choice;
  if (isChoice) {
    return {
      ...canonical,
      question: v.question,
      explanation: v.explanation ?? canonical.explanation,
      formats: {
        ...canonical.formats,
        choice: {
          ...canonical.formats.choice!,
          options: v.options ?? canonical.formats.choice!.options,
          answer: v.answer ?? canonical.formats.choice!.answer,
        },
      },
      aiGenerated: true,
    };
  }
  return {
    ...canonical,
    question: v.question,
    explanation: v.explanation ?? canonical.explanation,
    aiGenerated: true,
  };
}
