// 离线变体池加载：按 batch / topic 拆分的静态 JSON（content source），启动时经 import.meta.glob 合并。
// 与 questionBank 同构——变体**不嵌入** Question JSON，而是独立资产化（双模式 Variant 设计）。
// 目录为空 / 不存在时 import.meta.glob 返回 {}，variantPool 退化为 EMPTY_VARIANT_POOL（Pool-first 自动 no-op）。
// 运行时边界校验：Zod 负责形状合法性；应用层负责变体选择（见 domain/variantPool）。

import type { VariantPool, QuestionVariant } from '../schemas/variant';
import { variantPoolSchema, EMPTY_VARIANT_POOL } from '../schemas/variant';
import { formatSchemaErrorMessage } from '../schemas/errors';

const modules = import.meta.glob('./variants/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

/** 合并多个 batch 文件：按 questionId 聚合变体（多个文件可能含同一题的变体）。 */
function mergePools(pools: VariantPool[]): VariantPool {
  const variants: Record<string, QuestionVariant[]> = {};
  let generatedAt = 0;
  let promptVersion = 'unknown';
  for (const pool of pools) {
    generatedAt = Math.max(generatedAt, pool.generatedAt);
    if (pool.promptVersion) promptVersion = pool.promptVersion;
    for (const [qid, list] of Object.entries(pool.variants)) {
      variants[qid] = [...(variants[qid] ?? []), ...list];
    }
  }
  return { version: 1, generatedAt, promptVersion, variants };
}

const parsed: VariantPool[] = [];
for (const file of Object.keys(modules).sort()) {
  const result = variantPoolSchema.safeParse(modules[file]);
  if (!result.success) {
    throw new Error(formatSchemaErrorMessage(result.error, `变体池校验失败 ${file}`));
  }
  parsed.push(result.data);
}

export const variantPool: VariantPool = parsed.length > 0 ? mergePools(parsed) : EMPTY_VARIANT_POOL;
