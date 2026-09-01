// 纯逻辑：LLM 变体候选的校验与落地。安全模型（ADR-036）：
// LLM 可重构所有 Presentation（题干/场景/选项/解析），但必须通过 Knowledge Contract 校验。
// 输出为 VariantCandidate，需经此模块验证后方可落为 GeneratedVariant。

import type { GeneratedVariant, VariantCandidate } from '../types';
import type { FormatId } from '../schemas/common';
import type { Question } from '../schemas/question';
import { requiredPointsFor } from './knowledge/nodes';
import { shuffleChoiceOptions, normalizeAnswer, normalizeOptionText } from './options';
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

/** 题干文本（仅题干，不含选项）——题干锚定（hasStemAnchor）与必考概念覆盖率（requiredCoverageMet）的证据面。 */
function stemText(v: VariantCandidate | GeneratedVariant): string {
  return (v.question ?? '').toLowerCase();
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
 * 题干锚定（P0-6）：topic / tags / required 中至少有一个必须出现在**题干本身**。
 *
 * 为什么把证据面从「题干+选项」收紧到「题干」：概念出现在选项里 ≠ 题干在考察它。
 * 「变体保持原题主题」的硬门槛不能靠选项兜底——否则 LLM 可以把核心概念全部挪进选项、
 * 题干改写成一个与主题无关的提问，靠选项蒙混通过最小证据检查。
 *
 * 这是「requiredConcepts 必须成为答题所必需的推理条件」的确定性代理：
 * 题干必须自身锚定主题/必考概念，才存在可判断的考察意图。刻意不引入
 * 关键词级「意图识别」（问句词/动词白名单易误伤合法变体），也暂不上 LLM/embedding judge。
 * 局限（承认而非隐藏）：锚定检查证明「题干提到核心概念」，不证明「推理必须用到它」；
 * 后者靠 ai/variant.ts 的生成提示约束 + 覆盖率规则（requiredCoverageMet）近似保证。
 */
function hasStemAnchor(canonical: Question, v: VariantCandidate | GeneratedVariant): boolean {
  const text = stemText(v);
  const anchors = [canonical.topic, ...canonical.tags, ...(requiredPointsFor(canonical) ?? [])]
    .map(normalizeConcept)
    .filter(Boolean);
  if (anchors.length === 0) return true;
  return anchors.some((a) => anchorHasEvidence(a, text));
}

/**
 * requiredConcepts 覆盖率（P0-2）：不再「任一命中即通过」，要求达到约 2/3 覆盖。
 * 例如 3 个必考概念至少命中 2 个；1 个则全中。
 *
 * 证据面（2026-09-01 收紧）：**只看题干**，刻意排除 explanation 与 options。
 * - 排除 explanation：解析可「提到」required concept 却没让题目真正考察它，靠解析蒙混不计。
 * - 排除 options：轻量变体下选项只是「对原选项的逐项语义改写」，核心术语天然会被带进选项文本
 *   （如原题问 positional encoding、选项里必然出现 positional encoding），
 *   把它当证据会让「题干已漂移、靠选项兜底」的变体通过校验——知识点出现在选项里 ≠ 题干在考察它。
 */
function requiredCoverageMet(canonical: Question, v: VariantCandidate | GeneratedVariant): boolean {
  const required = (requiredPointsFor(canonical) ?? []).map(normalizeConcept).filter(Boolean);
  if (required.length === 0) return true;
  const text = stemText(v);
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
  format?: FormatId,
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
    const hasOptions = Array.isArray(v.options);
    // 允许仅改题干而不动选项；提供选项时校验其结构（数量 / 非空 / 去重）。
    // answer 永远来自 canonical，不在此校验——LLM 不重新决定答案。
    if (hasOptions) {
      if (v.options!.length !== cf.options.length) {
        return { ok: false, reason: '变体选项数量不能改变' };
      }
      if (v.options!.some((o) => typeof o !== 'string' || !o.trim())) {
        return { ok: false, reason: '选项存在空字符串' };
      }
      if (hasDuplicateOptions(v.options!)) {
        return { ok: false, reason: '选项存在重复' };
      }
    }
  }

  // 语义：题干锚定（topic/tags/required 至少一个出现在题干本身）+ required 覆盖率（约 2/3）。
  // 两者的证据面都**只看题干**：解析(explanation)不计入（P0-2，避免靠解析蒙混）；
  // 选项(options)也不计入（轻量变体下选项只是逐项改写，核心术语必然出现在选项里，计入即失效）。
  if (!hasStemAnchor(canonical, v)) {
    return { ok: false, reason: '变体题干未锚定 canonical topic / tags / required（核心概念只出现在选项中，无考察意图），疑似语义漂移' };
  }
  if (!requiredCoverageMet(canonical, v)) {
    return { ok: false, reason: '变体仅保留部分必考概念证据（requiredConcepts 未充分考察），疑似遗漏核心知识' };
  }

  return { ok: true };
}

/**
 * 把通过校验的变体落到题目上。
 * 选择题：替换 question（LLM 语义变换）；选项文本若由 LLM 改写则采用，
 *   随后由程序 Fisher–Yates 重排顺序并确定性重映射 answer 索引（结构变换，LLM 不参与）。
 *   explanation 永远来自 canonical（LLM 不生成解析）。
 * 开放题：仅替换 question；explanation 来自 canonical。
 * @param format 本次会话实际形态（P0-1）；提供时以它决定呈现结构，否则回退到 canonical 是否含 choice。
 * @param rng 可选随机源，用于选项重排；默认 Math.random。测试可注入确定性 rng。
 */
export function applyVariant(
  canonical: Question,
  v: GeneratedVariant,
  format?: FormatId,
  rng?: () => number,
): Question {
  const isChoice = format ? format === 'choice' : !!canonical.formats.choice;
  if (isChoice) {
    const cf = canonical.formats.choice!;
    let options = cf.options;
    let answer = cf.answer;
    // 仅当 LLM 提供了改写后的选项时才重排；否则保留 canonical 原顺序（不引入未经 LLM 改写却重排的副作用）。
    if (v.options) {
      const shuffled = shuffleChoiceOptions(v.options, cf.answer, rng);
      options = shuffled.options.map(normalizeOptionText);
      answer = normalizeAnswer(shuffled.answer);
    }
    return {
      ...canonical,
      question: v.question,
      explanation: canonical.explanation,
      formats: {
        ...canonical.formats,
        choice: {
          ...cf,
          // 安全边界（ADR-036 轻量变体）：answer 永远来自 canonical 经确定性重映射，LLM 不得重新决定。
          options,
          answer,
        },
      },
      aiGenerated: true,
    };
  }
  return {
    ...canonical,
    question: v.question,
    explanation: canonical.explanation,
    aiGenerated: true,
  };
}
