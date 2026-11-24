/**
 * Server-side one-shot adapter for the local CodeBuddy Agent SDK.
 *
 * Mirrors the safety and cancellation boundary in @saga/codebuddy-agent-runtime:
 * no implicit settings/Skills/MCP, no ordinary tools, bounded query lifetime,
 * iterator cleanup, and interruption of handles that arrive after cancellation.
 */
export interface CodeBuddyQueryHandle extends AsyncIterable<unknown> {
  interrupt?: () => unknown;
}

export interface CodeBuddyQueryInput {
  prompt: string;
  options: Record<string, unknown>;
}

export type CodeBuddyQueryFactory = (
  input: CodeBuddyQueryInput,
) => CodeBuddyQueryHandle | Promise<CodeBuddyQueryHandle>;

export interface CodeBuddySdkTaskInput {
  prompt: string;
  systemPrompt: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CodeBuddySdkTaskResult {
  text: string;
  sessionId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    totalCostUsd?: number;
    durationMs?: number;
    numTurns?: number;
  };
}

export class CodeBuddySdkTaskError extends Error {
  constructor(
    readonly code: 'timeout' | 'aborted' | 'sdk-error',
    message: string,
  ) {
    super(message);
    this.name = 'CodeBuddySdkTaskError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readText(event: Record<string, unknown>): string[] {
  if (event.type !== 'assistant') return [];
  const message = asRecord(event.message);
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((part) => {
    const block = asRecord(part);
    return block.type === 'text' && typeof block.text === 'string' && block.text.length > 0
      ? [block.text]
      : [];
  });
}

function readUsage(result: Record<string, unknown>): CodeBuddySdkTaskResult['usage'] {
  const raw = asRecord(result.usage);
  if (!result.usage || typeof result.usage !== 'object') return undefined;
  const number = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const inputTokens = number(raw.input_tokens);
  const outputTokens = number(raw.output_tokens);
  const cacheReadTokens = number(raw.cache_read_input_tokens);
  const cacheCreationTokens = number(raw.cache_creation_input_tokens);
  if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens === 0) return undefined;
  const totalCostUsd = result.total_cost_usd === undefined || result.total_cost_usd === null
    ? undefined
    : number(result.total_cost_usd);
  const durationMs = result.duration_ms === undefined ? undefined : number(result.duration_ms);
  const numTurns = result.num_turns === undefined ? undefined : number(result.num_turns);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(numTurns !== undefined ? { numTurns } : {}),
  };
}

async function defaultQueryFactory(input: CodeBuddyQueryInput): Promise<CodeBuddyQueryHandle> {
  const sdk = await import('@tencent-ai/agent-sdk');
  return sdk.query(input as Parameters<typeof sdk.query>[0]) as unknown as CodeBuddyQueryHandle;
}

export class CodeBuddySdkRuntime {
  constructor(private readonly queryFactory: CodeBuddyQueryFactory = defaultQueryFactory) {}

  async run(input: CodeBuddySdkTaskInput): Promise<CodeBuddySdkTaskResult> {
    if (!input.prompt.trim()) throw new CodeBuddySdkTaskError('sdk-error', 'CodeBuddy prompt is empty.');
    if (input.signal?.aborted) throw new CodeBuddySdkTaskError('aborted', 'CodeBuddy request was aborted.');

    const startedAt = Date.now();
    const timeoutMs = input.timeoutMs ?? 120_000;
    const prompt = [
      input.systemPrompt.trim() ? 'SYSTEM INSTRUCTIONS:\n' + input.systemPrompt.trim() : '',
      'USER REQUEST:\n' + input.prompt.trim(),
    ].filter(Boolean).join('\n\n');

    let handle: CodeBuddyQueryHandle | undefined;
    let iterator: AsyncIterator<unknown> | undefined;
    let interruptionKind: 'timeout' | 'aborted' | undefined;
    let interruptionReject: (error: CodeBuddySdkTaskError) => void = () => undefined;
    const interruption = new Promise<never>((_, reject) => { interruptionReject = reject; });

    const interrupt = () => {
      if (handle?.interrupt) {
        try { void Promise.resolve(handle.interrupt()).catch(() => undefined); } catch { /* best effort */ }
      }
      if (iterator?.return) {
        try { void Promise.resolve(iterator.return()).catch(() => undefined); } catch { /* best effort */ }
      }
    };

    const requestInterruption = (kind: 'timeout' | 'aborted') => {
      if (interruptionKind) return;
      interruptionKind = kind;
      interrupt();
      interruptionReject(new CodeBuddySdkTaskError(
        kind,
        kind === 'timeout' ? `CodeBuddy request exceeded ${timeoutMs} ms.` : 'CodeBuddy request was aborted.',
      ));
    };

    const timer = setTimeout(() => requestInterruption('timeout'), timeoutMs);
    const onAbort = () => requestInterruption('aborted');
    input.signal?.addEventListener('abort', onAbort, { once: true });

    const queryPromise = Promise.resolve().then(() => this.queryFactory({
      prompt,
      options: {
        ...(input.model?.trim() ? { model: input.model.trim() } : {}),
        permissionMode: 'default',
        settingSources: [],
        persistSession: false,
        thinking: { type: 'disabled' },
        effort: 'low',
        tools: [],
        allowedTools: [],
        maxTurns: 1,
        canUseTool: async (toolName: string) => ({
          behavior: 'deny' as const,
          message: 'This one-shot task does not allow tool execution: ' + toolName,
        }),
      },
    }));

    // A query handle can resolve after the HTTP request has timed out. Interrupt it
    // immediately rather than allowing an unobserved local CLI task to continue.
    void queryPromise.then((lateHandle) => {
      if (interruptionKind) {
        try { void Promise.resolve(lateHandle.interrupt?.()).catch(() => undefined); } catch { /* best effort */ }
      }
    }).catch(() => undefined);

    let text = '';
    let sessionId: string | undefined;
    let usage: CodeBuddySdkTaskResult['usage'];

    try {
      handle = await Promise.race([queryPromise, interruption]);
      if (interruptionKind) requestInterruption(interruptionKind);
      iterator = handle[Symbol.asyncIterator]();

      for (;;) {
        const next = await Promise.race([iterator.next(), interruption]);
        if (next.done) break;
        const event = asRecord(next.value);
        if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
          sessionId = event.session_id;
        }
        if (event.type === 'result') {
          if (event.is_error === true || (Array.isArray(event.errors) && event.errors.length > 0)) {
            throw new Error('CodeBuddy execution failed: ' + String((event.errors as unknown[] | undefined)?.[0] ?? 'unknown error'));
          }
          if (typeof event.subtype === 'string' && event.subtype !== 'success') {
            throw new Error('CodeBuddy execution failed: ' + event.subtype);
          }
          usage = readUsage(event);
        }
        for (const chunk of readText(event)) text += (text ? '\n' : '') + chunk;
      }

      if (!text.trim()) throw new Error('CodeBuddy Agent SDK returned no text. Check the local CLI login and model access.');
      return { text: text.trim(), ...(sessionId ? { sessionId } : {}), ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof CodeBuddySdkTaskError) throw error;
      requestInterruption('aborted');
      const message = error instanceof Error ? error.message : String(error);
      throw new CodeBuddySdkTaskError('sdk-error', 'CodeBuddy Agent SDK call failed: ' + message);
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      if (interruptionKind && iterator?.return) {
        try { void Promise.resolve(iterator.return()).catch(() => undefined); } catch { /* best effort */ }
      }
    }
  }
}
