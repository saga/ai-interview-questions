// 配置存取测试：链式形态清洗（localStorage key 属用户数据契约）
// 以及 config.json 编辑器的解析校验（parseConfigJSON）。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { DEFAULT_CONFIG, loadConfig, parseConfigJSON, saveConfig, sanitizeEntry, stringifyConfig } from './settings';
import { clearErrorLogs, getErrorLogs } from './db';
import type { AIConfig } from '../schemas/ai-config';

let store: Record<string, string>;

beforeEach(async () => {
  store = {};
  await clearErrorLogs();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
});

describe('配置审计日志', () => {
  it('记录安全摘要，不写入 API Key 或提示词正文', async () => {
    const secret = 'sk-audit-secret';
    saveConfig({
      ...DEFAULT_CONFIG,
      providers: DEFAULT_CONFIG.providers.map((provider) =>
        provider.id === 'deepseek' ? { ...provider, enabled: true, model: 'm', apiKey: secret } : provider,
      ),
      prompts: { agentInstructions: 'private prompt body', agentOpening: 'private opening body' },
    });

    const logs = await getErrorLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].scope).toBe('config-audit');
    expect(JSON.stringify(logs[0])).not.toContain(secret);
    expect(JSON.stringify(logs[0])).not.toContain('private prompt body');
    expect(JSON.stringify(logs[0])).not.toContain('private opening body');
    expect(logs[0].detail).toMatchObject({ after: { providers: expect.any(Array), prompts: expect.any(Object) } });
  });

  it('配置没有变化时不重复记录审计日志', async () => {
    saveConfig(DEFAULT_CONFIG);
    saveConfig(DEFAULT_CONFIG);
    expect(await getErrorLogs()).toHaveLength(0);
  });
});

describe('sanitizeEntry', () => {
  it('逐字段清洗并兜底缺失字段', () => {
    expect(sanitizeEntry({ id: 'deepseek', model: 'm' })).toEqual({
      id: 'deepseek',
      enabled: true,
      model: 'm',
      apiKey: '',
      baseUrl: '',
    });
  });

  it('enabled 缺省视为启用，显式 false 保留', () => {
    expect(sanitizeEntry({ id: 'chrome', enabled: false })?.enabled).toBe(false);
  });

  it('id 非法或非对象时返回 null', () => {
    expect(sanitizeEntry({ id: 'nope' })).toBeNull();
    expect(sanitizeEntry(null)).toBeNull();
    expect(sanitizeEntry('x')).toBeNull();
  });

  it('accountId 仅在非空字符串时保留（cloudflare 专用字段）', () => {
    expect(sanitizeEntry({ id: 'cloudflare-workers-ai', model: 'm', apiKey: 'k', accountId: 'abc123' })).toEqual({
      id: 'cloudflare-workers-ai',
      enabled: true,
      model: 'm',
      apiKey: 'k',
      baseUrl: '',
      accountId: 'abc123',
    });
    // 其他引擎/空值不产生噪音字段
    expect(sanitizeEntry({ id: 'deepseek', model: 'm' })?.accountId).toBeUndefined();
    expect(sanitizeEntry({ id: 'cloudflare-workers-ai', model: 'm', accountId: '   ' })?.accountId).toBeUndefined();
  });
});

describe('loadConfig', () => {
  it('无存储时返回默认配置（完整引擎样例：chrome/local 启用，其余禁用）', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('历史遗留的已下线引擎（openai/anthropic）被丢弃，openrouter 恢复后正常保留', () => {
    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [
        { id: 'chrome', enabled: true },
        { id: 'openai', enabled: true, model: 'gpt-4o', apiKey: 'sk-a' },
        { id: 'anthropic', enabled: false, model: 'claude-3-5-sonnet', apiKey: 'sk-b' },
      ],
    });
    expect(loadConfig()).toEqual({
      providers: [{ id: 'chrome', enabled: true, model: '', apiKey: '', baseUrl: '' }],
      generateOpenQuestions: false,
      questionChallengerEnabled: false,
      masteryThreshold: 75,
      disabledCategories: [],
      proficiency: DEFAULT_CONFIG.proficiency,
    });

    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [{ id: 'openrouter', enabled: true, model: 'anthropic/claude-haiku-4.5', apiKey: 'sk-or-v1-x' }],
    });
    expect(loadConfig()).toEqual({
      providers: [
        { id: 'openrouter', enabled: true, model: 'anthropic/claude-haiku-4.5', apiKey: 'sk-or-v1-x', baseUrl: '' },
      ],
      generateOpenQuestions: false,
      questionChallengerEnabled: false,
      masteryThreshold: 75,
      disabledCategories: [],
      proficiency: DEFAULT_CONFIG.proficiency,
    });
  });

  it('新链式形态逐项清洗并去重（同引擎保留首个）', () => {
    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [
        { id: 'chrome' },
        { id: 'local', enabled: false, model: 'unsloth/Qwen3-8B' },
        { id: 'chrome', model: '' }, // 重复，丢弃
        { id: 'bogus' }, // 非法，丢弃
        'junk', // 非对象，丢弃
      ],
    });
    const c = loadConfig();
    expect(c.providers).toHaveLength(2);
    expect(c.providers[0]).toMatchObject({ id: 'chrome', enabled: true });
    expect(c.providers[1]).toMatchObject({ id: 'local', enabled: false });
  });

  it('解析失败或全非法时回退默认配置', () => {
    store['ai-interview-trainer.config'] = '{not json';
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
    store['ai-interview-trainer.config'] = JSON.stringify({ providers: [{ id: 'bogus' }] });
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
});

