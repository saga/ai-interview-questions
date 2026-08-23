// 配置存取测试：新链式形态清洗 + 旧单选形态迁移（localStorage key 属用户数据契约）。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, saveConfig, sanitizeEntry } from './settings';
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
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-x',
    });
    expect(loadConfig()).toEqual({
      providers: [{ id: 'openrouter', enabled: true, model: 'openai/gpt-4o-mini', apiKey: 'sk-x', baseUrl: '' }],
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
