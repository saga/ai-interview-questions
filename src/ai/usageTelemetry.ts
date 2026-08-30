// KV Cache 命中遥测（P1④ 的「可观察性」部分）。
// 仅用于在开发期验证「stable-prefix prompt 是否真的命中了 DeepSeek 的 KV Cache」——
// 生产构建里静默（import.meta.env.DEV 为假），不污染线上日志。
//
// 用法：把 devUsageLogger 作为 onUsage 透传给 createLLMProvider / createInterviewAgent，
// 控制台便会打印每轮补全的 token 用量与缓存命中率。

import type { LLMUsage } from '../types';

/** 开发期用量日志：打印输入/输出 token 与 KV Cache 命中率。生产期无操作。 */
export const devUsageLogger: (usage: LLMUsage) => void = (() => {
  const active = typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  if (!active) return () => {};
  return (u: LLMUsage) => {
    const hitRate = u.inputTokens > 0 ? Math.round((u.cacheHitTokens / u.inputTokens) * 100) : 0;
    // eslint-disable-next-line no-console
    console.debug(
      `[LLM usage] in=${u.inputTokens} out=${u.outputTokens} ` +
        `cacheHit=${u.cacheHitTokens} (${hitRate}%) cacheMiss=${u.cacheMissTokens}` +
        (u.reasoningTokens ? ` reasoning=${u.reasoningTokens}` : ''),
    );
  };
})();