describe('loadConfig（generateOpenQuestions）', () => {
  it('字段缺省视为 false，显式 true 保留', () => {
    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [{ id: 'deepseek', enabled: true, model: 'm', apiKey: 'k' }],
    });
    expect(loadConfig().generateOpenQuestions).toBe(false);

    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [{ id: 'deepseek', enabled: true, model: 'm', apiKey: 'k' }],
      generateOpenQuestions: true,
    });
    expect(loadConfig().generateOpenQuestions).toBe(true);
  });
});

describe('saveConfig / loadConfig 往返', () => {
  it('保存后原样读回', () => {
    const c: AIConfig = {
      providers: [
        { id: 'chrome', enabled: true, model: '', apiKey: '', baseUrl: '' },
        { id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x', baseUrl: '' },
      ],
      generateOpenQuestions: true,
      questionChallengerEnabled: false,
      masteryThreshold: 75,
      disabledCategories: [],
      proficiency: DEFAULT_CONFIG.proficiency,
    };
    saveConfig(c);
    expect(loadConfig()).toEqual(c);
  });

  it('prompts.agentOpening 原样往返（开场指令可持久化）', () => {
    const c: AIConfig = {
      ...DEFAULT_CONFIG,
      prompts: { agentOpening: '只考 RAG，5 题，不要查薄弱主题' },
    };
    saveConfig(c);
    expect(loadConfig().prompts?.agentOpening).toBe('只考 RAG，5 题，不要查薄弱主题');
  });

  it('prompts.agentInstructions 原样往返（用户自定义偏好层可持久化）', () => {
    const c: AIConfig = {
      ...DEFAULT_CONFIG,
      prompts: { agentInstructions: '多问系统设计，语气严厉' },
    };
    saveConfig(c);
    expect(loadConfig().prompts?.agentInstructions).toBe('多问系统设计，语气严厉');
  });

  it('兼容旧字段：agentSystem 迁移为 agentInstructions，evaluationSystem/variantSystem 被丢弃', () => {
    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [{ id: 'chrome', enabled: true }],
      prompts: {
        agentSystem: '旧的系统提示词副本',
        agentOpening: '旧开场',
        evaluationSystem: '旧的评分系统提示词',
        variantSystem: '旧的变体系统提示词',
      },
    });
    const loaded = loadConfig();
    expect(loaded.prompts?.agentInstructions).toBe('旧的系统提示词副本');
    expect(loaded.prompts?.agentOpening).toBe('旧开场');
    // 不可再配置的字段直接丢弃，不应出现在读回结果中
    expect(loaded.prompts).not.toHaveProperty('evaluationSystem');
    expect(loaded.prompts).not.toHaveProperty('variantSystem');
  });

  it('新字段 agentInstructions 优先于旧字段 agentSystem（不回退到旧值）', () => {
    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [{ id: 'chrome', enabled: true }],
      prompts: { agentSystem: '旧值', agentInstructions: '新值' },
    });
    expect(loadConfig().prompts?.agentInstructions).toBe('新值');
  });

  it('prompts 仅含不可配置的 eval/variant 字段时，读回时不带 prompts（避免空噪音字段）', () => {
    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [{ id: 'chrome', enabled: true }],
      prompts: { evaluationSystem: 'x', variantSystem: 'y' },
    });
    const loaded = loadConfig();
    expect(loaded.prompts).toBeUndefined();
  });
});

describe('stringifyConfig', () => {
  it('输出两空格缩进 JSON，且可被 parseConfigJSON 原样读回', () => {
    const c: AIConfig = {
      providers: [{ id: 'chrome', enabled: true, model: '', apiKey: '', baseUrl: '' }],
      generateOpenQuestions: true,
      questionChallengerEnabled: false,
      masteryThreshold: 75,
      disabledCategories: [],
      proficiency: DEFAULT_CONFIG.proficiency,
    };
    const text = stringifyConfig(c);
    expect(text).toBe(JSON.stringify(c, null, 2));
    expect(parseConfigJSON(text)).toEqual({ ok: true, config: c });
  });
});

