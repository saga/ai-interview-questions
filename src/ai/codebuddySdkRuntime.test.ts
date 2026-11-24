import { describe, expect, it, vi } from 'vitest';
import {
  CodeBuddySdkRuntime,
  CodeBuddySdkTaskError,
  type CodeBuddyQueryHandle,
  type CodeBuddyQueryInput,
} from './codebuddySdkRuntime';

function fakeQuery(messages: unknown[], interrupt?: () => unknown) {
  const stream = (async function* () {
    for (const message of messages) yield message;
  })();
  return Object.assign(stream, { interrupt });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('CodeBuddySdkRuntime', () => {
  it('composes system and user prompts and uses safe one-shot defaults', async () => {
    let received: CodeBuddyQueryInput | undefined;
    const runtime = new CodeBuddySdkRuntime((input) => {
      received = input;
      return fakeQuery([
        { type: 'system', subtype: 'init', session_id: 'local-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
        { type: 'result', subtype: 'success', result: 'answer', usage: { input_tokens: 12, output_tokens: 4 }, total_cost_usd: 0 },
      ]);
    });

    const result = await runtime.run({ prompt: 'question', systemPrompt: 'rules', model: 'deepseek-v3' });

    expect(received?.prompt).toBe('question');
    expect(received?.options).toMatchObject({
      model: 'deepseek-v3',
      systemPrompt: 'rules',
      permissionMode: 'default',
      settingSources: [],
      persistSession: false,
      allowedTools: [],
      maxTurns: 1,
      thinking: { type: 'disabled' },
      effort: 'low',
    });
    expect(received?.options?.abortController).toBeInstanceOf(AbortController);
    expect(await (received?.options?.canUseTool as (name: string) => Promise<unknown>)('Read'))
      .toMatchObject({ behavior: 'deny', interrupt: true });
    expect(result).toMatchObject({
      text: 'answer',
      sessionId: 'local-session',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16, totalCostUsd: 0 },
    });
  });

  it('rejects invalid task deadlines before starting the SDK', async () => {
    const factory = vi.fn(() => fakeQuery([]));
    const runtime = new CodeBuddySdkRuntime(factory);
    await expect(runtime.run({ prompt: 'task', systemPrompt: 'rules', timeoutMs: 0 }))
      .rejects.toThrow('timeoutMs must be a positive finite number');
    expect(factory).not.toHaveBeenCalled();
  });

  it('does not start a query when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const factory = vi.fn(() => fakeQuery([]));
    const runtime = new CodeBuddySdkRuntime(factory);
    await expect(runtime.run({ prompt: 'task', systemPrompt: 'rules', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'aborted' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('bounds asynchronous query initialization and interrupts a handle that arrives late', async () => {
    const pending = deferred<CodeBuddyQueryHandle>();
    const interrupt = vi.fn();
    const runtime = new CodeBuddySdkRuntime(() => pending.promise);
    await expect(runtime.run({ prompt: 'task', systemPrompt: 'rules', timeoutMs: 10 }))
      .rejects.toBeInstanceOf(CodeBuddySdkTaskError);
    pending.resolve(Object.assign(fakeQuery([]), { interrupt }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  it('interrupts a running query when its deadline expires and aborts the SDK controller', async () => {
    const interrupt = vi.fn();
    let sdkSignal: AbortController | undefined;
    let returnCalls = 0;
    const query: CodeBuddyQueryHandle = Object.assign({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>(() => undefined),
          return: async () => {
            returnCalls += 1;
            return { done: true, value: undefined };
          },
        };
      },
    }, { interrupt });

    const runtime = new CodeBuddySdkRuntime((input) => {
      sdkSignal = input.options?.abortController;
      return query;
    });
    await expect(runtime.run({ prompt: 'task', systemPrompt: 'rules', timeoutMs: 10 }))
      .rejects.toMatchObject({ code: 'timeout' });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(sdkSignal?.signal.aborted).toBe(true);
    expect(returnCalls).toBeGreaterThan(0);
  });

  it('interrupts the query when the caller aborts', async () => {
    const controller = new AbortController();
    const interrupt = vi.fn();
    const query = Object.assign({
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<IteratorResult<unknown>>(() => undefined) };
      },
    }, { interrupt });
    const runtime = new CodeBuddySdkRuntime(() => query);
    const run = runtime.run({ prompt: 'task', systemPrompt: 'rules', signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: 'aborted' });
    expect(interrupt).toHaveBeenCalledTimes(1);
  });
});
