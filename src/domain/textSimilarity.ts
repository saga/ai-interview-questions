// 纯逻辑：CJK 感知的文本相似度（token 多重集 Dice）。
//
// 为什么不用 fuzzball 的 `token_set_ratio`：中文没有明显的词边界，fuzzball 的
// `full_process` 只在标点处切分，导致一整句中文退化成「1 个 token」，于是
// `token_set_ratio` 退化为整串 Levenshtein 比值。这同时造成两个方向的错误：
//   - 把「选项逐项同义改写」（共享大量汉字）误判为低相似 → 合法好变体被 drift 门禁误杀；
//   - 把「选项逐字相同、只换题干」的变体对误判为高相似 → variant-vs-variant near-dup 漏检。
// 详见 docs/DECISIONS.md 对应 ADR 与 ARCHITECTURE.md「技术栈注意点」。
//
// 本模块按字符粒度切中文、按词粒度切拉丁（kebab-case 拆词），再算 token 多重集 Dice：
//   Dice = 200 * |intersection| / (|A| + |B|)
// 字符级重叠天然区分「换词序/换句式」与「换概念」：同义改写共享大量汉字，
// 而偷换结论/真假属性几乎不共享汉字。校准（temp/calibrate-*.mjs）：
//   - 合法中文 paraphrases：44~74；换概念 swap：5~22；different-options 同题负样本 p95=38。
//   - 同选项 sibling（变体间近重复）min=74；差异化选项 sibling ≈47。
// 据此 drift 拒绝阈值 <35、dup 判定阈值 ≥70（见 domain/variant.ts）。

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

/** 把文本切成 token：中文按单字、拉丁/数字按连续词（kebab-case / snake_case 拆词）。小写化。 */
export function cjkTokenize(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };
  for (const ch of text.toLowerCase()) {
    if (CJK.test(ch)) {
      flush();
      out.push(ch);
    } else if (/[a-z0-9]/.test(ch)) {
      buf += ch;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/** token 多重集 Dice（0~100）：200 * 交集大小 / (|A| + |B|)。空对空=100，空对非空=0。 */
export function tokenMultisetDice(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let inter = 0;
  for (const t of b) {
    const n = counts.get(t) ?? 0;
    if (n > 0) {
      inter++;
      counts.set(t, n - 1);
    }
  }
  return (200 * inter) / (a.length + b.length);
}

/** 便捷函数：直接对两段文本算 CJK 感知 Dice（0~100）。 */
export function cjkDice(x: string, y: string): number {
  return tokenMultisetDice(cjkTokenize(x), cjkTokenize(y));
}
