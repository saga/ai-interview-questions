// 纯逻辑：变体候选的确定性校验（validateVariant）与落地（applyVariant）。
// 安全模型（ADR-036 / ADR-068 轻量变体）：LLM 只做**语义改写**（题干 + 选项文本逐项同义改写），
// 结构变换（选项规范化 / 顺序重排 / answer 索引重映射）与**全部校验**都由程序完成
// （deterministic structural safeguards）；answer / explanation 永远来自 canonical，不经过 LLM。
// 本模块是全链路**唯一**的校验入口：`ai/variant.generateVariant` 只做 LLM 适配 + 解析，不做校验。
// 注意：本设计只做「粗粒度结构 + 语义漂移防护」，**不验证语义等价 / 不证明知识契约成立**。

import type { GeneratedVariant, VariantCandidate } from '../types';
import type { FormatId } from '../schemas/common';
import type { Question } from '../schemas/question';
import type { VariantKind } from '../schemas/variant';
import { requiredPointsFor } from './knowledge/nodes';
import { shuffleChoiceOptions, normalizeAnswer, normalizeOptionText } from './options';
import { detectOptionLengthBias } from './bias';
import { cjkDice } from './textSimilarity';
import {
  isAssessmentIdentical,
  type ReasoningPath,
} from './reasoningPath';
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
 * 用 CJK 感知的字符级 Dice（`cjkDice`，见 textSimilarity.ts）做廉价相似度检查，
 * **不证明语义等价**——只拦住「轻量改写突然变成完全不同的选项」这类明显越界
 * （例如把正确项偷换成另一个技术结论）。
 *
 * 为什么用 CJK Dice 而非 fuzzball `token_set_ratio`：中文无词边界，fuzzball 退化成
 * 整串 Levenshtein，会把合法中文 paraphrase 误判为低相似（误杀好变体）。校准显示
 * 合法逐项同义改写 Dice ≈44~74、偷换结论/真假属性 ≈5~22。阈值取 35：
 * 合法改写必过（>35）、明显越界必拒（<35），且与下面 dup 阈值（≥70）留出活动窗口。
 */
function optionChangedTooMuch(original: string, rewritten: string): boolean {
  const a = normalizeOptionText(original);
  const b = normalizeOptionText(rewritten);
  if (!a || !b) return true;
  return cjkDice(a, b) < 35;
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
    // 只是用 CJK 感知字符级 Dice（`cjkDice`，见 textSimilarity.ts）拦住明显越界；
    // 阈值从宽（<35 才拒；合法中文 paraphrase 约 44~74，换概念 swap 约 5~22）。
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
 * 变体可自声明的测量面（ADR-077：offline variant 是 assessment variant，可换 angle / cognitiveTask）。
 * Runtime 的 `GeneratedVariant` 结构上不含这两项 ⇒ 天然只能是 presentation variant。
 */
export type VariantMeasurementFace = Partial<Pick<Question, 'angle' | 'cognitiveTask' | 'assessment'>>;

/**
 * 取出变体自声明的测量面（P1-1）：只有离线 Assessment Variant 会带这些字段，
 * Runtime Presentation Variant 结构上没有 ⇒ 返回空对象，applyVariant 自然继承 canonical。
 *
 * 存在意义：池命中路径此前手工拼 `{ question, options }` 交给 applyVariant，
 * **把池条目声明的测量面整段丢掉** —— schema 允许、applyVariant 支持，却在衔接处被抹掉
 * （与 2026-09-04 修过的「落库即丢」是同一类衔接 bug）。所有「从变体取测量面」都必须走这里。
 */
export function measurementFaceOf(v: VariantMeasurementFace): VariantMeasurementFace {
  return {
    ...(v.angle ? { angle: v.angle } : {}),
    ...(v.cognitiveTask ? { cognitiveTask: v.cognitiveTask } : {}),
    ...(v.assessment ? { assessment: v.assessment } : {}),
  };
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
  v: GeneratedVariant & VariantMeasurementFace,
  format?: FormatId,
  rng?: () => number,
): Question {
  // 两类 Variant 在这里分道（ADR-077 / P1-1 方案 A）：
  //   Offline Assessment Variant —— 池内条目可自声明 angle / cognitiveTask / assessment，声明即采用；
  //   Runtime Presentation Variant —— `GeneratedVariant` 只有 question/options，
  //     schema 层也禁止 runtime 条目带测量面 ⇒ 恒继承 canonical，assessment identity 不变。
  // 因此同一个 applyVariant 同时服务两者，不需要运行时分支。
  //
  // ⚠️ 2026-09-04 修复：此前 schema 有这些字段、注释声称「applyVariant 优先采用」，
  //    但本函数只做 ...canonical + 覆盖 question ⇒ 声明的测量面**落库即丢**，
  //    且全仓无消费者。与 plan0903_2 §二-A 记过的「字段被静默丢弃」是同一类问题。
  const face: Partial<Question> = measurementFaceOf(v);
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
      ...face,
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
    ...face,
    question: v.question,
    explanation: canonical.explanation,
    aiGenerated: true,
  };
}

