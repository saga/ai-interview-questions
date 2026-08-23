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
    expect(session.prompt).toHaveBeenCalledWith('user-prompt');
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
});
