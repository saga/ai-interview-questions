// 纯逻辑：变体候选的确定性校验（validateVariant）与落地（applyVariant）。
// 安全模型（ADR-036 / ADR-068 轻量变体）：LLM 只做**语义变换**（题干 + 选项文本逐项改写），
// 结构变换（选项规范化 / 顺序重排 / answer 索引重映射）与**全部校验**都由本模块完成；
// answer / explanation 永远来自 canonical，不经过 LLM。
// 本模块是全链路**唯一**的校验入口：`ai/variant.generateVariant` 只做 LLM 适配 + 解析，不做校验。

import type { GeneratedVariant, VariantCandidate } from '../types';
import type { FormatId } from '../schemas/common';
import type { Question } from '../schemas/question';
import { requiredPointsFor } from './knowledge/nodes';
import { shuffleChoiceOptions, normalizeAnswer, normalizeOptionText } from './options';
import { detectOptionLengthBias } from './bias';
import * as fuzz from 'fuzzball';

export interface VariantCheck {
  ok: boolean;
  /** 机器可读拒绝原因码（供 variant 遥测统计 fallback 率，如 'missing-options'）。 */
  code?: string;
  reason?: string;
  /** 软信号：通过但值得观测（如题干未命中字面锚点），不阻断。 */
  warning?: string;
}

/** 变体被拒的机器可读原因码（供 variant 遥测统计 fallback 率）。 */
export const VARIANT_REJECT_REASON = {
  /** 题干为空。 */
  EMPTY_QUESTION: 'empty-question',
  /** 题干含依赖原题的指代（原题/上述/前文…）。 */
  FORBIDDEN_REFERENCE: 'forbidden-reference',
  /** 选择题变体未提供 options。 */
  MISSING_OPTIONS: 'missing-options',
  /** 变体选项数量与 canonical 不一致。 */
  OPTION_COUNT_MISMATCH: 'option-count-mismatch',
  /** 选项为空字符串。 */
  EMPTY_OPTION: 'empty-option',
  /** 规范化后存在重复选项。 */
  DUPLICATE_OPTION: 'duplicate-option',
  /** 变体选项存在明显长度泄题（正确项过长）。 */
  OPTION_LENGTH_BIAS: 'option-length-bias',
} as const;

/**
 * 软信号文案：题干未命中任何字面锚点（漂移信号，非拒绝）。
 * 与 `VARIANT_REJECT_REASON` 严格区分——后者会导致回退原题，前者只写日志。
 */
export const STEM_ANCHOR_WARNING = 'variant stem has no lexical anchor';

const FORBIDDEN_REFERENCES = ['原题', '上述', '下文', '本文', '原文章', '原方案', '该方案', '前文', '题目中', '题干中'];