/**
 * variant-vs-variant 近重复阈值（`cjkDice(选项级) ≥` 该值即判为近重复）。
 *
 * 与 `optionChangedTooMuch` 的漂移阈值（<35 拒）构成一对**反向约束**：每个选项对 canonical
 * 必须 ≥35（不能改到认不出），同一题的两个变体选项之间必须 <88（不能改了等于没改）。
 *
 * 为什么比对「选项」而非「题干+选项整体指纹」：实测真实池选项平均 62 字符（长句），
 * 同选项 sibling 在整体指纹上 CJK Dice 仅 74.5~96.4，而「选项重述改写」的变体整体 Dice ≈83——
 * 两者重叠，整串度量**无法区分「照抄选项」与「重述选项」**。改比选项级后：
 *   同选项（逐字相同）  = 100；轻改（同义替换）≈ 91；重述改写 ≈ 54。
 * 阈值取 88：捕获「逐字照抄(100)」与「轻改(91)」（轻改不算真正多样化），放行「重述改写(54)」。
 * 这正是「根治单题双变体选项雷同」的硬约束——只换题干/只轻改选项都逃不过门禁。
 * 校准见 temp/probe-realpool.mjs / temp/probe-optonly.mjs。
 */
export const VARIANT_DUP_THRESHOLD = 88;

/**
 * 变体的「选项指纹」（去重专用）：仅全部选项（经 `normalizeOptionText` 规范化）拼接。
 * 近重复门禁只比对选项——题干本就该随变体不同，不该成为相似度证据；而「选项是否雷同」
 * 才是单题双变体多样性的真正判定面（见 `VARIANT_DUP_THRESHOLD` 注释）。
 */
export function variantOptionText(v: { options?: string[] }): string {
  return (v.options ?? []).map(normalizeOptionText).join(' | ');
}

/**
 * 变体的完整指纹：题干 + 全部选项（均经 `normalizeOptionText` 规范化）。
 * 保留给需要整体标识的场合（如测试断言指纹计入选项）；近重复门禁已改用 `variantOptionText`。
 */
export function variantFingerprint(v: { question?: string; options?: string[] }): string {
  const opts = (v.options ?? []).map(normalizeOptionText).join(' | ');
  return `${normalizeOptionText(v.question ?? '')} || ${opts}`;
}

export interface NearDuplicatePair {
  /** 两个变体在 `list` 中的下标。 */
  i: number;
  j: number;
  ratio: number;
}

/**
 * 找出一组变体内部的近重复配对（variant-vs-variant）。
 *
 * 放在 domain 而非某个脚本里，是为了让**离线生成器与池审计共用同一条规则**——
 * 此前该规则只存在于 `scripts/validate-variants.ts`，`scripts/assemble-variants.ts`
 * 这条组装通道完全绕过了它，导致「生成管线会拒绝的批次，组装通道却能照常落盘」。
 */
export function findNearDuplicateVariants(
  list: Array<{ question?: string; options?: string[] }>,
  threshold: number = VARIANT_DUP_THRESHOLD,
): NearDuplicatePair[] {
  const out: NearDuplicatePair[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      // 仅比对选项级指纹：题干差异不应计入相似度，选项雷同才是判定面。
      const ratio = cjkDice(variantOptionText(list[i]), variantOptionText(list[j]));
      if (ratio >= threshold) out.push({ i, j, ratio: Math.round(ratio) });
    }
  }
  return out;
}

