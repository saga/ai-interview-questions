// AI 底层：仅封装 @earendil-works/pi-ai 的调用细节（模型构建 + 文本补全 + JSON 提取）。
// 上层（variant / evaluate）才表达业务语义。浏览器：密钥经内存 CredentialStore 注入。

import { createModels } from '@earendil-works/pi-ai';
import type { Context, CredentialStore, Model, UserMessage } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { cloudflareWorkersAIProvider } from '@earendil-works/pi-ai/providers/cloudflare-workers-ai';
import { buildLocalProvider } from './local.ts';
import type { ProviderEntry } from '../schemas/ai-config';

/** 内存 CredentialStore：把用户填写的 API Key 提供给对应 provider（浏览器最稳妥的注入方式）。
 *  空 key 返回 undefined，交给 provider 自身的 auth.resolve 兜底（如 local 的占位符）。
 *  Cloudflare 额外经 credential.env 注入 Account ID（其 auth 协议要求 key + accountId 双字段）。 */
function createCredentialStore(entry: ProviderEntry): CredentialStore {
  const apiKey = entry.apiKey.trim();
  return {
    read: async (pid) => {
      if (pid !== entry.id || !apiKey) return undefined;
      if (entry.id === 'cloudflare-workers-ai') {
        return {
          type: 'api_key',
          key: apiKey,
          env: { CLOUDFLARE_ACCOUNT_ID: (entry.accountId ?? '').trim() },
        };
      }
      return { type: 'api_key', key: apiKey };
    },
    list: async () => [],
    modify: async () => undefined,
    delete: async () => undefined,
  };
}

export type ModelsClient = ReturnType<typeof createModels>;

/** 构建 pi-ai Models 实例，并按引擎 id 装配对应 provider 实现。 */
export function buildModels(config: ProviderEntry): ModelsClient {
  const models = createModels({ credentials: createCredentialStore(config) });
  if (config.id === 'deepseek') models.setProvider(deepseekProvider());
  else if (config.id === 'openrouter') models.setProvider(openrouterProvider());
  else if (config.id === 'google') models.setProvider(googleProvider());
  else if (config.id === 'cloudflare-workers-ai') models.setProvider(cloudflareWorkersAIProvider());
  else models.setProvider(buildLocalProvider(config));
  return models;
}

/** 按 provider + 模型 id 取模型；找不到返回 undefined。
 *  仅 cloudflare-workers-ai：浏览器无法直连 api.cloudflare.com（该域名不返回 CORS 头），
 *  故强制走同源代理 /api/ai/client/v4/accounts/{accountId}/ai/v1
 *  （由可选的 Node.js server：server/index.js 服务端转发到 api.cloudflare.com，
 *   本地则由 vite.config.ts 的 dev proxy 转发），从而规避跨域。
 *  该 provider 未启用时不会被调用，故不会产生任何代理流量。
 *  其它 provider（deepseek / openrouter / google / local）一律走各自模型目录里的默认 baseUrl。 */
export function getModel(models: ModelsClient, entry: ProviderEntry): Model<any> | undefined {
  const model = models.getModel(entry.id, entry.model);
  if (!model) return undefined;
  if (entry.id === 'cloudflare-workers-ai') {
    // pi-ai 已为 cloudflare 内置完整 baseUrl（含 {CLOUDFLARE_ACCOUNT_ID} 占位符，
    // 运行时由 credential store 的 env 注入真实 accountId，路径结构也由 pi-ai 负责拼接），
    // 我们**不要**自己拼路径。只需把跨域的源 https://api.cloudflare.com 换成「同源代理前缀」。
    // 代理前缀 /api/ai 由以下任一处在服务端剥离后转发到 api.cloudflare.com：
    //   · 本地开发：vite.config.ts 的 dev proxy → 可选 Node 服务（server/index.js）
    //   · Cloudflare 生产：worker/index.ts（wrangler deploy 的 main 脚本）
    //   · GitHub Pages：无服务端，cloudflare provider 不可用（见 DEPLOYMENT.md）
    // 必须保留「绝对 URL」：pi-ai 底层用 OpenAI SDK，会对 baseUrl 执行 new URL()，
    // 相对路径会抛 "Failed to construct 'URL': Invalid URL"，故前缀用 location.origin 拼成同源绝对地址。
    // 注意：不要直接引用 DOM 全局 `location`——本文件被 scripts/fix-bias.ts（Node 端构建，无 DOM lib）
    // 引用，直接写 location 会让 node 项目编译失败。改为从 globalThis 结构性读取，两种编译环境都通过。
    const g = globalThis as unknown as { location?: { origin: string } };
    const origin = g.location?.origin ?? '';
    const proxyBase = model.baseUrl.replace('https://api.cloudflare.com', `${origin}/api/ai`);
    return { ...model, baseUrl: proxyBase };
  }
  return model;
}

/** 调用 LLM 并返回纯文本（一次性补全，用于变体生成、开放题评分等 one-shot 场景）。 */
export async function callLLM(entry: ProviderEntry, system: string, user: string): Promise<string> {
  const models = buildModels(entry);
  const model = getModel(models, entry);
  if (!model) {
    throw new Error(`在引擎 "${entry.id}" 中未找到模型 "${entry.model}"`);
  }
  const message: UserMessage = { role: 'user', content: user, timestamp: Date.now() };
  const context: Context = { systemPrompt: system, messages: [message] };
  // 鉴权完全交给内存 CredentialStore（createCredentialStore 已按 provider 注入
  // apiKey / accountId 等字段）。切勿在此传 { apiKey }——pi-ai 收到 apiKey override
  // 时会构造「合成 credential」并丢弃 store 中的 env（如 Cloudflare 的 accountId），
  // 导致 applyAuth 拿到不到 accountId 而抛 "Provider is not configured"。
  const res = await models.complete(model, context, {});
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
