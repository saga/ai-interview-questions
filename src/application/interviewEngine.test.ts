// 引擎编排测试：useAI 开关必须门控开放题的 LLM 评分（mock provider，不发网络）。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterviewDefinition, OpenQuestion, Question, ScoringRubric } from '../types';

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

const sentinel = { overall: 88, dimensions: { correctness: 88, completeness: 88, architecture: 88, communication: 88 }, strengths: [], gaps: [], feedback: '' };

const evaluateOpenAnswer = vi.fn(async () => sentinel);
const transformQuestion = vi.fn(async (q: Question) => ({
  ...q,
  type: 'single' as const,
  options: ['a', 'b', 'c', 'd'],
  answer: [0],
  // 真实管线中由 transform.ts 的 transformQuestionWith 附加，mock 保持一致
  transformedFrom: q.type,
}));

vi.mock('../ai/provider', () => ({
  createLLMProvider: (config?: unknown) =>
    config
      ? {
          name: 'mock',
          generateVariant: vi.fn(async () => ({ question: '变体题干' })),
          evaluateOpenAnswer,
          transformQuestion,
        }
      : null,
}));

const { buildSession, evaluateAnswer } = await import('./interviewEngine');

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
  const config = { providers: [{ id: 'deepseek', enabled: true, model: 'm', apiKey: 'k', baseUrl: '' }] } as const;

  it('useAI=false 时开放题不调用 LLM，返回 null', async () => {
    const g = await evaluateAnswer(openQ, '我的回答', def(false), { providers: [...config.providers] });
    expect(g).toBeNull();
    expect(evaluateOpenAnswer).not.toHaveBeenCalled();
  });

  it('useAI=true 且配置有效时走 LLM 评分', async () => {
    const g = await evaluateAnswer(openQ, '我的回答', def(true), { providers: [...config.providers] });
    expect(g).toEqual(sentinel);
    expect(evaluateOpenAnswer).toHaveBeenCalledTimes(1);
  });

  it('无配置时即使 useAI=true 也返回 null（退化为未评分）', async () => {
    const g = await evaluateAnswer(openQ, '我的回答', def(true), undefined);
    expect(g).toBeNull();
  });
});

describe('题型变换审计记录（buildSession → transform-audit）', () => {
  const choiceQ: Question = {
    id: 'c1', category: 'agentic-ai', topic: 'tools', tags: [], difficulty: 'easy',
    type: 'single', question: 'qc', options: ['a', 'b', 'c', 'd'], answer: [0], explanation: '',
  };
  // 题池必须两种题型都有，否则 planComposition 按"单题型题池跳过配比"处理（domain/quiz.ts）
  const bank = { categories: ['agentic-ai'], questions: [openQ, choiceQ] };
  const cfg = { providers: [] };

  it('变换成功写入审计记录：from/result/provider 齐全，题目带 transformedFrom', async () => {
    const d = { ...def(true), questionTypes: ['single', 'essay'] as const, count: 2 };
    const session = await buildSession(bank, d, cfg);
    // 唯一开放题超出配额（maxOpen=0）→ 触发变换（target 为 single/multiple 由配比随机决定）
    const transformed = session.questions.find((q) => q.id === 'o1') as Question;
    expect(transformed.type).toBe('single');
    expect(transformed.transformedFrom).toBe('essay');
    const records = JSON.parse(store['ai-interview-trainer.transform-audit']) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      questionId: 'o1',
      from: 'essay',
      result: 'single',
      provider: 'mock',
      ok: true,
    });
    expect(['single', 'multiple']).toContain(records[0].target);
    expect(records[0].at).toBeGreaterThan(0);
  });

  it('变换失败也记录（ok=false + error），题目保留原题型', async () => {
    transformQuestion.mockRejectedValueOnce(new Error('LLM 输出缺少有效题干'));
    const d = { ...def(true), questionTypes: ['single', 'essay'] as const, count: 2 };
    const session = await buildSession(bank, d, cfg);
    expect(session.questions.find((q) => q.id === 'o1')?.type).toBe('essay');
    const records = JSON.parse(store['ai-interview-trainer.transform-audit']) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ questionId: 'o1', ok: false });
    expect(String(records[0].error)).toContain('题干');
  });

  it('useAI=false 时无变换也无审计记录（超额开放题被本地裁掉）', async () => {
    const d = { ...def(false), questionTypes: ['single', 'essay'] as const, count: 2 };
    const session = await buildSession(bank, d, undefined);
    expect(session.questions.map((q) => q.type)).not.toContain('essay');
    expect(store['ai-interview-trainer.transform-audit']).toBeUndefined();
  });
});
