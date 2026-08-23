// 纯逻辑测试：题目级 rubric 与全局 rubric 的合并 + 工厂分派 + 配置校验。
// ADR-013 / ARCHITECTURE「评分 Rubric」：required 注入提示词，dimensions 覆盖全局权重。
// ADR-021：provider==='chrome' 时无需 apiKey/model，工厂分派到 ChromeAIProvider。

import { describe, expect, it } from 'vitest';
import { ChromeAIProvider, PiAIProvider, createLLMProvider, isConfigValid, mergeQuestionRubric } from './provider';
import type { OpenQuestion, PiConfig, ScoringRubric } from '../types';

const GLOBAL: ScoringRubric = { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 };

function q(rubric?: OpenQuestion['rubric']): OpenQuestion {
  return {
    id: 'q1',
    category: 'agentic-ai',
    topic: 'memory',
    tags: [],
    difficulty: 'medium',
    type: 'essay',
    question: 'q',
    referenceAnswer: 'a',
    explanation: '',
    rubric,
  };
}

describe('mergeQuestionRubric', () => {
  it('无题目级 rubric 时原样返回全局权重', () => {
    expect(mergeQuestionRubric(q(), GLOBAL)).toEqual({ rubric: GLOBAL, requiredPoints: undefined });
  });

  it('dimensions 只覆盖给出的维度，其余沿用全局', () => {
    const { rubric } = mergeQuestionRubric(q({ dimensions: { architecture: 0.5 } }), GLOBAL);
    expect(rubric).toEqual({ correctness: 0.4, completeness: 0.2, architecture: 0.5, communication: 0.2 });
  });

  it('required 要点被透传（注入评分提示）', () => {
    const { requiredPoints } = mergeQuestionRubric(q({ required: ['短期记忆', '长期记忆'] }), GLOBAL);
    expect(requiredPoints).toEqual(['短期记忆', '长期记忆']);
  });
});

describe('isConfigValid', () => {
  it('chrome 引擎无需 apiKey/model 即有效', () => {
    expect(isConfigValid({ provider: 'chrome', model: '', apiKey: '' })).toBe(true);
  });

  it('云端引擎必须有 apiKey 与 model', () => {
    expect(isConfigValid({ provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey: '' })).toBe(false);
    expect(isConfigValid({ provider: 'openrouter', model: '', apiKey: 'sk-x' })).toBe(false);
    expect(isConfigValid({ provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey: 'sk-x' })).toBe(true);
  });

  it('缺配置对象或 provider 时无效', () => {
    expect(isConfigValid(undefined as unknown as PiConfig)).toBe(false);
    expect(isConfigValid({ provider: '' , model: '', apiKey: '' } as unknown as PiConfig)).toBe(false);
  });
});

describe('createLLMProvider', () => {
  it('chrome 配置分派到 ChromeAIProvider', () => {
    const p = createLLMProvider({ provider: 'chrome', model: '', apiKey: '' });
    expect(p).toBeInstanceOf(ChromeAIProvider);
    expect(p?.name).toBe('chrome');
  });

  it('云端配置分派到 PiAIProvider', () => {
    const p = createLLMProvider({ provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey: 'sk-x' });
    expect(p).toBeInstanceOf(PiAIProvider);
    expect(p?.name).toBe('pi-ai');
  });

  it('无效配置返回 null（上层退化为原题/不评分）', () => {
    expect(createLLMProvider({ provider: 'openai', model: '', apiKey: '' })).toBeNull();
    expect(createLLMProvider(undefined)).toBeNull();
  });

  it('ChromeAIProvider.evaluateOpenAnswer 复用同一套评分编排（走注入的 chromeComplete）', async () => {
    // 不 mock 底层：空回答短路路径不触达 LLM，验证签名/合并逻辑接线正确
    const p = new ChromeAIProvider();
    const result = await p.evaluateOpenAnswer(q(), '', { provider: 'chrome', model: '', apiKey: '' }, GLOBAL);
    expect(result.overall).toBe(0);
    expect(result.feedback).toBe('未作答。');
  });
});
