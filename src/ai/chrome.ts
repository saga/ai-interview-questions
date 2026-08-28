// Chrome Built-in AI（Prompt API）底层封装：浏览器自带的本地模型，无需 API Key、无网络外发。
// 与 pi.ts 对等——只做"可用性检测 + 一次性补全"，业务语义在 variant / evaluate。
// 兼容性由运行时能力检测决定（LanguageModel 不存在 → unavailable），不做 polyfill（ADR-021）。

/** Chrome Prompt API 的可用性状态（与 LanguageModel.availability() 对齐）。 */
export type ChromeAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface ChromeSessionLike {
  prompt(input: string): Promise<string>;
  destroy?(): void;
}

interface LanguageModelLike {
  availability?(): Promise<ChromeAvailability>;
  create(options?: {
    initialPrompts?: Array<{ role: string; content: string }>;
    monitor?: unknown;
  }): Promise<ChromeSessionLike>;
}

/** 取全局 LanguageModel（Prompt API）；不支持的环境返回 undefined。独立导出便于测试注入。 */
export function getLanguageModel(): LanguageModelLike | undefined {
  return (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel;
}

/** 检测当前环境的内置模型可用性；API 缺失或检测失败一律返回 unavailable。 */
export async function chromeAvailability(): Promise<ChromeAvailability> {
  const lm = getLanguageModel();
  if (!lm?.availability) return 'unavailable';
  try {
    const s = await lm.availability();
    return s ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * 受限并发队列：Chrome on-device 模型在同一时刻只允许存在「一个」活跃 session——
 * 第二个 `lm.create()` 会无限挂起（不抛错），导致 Promise.all 整体死锁、组卷永远卡在
 * 「正在生成」。因此本地引擎必须严格串行（CONCURRENCY = 1），用完即 destroy 后再建下一个。
 * 模块级队列对所有调用方生效（组卷变体的 Promise.all / 自适应出题 / 开放题评分），
 * 云端引擎（pi.ts）不受影响，仍可自由并发。
 */
const CONCURRENCY = 1;
let activeCount = 0;
const pending: Array<() => void> = [];

/** 当活跃数低于并发上限时，从等待队列取出任务启动。 */
function pump() {
  while (activeCount < CONCURRENCY && pending.length > 0) {
    const start = pending.shift()!;
    start();
  }
}

/**
 * 把任务投入受限并发队列。任务的成败只影响自身 promise，不会透传给队列中的其他任务，
 * 因此单个失败不会阻塞后续调用。
 */
function runLimited<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push(() => {
      activeCount++;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeCount--;
          pump();
        });
    });
    pump();
  });
}

/**
 * 单次补全硬超时：Chrome on-device 模型是单 session 的，且偶尔会在某些 prompt 上「永久不返回」
 * （既不复议也不抛错），也不提供 abort。若不设超时，一次卡死会永久占用唯一 session 槽位、
 * 让后续所有 create 死锁、整场组卷卡死。这里用 watchdog 把 create / prompt 包成「超时即拒绝」，
 * 上层（finalizeQuestion 的回退）据此降级为原题，保证 UI 永不假死。
 */
const CALL_TIMEOUT_MS = 60_000;
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Chrome 内置 AI ${label} 超时（${CALL_TIMEOUT_MS}ms），已降级为原题`)), CALL_TIMEOUT_MS),
    ),
  ]);
}

/** 一次性补全：每次调用新建 session（one-shot 无状态架构），用完即销毁；全局最多 1 个并发。 */
export async function chromeComplete(system: string, user: string): Promise<string> {
  return runLimited(() => chromeCompleteOnce(system, user));
}

async function chromeCompleteOnce(system: string, user: string): Promise<string> {
  const lm = getLanguageModel();
  if (!lm) {
    throw new Error('当前浏览器不支持 Chrome 内置 AI（Prompt API），请在设置中改用云端服务商');
  }
  if ((await chromeAvailability()) === 'unavailable') {
    throw new Error('Chrome 内置 AI 模型在当前环境不可用，请在设置中改用云端服务商');
  }
  const session = await withTimeout(
    lm.create({ initialPrompts: [{ role: 'system', content: system }] }),
    'create',
  );
  try {
    return (await withTimeout(session.prompt(user), 'prompt')) ?? '';
  } finally {
    await session.destroy?.();
  }
}