export interface SemanticDuplicatePair extends NearDuplicatePair {
  /** 判定依据：options（选项雷同）/ reasoning-path（同路径逐字重复）/ stem（同 kind 题干照抄）。 */
  basis: 'options' | 'reasoning-path' | 'stem';
  detail: string;
}

export interface SemanticDuplicateItem {
  id: string;
  kind?: VariantKind;
  question?: string;
  options?: string[];
  /** 已声明的测量意图（assessment variant）；缺省 = 继承 canonical（presentation）。 */
  assessment?: ReasoningPath;
}

/**
 * 语义级变体重复检测（Offline P0-4）：同一 questionId 内，文本明显不同但
 * reasoning path 相同也判重复——不能只靠字符 Dice / Fuzzball。
 *
 * 三条判定面（任一命中即重复）：
 *   1. options：选项级指纹 Dice ≥ 阈值（沿用 findNearDuplicateVariants 同一条规则）。
 *   2. reasoning-path：双方都声明了测量意图且逐字相同（isAssessmentIdentical）。
 *      未声明（继承 canonical）的 presentation 变体豁免——它们与 canonical 同路径
 *      是定义使然，不在此判罪（措辞多样性由第 1 条约束）。
 *   3. stem：同 kind 下题干近乎逐字相同（Dice ≥ 92）——连题干都没改，kind 白标了。
 */
export function findSemanticDuplicateVariants(
  list: SemanticDuplicateItem[],
  threshold: number = VARIANT_DUP_THRESHOLD,
): SemanticDuplicatePair[] {
  const out: SemanticDuplicatePair[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const optRatio = cjkDice(variantOptionText(a), variantOptionText(b));
      if (optRatio >= threshold) {
        out.push({
          i,
          j,
          ratio: Math.round(optRatio),
          basis: 'options',
          detail: `选项雷同（相似度 ${Math.round(optRatio)} ≥ ${threshold}）`,
        });
        continue;
      }
      if (a.assessment && b.assessment && isAssessmentIdentical(a.assessment, b.assessment)) {
        out.push({
          i,
          j,
          ratio: 100,
          basis: 'reasoning-path',
          detail: '双方声明的 assessment.target + reasoningGoal 逐字相同：文本不同但测的是同一条推理链',
        });
        continue;
      }
      if (a.kind && a.kind === b.kind) {
        const stemRatio = cjkDice(a.question ?? '', b.question ?? '');
        if (stemRatio >= 92) {
          out.push({
            i,
            j,
            ratio: Math.round(stemRatio),
            basis: 'stem',
            detail: `同 kind（${a.kind}）题干近乎照抄（相似度 ${Math.round(stemRatio)} ≥ 92）`,
          });
        }
      }
    }
  }
  return out;
}

// ── difficulty-preserved 确定性/结构性检查（Offline P1-8，离线专用） ──
//
// challenger 的 difficulty-preserved 是单条 LLM 判断，会漏掉四类结构性作弊：
// 新增 prerequisite / 删除关键条件 / 引入额外 domain knowledge / 提供额外暗示。
// 这些在文本层面有迹可循，先用零成本的纯函数拦截，通过的再交给 LLM 质询。
//
// 注意：本检查是**启发式**，只用于离线生成管线与组装器（候选不过就丢掉重采，
// 超采下成本可忽略），不进 runtime validateVariant——runtime 误杀一条变体 =
// 一次用户可见的 fallback 降级，阈值必须不同。

/** 限定词：删掉会改变命题真假或难度的词。 */
const QUALIFIERS = ['只有', '必须', '所有', '绝不', '总是', '从不', '唯一', '排他', '恰好', '至少', '至多'];

/** 拉丁技术词（长度 ≥3，排除纯数字）：用于新前提 / 暗示检测。 */
function latinTerms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9.\-]{2,}/g) ?? []).filter((t) => /[a-z]/.test(t));
}

/** 数字条件 token（含 $T \ge 20$、512、73% 这类）：删掉即改变题目约束。 */
function numericTokens(text: string): string[] {
  return text.match(/[0-9]+(\.[0-9]+)?%?/g) ?? [];
}

