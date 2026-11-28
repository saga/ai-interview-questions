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

export interface BlueprintKnowledgeIdentity {
  id: string;
  topic: string;
  courseId?: string;
  knowledgeId?: string;
  blueprintKnowledgeId?: string;
}

/**
 * Check the identity carried from Part 1 Blueprint through the Part 2 Question.
 * Question.topic and knowledgeId must both identify the same KnowledgeNode.id.
 * KnowledgeNode.topic is the shared classification field, not Question.topic.
 */
export function validateBlueprintKnowledgeIdentity(item: BlueprintKnowledgeIdentity): string[] {
  const problems: string[] = [];
  if (item.courseId && !item.knowledgeId) {
    problems.push(`${item.id}: 课程题缺少精确 knowledgeId`);
  }
  if (item.courseId && item.knowledgeId && item.topic !== item.knowledgeId) {
    problems.push(`${item.id}: 课程题的 topic 必须等于 knowledgeId（KnowledgeNode.id）`);
  }
  if (item.blueprintKnowledgeId && item.knowledgeId && item.blueprintKnowledgeId !== item.knowledgeId) {
    problems.push(
      `${item.id}: blueprintKnowledgeId "${item.blueprintKnowledgeId}" 与 knowledgeId "${item.knowledgeId}" 不一致`,
    );
  }
  return problems;
}
