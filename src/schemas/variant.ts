// 变体资产契约（Zod 即单一数据源）。
// 双模式 Variant 设计（见用户设计 spec + docs/DECISIONS.md）：
//   - Offline Variant Pool：题目变体作为题库资产（离线预生成，提交进仓库），训练时零 LLM 直接落地；
//   - Runtime Variant（可选开关，默认 OFF）：仅 Pool 未命中时的 fallback，且结果**不写回**题库。
// 两者共用本契约的 VariantKind / QuestionVariant / VariantPool，以及同一套
// `domain/variant` 的 validateVariant / applyVariant（不写第二套实现）。
// 变体**不嵌入** Question JSON，单独存于 `src/data/variants/*.json`（按 batch / topic 聚合）。

import { z } from 'zod';

/** 变体改写风格（轻量变体边界内的 4 种风格，不改变「LLM 只做语义变换」的硬约束）。 */
export const variantKindSchema = z.enum([
  'surface', // 仅改写题干表达（开放题或选择题均可；选择题须同时改写选项）
  'context', // 在题干中加入简短工程上下文后改写
  'surface-options', // 改写题干 + 逐项改写选项
  'context-options', // 加入上下文 + 改写题干 + 逐项改写选项
]);
export type VariantKind = z.infer<typeof variantKindSchema>;

/** 变体来源：离线池资产 or 运行时 fallback（运行时结果不落盘）。 */
export const variantGeneratorSchema = z.enum(['offline', 'runtime']);
export type VariantGenerator = z.infer<typeof variantGeneratorSchema>;

/**
 * 单条题目变体（已校验，可落地）。
 * id 为变体自身稳定 id（格式建议 `${questionId}__${kind}__${seq}`，如 `q-123__surface-options__0`），
 * 与 canonical Question.id 不同——用于 seenVariantIds 去重与 telemetry 归因。
 */
export const questionVariantSchema = z.object({
  id: z.string().min(1),
  kind: variantKindSchema,
  question: z.string().min(1),
  /** 选择题变体必填（轻量变体契约要求选项逐项改写）；开放题不出现此字段。 */
  options: z.array(z.string()).optional(),
  /** 生成时间戳（ms），用于 stale 判定与审计。 */
  generatedAt: z.number(),
  generator: variantGeneratorSchema,
  /** 生成时使用的 prompt 版本（来自 VARIANT_SYSTEM 的 [PROMPT-VERSION vN] 头），供 stale 判定。 */
  promptVersion: z.string().min(1),
  /** canonical 题目内容指纹（FNV-1a），用于检测 canonical 已变更导致的 stale 变体。 */
  sourceHash: z.string().min(1),
});
export type QuestionVariant = z.infer<typeof questionVariantSchema>;

/** 变体池：多个 batch 文件经前端/离线合并后的内存形态。 */
export const variantPoolSchema = z.object({
  version: z.literal(1),
  generatedAt: z.number(),
  promptVersion: z.string().min(1),
  /** questionId → 该题目的多条变体（离线生成默认每题 2 条）。 */
  variants: z.record(z.string(), z.array(questionVariantSchema)),
});
export type VariantPool = z.infer<typeof variantPoolSchema>;

/** 空池（无变体资产时默认）。 */
export const EMPTY_VARIANT_POOL: VariantPool = {
  version: 1,
  generatedAt: 0,
  promptVersion: 'unknown',
  variants: {},
};

/** 计算 sourceHash 时取自 canonical 的最小内容（足以检测题目内容漂移）。 */
export interface VariantSource {
  id: string;
  question: string;
  /** 选择题选项（按其 canonical 顺序）；开放题为 undefined。 */
  options?: string[];
}

/**
 * FNV-1a（32-bit）纯同步哈希，作为 canonical 题目内容指纹。
 * 纯函数、零依赖、确定性——可用于离线脚本 Node 侧与浏览器侧，无需 crypto。
 * 仅哈希「题面 + 选项文本」，answer / explanation 不入指纹（变体落地时恒取 canonical 的 answer）。
 */
export function computeVariantSourceHash(source: VariantSource): string {
  const normalized: VariantSource = {
    id: source.id,
    question: (source.question ?? '').trim(),
    options: (source.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0),
  };
  const input = JSON.stringify(normalized);
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 0x01000193，用 Math.imul 保持 32-bit 乘法
    hash = Math.imul(hash, 0x01000193);
  }
  hash >>>= 0; // 转无符号
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}
