// 纯逻辑：变体的**确定性语言质量门禁**（language sanity gate）。
//
// 为什么需要它——现有 `validateVariant` 拦的是「语义/结构」：
// 选项数量、空串、去重、长度泄题、选项漂移（cjkDice < 35）。
// 但它对语言质量完全失明：实测 evaluation 批次 42 条翻译腔变体的
// **最小 cjkDice = 39.0，全部高于漂移阈值 35 → 现有门禁 0 条拦住**。
// 语义有效 ≠ 语言质量，这是两类失败，必须两道门。
//
// 本模块只做**确定性**判定（无 LLM、无词典、无网络），分两类：
//   BLOCK —— 形式性缺陷，一旦出现几乎必然是坏的；
//   WARN  —— 统计性嫌疑，只报告不阻断。
//
// **归类是实测出来的，不是拍脑袋定的。** 判定标准：拿 1308 道 canonical 自查
// （好内容不该被拦），再拿 234 条真实变体看拦脏率。四条规则因为误伤合法技术写法
// 被从 BLOCK 降到 WARN，每条的降级理由都写在对应代码处：
//   - `option-too-short`   ：40 个合法短选项（「2 倍」「无监督学习」）
//   - `unbalanced-bracket` ：`[0, ∞)` 半开区间合法，且脏数据 0 命中
//   - `repeated-clause`    ：单字 Dice 把「时间复杂度」与「空间复杂度」判成重复
//   - `cjk-latin-glue`     ：`GPT4`、`L2` 紧凑写法合法
// 另有两条 BLOCK 规则的**正则被实测收窄**（不是放宽）：
//   - `double-punctuation` 去掉 `: . ! ?`，否则误伤 `aten::addmm`、`...`、`!!!`
//   - `incomplete-sentence` 去掉 `:`，否则误伤「下列说法正确的是：」
//
// 校准脚本见 temp/probe-gate-combo.mjs、temp/probe-clause-order.mjs、temp/verify-gate.ts。

import { cjkDice } from './textSimilarity';

/** 机器可读拒绝原因码（与 `VARIANT_REJECT_REASON` 同风格，供遥测统计）。 */
export const LANGUAGE_SANITY_REASON = {
  /** 题干或选项含异常/乱码字符（控制字符、零宽、私用区、U+FFFD）。 */
  GARBLED: 'garbled-unicode',
  /** 连续中文句读标点（如「。；」「，，」）。 */
  DOUBLE_PUNCT: 'double-punctuation',
  /** 【软】括号不配对。 */
  UNBALANCED_BRACKET: 'unbalanced-bracket',
  /** 以逗号/顿号/分号收尾 —— 句子没写完（冒号不在此列，见下方说明）。 */
  INCOMPLETE: 'incomplete-sentence',
  /** 【软】选项过短，可能无法承载一个独立判断。 */
  TOO_SHORT: 'option-too-short',
  /** 【软】同一选项内部出现高度重复的分句。 */
  REPEATED_CLAUSE: 'repeated-clause',
  /** 从句被整块倒装（机器翻译腔的典型形式特征）。 */
  CLAUSE_INVERSION: 'clause-inversion',
  /** 【软】汉字与拉丁字母/数字直接粘连，缺少分隔。 */
  CJK_LATIN_GLUE: 'cjk-latin-glue',
} as const;

/** 从句倒置率上限（%）。实测：干净变体 p95 = 0，翻译腔变体 p50 = 100。 */
export const MAX_CLAUSE_INVERSION = 70;

/**
 * 选项最小字符数（去空白后）——**仅作 WARN 的阈值**。
 *
 * 为什么不是硬门禁：实测 1308 道 canonical 里有 40 个短于 8 字符的选项，
 * 全是合法的（「2 倍」「4 倍」「无监督学习」「使用迁移学习」「只负责保存日志」），
 * 8 字符下限会误伤 16 道题。短 ≠ 残缺，「残缺」由 `INCOMPLETE`（以逗号收尾）来判定。
 */
export const MIN_OPTION_LENGTH = 4;

/** 参与重复分句判定的最短分句长度（字符）。短于此的分句不参与比对。 */
const MIN_CLAUSE_LENGTH = 6;

