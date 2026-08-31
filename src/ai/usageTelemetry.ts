// KV Cache 命中遥测（P1④ 的「可观察性」部分）。
// 仅用于在开发期验证「stable-prefix prompt 是否真的命中了 DeepSeek 的 KV Cache」——
// 生产构建里静默（import.meta.env.DEV 为假），不污染线上日志。
//
// 用法：把 devUsageLogger 作为 onUsage 透传给 createLLMProvider / createInterviewAgent，
// 控制台便会逐轮打印 token 用量与缓存命中率，并在每场面试结束时汇总一条「命中率曲线」。

import type { LLMUsage } from '../types';

/** 单轮补全用量快照（DEV 累计用）。 */
export interface UsageRound {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  reasoningTokens: number;
  /** 本轮命中率（0-100，inputTokens 为 0 时取 0）。 */
  hitRate: number;
}

/** 累计遥测快照：逐轮明细 + 累计命中率。 */
export interface UsageTelemetry {
  rounds: UsageRound[];
  totalInput: number;
  totalHit: number;
  totalMiss: number;
  /** 累计命中率（0-100）。 */
  cumulativeHitRate: number;
}

const DEV =
  typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

function hitRateOf(hit: number, total: number): number {
  return total > 0 ? Math.round((hit / total) * 100) : 0;
}

// 累计状态（DEV 构建才实际累积；生产构建下 devUsageLogger 为空操作，永不写入本状态）。
let rounds: UsageRound[] = [];

/** 清空累计遥测：每场新面试开始时调用，使曲线从 Round 1 重新计数（P1④）。 */
export function resetUsageTelemetry(): void {
  rounds = [];
}

/** 读取当前累计遥测快照（供 UI / 调试使用；生产构建也安全，只是始终为空）。 */
export function getUsageTelemetry(): UsageTelemetry {
  const totalInput = rounds.reduce((a, r) => a + r.inputTokens, 0);
  const totalHit = rounds.reduce((a, r) => a + r.cacheHitTokens, 0);
  const totalMiss = rounds.reduce((a, r) => a + r.cacheMissTokens, 0);
  return {
    rounds,
    totalInput,
    totalHit,
    totalMiss,
    cumulativeHitRate: hitRateOf(totalHit, totalInput),
  };
}

/** 把单轮 LLMUsage 折叠成 UsageRound。 */
function toRound(u: LLMUsage): UsageRound {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheHitTokens: u.cacheHitTokens,
    cacheMissTokens: u.cacheMissTokens,
    reasoningTokens: u.reasoningTokens ?? 0,
    hitRate: hitRateOf(u.cacheHitTokens, u.inputTokens),
  };
}

/** 开发期用量日志：打印输入/输出 token 与 KV Cache 命中率，并附累计命中率曲线。生产期无操作。 */
export const devUsageLogger: (usage: LLMUsage) => void = (() => {
  if (!DEV) return () => {};
  return (u: LLMUsage) => {
    const round = toRound(u);
    rounds.push(round);
    const idx = rounds.length;
    const t = getUsageTelemetry();
    const curve = rounds
      .map((r, i) => `R${i + 1}:${r.hitRate}%`)
      .join(' ');
    // eslint-disable-next-line no-console
    console.debug(
      `[LLM usage] R${idx} in=${round.inputTokens} out=${round.outputTokens} ` +
        `cacheHit=${round.cacheHitTokens} (${round.hitRate}%) cacheMiss=${round.cacheMissTokens}` +
        (round.reasoningTokens ? ` reasoning=${round.reasoningTokens}` : '') +
        `\n[LLM cache curve] ${curve}  | 累计 ${t.cumulativeHitRate}% (hit=${t.totalHit} miss=${t.totalMiss})`,
    );
  };
})();
