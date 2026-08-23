import type { AIConfig, ProviderEntry, ProviderId } from '../types';

const KEY = 'ai-interview-trainer.config';
const PROVIDER_IDS: ProviderId[] = ['chrome', 'local', 'openai', 'anthropic', 'openrouter', 'deepseek'];

export const DEFAULT_CONFIG: AIConfig = {
  providers: [{ id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: '', baseUrl: '' }],
};

/** 逐字段清洗引擎配置；id 非法时返回 null（丢弃该通道）。 */
export function sanitizeEntry(raw: unknown): ProviderEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!PROVIDER_IDS.includes(r.id as ProviderId)) return null;
  return {
    id: r.id as ProviderId,
    enabled: r.enabled !== false,
    model: typeof r.model === 'string' ? r.model : '',
    apiKey: typeof r.apiKey === 'string' ? r.apiKey : '',
    baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : '',
  };
}

/**
 * 读取配置。兼容两种历史形态（localStorage key 不变，属用户数据契约）：
 * - 旧单选：{ provider, model, apiKey, baseUrl } → 迁移为单元素降级链；
 * - 新链式：{ providers: [...] } → 逐项清洗。
 */
export function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!Array.isArray(parsed.providers) && parsed.provider) {
        const entry = sanitizeEntry({ ...parsed, id: parsed.provider, enabled: true });
        if (entry) return { providers: [entry] };
      }
      if (Array.isArray(parsed.providers)) {
        const providers = parsed.providers
          .map(sanitizeEntry)
          .filter((e): e is ProviderEntry => e !== null)
          // 同一引擎只保留首个出现，避免降级链语义混乱
          .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);
        if (providers.length > 0) return { providers };
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(c: AIConfig): void {
  localStorage.setItem(KEY, JSON.stringify(c));
}
