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
import type { LLMUsage } from '../types';
import { capabilitiesFor } from './capabilities';
import type { Usage } from '@earendil-works/pi-ai';

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

/** 一次性补全的可选参数。 */
export interface CallLLMOptions {
  /** 要求模型输出严格 JSON。是否真正附加 `response_format={type:'json_object'}` 由 provider 能力决定
   *  （见 capabilities.ts：仅声明 jsonMode 的引擎才启用，当前为 deepseek / openrouter）。
   *  DeepSeek 文档要求 prompt 含 "json" 字样，VARIANT_SYSTEM / EVAL_SYSTEM / QUESTION_CHALLENGER_SYSTEM 均满足。
   *  收益：免去偶发非 JSON 输出被 extractJSON 抛错、进而触发整段重生成（浪费 token）。 */
  jsonMode?: boolean;
  /** 采样温度；不传则使用模型默认。评分等确定性场景建议传 0。 */
  temperature?: number;
  /** KV Cache 命中遥测（P1④）：一次补全结束（含 JSON 空内容重试后的那次）后回传归一化用量。
   * 应用层可据此观察 cacheHitTokens / cacheMissTokens，验证 stable-prefix prompt 是否真的命中缓存。 */
  onUsage?: (usage: LLMUsage) => void;
}

/** 把 pi-ai 的 Usage 归一化为 provider 无关的 LLMUsage（cacheRead→命中，input-cacheRead→未命中）。 */
export function piUsageToLLMUsage(u: Usage): LLMUsage {
  const input = u.input ?? 0;
  const cacheHit = u.cacheRead ?? 0;
  return {
    inputTokens: input,
    outputTokens: u.output ?? 0,
    cacheHitTokens: cacheHit,
    cacheMissTokens: Math.max(0, input - cacheHit),
    reasoningTokens: u.reasoning,
  };
}

/** 调用 LLM 并返回纯文本（一次性补全，用于变体生成、开放题评分等 one-shot 场景）。 */
export async function callLLM(
  entry: ProviderEntry,
  system: string,
  user: string,
  opts?: CallLLMOptions,
): Promise<string> {
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

  // 能力协商（P2⑦）：是否启用原生 JSON 模式由 provider 能力决定，而非硬编码 `entry.id === 'deepseek'`。
  // DeepSeek / OpenRouter 等声明 jsonMode 能力的引擎会收到 response_format=json_object，
  // 其余引擎走 prompt + parser 兜底（避免向非预期引擎发送不支持的参数）。
  // 透传机制：pi-ai 对 openai-completions 适配器执行 Object.assign(params, samplingParams)。
  const useJson = Boolean(opts?.jsonMode) && capabilitiesFor(entry).jsonMode;
  const samplingParams = useJson ? { response_format: { type: 'json_object' } } : undefined;
  const temperature = opts?.temperature;

  const completeOnce = async (): Promise<{ text: string; usage?: Usage }> => {
    const res = await models.complete(model, context, {
      ...(samplingParams ? { samplingParams } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    });
    // P0-2：provider 调用失败（HTTP 5xx / 401 / 429 / 断网 / content_filter）时，pi-ai 返回
    // stopReason='error' 而非抛出异常。若不在此显式抛出，callLLM 会静默返回空串 ''——上层依赖
    // 异常来降级的 FallbackProvider（provider.ts:135）就永远捕获不到失败、永不切换到下一引擎，
    // 401/429/断网全部被伪装成「第一个引擎返回空」。归一为抛错，恢复失败语义：
    // FallbackProvider 的 try/catch 才能按设计降级到链中下一个引擎。
    if (res.stopReason === 'error' || res.stopReason === 'aborted') {
      throw new Error(res.errorMessage || `LLM 调用失败（stopReason=${res.stopReason}）`);
    }
    const textBlock = (res.content ?? []).find((b) => b.type === 'text');
    return { text: (textBlock && 'text' in textBlock ? textBlock.text : '') ?? '', usage: res.usage };
  };

  let first = await completeOnce();
  let text = first.text;
  let lastUsage = first.usage;
  // DeepSeek JSON 模式官方已知偶发返回空内容（"API may occasionally return empty content"）。
  // 单次重试兜底，避免把空串直接交给上层 parse 报错而浪费一次整段重生成。
  if (useJson && !text.trim()) {
    const retry = await completeOnce();
    text = retry.text;
    lastUsage = retry.usage;
  }
  if (opts?.onUsage && lastUsage) opts.onUsage(piUsageToLLMUsage(lastUsage));
  return text;
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
