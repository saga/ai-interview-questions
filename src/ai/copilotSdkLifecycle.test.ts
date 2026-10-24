import { describe, expect, it, vi } from 'vitest';
import { CopilotSdkClientLifecycle } from './copilotSdkLifecycle';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CopilotSdkClientLifecycle', () => {
  it('shares one in-flight startup across concurrent requests', async () => {
    const gate = deferred<void>();
    const client = { start: vi.fn(() => gate.promise), stop: vi.fn(async () => undefined) };
    const lifecycle = new CopilotSdkClientLifecycle(async () => client);

    const first = lifecycle.getClient();
    const second = lifecycle.getClient();
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    gate.resolve();

    await expect(first).resolves.toBe(client);
    await expect(second).resolves.toBe(client);
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a client when shutdown races with startup', async () => {
    const gate = deferred<void>();
    const client = { start: vi.fn(() => gate.promise), stop: vi.fn(async () => undefined) };
    const lifecycle = new CopilotSdkClientLifecycle(async () => client);

    const pending = lifecycle.getClient();
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    await lifecycle.stop();
    gate.resolve();

    await expect(pending).rejects.toThrow(/stopped while it was starting/i);
    expect(client.stop).toHaveBeenCalledTimes(1);
    await expect(lifecycle.getClient()).rejects.toThrow(/shut down/i);
  });

  it('cleans up a client whose startup fails and allows a fresh attempt', async () => {
    const failed = {
      start: vi.fn(async () => { throw new Error('startup failed'); }),
      stop: vi.fn(async () => undefined),
    };
    const recovered = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    let attempts = 0;
    const lifecycle = new CopilotSdkClientLifecycle(async () => (++attempts === 1 ? failed : recovered));

    await expect(lifecycle.getClient()).rejects.toThrow(/startup failed/);
    expect(failed.stop).toHaveBeenCalledTimes(1);
    await expect(lifecycle.getClient()).resolves.toBe(recovered);
  });
});