function normalizeConcept(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 题干文本（仅题干，不含选项）——字面锚点（stemAnchorMissing）的唯一证据面。 */
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
 * 漂移软信号（drift signal，**不是 gate**）：题干是否连 topic / tags / required 的
 * 一个字面锚点都没有命中。返回 true 表示「题干可能与主题脱钩」，只产 warning，绝不阻断。
 *
 * 证据面只取**题干**：概念出现在选项里 ≠ 题干在考察它——轻量变体下选项只是原选项的逐项
 * 改写，核心术语天然会被带进选项，把选项算作证据等于允许「题干漂移、靠选项兜底」。
 *
 * 为什么只能是软信号（2026-09-02 第五轮，从硬门槛降级）：字面锚点无法承担语义等价证明。
 * 反例：原题「为什么 KV Cache 能降低 prefill 成本？」的合法变体
 * 「某服务前缀高度重复却仍重复相同前向计算，如何降低开销？」一个锚点词都不含。
 * 轻量变体的目标只是「防止明显跑题」，而跑题的真正兜底是两条更硬的边界：
 * ① `VARIANT_SYSTEM` 的逐项一一对应约束（禁改技术结论/因果/适用条件/真假属性）；
 * ② `answer` / `explanation` 恒取 canonical——即便变体改歪，判分与解析仍按原题，不会判错题。
 * 因此未命中只记 warning；是否需要收紧，交由「测真实 fallback 率再调 gate」的观测路径决定。
 */
function stemAnchorMissing(canonical: Question, v: VariantCandidate | GeneratedVariant): boolean {
  const text = stemText(v);
  const anchors = [canonical.topic, ...canonical.tags, ...(requiredPointsFor(canonical) ?? [])]
    .map(normalizeConcept)
    .filter(Boolean);
  // 没有锚点可比对（题目标注缺失）→ 无从判定漂移，不告警，避免把「元数据不全」误报成「语义漂移」。
  if (anchors.length === 0) return false;
  return !anchors.some((a) => anchorHasEvidence(a, text));
}

// 注：此处曾存在 `requiredCoverageMet()`（requiredConcepts 字面覆盖需达 ≈2/3），
// 2026-09-01 第四轮**刻意删除**。理由：轻量变体的目标只是「防止明显跑题」，
// 而字面覆盖率无法承担「证明知识契约完全成立」的任务——它惩罚的是合法的好变体。
// 反例：原题「为什么 KV Cache 能降低 Transformer 推理的 prefill 成本？」
// 合法变体「某在线服务前缀高度重复，却仍重复执行相同前向计算，如何降低这部分开销？」
// 题干里没有 KV Cache / Transformer / prefill 任何一个词，却完全合法，会被 2/3 门槛误杀。
// 第五轮后同一个反例连宽松锚点也可能不命中，因此 stemAnchorMissing 只作漂移软信号（warning）：
// 硬门槛只剩选项结构不变量（必填/数量/非空/去重）+ 长度泄题检查，
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

/**
 * 校验变体候选——**全链路唯一的校验入口**（2026-09-02 第五轮消除双校验）。
 * 职责分层：`ai/variant.generateVariant` = LLM + parse；`finalizeQuestion` = validate + apply + fallback。
 *
 * 硬门槛（失败即回退原题）：
 *   - 题干非空、无依赖原题的指代
 *   - 选择题：options 必填且数量一致、非空、去重
 *   - 选择题：无长度泄题（抗暗示，且不重试）
 * 软信号（仅 warning，不阻断）：题干未命中 topic / tags / required 字面锚点。
 *
 *  @param format 本次会话实际形态（P0-1）；提供时以它决定选择/开放结构，否则回退到 canonical 是否含 choice。
 */
export function validateVariant(
  canonical: Question,
  v: VariantCandidate | GeneratedVariant,
  format?: FormatId,
): VariantCheck {
  if (!v || typeof v.question !== 'string' || !v.question.trim()) {
    return { ok: false, code: VARIANT_REJECT_REASON.EMPTY_QUESTION, reason: '变体题干为空' };
  }
  if (FORBIDDEN_REFERENCES.some((w) => v.question!.includes(w))) {
    return {
      ok: false,
      code: VARIANT_REJECT_REASON.FORBIDDEN_REFERENCE,
      reason: '题干包含依赖原题的指代，需自包含',
    };
  }

  // P0-1：以会话形态为准，而不是「canonical 有 choice 就当选择题」
  const isChoice = format ? format === 'choice' : !!canonical.formats.choice;
  if (isChoice) {
    const cf = canonical.formats.choice!;
    // 轻量变体契约：选择题变体 = 题干变换 + 选项逐项变换（顺序再由程序打乱）。
    // 因此 options 是**必填**——只改题干不动选项的候选一律拒绝：
    // 否则 applyVariant 会退化成「保留原选项 + 原顺序」，变体名存实亡（用户照样能凭选项记忆作答）。
    if (!Array.isArray(v.options)) {
      return {
        ok: false,
        code: VARIANT_REJECT_REASON.MISSING_OPTIONS,
        reason: '选择题变体缺少 options（需与题干一并逐项改写）',
      };
    }
    // 先规范化再校验：保证「校验对象 === 最终展示文本」。
    // 否则 "Redis" 与 " Redis " 在去重/长度检查里是两个不同选项，却会在 applyVariant 后渲染成同一文本。
    const options = v.options.map(normalizeOptionText);
    if (options.length !== cf.options.length) {
      return {
        ok: false,
        code: VARIANT_REJECT_REASON.OPTION_COUNT_MISMATCH,
        reason: '变体选项数量不能改变',
      };
    }
    if (options.some((o) => !o)) {
      return { ok: false, code: VARIANT_REJECT_REASON.EMPTY_OPTION, reason: '选项存在空字符串' };
    }
    if (hasDuplicateOptions(options)) {
      return { ok: false, code: VARIANT_REJECT_REASON.DUPLICATE_OPTION, reason: '选项存在重复' };
    }
    // 抗暗示硬失败（不再重新请求 LLM）：长度泄题。
    // 作用于规范化后的选项，且只对选择题执行——open 形态没有选项，语义上不适用。
    const bias = detectOptionLengthBias(options, cf.answer);
    if (bias.biased) {
      return {
        ok: false,
        code: VARIANT_REJECT_REASON.OPTION_LENGTH_BIAS,
        reason: `变体选项存在明显长度泄题：${bias.detail}`,
      };
    }
    // answer 永远来自 canonical，不在此校验——LLM 不重新决定答案。
  }

  // 软信号（不阻断，理由见 stemAnchorMissing 注释）：题干未命中任何字面锚点 → 仅告警。
  // 它不是「语义闸门」，不参与拒绝决策；与上面的硬门槛（结构 + 长度泄题）严格分离。
  if (stemAnchorMissing(canonical, v)) {
    return { ok: true, warning: STEM_ANCHOR_WARNING };
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
    // 规范化 → 打乱：与 validateVariant 的校验对象保持同一份文本
    // （校验阶段同样先 normalizeOptionText 再查数量/空串/去重/长度 bias）。
    // 顺序即「normalize → validate → shuffle」，而非「validate 原文 → shuffle → normalize」。
    const shuffled = shuffleChoiceOptions(v.options!.map(normalizeOptionText), cf.answer, rng);
    const options = shuffled.options;
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
