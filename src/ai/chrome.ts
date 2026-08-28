// Chrome Built-in AI（Prompt API）底层封装：浏览器自带的本地模型，无需 API Key、无网络外发。
// 与 pi.ts 对等——只做"可用性检测 + 一次性补全"，业务语义在 variant / evaluate。
// 兼容性由运行时能力检测决定（LanguageModel 不存在 → unavailable），不做 polyfill（ADR-021）。
//
// 并发 / 超时 / 取消 / session 生命周期统一由文件内的 ChromeAIExecutor 管理：
// 本地模型支持并发 session，但偶发「prompt 永久不返回」会占住槽位导致后续 create 全部死锁，
// 故由 executor 用超时 + AbortSignal + destroy() 把死锁降级为「超时拒绝」，上层再回退原题。

/** Chrome Prompt API 的可用性状态（与 LanguageModel.availability() 对齐）。 */
export type ChromeAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export type ChromeAITaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ChromeAITaskInfo {
  id: string;
  status: ChromeAITaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: unknown;
}

export interface ChromeAIExecutorOptions {
  /** 同时执行的 prompt 数上限。Chrome 本机模型建议 2（竞争本机算力，不是硬上限）。 */
  concurrency?: number;
  /** 单次 prompt 的默认超时（ms）。 */
  timeoutMs?: number;
  /** 执行失败后的重试次数。 */
  retries?: number;
  /** 队列状态变化回调（可接 React state）。 */
  onChange?: (tasks: ChromeAITaskInfo[]) => void;
}

export interface ChromeAIExecuteOptions {
  /** 取消本任务。 */
  signal?: AbortSignal;
  /** 覆盖默认超时。 */
  timeoutMs?: number;
  /** 覆盖默认重试次数。 */
  retries?: number;
  /** 可选的 system prompt（进入 initialPrompts）。 */
  system?: string;
  /** 可选任务 id。 */
  taskId?: string;
}

