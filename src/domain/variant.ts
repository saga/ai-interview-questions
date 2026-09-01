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
 * 局限（承认而非隐藏）：锚定检查只证明「题干仍与主题相关」，不证明「推理必须用上每个 required」。
 * 后者不再用字面覆盖率近似（2026-09-01 第四轮删除 requiredCoverageMet），而由两条更硬的边界兜底：
 * ① `VARIANT_SYSTEM` 的逐项一一对应约束（禁改技术结论/因果/适用条件/真假属性）；
 * ② `answer` / `explanation` 恒取 canonical——即便变体改歪，判分与解析仍然按原题，不会判错题。
 */
function hasStemAnchor(canonical: Question, v: VariantCandidate | GeneratedVariant): boolean {
  const text = stemText(v);
  const anchors = [canonical.topic, ...canonical.tags, ...(requiredPointsFor(canonical) ?? [])]
    .map(normalizeConcept)
    .filter(Boolean);
  if (anchors.length === 0) return true;
  return anchors.some((a) => anchorHasEvidence(a, text));
}

// 注：此处曾存在 `requiredCoverageMet()`（requiredConcepts 字面覆盖需达 ≈2/3），
// 2026-09-01 第四轮**刻意删除**。理由：轻量变体的目标只是「防止明显跑题」，
// 而字面覆盖率无法承担「证明知识契约完全成立」的任务——它惩罚的是合法的好变体。
// 反例：原题「为什么 KV Cache 能降低 Transformer 推理的 prefill 成本？」
// 合法变体「某在线服务前缀高度重复，却仍重复执行相同前向计算，如何降低这部分开销？」
// 题干里没有 KV Cache / Transformer / prefill 任何一个词，却完全合法，会被 2/3 门槛误杀。
// 漂移防护改由 hasStemAnchor（宽松锚点）+ 选项结构不变量（数量/非空/去重）+ 长度泄题检查承担，
// 语义正确性由「answer/explanation 恒取 canonical」这条硬边界兜底——变体改错也不会判错题。

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
    // 轻量变体契约：选择题变体 = 题干变换 + 选项逐项变换（顺序再由程序打乱）。
    // 因此 options 是**必填**——只改题干不动选项的候选一律拒绝：
    // 否则 applyVariant 会退化成「保留原选项 + 原顺序」，变体名存实亡（用户照样能凭选项记忆作答）。
    if (!Array.isArray(v.options)) {
      return { ok: false, reason: '选择题变体缺少 options（需与题干一并逐项改写）' };
    }
    if (v.options.length !== cf.options.length) {
      return { ok: false, reason: '变体选项数量不能改变' };
    }
    if (v.options.some((o) => typeof o !== 'string' || !o.trim())) {
      return { ok: false, reason: '选项存在空字符串' };
    }
    if (hasDuplicateOptions(v.options)) {
      return { ok: false, reason: '选项存在重复' };
    }
    // answer 永远来自 canonical，不在此校验——LLM 不重新决定答案。
  }

  // 语义闸门（仅一层）：题干锚定——topic / tags / required 至少一个出现在**题干本身**。
  // 证据面只看题干：解析(explanation)不计入（避免靠解析蒙混）；
  // 选项(options)也不计入（轻量变体下选项只是逐项改写，核心术语必然出现在选项里，计入即失效）。
  // 刻意不再叠加 requiredConcepts 字面覆盖率门槛（详见上方 requiredCoverageMet 删除说明）。
  if (!hasStemAnchor(canonical, v)) {
    return { ok: false, reason: '变体题干未锚定 canonical topic / tags / required，疑似语义漂移' };
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
    // 轻量变体契约下 options 必填（validateVariant 已强制），无需再分支回退：
    // 无条件重排 + 无条件重映射，杜绝「选项没改却先打乱」或「改了却沿用原顺序」的中间态。
    const shuffled = shuffleChoiceOptions(v.options!, cf.answer, rng);
    const options = shuffled.options.map(normalizeOptionText);
    const answer = normalizeAnswer(shuffled.answer);
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
