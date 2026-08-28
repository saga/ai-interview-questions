// Chrome Prompt API 封装测试：mock globalThis.LanguageModel，不发任何真实调用。
// 覆盖：可用性检测（API 缺失 / 异常兜底）、one-shot 补全（system 注入、destroy 清理）、不可用时报错。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeAvailability, chromeComplete, getLanguageModel } from './chrome';

type SessionStub = { prompt: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };

function stubLanguageModel(impl?: Partial<{ availability: () => Promise<string>; create: (...args: unknown[]) => Promise<SessionStub> }>) {
  const lm = {
    availability: impl?.availability ?? (async () => 'available'),
    create:
      impl?.create ??
      (async () => {
        const session: SessionStub = { prompt: vi.fn(async () => 'ok'), destroy: vi.fn() };
        return session;
      }),
  };
  (globalThis as { LanguageModel?: unknown }).LanguageModel = lm;
  return lm;
}

afterEach(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
});

describe('chromeAvailability', () => {
  it('API 缺失时返回 unavailable', async () => {
    expect(await chromeAvailability()).toBe('unavailable');
  });

  it('透传 LanguageModel.availability() 结果', async () => {
    stubLanguageModel({ availability: async () => 'downloadable' });
    expect(await chromeAvailability()).toBe('downloadable');
  });

  it('availability 抛错时兜底为 unavailable', async () => {
    stubLanguageModel({ availability: async () => Promise.reject(new Error('boom')) });
    expect(await chromeAvailability()).toBe('unavailable');
  });
});

describe('chromeComplete', () => {
  it('system 进入 initialPrompts，user 发给 prompt，用后销毁 session', async () => {
    let createdWith: unknown;
    const session: SessionStub = { prompt: vi.fn(async (u: string) => `echo:${u}`), destroy: vi.fn() };
    const lm = stubLanguageModel({
      create: async (opts) => {
        createdWith = opts;
        return session;
      },
    });
    const out = await chromeComplete('sys-prompt', 'user-prompt');
    expect(out).toBe('echo:user-prompt');
    expect(createdWith).toMatchObject({ initialPrompts: [{ role: 'system', content: 'sys-prompt' }] });
    expect(session.prompt).toHaveBeenCalledWith('user-prompt', expect.anything());
    expect(session.destroy).toHaveBeenCalledTimes(1);
    void lm;
  });

  it('prompt 返回空值时兜底为空字符串', async () => {
    stubLanguageModel({
      create: async () => ({ prompt: vi.fn(async () => undefined as unknown as string), destroy: vi.fn() }),
    });
    expect(await chromeComplete('s', 'u')).toBe('');
  });

  it('不支持 Prompt API 时抛出可读错误', async () => {
    await expect(chromeComplete('s', 'u')).rejects.toThrow('不支持 Chrome 内置 AI');
  });

  it('模型不可用（unavailable）时不创建 session 直接报错', async () => {
    const lm = stubLanguageModel({ availability: async () => 'unavailable' });
    const create = vi.fn();
    (lm as { create: typeof create }).create = create;
    await expect(chromeComplete('s', 'u')).rejects.toThrow('不可用');
    expect(create).not.toHaveBeenCalled();
  });

  it('getLanguageModel 返回全局注入的实例', () => {
    const lm = stubLanguageModel();
    expect(getLanguageModel()).toBe(lm);
  });

  it('create / prompt 永久不返回（on-device 偶发卡死）时超时拒绝，不假死', async () => {
    vi.useFakeTimers();
    stubLanguageModel({
      create: async () => ({
        // 永不 resolve，模拟 Chrome 内置 AI 偶尔的死锁
        prompt: () => new Promise<string>(() => {}),
        destroy: vi.fn(),
      }),
    });
    const p = chromeComplete('s', 'u');
    // 先把断言 handler 挂上，再推进假时钟，避免「rejection 处理时机」告警
    const assertions = expect(p).rejects.toThrow('超时');
    // 单次 60s 超时 + 1 次重试（sleep 250ms）≈ 120.25s，留余量
    await vi.advanceTimersByTimeAsync(125_000);
    await assertions;
    vi.useRealTimers();
  });

  it('Chrome on-device 模型支持并发 session：并发调用上限为 executor 的 concurrency（默认 2）', async () => {
    let active = 0;
    let maxActive = 0;
    stubLanguageModel({
      create: async () => ({
        prompt: async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return 'ok';
        },
        destroy: vi.fn(),
      }),
    });
    // 模拟组卷路径：Promise.all 同时发起 5 个补全
    await Promise.all(Array.from({ length: 5 }, (_, i) => chromeComplete('s', `u${i}`)));
    // 默认 concurrency=2：同一时刻最多 2 个 session 并发，不会退化成串行也不会无限并发
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });

  it('前一个调用失败不影响后续调用（rejection 不透传，且会按 executor 重试一次）', async () => {
    let n = 0;
    stubLanguageModel({
      create: async () => {
        n++;
        // 前两次都失败：第一次失败 → executor 重试（retries=1）→ 第二次仍失败 → 才真正 reject
        if (n <= 2) throw new Error('boom');
        return { prompt: vi.fn(async () => 'ok'), destroy: vi.fn() };
      },
    });
    await expect(chromeComplete('s', 'u1')).rejects.toThrow('boom');
    await expect(chromeComplete('s', 'u2')).resolves.toBe('ok');
  });
});
