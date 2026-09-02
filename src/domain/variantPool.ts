// 离线变体池解析（双模式 Variant 设计的「Pool-first」确定性部分）。
// 本模块只做**确定性选择**，不调用 LLM、不做校验（校验统一在 sessionEvaluator.finalizeQuestion 的
// validateVariant 一处，保持轻量变体的单一校验门禁）。运行时 fallback（1 次 LLM）也在 finalizeQuestion 内编排。
//
// 设计红线（见用户设计 spec）：
//   - Offline Variant Pool 是默认路径：命中即零 LLM 直接落地；
//   - Runtime Variant（runtimeVariantEnabled，默认 OFF）只是 Pool miss 时的可选兜底；
//   - 两者共用同一套 validateVariant / applyVariant，不写第二套实现。

import type { Question } from '../schemas/question';
import type { VariantPool, QuestionVariant } from '../schemas/variant';
import { computeVariantSourceHash } from '../schemas/variant';

/** 取某题在池中的所有变体（无则返回空数组）。 */
export function getAvailableVariants(pool: VariantPool, questionId: string): QuestionVariant[] {
  return pool.variants[questionId] ?? [];
}

/**
 * 从候选变体中选一条落地：跳过本会话已用过的，用确定性 rng 打乱后取首个以提升多样性。
 * 若全部已用过（seen 覆盖全集），则允许复用（避免无变体可用）。
 * @param seen 本会话内已落地过的变体 id 集合（调用方负责 add，避免重复）。
 * @param rng 可选随机源（默认 Math.random）；测试可注入确定性 rng。
 */
export function selectVariant(
  variants: QuestionVariant[],
  seen?: Set<string>,
  rng: () => number = Math.random,
): QuestionVariant | null {
  if (variants.length === 0) return null;
  const fresh = seen && seen.size > 0 ? variants.filter((v) => !seen.has(v.id)) : variants;
  const candidate = fresh.length > 0 ? fresh : variants;
  if (candidate.length === 0) return null;
  // 确定性 Fisher–Yates 打乱（用注入的 rng）后取首个：避免每次都选列表首个，提升会话内多样性。
  // 不用 `sort(() => rng() - 0.5)`——其比较器不满足传递性，V8 下顺序不可预测。
  const arr = [...candidate];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr[0] ?? null;
}

export interface ResolveVariantArgs {
  canonical: Question;
  /** 离线变体池；null / 空池视为无资产（Pool-first 自动 miss）。 */
  pool: VariantPool | null;
  /** 本会话内已落地过的变体 id（用于去重）。 */
  seen?: Set<string>;
}

/**
 * Pool-first 解析：命中返回选中的变体（尚未经 validateVariant，交由 finalizeQuestion 统一校验），
 * 否则 null（miss → 由 finalizeQuestion 决定回退原题或走运行时兜底）。
 *
 * 这是「训练选择逻辑」的确定性桩：完整三态（Pool 命中 / miss+开关关 / miss+开关开+provider）由
 * finalizeQuestion 编排——本函数只回答「池子里有没有这条题的可用变体、选哪条」。
 */
export function resolveQuestionVariant(args: ResolveVariantArgs): QuestionVariant | null {
  if (!args.pool) return null;
  const variants = getAvailableVariants(args.pool, args.canonical.id);
  return selectVariant(variants, args.seen);
}

/**
 * 变体是否 stale：池中变体的 sourceHash 与当前 canonical 内容指纹不一致，说明原题已改、该变体可能失真。
 * 用于 validate-variants 脚本与 CLI --stale；运行时命中但校验不过也会回退（见 finalizeQuestion）。
 */
export function isVariantStale(variant: QuestionVariant, canonical: Question): boolean {
  const current = computeVariantSourceHash({
    id: canonical.id,
    question: canonical.question,
    options: canonical.formats.choice?.options,
  });
  return variant.sourceHash !== current;
}
