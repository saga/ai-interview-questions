// Chrome 内置 AI 的 Agent 运行时适配。
//
// 背景：pi-agent-core 的 Agent 循环依赖 `streamFn` 返回「带工具调用（toolCall）的事件流」，
// 而 Chrome Prompt API（window.LanguageModel）是纯文本 one-shot 补全，没有原生 function calling。
// 因此这里把工具定义注入提示词，要求模型以「单个 JSON 工具调用」作答，再把这段文本补全
// 解析并包装成 Agent 期望的 AssistantMessageEventStream（start → toolcall_* → done(toolUse)）。
//
// 设计权衡（trade-off）：
// - 优点：复用已有的 chromeComplete（含串行队列 + 可用性检测），零额外依赖，本地无网络外发。
// - 代价：prompt-based 工具调用不如原生 function calling 可靠——模型偶尔不输出合法 JSON、
//   或参数不符合 schema。这里做了多层兜底：
//   (1) 解析失败 → 退化为纯文本消息（stop），Agent 收场后由 ensureQuestionDelivered 确定性兜底；
//   (2) chromeComplete 抛错 → 编码为 error 事件（不抛出），同样触发自愈兜底，而非让页面卡死；
//   (3) 工具名校验：只接受 context.tools 中真实存在的工具名，避免「幻觉」工具名。
// 整体遵循「LLM 只做不确定决策，失败由确定性护栏接管」的项目红线。

import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  StopReason,
  TextContent,
  Tool,
  ToolCall,
  Usage,
} from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { chromeComplete } from './chrome';
import type { ProviderEntry } from '../schemas/ai-config';

/** 占位的 Chrome 模型 id（Agent 会把 model 回传进 streamFn，但本实现忽略它，直接绑定 chromeComplete）。 */
const CHROME_MODEL_ID = 'chrome-builtin';

/** 极简占位 Model：只需满足 Model 形状，无需真实 provider 字段（api 用字符串字面量绕过 KnownApi 限制）。 */
function chromeModel(): Model<any> {
  return {
    id: CHROME_MODEL_ID,
    name: 'Chrome Built-in AI',
    api: 'chrome' as Api,
    provider: 'chrome',
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

/** 构造一条标准（空内容）的 AssistantMessage，stopReason 可调；timestamp 取当前时间。 */
function baseMessage(stopReason: StopReason): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'chrome' as Api,
    provider: 'chrome',
    model: CHROME_MODEL_ID,
    usage: zeroUsage(),
    stopReason,
    timestamp: Date.now(),
  };
}

/** 零用量占位（本地模型不计费）。 */
function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** 构造一个文本块。 */
function textBlock(text: string): TextContent {
  return { type: 'text', text };
}

const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_ITEM_CHARS = 900;

/**
 * 把最近的对话历史压缩为纯文本，供注入 Chrome 提示词。
 * Chrome Agent 每轮都会重建 user prompt；只保留最近状态可避免 prompt 随轮次线性膨胀。
 */
function renderMessages(messages: Context['messages']): string {
  const parts: string[] = [];
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  if (messages.length > recent.length) parts.push(`[已省略 ${messages.length - recent.length} 条较早历史]`);
  for (const m of recent) {
    if (m.role === 'user') {
      parts.push('User: ' + truncate(contentToText(m.content)));
    } else if (m.role === 'assistant') {
      const blocks = m.content ?? [];
      const calls = blocks.filter((b): b is ToolCall => b.type === 'toolCall');
      if (calls.length > 0) {
        for (const c of calls) {
          parts.push(`Assistant tool "${c.name}" ${JSON.stringify(c.arguments ?? {})}`);
        }
      } else {
        const text = blocks.filter((b): b is TextContent => b.type === 'text').map((b) => b.text).join(' ');
        if (text.trim()) parts.push('Assistant: ' + truncate(text));
      }
    } else if (m.role === 'toolResult') {
      parts.push(`Tool "${m.toolName}": ${truncate(contentToText(m.content))}`);
    }
  }
  return parts.join('\n');
}

function truncate(value: string, max = MAX_HISTORY_ITEM_CHARS): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** 把多形态 content（string 或 TextContent[]）统一成纯文本。 */
function contentToText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join(' ')
    .trim();
}

/** 把可用工具渲染成紧凑签名；工具语义在 system prompt 中定义，避免每轮重复长描述。 */
function renderTools(tools?: Tool[]): string {
  if (!tools || tools.length === 0) return '(no tools available)';
  return tools
    .map((t) => {
      let schema = '{}';
      try {
        schema = JSON.stringify(t.parameters ?? {});
      } catch {
        schema = '{}';
      }
      return `- ${t.name}: ${schema}`;
    })
    .join('\n');
}

/** 构造用户侧提示词：近期状态 + 紧凑工具清单；稳定协议放在 system prompt。 */
export function buildUserPrompt(context: Context): string {
  const transcript = renderMessages(context.messages);
  const tools = renderTools(context.tools);
  return [
    '## Recent interview state',
    transcript || '(empty)',
    '',
    '## Available tools',
    tools,
    '',
    'Choose exactly one tool for the current state.',
  ].join('\n');
}

const CHROME_TOOL_PROTOCOL = `\n\n## Chrome tool protocol\nRespond with exactly one JSON object and nothing else (no markdown): {"tool":"<tool_name>","args":{}}. The tool name must be from the available tools and args must match its schema.`;

