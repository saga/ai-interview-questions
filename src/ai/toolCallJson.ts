// 工具调用 JSON 的识别与抽取（Chrome 引擎的 prompt-based function calling 协议）。
//
// 背景：Chrome 内置 AI 没有原生 function calling，chromeAgent 用「要求模型只输出一个
// JSON 对象」来模拟（见 chromeAgent.ts 的 CHROME_TOOL_PROTOCOL）。这段 JSON 是**内部协议**，
// 不是给用户看的内容——一旦解析环节出问题，它就会以 assistant 文本块的形式流到 UI，
// 被渲染成「面试官的推理」，例如：{"tool":"getUserWeaknesses","args":{}}。
//
// 两个层次都需要判断「这段文本是不是工具调用协议本身」，故抽到这里共用，避免两份口径漂移：
//   - chromeAgent.driveStream（解析层）：解析失败且像工具调用 → 编码为 error，不回退成文本；
//   - useAgentInterview（展示层）：最后一道防线，拒绝把协议写进 transcript。

/**
 * 从一段文本中抽出第一个 JSON 对象。
 * 兼容 ``` 代码块包裹，以及 JSON 前后夹带多余文字（模型偶尔会先写一句人话）。
 * 结果不是「非数组对象」时返回 null（数组、标量、解析失败都算没抽到）。
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
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
    if (first === -1 || last <= first) return null;
    try {
      obj = JSON.parse(jsonStr.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  return obj as Record<string, unknown>;
}

/** 取出工具调用对象里的工具名：支持 {tool,...} 与 {name,...} 两种写法。 */
export function toolCallName(rec: Record<string, unknown>): string | undefined {
  if (typeof rec.tool === 'string') return rec.tool;
  if (typeof rec.name === 'string') return rec.name;
  return undefined;
}

/**
 * 这段文本是否「长得像一次工具调用」——哪怕工具名幻觉、参数不合 schema。
 *
 * 判据是「能抽出一个含 `tool` / `name` 字符串字段的 JSON 对象」。刻意**不校验工具名是否合法**：
 * 幻觉工具名同样属于内部协议，同样不能展示给用户。自然的推理文本不会长成这个形状。
 */
export function looksLikeToolCall(raw: string): boolean {
  const rec = extractJsonObject(raw);
  return rec !== null && toolCallName(rec) !== undefined;
}
