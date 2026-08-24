// 类目 slug（= 6 大能力域）→ 中文展示名。题库里 category 存域 slug（机器可读），UI 用此映射显示。
// 域定义以 src/data/taxonomy.ts 为单一真理来源，这里直接复用其 DOMAIN_LABELS，避免两处漂移。

import { DOMAIN_LABELS } from '../data/taxonomy';

export const CATEGORY_LABELS: Record<string, string> = { ...DOMAIN_LABELS };

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug;
}
