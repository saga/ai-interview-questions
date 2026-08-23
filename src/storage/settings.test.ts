// 配置存取测试：新链式形态清洗 + 旧单选形态迁移（localStorage key 属用户数据契约）
// 以及 config.json 编辑器的解析校验（parseConfigJSON）。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, parseConfigJSON, saveConfig, sanitizeEntry, stringifyConfig } from './settings';
import type { AIConfig } from '../types';

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
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
});

describe('loadConfig', () => {
  it('无存储时返回默认配置（DeepSeek 单通道）', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('旧单选形态迁移为单元素降级链', () => {
    store['ai-interview-trainer.config'] = JSON.stringify({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: 'sk-x',
    });
    expect(loadConfig()).toEqual({
      providers: [{ id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x', baseUrl: '' }],
    });
  });

  it('历史遗留的已下线引擎（openai/anthropic/openrouter）被丢弃', () => {
    store['ai-interview-trainer.config'] = JSON.stringify({
      providers: [
        { id: 'chrome', enabled: true },
        { id: 'openai', enabled: true, model: 'gpt-4o', apiKey: 'sk-a' },
        { id: 'anthropic', enabled: false, model: 'claude-3-5-sonnet', apiKey: 'sk-b' },
      ],
    });
    expect(loadConfig()).toEqual({ providers: [{ id: 'chrome', enabled: true, model: '', apiKey: '', baseUrl: '' }] });
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

describe('saveConfig / loadConfig 往返', () => {
  it('保存后原样读回', () => {
    const c: AIConfig = {
      providers: [
        { id: 'chrome', enabled: true, model: '', apiKey: '', baseUrl: '' },
        { id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x', baseUrl: '' },
      ],
    };
    saveConfig(c);
    expect(loadConfig()).toEqual(c);
  });
});

describe('stringifyConfig', () => {
  it('输出两空格缩进 JSON，且可被 parseConfigJSON 原样读回', () => {
    const c: AIConfig = { providers: [{ id: 'chrome', enabled: true, model: '', apiKey: '', baseUrl: '' }] };
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
      },
    });
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
