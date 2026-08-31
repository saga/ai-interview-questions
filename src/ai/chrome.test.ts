// Chrome Prompt API 封装测试：mock globalThis.LanguageModel，不发任何真实调用。
// 覆盖：可用性检测（API 缺失 / 异常兜底）、one-shot 补全（基准 session + clone、system 注入、destroy 清理）、
// 不可用时报错、并发上限、超时拒绝、重试。

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHROME_AI_CONCURRENCY,
  chromeAI,
  chromeAvailability,
  chromeComplete,
  getLanguageModel,
} from './chrome';

type CloneSession = { prompt: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
type SessionStub = CloneSession & { clone: ReturnType<typeof vi.fn> };

/** 构造基准 session：其 clone() 返回一个独立的克隆 session（prompt 用 promptImpl）。 */
function makeSession(promptImpl: (u: string) => string | Promise<string>): SessionStub {
  const base: SessionStub = {
    prompt: vi.fn(),
    destroy: vi.fn(),
    clone: vi.fn(async () => ({ prompt: vi.fn(promptImpl), destroy: vi.fn() })),
  };
  return base;
}

function stubLanguageModel(impl?: Partial<{ availability: () => Promise<string>; create: (...args: unknown[]) => Promise<SessionStub> }>) {
  const lm = {
    availability: impl?.availability ?? (async () => 'available'),
    create: impl?.create ?? (async () => makeSession(async () => 'ok')),
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
  it('system 进入 initialPrompts；create 建基准、clone 出题、用后 destroy clone，base 空闲销毁', async () => {
    let createdWith: unknown;
    let cloned: CloneSession | undefined;
    const base = makeSession(async (u) => `echo:${u}`);
    base.clone = vi.fn(async () => {
      cloned = { prompt: vi.fn(async (u) => `echo:${u}`), destroy: vi.fn() };
      return cloned;
    });
    const lm = stubLanguageModel({ create: async (opts) => {
      createdWith = opts;
      return base;
    } });
    const out = await chromeComplete('sys-prompt', 'user-prompt');
    expect(out).toBe('echo:user-prompt');
    expect(createdWith).toMatchObject({ initialPrompts: [{ role: 'system', content: 'sys-prompt' }] });
    expect(base.clone).toHaveBeenCalledTimes(1);
    expect(cloned!.prompt).toHaveBeenCalledWith('user-prompt', expect.anything());
    expect(cloned!.destroy).toHaveBeenCalledTimes(1);
    expect(base.destroy).toHaveBeenCalledTimes(1); // 整批空闲后销毁基准
    void lm;
  });

  it('prompt 返回空值时兜底为空字符串', async () => {
    stubLanguageModel({ create: async () => makeSession(async () => undefined as unknown as string) });
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

  it('已 aborted 的 signal 立即被拒绝且不创建 session（P1-9：取消信号必须透传进 executor）', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const create = vi.fn();
    const lm = stubLanguageModel({ create: async () => {
      create();
      return makeSession(async () => 'ok');
    } });
    void lm;
    await expect(chromeComplete('s', 'u', ctrl.signal)).rejects.toThrow(DOMException);
    expect(create).not.toHaveBeenCalled();
  });

  it('未中止的 signal 作为透传选项被接受、不影响正常补全', async () => {
    stubLanguageModel();
    const ctrl = new AbortController();
    const out = await chromeComplete('s', 'u', ctrl.signal);
    expect(out).toBe('ok');
  });

  it('getLanguageModel 返回全局注入的实例', () => {
    const lm = stubLanguageModel();
    expect(getLanguageModel()).toBe(lm);
  });

  it('create / prompt 永久不返回（on-device 偶发卡死）时超时拒绝，不假死', async () => {
    vi.useFakeTimers();
    stubLanguageModel({ create: async () => makeSession(() => new Promise<string>(() => {})) });
    // 用显式 timeoutMs=5000，避免依赖单例默认超时值；与真实 90s 行为一致（单测不卡 180s）
    const p = chromeAI.execute('u', { system: 's', timeoutMs: 5000, retries: 1 });
    // 先把断言 handler 挂上，再推进假时钟，避免「rejection 处理时机」告警
    const assertions = expect(p).rejects.toThrow('超时');
    // 单次 5s 超时 + 1 次重试（sleep 250+500ms）≈ 5.75s，留余量
    await vi.advanceTimersByTimeAsync(11_000);
    await assertions;
    vi.useRealTimers();
  });

  it(`并发调用上限为 executor 的 concurrency（当前 ${CHROME_AI_CONCURRENCY}）`, async () => {
    let active = 0;
    let maxActive = 0;
    stubLanguageModel({
      create: async () =>
        makeSession(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return 'ok';
        }),
    });
    // 模拟组卷路径：Promise.all 同时发起 2×concurrency 个补全（同 system → 共用一个基准 session，逐个 clone）。
    // 任务数取 2 倍并发上限，确保队列一定被填满，从而能真实观测到峰值并发。
    const total = CHROME_AI_CONCURRENCY * 2;
    await Promise.all(Array.from({ length: total }, (_, i) => chromeComplete('s', `u${i}`)));
    // 上界：同一时刻最多 concurrency 个 clone 在 prompt，不会无限并发。
    // 断言引用常量而非硬编码数字——调整并发数时本测试自动跟随，不会再把旧值"锁死"。
    expect(maxActive).toBeLessThanOrEqual(CHROME_AI_CONCURRENCY);
    // 下界：既然任务数（2×）多于并发上限，就应当跑满；防止将来悄悄退化成串行而无人察觉。
    expect(maxActive).toBe(CHROME_AI_CONCURRENCY);
  });

  it('前一个调用失败不影响后续调用（rejection 不透传，且会按 executor 重试一次）', async () => {
    let n = 0;
    stubLanguageModel({
      create: async () => {
        n++;
        // 前两次都失败：第一次失败 → executor 重试（retries=1）→ 第二次仍失败 → 才真正 reject
        if (n <= 2) throw new Error('boom');
        return makeSession(async () => 'ok');
      },
    });
    await expect(chromeComplete('s', 'u1')).rejects.toThrow('boom');
    await expect(chromeComplete('s', 'u2')).resolves.toBe('ok');
  });
});