/** 分句重复判定阈值（cjkDice，%）。 */
const REPEATED_CLAUSE_THRESHOLD = 85;

/**
 * 分句参与倒置计算的**最低匹配分**（cjkDice，%）。
 *
 * 为什么必须有这个下限：greedy 匹配对「与 canonical 任何分句都零字面重叠」的重述分句
 * 会退化成「取第一个」，凭空造出逆序对 —— 实测一个合法变体因此被判 100% 倒置而误杀。
 * 例：canonical「避免每步重算整个前缀，」/ 变体「导致开销随长度累积」零重叠，
 * 该分句应当被排除，而不是被当成「跑到了最前面」。
 *
 * 取值 20 的依据：低于 drift 拒绝阈值（35），即「连漂移门禁都觉得不像同一个选项」的分句，
 * 不配提供顺序证据。真实池中翻译腔分句的同源匹配分远高于此，故不影响拦脏率。
 */
const CLAUSE_MATCH_MIN = 20;

// 异常 Unicode：C0 控制字符（不含 \n \r \t）、DEL、替换符 U+FFFD、
// 零宽/方向字符（ZWSP..RLM、WordJoiner、BOM）、私用区、非字符 U+FFFE/U+FFFF。
// 这些在正常文本里永远不该出现，出现即编码事故或模型吐出了乱码。
// 用 \u 转义而非字面控制字符——源码里嵌原始控制字符会被编辑器/工具链悄悄改写。
const GARBLED_UNICODE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\uFFFD\\u200B-\\u200F\\u2060-\\u2064\\uFEFF\\uE000-\\uF8FF\\uFFFE\\uFFFF]',
);

// 连续**中文句读**标点。「。」「；」「，」等连续堆叠是句读崩坏的直接证据。
//
// 为什么不含 `: . ! ?`：实测 canonical 里 5 处命中全部是合法技术写法——
//   `aten::addmm`（C++ 命名空间）、`torch.triu(..., diagonal=1)`（省略号参数）、
//   `!!! 不要办理开户 !!!`（强语气强调）。
// 收窄到中文句读后，这 5 处全部消失，而脏数据里的「。；」「，。」照旧被抓。
const DOUBLE_PUNCTUATION = /[。；;，,、]{2,}/;

// 以「句子内部标点」收尾 = 话没写完。
// **不含冒号**：实测 canonical 里 15 处以冒号收尾的题目全部是标准中文出题写法
// （「下列说法正确的是：」用冒号引出选项），冒号收尾 ≠ 句子不完整。
const INCOMPLETE_TAIL = /[，,、；;]$/;

// 汉字与拉丁/数字直接粘连（缺空格）。注意：命中不等于错
// （「GPT4」这类写法合法），故只作 WARN。
const CJK_LATIN_GLUE = /[一-鿿][A-Za-z0-9]|[A-Za-z0-9][一-鿿]/;

export type LanguageSanitySeverity = 'block' | 'warn';

export interface LanguageSanityIssue {
  code: string;
  severity: LanguageSanitySeverity;
  /** 命中位置：`stem` 或 `option`。 */
  field: 'stem' | 'option';
  /** `field === 'option'` 时的选项下标（0-based）。 */
  index?: number;
  /** 人类可读说明，直接进报告。 */
  detail: string;
}

export interface LanguageSanityResult {
  /** 无 BLOCK 级问题即为 true。WARN 不影响。 */
  ok: boolean;
  issues: LanguageSanityIssue[];
  /** 命中的 BLOCK 码（去重），便于统计。 */
  blockCodes: string[];
  /** 命中的 WARN 码（去重）。 */
  warnCodes: string[];
}

