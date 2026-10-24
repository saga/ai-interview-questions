/**
 * Owns the process-level CopilotClient used by the local Vite endpoint.
 *
 * A stop is terminal. The generation guard prevents a late asynchronous start
 * from publishing a client after the Vite server has already closed.
 */
export interface StartableCopilotClient {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

export class CopilotSdkClientLifecycle<T extends StartableCopilotClient> {
  private client: T | null = null;
  private starting: Promise<T> | null = null;
  private generation = 0;
  private closed = false;

  constructor(private readonly createClient: () => T | Promise<T>) {}

  async getClient(): Promise<T> {
    if (this.closed) throw new Error('Copilot client lifecycle is shut down.');
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    const generation = this.generation;
    const startPromise = (async () => {
      const candidate = await this.createClient();
      try {
        if (this.closed || generation !== this.generation) {
          throw new Error('Copilot client was stopped while it was starting.');
        }
        await candidate.start();
        if (this.closed || generation !== this.generation) {
          throw new Error('Copilot client was stopped while it was starting.');
        }
        this.client = candidate;
        return candidate;
      } catch (error) {
        if (this.client !== candidate) {
          await Promise.resolve(candidate.stop()).catch(() => undefined);
        }
        throw error;
      }
    })();

    this.starting = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.starting === startPromise) this.starting = null;
    }
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    const active = this.client;
    this.client = null;
    this.starting = null;
    if (active) await active.stop();
  }
}