interface ChromeSessionLike {
  prompt(input: string, opts?: { signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
  /** Prompt API 支持 clone()：从基准 session 派生独立会话，免去重复解析 system 指令（官方推荐做法）。 */
  clone?(): Promise<ChromeSessionLike>;
}

interface LanguageModelLike {
  availability?(): Promise<ChromeAvailability>;
  create(options?: {
    initialPrompts?: Array<{ role: string; content: string }>;
    signal?: AbortSignal;
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

function createTaskId(): string {
  return `chrome-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isRetryableError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof DOMException) {
    return ['NetworkError', 'InvalidStateError', 'OperationError', 'TimeoutError'].includes(error.name);
  }
  return true;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const valid = signals.filter(Boolean) as AbortSignal[];
  if (valid.length <= 1) return valid[0] ?? new AbortController().signal;
  const ctrl = new AbortController();
  valid.forEach((s) =>
    s.addEventListener(
      'abort',
      () => ctrl.abort(s.reason),
      { once: true },
    ),
  );
  return ctrl.signal;
}

/** 无论底层是否遵守 abort，都保证在 timeoutMs 后拒绝，避免永久假死。
 *  用回调式 setTimeout（而非会 reject 的 timer promise + Promise.race），
 *  可避免「rejection 暂未被处理」的伪未处理拒绝告警。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Chrome 内置 AI ${label} 超时（${ms}ms）`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

interface QueueItem<T> {
  task: ChromeAITaskInfo;
  execute: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  controller: AbortController;
}

/**
 * Chrome Built-in AI / Prompt API 执行器（基础设施层，不依赖 React）。
 *
 * 职责：并发控制、FIFO 队列、取消（AbortSignal）、超时、重试、LanguageModel session 生命周期、状态回调。
 *
 * 关键修正（对比早期「CONCURRENCY=1 串行」的误判）：
 * 实测 Chrome on-device 模型支持并发 session，真正导致「开始自定义训练」卡死的是——
 * 某个 prompt 偶发永久不返回（既不 resolve 也不 reject，也不遵守 abort），其 session 一直占着槽位，
 * 后续 create 拿不到槽位而全部挂起。因此这里必须靠「超时 + AbortSignal + destroy()」把死锁变成「超时拒绝」，
 * 上层（finalizeQuestion 回退原题）据此降级，UI 永不假死。
 *
 * 设计来源：用户提供的 ChromeAIExecutor 方案（含 runningTasks Map 修正）。
 */
export class ChromeAIExecutor {
  private readonly concurrency: number;
  private readonly defaultTimeoutMs: number;
  private readonly defaultRetries: number;

  private readonly queue: QueueItem<unknown>[] = [];
  private readonly runningTasks = new Map<string, QueueItem<unknown>>();
  private readonly tasks = new Map<string, ChromeAITaskInfo>();

  /** 按 system 缓存的基准 session（创建一次，每题 clone）。空闲时随 disposeBases 释放。 */
  private readonly baseSessions = new Map<string, ChromeSessionLike>();
  private readonly baseSessionPromises = new Map<string, Promise<ChromeSessionLike>>();

  private running = 0;
  private readonly onChange?: (tasks: ChromeAITaskInfo[]) => void;

  constructor(options: ChromeAIExecutorOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.defaultTimeoutMs = options.timeoutMs ?? 90_000;
    this.defaultRetries = Math.max(0, options.retries ?? 1);
    this.onChange = options.onChange;
  }

  get activeCount(): number {
    return this.running;
  }
  get pendingCount(): number {
    return this.queue.length;
  }
  get maxConcurrency(): number {
    return this.concurrency;
  }
  getTasks(): ChromeAITaskInfo[] {
    return Array.from(this.tasks.values());
  }

  execute(prompt: string, options: ChromeAIExecuteOptions = {}): Promise<string> {
    return this.enqueue(
      (signal) => this.runPrompt(prompt, signal, options),
      options,
    );
  }

  enqueue<T>(
    execute: (signal: AbortSignal) => Promise<T>,
    options: ChromeAIExecuteOptions = {},
  ): Promise<T> {
    const id = options.taskId ?? createTaskId();
    const task: ChromeAITaskInfo = { id, status: 'queued', createdAt: Date.now() };
    const controller = new AbortController();

    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else
        options.signal.addEventListener(
          'abort',
          () => controller.abort(options.signal!.reason),
          { once: true },
        );
    }

    this.tasks.set(id, task);
    this.emitChange();

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        execute: execute as (signal: AbortSignal) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        controller,
      });
      this.pump();
    });
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
      return false;

    const queuedIndex = this.queue.findIndex((item) => item.task.id === taskId);
    if (queuedIndex >= 0) {
      const [item] = this.queue.splice(queuedIndex, 1);
      item.controller.abort();
      task.status = 'cancelled';
      task.finishedAt = Date.now();
      item.reject(new DOMException('Task cancelled', 'AbortError'));
      this.emitChange();
      return true;
    }

    const item = this.runningTasks.get(taskId);
    if (item) {
      item.controller.abort();
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'queued' || task.status === 'running') this.cancel(task.id);
    }
  }

