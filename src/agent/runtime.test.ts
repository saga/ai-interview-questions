import { describe, expect, it, vi } from 'vitest';
import { chainStreamFns, isAgentAbort, validAgentEntries } from './runtime';
import type { ProviderEntry } from '../schemas/ai-config';

const ok = (marker: string) => (async function* () {
  yield { type: 'text', text: marker } as never;
}) as never;

describe('Agent runtime fallback（P1-2）', () => {
  it('首个引擎抛错时降级到下一引擎', async () => {
    const failing = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    const next = vi.fn(ok('hello'));
    const streamFn = chainStreamFns([
      { id: 'deepseek', streamFn: failing as never },
      { id: 'local', streamFn: next as never },
    ]);
    const gen = (await streamFn({} as never, { messages: [] } as never, {} as never)) as AsyncGenerator<unknown>;
    const first = await gen.next();
    expect(first.value).toMatchObject({ text: 'hello' });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('用户主动 abort 时绝不切换引擎', async () => {
    const controller = new AbortController();
    controller.abort();
    const first = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    const second = vi.fn(ok('never'));
    const streamFn = chainStreamFns([
      { id: 'deepseek', streamFn: first as never },
      { id: 'local', streamFn: second as never },
    ]);
    await expect(
      streamFn({} as never, { messages: [] } as never, { signal: controller.signal } as never),
    ).rejects.toThrow('aborted');
    expect(second).not.toHaveBeenCalled();
  });

  it('isAgentAbort 只认取消，不把普通失败当 abort', () => {
    expect(isAgentAbort(new Error('rate limit'), null)).toBe(false);
    const abortErr = new Error('x');
    abortErr.name = 'AbortError';
    expect(isAgentAbort(abortErr, null)).toBe(true);
    expect(isAgentAbort(new Error('y'), { aborted: true } as AbortSignal)).toBe(true);
  });

  it('validAgentEntries 只收启用且合法的引擎（顺序即降级顺序）', () => {
    const config = {
      providers: [
        { id: 'deepseek', enabled: true, model: 'm', apiKey: 'k' },
        { id: 'local', enabled: false, model: 'm' },
        { id: 'google', enabled: true, model: '', apiKey: '' },
      ] as ProviderEntry[],
    };
    expect(validAgentEntries(config).map((e) => e.id)).toEqual(['deepseek']);
  });
});
