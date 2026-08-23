// AI 底层：仅封装 @earendil-works/pi-ai 的调用细节（模型构建 + 文本补全 + JSON 提取）。
// 上层（variant / evaluate）才表达业务语义。浏览器：密钥经内存 CredentialStore 注入。

import { createModels } from '@earendil-works/pi-ai';
import type { Context, CredentialStore, Model, ProviderId, UserMessage } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import type { PiConfig } from '../types';

/** 内存 CredentialStore：把用户填写的 API Key 提供给对应 provider（浏览器最稳妥的注入方式）。 */
function createCredentialStore(apiKey: string, providerId: string): CredentialStore {
  return {
    read: async (pid) => (pid === providerId ? { type: 'api_key', key: apiKey } : undefined),
    list: async () => [],
    modify: async () => undefined,
    delete: async () => undefined,
  };
}

export type ModelsClient = ReturnType<typeof createModels>;

/** 构建 pi-ai Models 实例，并按 provider 装配对应 provider 实现。 */
export function buildModels(config: PiConfig): ModelsClient {
  const models = createModels({
    credentials: createCredentialStore(config.apiKey, config.provider),
  });
  if (config.provider === 'openai') models.setProvider(openaiProvider());
  else if (config.provider === 'anthropic') models.setProvider(anthropicProvider());
  else models.setProvider(openrouterProvider());
  return models;
}

/** 按 provider + 模型 id 取模型；找不到返回 undefined。 */
export function getModel(models: ModelsClient, provider: ProviderId, modelId: string): Model<any> | undefined {
  return models.getModel(provider, modelId);
}

/** 调用 LLM 并返回纯文本（一次性补全，用于变体生成、开放题评分等 one-shot 场景）。 */
export async function callLLM(config: PiConfig, system: string, user: string): Promise<string> {
  const models = buildModels(config);
  const model = getModel(models, config.provider, config.model);
  if (!model) {
    throw new Error(`在 provider "${config.provider}" 中未找到模型 "${config.model}"`);
  }
  const message: UserMessage = { role: 'user', content: user, timestamp: Date.now() };
  const context: Context = { systemPrompt: system, messages: [message] };
  const res = await models.complete(model, context, { apiKey: config.apiKey });
  const textBlock = (res.content ?? []).find((b) => b.type === 'text');
  return (textBlock && 'text' in textBlock ? textBlock.text : '') ?? '';
}

/** 从 LLM 文本中稳健地提取 JSON（容忍代码块包裹与多余文字）。 */
export function extractJSON<T = unknown>(raw: string): T {
  let s = (raw ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    const first = s.search(/[[{]/);
    const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (first !== -1 && last > first) {
      return JSON.parse(s.slice(first, last + 1)) as T;
    }
    throw new Error('LLM 未返回可解析的 JSON');
  }
}