  cleanup(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
        this.tasks.delete(id);
    }
    this.emitChange();
  }

  clearQueue(): void {
    const pending = [...this.queue];
    this.queue.length = 0;
    for (const item of pending) {
      item.controller.abort();
      item.task.status = 'cancelled';
      item.task.finishedAt = Date.now();
      item.reject(new DOMException('Queue cleared', 'AbortError'));
    }
    this.emitChange();
  }

  async idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.running === 0 && this.queue.length === 0) resolve();
        else setTimeout(check, 25);
      };
      check();
    });
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.running++;
      void this.runItem(item);
    }
    this.emitChange();
  }

  private async runItem<T>(item: QueueItem<T>): Promise<void> {
    const { task, execute, resolve, reject, controller } = item;
    this.runningTasks.set(task.id, item as QueueItem<unknown>);
    task.status = 'running';
    task.startedAt = Date.now();
    this.emitChange();

    try {
      const result = await execute(controller.signal);
      if (controller.signal.aborted) {
        task.status = 'cancelled';
        task.finishedAt = Date.now();
        reject(new DOMException('Task cancelled', 'AbortError'));
      } else {
        task.status = 'completed';
        task.finishedAt = Date.now();
        resolve(result);
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        task.status = 'cancelled';
        task.finishedAt = Date.now();
        reject(error);
      } else {
        task.status = 'failed';
        task.finishedAt = Date.now();
        task.error = error;
        reject(error);
      }
    } finally {
      this.runningTasks.delete(task.id);
      this.running--;
      this.emitChange();
      this.pump();
      // 整批空闲后释放基准 session，避免长期占用 Chrome 的并发槽位（否则会拖累后续训练）
      if (this.running === 0 && this.queue.length === 0) this.disposeBases();
    }
  }

  private async runPrompt(
    prompt: string,
    signal: AbortSignal,
    options: ChromeAIExecuteOptions,
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const retries = options.retries ?? this.defaultRetries;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        return await this.runPromptOnce(prompt, signal, timeoutMs, options.system);
      } catch (error) {
        lastError = error;
        if (signal.aborted || isAbortError(error) || !isRetryableError(error) || attempt >= retries)
          throw error;
        await sleep(250 * 2 ** attempt, signal);
      }
    }
    throw lastError;
  }

  /** 取（或惰性创建并缓存）针对某 system 的基准 session；同 system 只 create 一次，后续 clone 派生。 */
  private getBaseSession(
    system: string | undefined,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<ChromeSessionLike> {
    const key = system ?? '';
    const existing = this.baseSessionPromises.get(key);
    if (existing) return existing;

    const p = (async () => {
      const lm = getLanguageModel();
      if (!lm) throw new Error('当前浏览器不支持 Chrome 内置 AI（Prompt API），请在设置中改用云端服务商');
      return await withTimeout(
        lm.create({
          ...(system ? { initialPrompts: [{ role: 'system', content: system }] } : {}),
          signal,
        }),
        timeoutMs,
        'create-base',
      );
    })();

    this.baseSessionPromises.set(key, p);
    // 成功后登记基准；失败则移除，下次重新 create
    p.then(
      (s) => this.baseSessions.set(key, s),
      () => this.baseSessionPromises.delete(key),
    );
    return p;
  }

  private async runPromptOnce(
    prompt: string,
    externalSignal: AbortSignal,
    timeoutMs: number,
    system?: string,
  ): Promise<string> {
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(new DOMException('Chrome AI request timed out', 'TimeoutError')),
      timeoutMs,
    );
    const signal = combineSignals(externalSignal, timeoutController.signal);

    let clone: ChromeSessionLike | undefined;
    try {
      const base = await this.getBaseSession(system, signal, timeoutMs);
      // 基准 session 只建一次；每题用 clone() 派生独立会话，免去重复解析 system 指令（官方推荐）
      const c = await withTimeout(
        (base.clone?.() ?? Promise.reject(new Error('session 不支持 clone'))) as Promise<ChromeSessionLike>,
        timeoutMs,
        'clone',
      );
      clone = c;
      return (await withTimeout(c.prompt(prompt, { signal }), timeoutMs, 'prompt')) ?? '';
    } finally {
      clearTimeout(timer);
      // destroy() 释放克隆 session 槽位；基准在整批空闲时由 disposeBases 统一释放
      clone?.destroy?.();
    }
  }

  private disposeBases(): void {
    for (const [, s] of this.baseSessions) {
      try {
        s.destroy?.();
      } catch {
        /* 忽略销毁异常 */
      }
    }
    this.baseSessions.clear();
    this.baseSessionPromises.clear();
  }

  private emitChange(): void {
    this.onChange?.(this.getTasks());
  }
}

/** 应用层单例：Chrome 内置 AI 并发上限 8，单次 90s 超时，失败重试 1 次。 */
export const chromeAI = new ChromeAIExecutor({
  concurrency: 8,
  timeoutMs: 90_000,
  retries: 1,
});

/**
 * 一次性补全：把 system + user 交给 ChromeAIExecutor（默认并发 2、单次 60s 超时、失败重试 1 次）。
 * 业务层签名不变（variant / evaluate / provider 无需改动）；session 的创建、超时、销毁都在 executor 内完成。
 * 先做一次可用性预检，模型明确 unavailable 时直接报错、连 session 都不建（避免无谓的 create 超时）。
 */
export async function chromeComplete(system: string, user: string): Promise<string> {
  if (!getLanguageModel()) {
    throw new Error('当前浏览器不支持 Chrome 内置 AI（Prompt API），请在设置中改用云端服务商');
  }
  if ((await chromeAvailability()) === 'unavailable') {
    throw new Error('Chrome 内置 AI 模型在当前环境不可用，请在设置中改用云端服务商');
  }
  return chromeAI.execute(user, { system });
}
