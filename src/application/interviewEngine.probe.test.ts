// 引擎 Dynamic Probe（PR6）集成测试：当概念优先路径选中「无题库题」的 uncovered 概念时，
// 用注入的 provider 生成 transient 临时题；并验证晋升阈值信号与无 AI 时回退。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterviewDefinition, LLMProvider, Question } from '../types';
import { buildSession, nextAdaptiveStep } from './interviewEngine';

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

// 仅 topic=transformer、且只探测 ffn 的题库：使高 importance 概念（transformer/self-attention）无题库题 → 触发探针
function transformerBank(): Question[] {
  return [
    {
      id: 'ffn-q1',
      category: 'transformer',
      topic: 'transformer',
      tags: ['ffn'],
      difficulty: 'easy',
      question: 'FFN 是什么？',
      explanation: '',
      tests: [{ concept: 'ffn', role: 'primary' }],
      formats: { choice: { type: 'single', options: ['a', 'b'], answer: [0] } },
    },
    {
      id: 'ffn-q2',
      category: 'transformer',
      topic: 'transformer',
      tags: ['ffn'],
      difficulty: 'easy',
      question: 'FFN 的作用？',
      explanation: '',
      tests: [{ concept: 'ffn', role: 'primary' }],
      formats: { choice: { type: 'single', options: ['a', 'b'], answer: [0] } },
    },
  ];
}

function adaptiveDef(): InterviewDefinition {
  return {
    title: 't',
    categories: [],
    difficulties: [],
    formats: ['choice'],
    count: 10,
    adaptive: true,
    useAI: false,
    scoringRubric: { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 },
  };
}

function fakeProbeProvider(): LLMProvider {
  return {
    name: 'fake-probe',
    generateVariant: vi.fn(),
    generateQuestion: vi.fn(async (blueprint) => ({
      question: `探针题：${blueprint.expectedConcepts[0]}`,
      angle: blueprint.angle,
      difficulty: blueprint.difficulty,
      formats: { choice: { type: 'single', options: ['a', 'b'], answer: [0] } },
      explanation: '探针解析',
      tests: [{ concept: blueprint.expectedConcepts[0], role: 'primary' }],
    })),
    evaluateOpenAnswer: vi.fn(),
  };
}

describe('nextAdaptiveStep · Dynamic Probe（PR6）', () => {
  it('uncovered 高 importance 概念无题库题 → 生成 transient 探针题，tests 主探该概念', async () => {
    const bank = { categories: ['transformer'], questions: transformerBank() };
    const session = await buildSession(bank, adaptiveDef(), undefined);
    const step = await nextAdaptiveStep(bank, session, [], undefined, undefined, fakeProbeProvider());
    expect(step).not.toBeNull();
    expect(step!.probe).toBeDefined();
    expect(step!.probe!.conceptId).toBe(step!.question.question.tests?.[0]?.concept);
    // 探针题不持久化
    expect(step!.question.question.transient).toBe(true);
    // 概念应属 transformer 节点高 importance 面
    expect(['transformer', 'self-attention', 'qkv', 'multi-head-attention', 'causal-mask', 'kv-cache', 'positional-encoding']).toContain(
      step!.probe!.conceptId,
    );
  });

  it('同一概念被探针 3 次 → 返回晋升信号 promoted=true', async () => {
    const bank = { categories: ['transformer'], questions: transformerBank() };
    const session = await buildSession(bank, adaptiveDef(), undefined);
    // 预置 3 道同概念(transient)探针题，模拟历史反复探测
    for (let i = 0; i < 3; i++) {
      session.questions.push({
        question: {
          id: `probe-transformer-${i}`,
          category: 'transformer',
          topic: 'transformer',
          tags: ['transformer'],
          difficulty: 'easy',
          question: '?',
          explanation: '',
          transient: true,
          tests: [{ concept: 'transformer', role: 'primary' }],
          formats: { choice: { type: 'single', options: ['a', 'b'], answer: [0] } },
        },
        format: 'choice',
      });
    }
    const step = await nextAdaptiveStep(bank, session, [], undefined, undefined, fakeProbeProvider());
    expect(step).not.toBeNull();
    expect(step!.probe?.conceptId).toBe('transformer');
    expect(step!.probe?.promoted).toBe(true);
  });

  it('无 AI（无 providerOverride 且 useAI=false）→ 不发探针，回退到原自适应路径取 bank 题', async () => {
    const bank = { categories: ['transformer'], questions: transformerBank() };
    const session = await buildSession(bank, adaptiveDef(), undefined);
    const step = await nextAdaptiveStep(bank, session, [], undefined, undefined);
    expect(step).not.toBeNull();
    expect(step!.probe).toBeUndefined();
    expect(step!.question.question.transient).toBeFalsy();
    expect(step!.question.question.id).toMatch(/^ffn-q/); // 余下 bank 题（不依赖随机挑选）
  });
});
