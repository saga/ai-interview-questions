// 类目 slug → 中文名。重构后 category 已与 taxonomy topic 对齐（28 话题），
// 兼容旧 6 域 slug，故合并 DOMAIN_LABELS + TOPIC_LABELS。
import { DOMAIN_LABELS, TOPIC_LABELS } from '../data/taxonomy';

export const CATEGORY_LABELS: Record<string, string> = { ...DOMAIN_LABELS, ...TOPIC_LABELS };

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug;
}