describe('parseConfigJSON（config.json 编辑器校验）', () => {
  const VALID_ENTRY = { id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x' };

  it('合法多引擎链：清洗字段并保持顺序', () => {
    const res = parseConfigJSON(
      JSON.stringify({ providers: [{ id: 'chrome' }, { ...VALID_ENTRY, apiKey: 'sk-x' }] }),
    );
    expect(res).toEqual({
      ok: true,
      config: {
        providers: [
          { id: 'chrome', enabled: true, model: '', apiKey: '', baseUrl: '' },
          { id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x', baseUrl: '' },
        ],
        generateOpenQuestions: false,
        questionChallengerEnabled: false,
        masteryThreshold: 75,
        disabledCategories: [],
        proficiency: DEFAULT_CONFIG.proficiency,
      },
    });
  });

  it('generateOpenQuestions：显式 true 保留，缺省/非法值视为 false', () => {
    const base = { providers: [VALID_ENTRY] };
    const on = parseConfigJSON(JSON.stringify({ ...base, generateOpenQuestions: true }));
    expect(on).toEqual({
      ok: true,
      config: { providers: [{ ...VALID_ENTRY, baseUrl: '' }], generateOpenQuestions: true, questionChallengerEnabled: false, masteryThreshold: 75, disabledCategories: [], proficiency: DEFAULT_CONFIG.proficiency },
    });
    for (const bad of [undefined, 'yes', 1, null]) {
      const raw = bad === undefined ? base : { ...base, generateOpenQuestions: bad };
      const res = parseConfigJSON(JSON.stringify(raw));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.config.generateOpenQuestions).toBe(false);
    }
  });

  it('prompts.agentOpening：字符串通过，非字符串整体拒绝', () => {
    const base = { providers: [VALID_ENTRY] };
    const ok = parseConfigJSON(JSON.stringify({ ...base, prompts: { agentOpening: '改成 15 题' } }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.prompts?.agentOpening).toBe('改成 15 题');

    // 非字符串 → 整个配置被拒（与 agentInstructions 同口径，不静默丢弃）
    const bad = parseConfigJSON(JSON.stringify({ ...base, prompts: { agentOpening: 15 } }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('agentOpening');
  });

  it('停用的引擎允许配置不完整（保留其配置）', () => {
    const res = parseConfigJSON(
      JSON.stringify({
        providers: [
          { id: 'local', enabled: false },
          VALID_ENTRY,
        ],
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.providers[0]).toMatchObject({ id: 'local', enabled: false });
  });

  it('cloudflare：accountId 齐全时通过，缺失时整体拒绝', () => {
    const CF = { id: 'cloudflare-workers-ai', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', apiKey: 'cf-token' };
    const ok = parseConfigJSON(JSON.stringify({ providers: [{ ...CF, accountId: '023e105f' }] }));
    expect(ok).toEqual({
      ok: true,
      config: {
        providers: [
          {
            id: 'cloudflare-workers-ai',
            enabled: true,
            model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            apiKey: 'cf-token',
            baseUrl: '',
            accountId: '023e105f',
          },
        ],
        generateOpenQuestions: false,
        questionChallengerEnabled: false,
        masteryThreshold: 75,
        disabledCategories: [],
        proficiency: DEFAULT_CONFIG.proficiency,
      },
    });
    const bad = parseConfigJSON(JSON.stringify({ providers: [CF] }));
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('Account ID') });
  });

  it.each([
    ['非 JSON 文本', '{not json'],
    ['顶层缺 providers', '{"foo": 1}'],
    ['providers 不是数组', '{"providers": "x"}'],
    ['id 非法', JSON.stringify({ providers: [VALID_ENTRY, { id: 'openai', model: 'gpt-4o', apiKey: 'k' }] })],
    ['同引擎重复', JSON.stringify({ providers: [VALID_ENTRY, VALID_ENTRY] })],
    ['启用的 local 缺模型', JSON.stringify({ providers: [{ id: 'local', enabled: true }, VALID_ENTRY] })],
    ['启用的云端缺 apiKey', JSON.stringify({ providers: [{ id: 'deepseek', enabled: true, model: 'm' }] })],
    ['全部停用', JSON.stringify({ providers: [{ ...VALID_ENTRY, enabled: false }] })],
    ['空链', JSON.stringify({ providers: [] })],
  ])('整体拒绝：%s，并给出错误信息', (_name, text) => {
    const res = parseConfigJSON(text as string);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
  });

  it('错误信息可定位到具体下标与原因', () => {
    expect(parseConfigJSON('{"providers":[{"id":"openai"}]}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('providers[0].id'),
    });
    expect(
      parseConfigJSON(JSON.stringify({ providers: [VALID_ENTRY, { ...VALID_ENTRY, apiKey: 'sk-y' }] })),
    ).toMatchObject({ ok: false, error: expect.stringContaining('重复') });
  });
});
