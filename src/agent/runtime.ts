// Agent 运行时接线：把 pi-ai 的 Models 适配成 pi-agent-core 需要的 { streamFn, model }。
// 浏览器可用，无 Node 依赖；模型与 provider 由 buildModels 按引擎 id 装配。

import type { Model } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { buildModels, getModel } from '../ai/pi';
import { buildChromeAgentRuntime, isChromeEntry } from '../ai/chromeAgent';
import type { ProviderEntry } from '../types';

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
  const model = getModel(models, entry.id, entry.model);
  if (!model) {
    throw new Error(`在引擎 "${entry.id}" 中未找到模型 "${entry.model}"`);
  }
  const streamFn: StreamFn = (m, context, options) => models.streamSimple(m, context, options);
  return { streamFn, model };
}