/**
 * 容错解析模型输出为工具调用：兼容代码块包裹与多余文字，支持 {tool,args} 与 {name,arguments} 两种写法；
 * 工具名必须出现在 allowed 集合中（防止幻觉工具名）；参数非对象则回退为空对象。
 */
function parseToolCall(raw: string, allowed: Set<string>): { name: string; args: Record<string, unknown> } | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  let jsonStr = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonStr = fence[1].trim();
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    const first = jsonStr.search(/[[{]/);
    const last = Math.max(jsonStr.lastIndexOf('}'), jsonStr.lastIndexOf(']'));
    if (first !== -1 && last > first) {
      try {
        obj = JSON.parse(jsonStr.slice(first, last + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const name = typeof rec.tool === 'string' ? rec.tool : typeof rec.name === 'string' ? rec.name : undefined;
  if (!name || !allowed.has(name)) return null;
  const rawArgs = rec.args ?? rec.arguments;
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
  return { name, args: args as Record<string, unknown> };
}

/** 发射一条合法的工具调用事件序列（与 openai-completions provider 的发射顺序一致）。 */
function emitToolCall(stream: AssistantMessageEventStream, name: string, args: Record<string, unknown>): void {
  const toolCall: ToolCall = { type: 'toolCall', id: 'call_' + randomId(), name, arguments: args };
  const output = baseMessage('pending');
  output.content = [toolCall];
  output.stopReason = 'toolUse';
  stream.push({ type: 'start', partial: baseMessage('pending') });
  stream.push({ type: 'toolcall_start', contentIndex: 0, partial: output });
  stream.push({ type: 'toolcall_delta', contentIndex: 0, delta: JSON.stringify(args), partial: output });
  stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: output });
  stream.push({ type: 'done', reason: 'toolUse', message: output });
}

/** 发射一条纯文本消息并正常结束本轮（stop）；空文本则直接 done。 */
function emitText(stream: AssistantMessageEventStream, raw: string): void {
  const text = raw ?? '';
  if (!text.trim()) {
    const out = baseMessage('stop');
    stream.push({ type: 'start', partial: baseMessage('pending') });
    stream.push({ type: 'done', reason: 'stop', message: out });
    return;
  }
  const block = textBlock(text);
  const out = baseMessage('stop');
  out.content = [block];
  const partial = baseMessage('pending');
  partial.content = [block];
  stream.push({ type: 'start', partial });
  stream.push({ type: 'text_start', contentIndex: 0, partial });
  stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial });
  stream.push({ type: 'text_end', contentIndex: 0, content: text, partial });
  stream.push({ type: 'done', reason: 'stop', message: out });
}

/** 发射 error 事件（不抛出），让 Agent 自愈兜底接管，而非让页面无限「选题中」。 */
function emitError(stream: AssistantMessageEventStream, message: string): void {
  const out = baseMessage('error');
  out.errorMessage = message;
  stream.push({ type: 'start', partial: baseMessage('pending') });
  stream.push({ type: 'error', reason: 'error', error: out });
}

/** 简单随机 id（工具调用需要唯一 id 以便工具结果匹配）。 */
function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 创建一个 Chrome 专属的事件流：异步驱动 chromeComplete，并把结果解析为工具调用或文本。
 * 返回流是同步的（与 faux provider 的 queueMicrotask 模式一致），驱动在微任务中异步进行。
 */
function createChromeEventStream(context: Context): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void driveStream(stream, context);
  return stream;
}

/** 异步驱动：调用 chromeComplete → 解析 → 发射事件；任何异常都编码进 stream 而非抛出。 */
async function driveStream(stream: AssistantMessageEventStream, context: Context): Promise<void> {
  const system = `${context.systemPrompt ?? ''}${CHROME_TOOL_PROTOCOL}`;
  const userPrompt = buildUserPrompt(context);
  let raw: string;
  try {
    raw = await chromeComplete(system, userPrompt);
  } catch (err) {
    emitError(stream, err instanceof Error ? err.message : String(err));
    return;
  }
  const allowed = new Set((context.tools ?? []).map((t) => t.name));
  const parsed = parseToolCall(raw, allowed);
  if (!parsed) {
    // 没有可解析的工具调用：退化为文本消息，Agent 收场后由确定性兜底接管
    emitText(stream, raw);
    return;
  }
  emitToolCall(stream, parsed.name, parsed.args);
}

/**
 * 构造 Chrome 引擎的 Agent 运行时（streamFn + model）。
 * 当 ProviderEntry.id === 'chrome' 时由 buildAgentRuntime 调用；其余引擎仍走 pi-ai 的 streamSimple。
 */
export function buildChromeAgentRuntime(): { streamFn: StreamFn; model: Model<any> } {
  const model = chromeModel();
  // streamFn 忽略回传的 model（始终用 chromeComplete），第三个 options 参数无关紧要予以忽略
  const streamFn: StreamFn = (_model, context) => createChromeEventStream(context);
  return { streamFn, model };
}

/** 供 runtime.ts 判断是否需要走 Chrome 专属路径。 */
export function isChromeEntry(entry: ProviderEntry): boolean {
  return entry.id === 'chrome';
}
