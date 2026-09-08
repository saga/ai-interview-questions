// convert-blueprint-output.ts 的纯逻辑（便于单测，AGENTS.md §4）。
// Part2 以 option key 对齐的 misconceptionMap（如 {A:0,B:null}）→ schema 要求的「按 option 索引数组」。

export type MisconceptionMap = Record<string, number | null> | null | undefined;

/**
 * 把 key 对齐的 misconceptionMap 转成选项索引数组。
 * 返回 `problems` 收集校验失败（缺 key / 正确选项标了误解），供调用方汇入 errors。
 */
export function mapMisconceptionMap(
  options: { key: string }[],
  answerIndices: number[],
  keyed: MisconceptionMap,
  itemId: string,
): { array: (number | null)[] | null; problems: string[] } {
  if (!keyed) return { array: null, problems: [] };
  const problems: string[] = [];
  const array = options.map((o) => {
    if (!(o.key in keyed)) {
      problems.push(`${itemId}: misconceptionMap 缺少 key "${o.key}"`);
      return null;
    }
    return keyed[o.key] ?? null;
  });
  for (const idx of answerIndices) {
    if (array[idx] !== null) {
      problems.push(`${itemId}: 正确选项 ${options[idx].key} 不应标注误解（保持 null）`);
    }
  }
  return { array, problems };
}

/** 两个 misconceptionMap 数组是否逐项相等（用于 variant vs canonical 一致性校验）。 */
export function misconceptionMapsEqual(a: (number | null)[] | null, b: (number | null)[] | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
