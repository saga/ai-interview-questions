// 纯逻辑：变体候选的确定性校验（validateVariant）与落地（applyVariant）。
// 安全模型（ADR-036 / ADR-068 轻量变体）：LLM 只做**语义改写**（题干 + 选项文本逐项同义改写），
// 结构变换（选项规范化 / 顺序重排 / answer 索引重映射）与**全部校验**都由程序完成
// （deterministic structural safeguards）；answer / explanation 永远来自 canonical，不经过 LLM。
// 本模块是全链路**唯一**的校验入口：`ai/variant.generateVariant` 只做 LLM 适配 + 解析，不做校验。
// 注意：本设计只做「粗粒度结构 + 语义漂移防护」，**不验证语义等价 / 不证明知识契约成立**。

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
  /** 变体选项语义改写幅度过大（可能偷换结论 / 真假属性）。 */
  OPTION_SEMANTIC_DRIFT: 'option-semantic-drift',
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
 * ② `answer` / `explanation` 恒取 canonical——这只能防止 LLM 直接篡改 answer 索引，**无法**保证 LLM 改写 options 后正确 / 错误语义仍不变（见 `optionChangedTooMuch` 粗粒度防护）。
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
// 硬门槛只剩选项结构不变量（必填/数量/非空/去重）+ 长度泄题检查 + 选项语义漂移粗粒度防护，
// 语义正确性不能只靠「answer/explanation 恒取 canonical」兜底：它只防 answer 索引被篡改，
// 防不住 LLM 把某个正确/错误选项改写成完全不同语义；粗粒度兜底在 optionChangedTooMuch（改写过大直接 fallback）。

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
 * 选项语义漂移粗粒度防护：判断某个选项的改写是否越界。
 * 仅用 fuzzball `token_set_ratio` 做廉价相似度检查，**不证明语义等价**——
 * 只拦住「轻量改写突然变成完全不同的选项」这类明显越界（例如把正确项
 * 偷换成另一个技术结论）。阈值从宽：`< 45` 视为改写过大（reject），
 * `45~60` / `> 60` 均接受，避免正常中文 paraphrase 被误杀（与 lexical anchor
 * 降级为 warning 同样的克制）。
 */
function optionChangedTooMuch(original: string, rewritten: string): boolean {
  const a = normalizeOptionText(original);
  const b = normalizeOptionText(rewritten);
  if (!a || !b) return true;
  const ratio = fuzz.token_set_ratio(a, b);
  return ratio < 45;
}

/**
 * 校验变体候选——**全链路唯一的校验入口**（2026-09-02 第五轮消除双校验）。
 * 职责分层：`ai/variant.generateVariant` = LLM + parse；`finalizeQuestion` = validate + apply + fallback。
 *
 * 硬门槛（失败即回退原题）：
 *   - 题干非空、无依赖原题的指代
 *   - 选择题：options 必填且数量一致、非空、去重
 *   - 选择题：无长度泄题（抗暗示，且不重试）
 *   - 选择题：选项逐项语义未明显漂移（粗粒度 fuzz 相似度，非语义等价证明）
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
    // 选项语义漂移粗粒度防护（P0）：LLM 仅被允许「逐项同义改写」选项，
    // 并不保证改写后仍与原选项指向同一技术结论。若某个选项改写幅度过大
    // （与原选项语义脱钩，可能被偷换成不同结论 / 真假属性），直接 fallback，
    // 绝不让「轻量改写」变成「完全不同的选项」。注意：这不是语义等价证明，
    // 只是用 fuzzball `token_set_ratio` 拦住明显越界；阈值从宽（<45 才拒）。
    for (let i = 0; i < cf.options.length; i++) {
      if (optionChangedTooMuch(cf.options[i], options[i])) {
        return {
          ok: false,
          code: VARIANT_REJECT_REASON.OPTION_SEMANTIC_DRIFT,
          reason: `第 ${i + 1} 个选项改写幅度过大`,
        };
      }
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
