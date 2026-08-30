// Provider 能力协商：把「这个引擎支持哪些 LLM 能力」从散落的 `if (provider === 'deepseek')`
// 收敛成一份声明式能力表。AI 层据此选择最优路径（原生 JSON / 原生工具调用 / 思考 / KV Cache / 多轮），
// 而不是在业务代码里写死 provider 判断。
//
// 设计要点（对齐用户的 DeepSeek 优化清单 P2⑦）：
// - 业务层只问「能力有没有」，不关心是哪家 provider；
// - 新增引擎（OpenAI / Gemini / Ollama / OpenRouter）只需在此登记能力，无需改动 callLLM / provider；
// - 能力是「协商」的入口：未来 DeepSeek 的 Thinking / 长上下文缓存等都可挂在这里。

import type { ProviderEntry } from '../schemas/ai-config';

/** 单个引擎对外暴露的结构化生成 / 推理能力。 */
export interface LLMCapabilities {
  /** 原生 JSON 模式（response_format=json_object / 等价结构化输出）。true 时 callLLM 会主动附加，
   *  免去偶发非 JSON 被解析抛错、触发整段重生成的浪费。 */
  jsonMode: boolean;
  /** 原生 function / tool calling（pi-agent-core 直接吃底层 provider 的工具调用）。Chrome 内置 AI 走 prompt 工具，为 false。 */
  toolCalls: boolean;
  /** 推理/思考模式（DeepSeek Reasoner 等）。注意：本实现中 thinking 由「选择 reasoner 模型」驱动，
   *  不是运行时参数；这里只声明能力，是否启用取决于用户配置的模型。 */
  thinking: boolean;
  /** 上下文缓存（DeepSeek / Anthropic 等 prefix-matching cache）。true 时我们应主动设计 stable-prefix prompt 以命中缓存。 */
  contextCaching: boolean;
  /** 多轮对话（无状态 API 下由上层 append-only messages 维持历史）。Agent runtime 依赖此项。 */
  multiRound: boolean;
}

/** 各引擎的默认能力表。仅登记「已确认支持」的能力，未列引擎回退到保守默认。 */
const CAPABILITY_TABLE: Record<ProviderEntry['id'], LLMCapabilities> = {
  // DeepSeek：官方原生 JSON 模式、原生工具调用、Reasoner 思考、默认开启的 KV Cache、无状态多轮。
  deepseek: {
    jsonMode: true,
    toolCalls: true,
    thinking: true,
    contextCaching: true,
    multiRound: true,
  },
  // OpenRouter：OpenAI 兼容通道，绝大多数模型支持 JSON 模式与原生工具调用。
  openrouter: {
    jsonMode: true,
    toolCalls: true,
    thinking: false,
    contextCaching: false,
    multiRound: true,
  },
  // Google Gemini：结构化输出走 Gemini 自有参数（非 response_format=json_object），原生工具调用支持，
  // 但本适配层暂不为它附加 json_object，故 jsonMode 此处为 false（避免向非预期引擎发送错误参数）。
  google: {
    jsonMode: false,
    toolCalls: true,
    thinking: false,
    contextCaching: false,
    multiRound: true,
  },
  // Cloudflare Workers AI：模型各异，保守按「无原生 JSON / 无原生工具」处理（prompt + parser 兜底）。
  'cloudflare-workers-ai': {
    jsonMode: false,
    toolCalls: false,
    thinking: false,
    contextCaching: false,
    multiRound: true,
  },
  // 本地 OpenAI 兼容服务：视部署模型而定，保守不强制 json_object（避免小模型不支持时报错）。
  local: {
    jsonMode: false,
    toolCalls: true,
    thinking: false,
    contextCaching: false,
    multiRound: true,
  },
  // Chrome 内置 AI：Prompt API，无原生 JSON / 工具调用，靠 prompt + parser。
  chrome: {
    jsonMode: false,
    toolCalls: false,
    thinking: false,
    contextCaching: false,
    multiRound: true,
  },
};

/** 保守默认（覆盖未知引擎 id）：只声明多轮，其余能力关，由 prompt+parser 兜底。 */
const FALLBACK_CAPABILITIES: LLMCapabilities = {
  jsonMode: false,
  toolCalls: false,
  thinking: false,
  contextCaching: false,
  multiRound: true,
};

/** 取某引擎的能力表（纯函数，便于测试）。未知引擎回退保守默认。 */
export function capabilitiesFor(entry: ProviderEntry): LLMCapabilities {
  return CAPABILITY_TABLE[entry.id] ?? FALLBACK_CAPABILITIES;
}
