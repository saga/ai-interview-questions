// 引擎编排测试：useAI 开关必须门控开放题的 LLM 评分（mock provider，不发网络）。

import { describe, expect, it, vi } from 'vitest';
import type { InterviewDefinition, OpenQuestion, ScoringRubric } from '../types';

const sentinel = { overall: 88, dimensions: { correctness: 88, completeness: 88, architecture: 88, communication: 88 }, strengths: [], gaps: [], feedback: '' };

const evaluateOpenAnswer = vi.fn(async () => sentinel);

vi.mock('../ai/provider', () => ({
  createLLMProvider: () => ({ name: 'mock', generateVariant: vi.fn(), evaluateOpenAnswer }),
}));

const { evaluateAnswer } = await import('./interviewEngine');

const openQ: OpenQuestion = {
  id: 'o1', category: 'agentic-ai', topic: 'memory', tags: [], difficulty: 'medium',
  type: 'essay', question: 'q', referenceAnswer: 'a', explanation: '',
};

function def(useAI: boolean): InterviewDefinition {
  return {
    title: 't',
    categories: [],
    difficulties: [],
    questionTypes: ['essay'],
    count: 1,
    useAI,
    scoringRubric: { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 } satisfies ScoringRubric,
  };
}

describe('evaluateAnswer 的 useAI 门控（ADR-020）', () => {
  it('useAI=false 时开放题不调用 LLM，返回 null', async () => {
    const g = await evaluateAnswer(openQ, '我的回答', def(false), {
      provider: 'openrouter', model: 'm', apiKey: 'k',
    });
    expect(g).toBeNull();
    expect(evaluateOpenAnswer).not.toHaveBeenCalled();
  });

  it('useAI=true 且配置有效时走 LLM 评分', async () => {
    const g = await evaluateAnswer(openQ, '我的回答', def(true), {
      provider: 'openrouter', model: 'm', apiKey: 'k',
    });
    expect(g).toEqual(sentinel);
    expect(evaluateOpenAnswer).toHaveBeenCalledTimes(1);
  });

  it('无配置时即使 useAI=true 也返回 null（退化为未评分）', async () => {
    const g = await evaluateAnswer(openQ, '我的回答', def(true), undefined);
    expect(g).toBeNull();
  });
});