export type DifficultyDriverFlag =
  | 'dropped-qualifier'
  | 'dropped-numeric-condition'
  | 'new-prerequisite'
  | 'extra-hint';

export interface DifficultyDriverCheck {
  ok: boolean;
  flags: Array<{ flag: DifficultyDriverFlag; detail: string }>;
}

/**
 * 检查候选题干是否动了题目的难度驱动项。返回 ok=false 即应在确定性门禁拦截。
 *
 * 四类拦截（任一命中即不过）：
 *   - dropped-qualifier：canonical 题干有限定词，变体一个不剩 → 条件被删，题变难或真假翻转。
 *   - dropped-numeric-condition：canonical 题干的数字条件在变体题干里一个都不出现 →
 *     关键约束被删（数字改写成汉字的情况由 LLM 质询兜底，这里只拦整段丢失）。
 *   - new-prerequisite：变体题干引入 ≥3 个 canonical（题干 + 选项）完全没有的拉丁技术词 →
 *     需要额外领域知识，题变难。
 *   - extra-hint：变体题干含有「正确项独有、干扰项没有、原题干也没有」的拉丁关键词 →
 *     把答案线索泄进了题干，题变简单。
 *
 * 开放题同样适用（只看题干）；选择题额外看选项面。
 *
 * @param kind 变体风格。`context*` 允许在题干中加入工程背景（场景细节是题干给出的
 *   已知条件，不是考生需自带的前提），因此 `new-prerequisite` 只对 `surface*` 生效；
 *   其余三项与 kind 无关（删条件、泄暗示在任何风格下都是作弊）。
 */
export function checkOfflineDifficultyDrivers(
  canonical: Question,
  variant: { question: string; options?: string[] },
  kind?: VariantKind,
): DifficultyDriverCheck {
  const flags: DifficultyDriverCheck['flags'] = [];
  const cStem = canonical.question ?? '';
  const vStem = variant.question ?? '';
  const canonicalPool = `${cStem} || ${(canonical.formats.choice?.options ?? []).join(' | ')}`;

  const cQuals = QUALIFIERS.filter((q) => cStem.includes(q));
  if (cQuals.length > 0 && !QUALIFIERS.some((q) => vStem.includes(q))) {
    flags.push({
      flag: 'dropped-qualifier',
      detail: `原题限定词（${cQuals.join('/')}）在变体题干里全部丢失`,
    });
  }

  const cNums = [...new Set(numericTokens(cStem))];
  // 只看「实质性」数字条件：多位数字 / 小数 / 百分比。单个数字（题号、版本号、
  // 「第 1 步」这类行文编号）在改写中丢失是常态，不代表约束被删——拦它只会误杀。
  const substantive = cNums.filter((n) => n.replace(/%/g, '').length >= 2 || n.includes('.'));
  if (substantive.length > 0) {
    const vNums = new Set(numericTokens(vStem));
    const kept = substantive.filter((n) => vNums.has(n));
    if (kept.length === 0) {
      flags.push({
        flag: 'dropped-numeric-condition',
        detail: `原题数字条件（${substantive.slice(0, 4).join('/')}）在变体题干里一个都不出现`,
      });
    }
  }

  const poolTerms = new Set(latinTerms(canonicalPool));
  const fresh = latinTerms(vStem).filter((t) => !poolTerms.has(t));
  const freshUnique = [...new Set(fresh)];
  // 仅 surface* 拦截：context* 的场景细节是题干给出的已知条件（见函数注释）。
  const isContextKind = kind === 'context' || kind === 'context-options';
  if (!isContextKind && freshUnique.length >= 3) {
    flags.push({
      flag: 'new-prerequisite',
      detail: `变体题干引入原题没有的新技术词（${freshUnique.slice(0, 5).join('/')} 等 ${freshUnique.length} 个），可能需要额外领域知识`,
    });
  }

  const choice = canonical.formats.choice;
  const vOpts = variant.options;
  if (choice && vOpts && vOpts.length === choice.options.length) {
    const correct = choice.answer.filter((i) => i < choice.options.length).map((i) => choice.options[i]);
    const distractors = choice.options.filter((_, i) => !choice.answer.includes(i));
    const distractorTerms = new Set(distractors.flatMap(latinTerms));
    const canonStemTerms = new Set(latinTerms(cStem));
    // topic / tags 自带词出现在题干是正常的（锚定主题），不算泄题暗示。
    const themeTerms = new Set(latinTerms(`${canonical.topic} ${(canonical.tags ?? []).join(' ')}`));
    const hintTerms = [...new Set(correct.flatMap(latinTerms))].filter(
      (t) =>
        !distractorTerms.has(t) &&
        !canonStemTerms.has(t) &&
        !themeTerms.has(t) &&
        latinTerms(vStem).includes(t),
    );
    if (hintTerms.length > 0) {
      flags.push({
        flag: 'extra-hint',
        detail: `变体题干泄入正确项独有关键词（${hintTerms.slice(0, 4).join('/')}），可能提供额外暗示`,
      });
    }
  }

  return { ok: flags.length === 0, flags };
}

