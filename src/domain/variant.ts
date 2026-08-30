// 纯逻辑：LLM 变体候选的校验与落地。安全模型（ADR-036）：
// LLM 可重构所有 Presentation（题干/场景/选项/解析），但必须通过 Knowledge Contract 校验。
// 输出为 VariantCandidate，需经此模块验证后方可落为 GeneratedVariant。

import type { GeneratedVariant, VariantCandidate } from '../types';
import type { VariantFormat } from '../schemas/common';
import type { Question } from '../schemas/question';
import { requiredPointsFor } from './knowledge';
import * as fuzz from 'fuzzball';

export interface VariantCheck {
  ok: boolean;
  reason?: string;
  warning?: string;
}

const FORBIDDEN_REFERENCES = ['原题', '上述', '下文', '本文', '原文章', '原方案', '该方案', '前文', '题目中', '题干中'];

function normalizeConcept(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 评估文本：仅题干 + 选项，刻意排除 explanation。
 * 理由（P0-2）：解析可「提到」required concept 却并未让题目真正考察该概念，
 * 把 explanation 当证据会让「题目已漂移、靠解析蒙混」的变体通过校验。
 */
function evidenceText(v: VariantCandidate | GeneratedVariant): string {
  return [v.question ?? '', ...(v.options ?? [])].join(' ').toLowerCase();
}

/** 单条 anchor（topic/tag/required）是否在文本中有证据（精确 token / 子 token / fuzzball 兜底）。 */
function anchorHasEvidence(anchor: string, text: string): boolean {
  if (text.includes(anchor)) return true;
  const tokens = anchor
    .split(/[\s，,。；;、\/:：]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  for (const tok of tokens) {
    if (text.includes(tok)) return true;
    // 英文 topic/tag 可能为 kebab-case，拆分后单 token 也需匹配（如 multi-agent → multi / agent）
    const subTokens = tok.split(/[-_]+/).filter((s) => s.length >= 2);
    for (const sub of subTokens) {
      if (text.includes(sub)) return true;
    }
  }
  // fuzzball 兜底（浏览器纯 JS，无后端）：处理词序/形态差异，如
  // "batch statistics" vs "statistics computed across the batch" → token_set 100；
  // "regularisation" vs "regularization" 拼写差异。阈值 75/80 兼顾形态变化与避免漂移误判。
  if (anchor.length >= 3) {
    try {
      if (fuzz.token_set_ratio(anchor, text) >= 75) return true;
      if (fuzz.partial_ratio(anchor, text) >= 80) return true;
    } catch {
      // fuzzball 异常时忽略，退化为精确匹配
    }
  }
  return false;
}

/**
 * 最小证据：topic / tags / required 中至少有一个在（题干+选项）中出现。
 * 这是「这道变体还在考原题主题」的硬门槛——整段丢失即判漂移。
 */
function hasMinimalEvidence(canonical: Question, v: VariantCandidate | GeneratedVariant): boolean {
  const text = evidenceText(v);
  const anchors = [canonical.topic, ...canonical.tags, ...(requiredPointsFor(canonical) ?? [])]
    .map(normalizeConcept)
    .filter(Boolean);
  if (anchors.length === 0) return true;
  return anchors.some((a) => anchorHasEvidence(a, text));
}

/**
 * requiredConcepts 覆盖率（P0-2）：不再「任一命中即通过」，要求达到约 2/3 覆盖。
 * 例如 3 个必考概念至少命中 2 个；1 个则全中。靠解析蒙混（explanation 提及）不计。
 */
function requiredCoverageMet(canonical: Question, v: VariantCandidate | GeneratedVariant): boolean {
  const required = (requiredPointsFor(canonical) ?? []).map(normalizeConcept).filter(Boolean);
  if (required.length === 0) return true;
  const text = evidenceText(v);
  const matched = required.filter((a) => anchorHasEvidence(a, text)).length;
  const need = Math.max(1, Math.round((required.length * 2) / 3));
  return matched >= need;
}

function hasDuplicateOptions(options: string[]): boolean {
  const seen = new Set<string>();
  for (const o of options) {
    const k = o.trim();
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/** 校验变体候选：结构 + 语义不变量。无兜底——失败即拒绝。
 *  @param format 本次会话实际形态（P0-1）；提供时以它决定选择/开放结构，否则回退到 canonical 是否含 choice。 */
export function validateVariant(
  canonical: Question,
  v: VariantCandidate | GeneratedVariant,
  format?: VariantFormat,
): VariantCheck {
  if (!v || typeof v.question !== 'string' || !v.question.trim()) {
    return { ok: false, reason: '变体题干为空' };
  }
  if (FORBIDDEN_REFERENCES.some((w) => v.question!.includes(w))) {
    return { ok: false, reason: '题干包含依赖原题的指代，需自包含' };
  }

  // P0-1：以会话形态为准，而不是「canonical 有 choice 就当选择题」
  const isChoice = format ? format === 'choice' : !!canonical.formats.choice;
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

  // 语义：最小证据（topic/tags/required 任一出现于题干+选项）+ required 覆盖率（约 2/3）。
  // 解析(explanation)不计入证据，避免「题目已漂移、靠解析蒙混」通过（P0-2）。
  if (!hasMinimalEvidence(canonical, v)) {
    return { ok: false, reason: '变体未保留 canonical topic / tags / required 的明显证据，疑似语义漂移' };
  }
  if (!requiredCoverageMet(canonical, v)) {
    return { ok: false, reason: '变体仅保留部分必考概念证据（requiredConcepts 未充分考察），疑似遗漏核心知识' };
  }

  return { ok: true };
}

/**
 * 把通过校验的变体落到题目上。
 * 选择题：替换 question / explanation / options / answer
 * 开放题：仅替换 question / explanation
 * @param format 本次会话实际形态（P0-1）；提供时以它决定呈现结构，否则回退到 canonical 是否含 choice。
 */
export function applyVariant(canonical: Question, v: GeneratedVariant, format?: VariantFormat): Question {
  const isChoice = format ? format === 'choice' : !!canonical.formats.choice;
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
