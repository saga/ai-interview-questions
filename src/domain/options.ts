// 纯逻辑：选择题选项的结构性变换（程序负责，不依赖 LLM）。
// 含 Fisher–Yates 随机打乱 + answer 索引确定性重映射、顺序变化保证、多选题答案归一化、文本规范化。
//
// 设计边界（ADR-036 轻量变体收缩）：选项顺序 / 答案重映射 / 格式 / 校验全部由程序完成，
// LLM 只负责「逐个改写选项文本」，绝不决定顺序或答案。

export interface ShuffledOptions {
  options: string[];
  answer: number[];
}

/**
 * Fisher–Yates 打乱选项，并确定性地把 canonical 的 answer 索引重映射到新顺序。
 * @param options 选项文本（与 canonical 一一对应，顺序即 originalIndex）
 * @param answer  canonical 的 answer 索引（基于原始顺序）
 * @param rng     可选随机源，默认 Math.random；测试可注入确定性 rng。
 */
export function shuffleChoiceOptions(
  options: string[],
  answer: number[],
  rng: () => number = Math.random,
): ShuffledOptions {
  const items = options.map((text, index) => ({ text, originalIndex: index }));

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  // 保证顺序确实改变：若打乱后与原顺序完全相同（极小概率），交换前两项。
  // 不影响答案正确性——下方按 originalIndex 重映射，交换只是改变呈现顺序。
  if (items.length >= 2 && items.every((it, idx) => it.originalIndex === idx)) {
    [items[0], items[1]] = [items[1], items[0]];
  }

  const newAnswer = items
    .map((item, newIndex) => (answer.includes(item.originalIndex) ? newIndex : -1))
    .filter((i) => i >= 0);

  return {
    options: items.map((item) => item.text),
    answer: newAnswer,
  };
}

/**
 * 若打乱结果与原始顺序完全相同，交换前两项以保证机械变化一定发生（纯算法，无 LLM）。
 * 通用纯函数，便于单测；shuffleChoiceOptions 内部已内置等价保证。
 */
export function ensureDifferentOrder<T>(original: T[], shuffled: T[]): T[] {
  if (original.length < 2) return shuffled;
  const same = shuffled.every((value, i) => value === original[i]);
  if (same) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }
  return shuffled;
}

/** 多选题 answer 索引归一化为升序（确定性展示，不改变语义）。 */
export function normalizeAnswer(answer: number[]): number[] {
  return [...answer].sort((a, b) => a - b);
}

/** 选项文本轻量规范化：折叠多余空白、去首尾空格（防止 LLM 输出 Markdown/空白噪声）。 */
export function normalizeOptionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
