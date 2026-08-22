import type { PiConfig } from '../types';

const KEY = 'ai-interview-trainer.config';

export function loadConfig(): PiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PiConfig>;
      return {
        provider: parsed.provider ?? 'openrouter',
        model: parsed.model ?? 'openai/gpt-4o-mini',
        apiKey: parsed.apiKey ?? '',
      };
    }
  } catch {
    /* ignore */
  }
  return { provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey: '' };
}

export function saveConfig(c: PiConfig): void {
  localStorage.setItem(KEY, JSON.stringify(c));
}