// ── Top-N 多样性选择（Offline P1-6：超采 → deterministic gate → challenger → top-N） ──
//
// 此前按 challenger 总分取最高分：候选可能 N 条全是高质量但彼此雷同的 paraphrase。
// 改为贪心 MMR：分数打底，逐轮选「分数 − 与已选集合的相似惩罚」最大者。
// 惩罚三项：wording（选项文本 Dice）、reasoning-path（同声明路径）、kind（同 kind）。

export interface DiverseCandidate {
  /** 候选标识（用于测试断言；生产侧传下标或 id 均可）。 */
  key: string;
  kind: VariantKind;
  /** challenger 分数（0~1；全 pass 候选同为 1 时多样性完全决定排序）。 */
  score: number;
  /** 去重用选项文本（与 VARIANT_DUP_THRESHOLD 同口径）。 */
  optionText: string;
  /** 题干文本（同 kind 下题干照抄的第二道防线）。 */
  stemText: string;
  /** 声明的测量路径指纹（规范化 target + goal；presentation 候选为 null）。 */
  pathKey: string | null;
}

export interface DiversityWeights {
  /** 选项文本相似惩罚系数（默认 0.5：Dice 100 的候选扣 0.5 分）。 */
  wording?: number;
  /** 同 kind 惩罚（默认 0.15）。 */
  kind?: number;
  /** 同 reasoning-path 惩罚（默认 0.6：同路径候选几乎不可能同时入选）。 */
  path?: number;
}

/** 规范化测量路径指纹：target + reasoningGoal 去空白小写拼接。 */
export function reasoningPathKeyOf(path: ReasoningPath | undefined): string | null {
  if (!path) return null;
  const t = (path.target ?? '').replace(/\s+/g, '').toLowerCase();
  const g = (path.reasoningGoal ?? '').replace(/\s+/g, '').toLowerCase();
  if (!t && !g) return null;
  return `${t} || ${g}`;
}

/**
 * 贪心 MMR 取 top-N：首轮取最高分，之后每轮取「score − 惩罚」最大者。
 * 同分时优先选与已选集合 kind 不同、路径不同的候选（sort 的 tie-break 显式写出，
 * 不依赖 Array.sort 的稳定性假设——V8 虽稳定，但把意图写进比较器更易审计）。
 */
export function selectDiverseTopN<T extends DiverseCandidate>(
  candidates: T[],
  want: number,
  weights: DiversityWeights = {},
): T[] {
  const { wording = 0.5, kind = 0.15, path = 0.6 } = weights;
  const picked: T[] = [];
  const rest = [...candidates];
  while (picked.length < want && rest.length > 0) {
    let bestIdx = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      let penalty = 0;
      for (const p of picked) {
        penalty = Math.max(penalty, (cjkDice(c.optionText, p.optionText) / 100) * wording);
        if (c.kind === p.kind) penalty = Math.max(penalty, kind);
        if (c.pathKey && p.pathKey && c.pathKey === p.pathKey) penalty = Math.max(penalty, path);
        if (c.stemText && p.stemText && cjkDice(c.stemText, p.stemText) >= 92) {
          penalty = Math.max(penalty, kind);
        }
      }
      const value = c.score - penalty;
      if (value > bestValue) {
        bestValue = value;
        bestIdx = i;
      }
    }
    picked.push(rest.splice(bestIdx, 1)[0]);
  }
  return picked;
}
