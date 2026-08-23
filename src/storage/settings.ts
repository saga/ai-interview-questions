import type { AIConfig, ProviderEntry, ProviderId } from '../types';
import { isEntryValid } from '../ai/provider';

const KEY = 'ai-interview-trainer.config';
const PROVIDER_IDS: readonly ProviderId[] = ['chrome', 'local', 'deepseek', 'openrouter', 'google', 'cloudflare-workers-ai'];

export const DEFAULT_CONFIG: AIConfig = {
  providers: [{ id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: '', baseUrl: '' }],
  generateOpenQuestions: false,
};

/** 逐字段清洗引擎配置；id 非法时返回 null（丢弃该通道）。
 *  accountId 仅 cloudflare 使用：非空才保留，避免其他引擎的配置出现空噪音字段。 */
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
    ...(typeof r.accountId === 'string' && r.accountId.trim() ? { accountId: r.accountId } : {}),
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
      // 历史存储无此字段：缺省视为关闭（与默认值一致，ADR-031）
      const generateOpenQuestions = parsed.generateOpenQuestions === true;
      if (!Array.isArray(parsed.providers) && parsed.provider) {
        const entry = sanitizeEntry({ ...parsed, id: parsed.provider, enabled: true });
        if (entry) return { providers: [entry], generateOpenQuestions };
      }
      if (Array.isArray(parsed.providers)) {
        const providers = parsed.providers
          .map(sanitizeEntry)
          .filter((e): e is ProviderEntry => e !== null)
          // 同一引擎只保留首个出现，避免降级链语义混乱
          .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);
        if (providers.length > 0) return { providers, generateOpenQuestions };
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

export function stringifyConfig(c: AIConfig): string {
  return JSON.stringify(c, null, 2);
}

/**
 * 校验并清洗「config.json 编辑器」提交的文本（纯函数，便于测试）。
 * 通过后返回规范化配置；任何一处不合法都整体拒绝，并给出可定位的错误信息。
 */
export function parseConfigJSON(text: string): { ok: true; config: AIConfig } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }
  const root = parsed as Record<string, unknown> | null;
  if (!root || typeof root !== 'object' || Array.isArray(root) || !Array.isArray(root.providers)) {
    return { ok: false, error: '顶层结构必须是 { "providers": [ ... ] }（引擎按数组顺序组成降级链）' };
  }

  const entries: ProviderEntry[] = [];
  const seen = new Set<ProviderId>();
  for (let i = 0; i < root.providers.length; i++) {
    const raw = root.providers[i];
    const id = (raw as Record<string, unknown> | null)?.id;
    if (!PROVIDER_IDS.includes(id as ProviderId)) {
      return { ok: false, error: `providers[${i}].id "${String(id)}" 非法，可选：${PROVIDER_IDS.join(' / ')}` };
    }
    if (seen.has(id as ProviderId)) {
      return { ok: false, error: `providers[${i}] 的 id "${String(id)}" 重复：同一引擎只能出现一次` };
    }
    seen.add(id as ProviderId);

    const entry = sanitizeEntry(raw);
    if (!entry) return { ok: false, error: `providers[${i}] 结构非法（需要 id / enabled / model / apiKey / baseUrl 字段）` };
    if (entry.enabled && !isEntryValid(entry)) {
      const hint =
        entry.id === 'local'
          ? '本地 API 引擎必须填写模型 ID'
          : entry.id === 'cloudflare-workers-ai'
            ? 'Cloudflare 引擎必须填写模型、API Token 与 Account ID'
            : '云端引擎必须同时填写模型与 API Key';
      return { ok: false, error: `providers[${i}]（${entry.id}）已启用但配置不完整：${hint}` };
    }
    entries.push(entry);
  }

  if (!entries.some((p) => p.enabled && isEntryValid(p))) {
    return { ok: false, error: '至少需要一个启用且配置完整的引擎' };
  }
  // generateOpenQuestions 缺省/非法值一律视为 false（与默认值一致）
  return { ok: true, config: { providers: entries, generateOpenQuestions: root.generateOpenQuestions === true } };
}
