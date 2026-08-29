import type { AIConfig, ProviderEntry } from '../schemas/ai-config';
import type { ProviderId } from '../schemas/common';
import { isEntryValid } from '../ai/provider';
import { aiConfigSchema, proficiencyConfigSchema } from '../schemas/ai-config';
import { formatSchemaErrorMessage } from '../schemas/errors';
import { SAMPLE_CONFIG } from '../config/sampleConfig';

const KEY = 'ai-interview-trainer.config';
const PROVIDER_IDS: readonly ProviderId[] = ['chrome', 'local', 'deepseek', 'openrouter', 'google', 'cloudflare-workers-ai'];

// 默认配置 = 内置的干净样例（src/config/sample-config.json）：完整引擎清单，
// chrome / local 启用、其余禁用。既是「恢复默认」按钮的回填值，也是 localStorage 为空 / 损坏时的兜底。
export const DEFAULT_CONFIG: AIConfig = SAMPLE_CONFIG;

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
 * 读取配置：localStorage key 不变（用户数据契约），形态为 `{ providers: [...] }`。
 * 解析失败、形状不合法或全部引擎无效时回退默认配置。
 */
export function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // 历史存储无此字段：缺省视为关闭（与默认值一致，ADR-031）
      const generateOpenQuestions = parsed.generateOpenQuestions === true;
      const masteryThreshold = typeof parsed.masteryThreshold === 'number' ? parsed.masteryThreshold : 75;
      const disabledCategories = Array.isArray(parsed.disabledCategories)
        ? parsed.disabledCategories.filter((value): value is string => typeof value === 'string')
        : [];
      const proficiencyResult = proficiencyConfigSchema.safeParse(parsed.proficiency);
      const proficiency = proficiencyResult.success ? proficiencyResult.data : proficiencyConfigSchema.parse({});
      const prompts = parsed.prompts && typeof parsed.prompts === 'object' ? parsed.prompts : undefined;
      if (Array.isArray(parsed.providers)) {
        const providers = parsed.providers
          .map(sanitizeEntry)
          .filter((e): e is ProviderEntry => e !== null)
          // 同一引擎只保留首个出现，避免降级链语义混乱
          .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);
        if (providers.length > 0) {
          return {
            providers,
            generateOpenQuestions,
            masteryThreshold,
            disabledCategories,
            proficiency,
            ...(prompts ? { prompts } : {}),
          };
        }
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
 * 分层：Zod 负责形状校验，domain 负责业务不变量（去重 / isEntryValid / 至少一可用）。
 */
export function parseConfigJSON(text: string): { ok: true; config: AIConfig } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }

  // ── Zod 形状校验（数据长什么样） ──
  const shapeResult = aiConfigSchema.safeParse(parsed);
  if (!shapeResult.success) {
    // 顶层 providers 缺失 / 类型错误给出更友好的提示，保持原有文案兼容
    const root = parsed as Record<string, unknown> | null;
    if (!root || typeof root !== 'object' || Array.isArray(root) || !Array.isArray((root as Record<string, unknown>).providers)) {
      return { ok: false, error: '顶层结构必须是 { "providers": [ ... ] }（引擎按数组顺序组成降级链）' };
    }
    return {
      ok: false,
      error: `配置结构错误：\n${formatSchemaErrorMessage(shapeResult.error)}`,
    };
  }

  // Zod 已填入默认值并完成类型清洗，再做一次 sanitize 归一（accountId 空字符串剔除等）
  const normalized = shapeResult.data;
  const entries: ProviderEntry[] = [];
  const seen = new Set<ProviderId>();

  for (let i = 0; i < normalized.providers.length; i++) {
    const rawEntry = normalized.providers[i] as unknown as Record<string, unknown>;
    // 利用 sanitizeEntry 做最终归一（保留其对 accountId 的清洗语义）
    const entry = sanitizeEntry(rawEntry);
    if (!entry) {
      return { ok: false, error: `providers[${i}] 结构非法（需要 id / enabled / model / apiKey / baseUrl 字段）` };
    }
    if (seen.has(entry.id)) {
      return { ok: false, error: `providers[${i}] 的 id "${String(entry.id)}" 重复：同一引擎只能出现一次` };
    }
    seen.add(entry.id);

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
  // generateOpenQuestions 已由 Zod 默认 false，无需额外处理
  return {
    ok: true,
    config: {
      providers: entries,
      generateOpenQuestions: normalized.generateOpenQuestions,
      masteryThreshold: normalized.masteryThreshold,
      disabledCategories: normalized.disabledCategories,
      proficiency: normalized.proficiency,
      ...(normalized.prompts ? { prompts: normalized.prompts } : {}),
    },
  };
}
