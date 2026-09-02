import { describe, it, expect } from 'vitest';
import { aiConfigSchema } from './ai-config';

describe('aiConfigSchema', () => {
  it('accepts valid config with single provider', () => {
    expect(() =>
      aiConfigSchema.parse({
        providers: [{ id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x' }],
        generateOpenQuestions: false,
        masteryThreshold: 75,
      }),
    ).not.toThrow();
  });

  it('defaults generateOpenQuestions to false', () => {
    const parsed = aiConfigSchema.parse({
      providers: [{ id: 'chrome', enabled: true, model: '', apiKey: '' }],
    });
    expect(parsed.generateOpenQuestions).toBe(false);
  });

  it('defaults questionChallengerEnabled to false', () => {
    const parsed = aiConfigSchema.parse({ providers: [{ id: 'chrome' }] });
    expect(parsed.questionChallengerEnabled).toBe(false);
  });

  it('defaults runtimeVariantEnabled to false', () => {
    const parsed = aiConfigSchema.parse({ providers: [{ id: 'chrome' }] });
    expect(parsed.runtimeVariantEnabled).toBe(false);
  });

  it('coerces any non-true runtimeVariantEnabled to false', () => {
    for (const bad of [undefined, '', 'yes', 1, 0, null, {}, []]) {
      const parsed = aiConfigSchema.parse({ providers: [{ id: 'chrome' }], runtimeVariantEnabled: bad });
      expect(parsed.runtimeVariantEnabled).toBe(false);
    }
  });

  it('preserves explicit runtimeVariantEnabled: true', () => {
    const parsed = aiConfigSchema.parse({
      providers: [{ id: 'chrome' }],
      runtimeVariantEnabled: true,
    });
    expect(parsed.runtimeVariantEnabled).toBe(true);
  });

  it('defaults masteryThreshold to 75', () => {
    const parsed = aiConfigSchema.parse({ providers: [] });
    expect(parsed.masteryThreshold).toBe(75);
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
