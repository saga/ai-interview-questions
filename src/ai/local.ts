// 本地 OpenAI 兼容服务（默认 Unsloth Studio：http://127.0.0.1:8888/v1）。
// 复用 pi-ai 的自定义 provider 机制（createProvider + openai-completions API，
// 与官方 models.json 自定义 provider 同一条路径），不手写 HTTP（ADR-022）。

import { createProvider } from '@earendil-works/pi-ai';
import type { Provider } from '@earendil-works/pi-ai';
import type { Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { ProviderEntry } from '../schemas/ai-config';

export const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:8888/v1';

/** 归一化 baseUrl：去空白与尾部斜杠；空值回退默认地址。独立导出便于测试。 */
export function normalizeBaseUrl(raw?: string): string {
  const s = (raw ?? '').trim();
  return (s || DEFAULT_LOCAL_BASE_URL).replace(/\/+$/, '');
}

/**
 * 构建本地服务的 Provider：单模型静态目录，openai-completions 协议。
 * compat 关闭 developer role 与 reasoning_effort——多数本地推理服务器
 * （Unsloth / Ollama / vLLM / llama.cpp）不认这些字段（见 pi models 文档）。
 */
export function buildLocalProvider(config: ProviderEntry): Provider<'openai-completions'> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const model: Model<'openai-completions'> = {
    id: config.model,
    name: config.model,
    api: 'openai-completions',
    provider: 'local',
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
  return createProvider({
    id: 'local',
    baseUrl,
    // 本地服务通常免密钥；pi 要求 provider 有 auth 语义，空 key 用占位符兜底
    auth: {
      apiKey: {
        name: 'Local API key（可选）',
        resolve: async () => ({ auth: { apiKey: config.apiKey.trim() || 'local' } }),
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  });
}
