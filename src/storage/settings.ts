import type { PiConfig } from '../types';

const KEY = 'ai-interview-trainer.config';

export function loadConfig(): PiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PiConfig>;
      return {
        provider: parsed.provider ?? 'deepseek',
        model: parsed.model ?? 'deepseek-v4-flash',
        apiKey: parsed.apiKey ?? '',
        baseUrl: parsed.baseUrl ?? '',
      };
    }
  } catch {
    /* ignore */
  }
  return { provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: '', baseUrl: '' };
}

export function saveConfig(c: PiConfig): void {
  localStorage.setItem(KEY, JSON.stringify(c));
}
