// Agent 运行时接线：把 pi-ai 的 Models 适配成 pi-agent-core 需要的 { streamFn, model }。
// 浏览器可用，无 Node 依赖；模型与 provider 由 buildModels 按引擎 id 装配。

import type { Model } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { buildModels, getModel } from '../ai/pi';
import { buildChromeAgentRuntime, isChromeEntry } from '../ai/chromeAgent';
import { isEntryValid } from '../ai/provider';
import type { ProviderEntry } from '../schemas/ai-config';

/**
 * 由引擎配置构造 Agent 运行时所需的两样东西：
 * - `streamFn`：直接委托 `models.streamSimple`（签名正好满足 pi-agent-core 的 StreamFn）；
 * - `model`：当前引擎选中的模型，交给 Agent 作为默认 model。
 * 返回的 streamFn 忽略 Agent 传入的 model 参数（model 已绑定在 models 实例上），
 * 但仍透传给 streamSimple 以保持与底层 provider 路由一致。
 */
export function buildAgentRuntime(entry: ProviderEntry): { streamFn: StreamFn; model: Model<any> } {
  // Chrome 内置 AI 没有原生 function calling，走专用的 prompt-based 工具调用运行时；
  // 其余引擎（云端 / 本地 OpenAI 兼容）由 pi-ai 的 streamSimple 提供流式 + 原生工具调用。
  if (isChromeEntry(entry)) return buildChromeAgentRuntime();
  const models = buildModels(entry);
  const model = getModel(models, entry);
  if (!model) {
    throw new Error(`在引擎 "${entry.id}" 中未找到模型 "${entry.model}"`);
  }
  const streamFn: StreamFn = (m, context, options) => models.streamSimple(m, context, options);
  return { streamFn, model };
}

/**
 * 用户主动取消（绝不 fallback，否则"停止"会被自动切换引擎复活）：
 * AbortSignal 已触发，或错误本身就是取消（AbortError / 超时取消未触发 fallback 前已 abort 由调用方判定）。
 */
export function isAgentAbort(err: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  const name = (err as { name?: unknown })?.name;
  return name === 'AbortError' || name === 'TimeoutError' && (signal?.aborted ?? false);
}

/**
 * Agent 主循环的端到端 fallback（P1-2）：把降级链下沉到 Runtime 的 streamFn 层，
 * 而不是只让 one-shot 工具（评分/变体）走 FallbackProvider。
 *
 * - entries[0] 为主引擎，失败（抛错）按序尝试下一个；全部失败才向外抛错。
 * - 每个候选复用各自绑定的 model（各 streamFn 本就忽略传入的 model，用自有绑定）。
 * - 用户主动取消（abort）直接透出，绝不切换引擎。
 * - 返回的 model 取首个引擎的（Agent 仅作默认 model 占位）。
 */
/**
 * 纯组合子（可单测）：把多个已建好的 streamFn 按序串成一条 fallback 链。
 * 失败语义与 buildFallbackAgentRuntime 一致，engine 创建逻辑不掺入。
 */
export function chainStreamFns(candidates: { id: string; streamFn: StreamFn }[]): StreamFn {
  return (async (m, context, options) => {
    let lastErr: unknown;
    for (const { id, streamFn } of candidates) {
      try {
        return await streamFn(m, context, options);
      } catch (err) {
        if (isAgentAbort(err, options?.signal)) throw err;
        console.warn(`[Agent:${id}] 主循环失败，降级到下一引擎：`, err);
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('所有 Agent 引擎均不可用');
  }) as StreamFn;
}

export function buildFallbackAgentRuntime(entries: ProviderEntry[]): {
  streamFn: StreamFn;
  model: Model<any>;
  chain: string[];
} {
  const built = entries.map((entry) => ({ entry, runtime: buildAgentRuntime(entry) }));
  if (built.length === 0) throw new Error('fallback 引擎链为空');
  const chain = built.map((b) => b.entry.id);
  const streamFn = chainStreamFns(built.map((b) => ({ id: b.entry.id, streamFn: b.runtime.streamFn })));
  return { streamFn, model: built[0].runtime.model, chain };
}

/** 配置中所有启用且字段合法的 Agent 候选引擎（按配置顺序 = 降级顺序）。 */
export function validAgentEntries(config: { providers?: ProviderEntry[] }): ProviderEntry[] {
  return (config.providers ?? []).filter((p) => p.enabled && isEntryValid(p));
}