/** 按句读切分（保留末尾标点，使「悬空逗号」可见）。 */
export function splitClauses(text: string): string[] {
  return (text ?? '')
    .split(/(?<=[。；;！!？?，,、])/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * 从句倒置率（0~100）：变体的每个分句贪心匹配最相似的 canonical 分句，
 * 得到下标序列，返回其**逆序对比例**。
 *
 * 为什么这条能抓机器翻译腔：翻译腔的改写方式是「从句整块倒装」——
 *   原文：聚焦 A 做评测，B 不必纳入考察；因为 C，把 D 就行。
 *   变体：把 D 亦就是可。C，因为 B，聚焦 A 做评估，
 * 分句内容还在、字也还在，所以**单字 Dice 掉得不多**（漂移门禁看不见），
 * 但**顺序全反了**。合法的重述改写保留叙述顺序（先结论后理由 → 仍先结论后理由），
 * 所以倒置率接近 0。实测：192 条干净变体 p50/p75/p90/p95 全为 0，
 * 42 条翻译腔变体 p50 = 100。
 *
 * 两侧分句数 < 2 时无从判定顺序，返回 0（不惩罚短句）。
 * 有效匹配（分 ≥ `CLAUSE_MATCH_MIN`）不足 2 个时同样返回 0 —— 没有足够证据就不下结论。
 */
export function clauseInversion(canonicalText: string, variantText: string): number {
  const cs = splitClauses(canonicalText);
  const vs = splitClauses(variantText);
  if (cs.length < 2 || vs.length < 2) return 0;
  const idx: number[] = [];
  for (const vc of vs) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < cs.length; i++) {
      const score = cjkDice(cs[i], vc);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    // 零重叠 / 极低重叠的分句不提供顺序证据，排除（详见 CLAUSE_MATCH_MIN 注释）。
    if (bestScore >= CLAUSE_MATCH_MIN) idx.push(best);
  }
  if (idx.length < 2) return 0;
  let inversions = 0;
  let total = 0;
  for (let i = 0; i < idx.length; i++) {
    for (let j = i + 1; j < idx.length; j++) {
      total++;
      if (idx[i] > idx[j]) inversions++;
    }
  }
  return total === 0 ? 0 : (inversions / total) * 100;
}

function hasUnbalancedBrackets(s: string): boolean {
  return (
    s.split('（').length !== s.split('）').length ||
    s.split('(').length !== s.split(')').length ||
    s.split('【').length !== s.split('】').length ||
    s.split('[').length !== s.split(']').length
  );
}

/** 检查一段文本的形式性缺陷（不含需要 canonical 对照的规则）。 */
function checkText(
  text: string,
  field: 'stem' | 'option',
  index: number | undefined,
  issues: LanguageSanityIssue[],
): void {
  const push = (code: string, severity: LanguageSanitySeverity, detail: string) =>
    issues.push({ code, severity, field, ...(index === undefined ? {} : { index }), detail });

  if (GARBLED_UNICODE.test(text)) {
    push(LANGUAGE_SANITY_REASON.GARBLED, 'block', '含异常/乱码字符（控制字符、零宽、私用区或替换符）');
  }
  if (DOUBLE_PUNCTUATION.test(text)) {
    push(LANGUAGE_SANITY_REASON.DOUBLE_PUNCT, 'block', '出现连续同类标点');
  }
  // 括号不配对只作 WARN：实测「cosine 的取值范围是 [0, ∞)」这类半开区间数学写法
  // 会让「分别计数 [ 与 ]」的规则误报，而真实脏数据里 0 命中——收益为 0，不敢硬拦。
  if (hasUnbalancedBrackets(text)) {
    push(LANGUAGE_SANITY_REASON.UNBALANCED_BRACKET, 'warn', '括号不配对（半开区间等写法可能误报）');
  }
  if (INCOMPLETE_TAIL.test(text.trim())) {
    push(LANGUAGE_SANITY_REASON.INCOMPLETE, 'block', '以逗号/顿号/分号收尾，句子不完整');
  }
  if (field === 'option' && text.replace(/\s/g, '').length < MIN_OPTION_LENGTH) {
    push(LANGUAGE_SANITY_REASON.TOO_SHORT, 'warn', `选项过短（< ${MIN_OPTION_LENGTH} 字符）`);
  }
  if (CJK_LATIN_GLUE.test(text)) {
    // 只作 WARN：GPT4、L2 这类紧凑写法是合法的，不能因此拒绝。
    push(LANGUAGE_SANITY_REASON.CJK_LATIN_GLUE, 'warn', '汉字与拉丁字母/数字直接粘连');
  }
  // 重复分句只作 WARN：单字 Dice 对短句分辨力差，实测把
  // 「时间复杂度 O(N² · D²)」与「空间复杂度 O(N² · D)」判成重复（共享大量字符但语义相反）。
  // 且真实脏数据里仅 1 条命中，收益不足以支撑硬拦。
  const clauses = splitClauses(text).filter((c) => c.length >= MIN_CLAUSE_LENGTH);
  for (let i = 0; i < clauses.length; i++) {
    for (let j = i + 1; j < clauses.length; j++) {
      if (cjkDice(clauses[i], clauses[j]) >= REPEATED_CLAUSE_THRESHOLD) {
        push(LANGUAGE_SANITY_REASON.REPEATED_CLAUSE, 'warn', `第 ${i + 1} 与第 ${j + 1} 个分句高度重复`);
        return;
      }
    }
  }
}

export interface LanguageSanityInput {
  /** 变体题干。 */
  stem: string;
  /** 变体选项（选择题）；开放题传 undefined。 */
  options?: string[];
}

export interface LanguageSanityCanonical {
  /** canonical 题干，用于从句倒置比对。 */
  stem: string;
  /** canonical 选项（按下标一一对应变体选项）。 */
  options?: string[];
}

/**
 * 对一条变体做确定性语言质量检查。
 *
 * 调用位置（管线顺序，评审确认的形状）：
 *   over-sample → **结构校验 validateVariant** → **语言门禁本函数** → 语义漂移质询（5D challenger）→ 去重/排序
 * 语言门禁放在 5D challenger **之前**：它是零成本纯函数，先把明显的语言垃圾筛掉，
 * 不浪费昂贵的 LLM 质询；而且 5D challenger 被告知了标准答案，只回答「结论还在不在」，
 * 天然看不见语言质量（这正是它放行了 42 条翻译腔的原因）。
 *
 * @param variant 变体文本（题干 + 选项）
 * @param canonical 原题文本（题干 + 选项），用于从句倒置比对
 */
export function checkLanguageSanity(
  variant: LanguageSanityInput,
  canonical: LanguageSanityCanonical,
): LanguageSanityResult {
  const issues: LanguageSanityIssue[] = [];

  checkText(variant.stem, 'stem', undefined, issues);
  if (variant.options) {
    variant.options.forEach((o, i) => checkText(o ?? '', 'option', i, issues));
  }

  // 从句倒置：逐个选项比对 canonical 对应选项，取最大值。
  // 用 max 而非 avg：一个选项语序崩坏就足以让整条变体不可用（考生要读它）。
  if (variant.options && canonical.options) {
    let worst = 0;
    let worstIndex = -1;
    for (let i = 0; i < variant.options.length; i++) {
      const canonicalOpt = canonical.options[i];
      if (canonicalOpt == null) continue;
      const inv = clauseInversion(canonicalOpt, variant.options[i] ?? '');
      if (inv > worst) {
        worst = inv;
        worstIndex = i;
      }
    }
    if (worst >= MAX_CLAUSE_INVERSION) {
      issues.push({
        code: LANGUAGE_SANITY_REASON.CLAUSE_INVERSION,
        severity: 'block',
        field: 'option',
        index: worstIndex,
        detail: `第 ${worstIndex + 1} 个选项从句倒置率 ${worst.toFixed(0)}%（上限 ${MAX_CLAUSE_INVERSION}%）`,
      });
    }
  }

  const blockCodes = [...new Set(issues.filter((i) => i.severity === 'block').map((i) => i.code))];
  const warnCodes = [...new Set(issues.filter((i) => i.severity === 'warn').map((i) => i.code))];
  return { ok: blockCodes.length === 0, issues, blockCodes, warnCodes };
}

/** 报告用：把致命问题渲染成一行。 */
export function formatSanityIssues(result: LanguageSanityResult): string {
  return result.issues
    .filter((i) => i.severity === 'block')
    .map((i) => `${i.field}${i.index === undefined ? '' : `[${i.index}]`}: ${i.detail}`)
    .join('；');
}
