import { describe, it, expect } from 'vitest';
import { aiConfigSchema } from './ai-config';

describe('aiConfigSchema', () => {
  it('accepts valid config with single provider', () => {
    expect(() =>
      aiConfigSchema.parse({
        providers: [{ id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x' }],
        generateOpenQuestions: false,
      }),
    ).not.toThrow();
  });

  it('defaults generateOpenQuestions to false', () => {
    const parsed = aiConfigSchema.parse({
      providers: [{ id: 'chrome', enabled: true, model: '', apiKey: '' }],
    });
    expect(parsed.generateOpenQuestions).toBe(false);
  });

  it('defaults enabled to true', () => {
    const parsed = aiConfigSchema.parse({
      providers: [{ id: 'deepseek', model: 'm', apiKey: 'k' }],
    });
    expect(parsed.providers[0].enabled).toBe(true);
  });

  it('rejects unknown provider id', () => {
    expect(() =>
      aiConfigSchema.parse({
        providers: [{ id: 'unknown', enabled: true, model: 'm', apiKey: 'k' }],
      }),
    ).toThrow();
  });

  it('accepts chrome without apiKey/model', () => {
    expect(() =>
      aiConfigSchema.parse({
        providers: [{ id: 'chrome', enabled: true, model: '', apiKey: '' }],
      }),
    ).not.toThrow();
  });

  it('accepts local with baseUrl', () => {
    expect(() =>
      aiConfigSchema.parse({
        providers: [{ id: 'local', enabled: true, model: 'local-model', apiKey: '', baseUrl: 'http://127.0.0.1:8888/v1' }],
      }),
    ).not.toThrow();
  });
});
