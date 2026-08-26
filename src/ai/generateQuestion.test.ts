// LLM 生成题（PR5/PR6 共用）测试：generateQuestionForBlueprint 把蓝图 + 补全函数变成 GeneratedQuestion。

import { describe, expect, it } from 'vitest';
import type { CompleteFn, KnowledgeNode, QuestionBlueprint } from '../types';
import { generateQuestionForBlueprint } from './generateQuestion';
import { buildQuestionFromGeneration } from '../domain/blueprint';
import { parseQuestionSafe } from '../schemas/question';

const node: KnowledgeNode = {
  id: 'transformer',
  name: 'Transformer',
  area: 'llm',
  topic: 'architecture',
  priority: 'P0',
  summary: 'Transformer 架构',
  required: ['self-attention'],
  misconceptions: [],
  angles: ['definition', 'mechanism'],
  concepts: [{ id: 'self-attention', title: 'Self-Attention', importance: 1.0 }],
};

const bp: QuestionBlueprint = {
  topic: 'transformer',
  angle: 'definition',
  difficulty: 'easy',
  format: 'choice',
  purpose: '检验学习者能否解释 Self-Attention',
  expectedConcepts: ['self-attention'],
};

function fakeComplete(payload: string): CompleteFn {
  return async () => payload;
}

describe('generateQuestionForBlueprint', () => {
  it('choice 蓝图 → 返回带 choice 形态的 GeneratedQuestion，tests 与蓝图对齐', async () => {
    const payload = JSON.stringify({
      question: '什么是自注意力机制？',
      angle: 'definition',
      difficulty: 'easy',
      formats: { choice: { type: 'single', options: ['A', 'B', 'C', 'D'], answer: [0] } },
      explanation: '自注意力让每个位置关注所有位置。',
      tests: [{ concept: 'self-attention', role: 'primary' }],
    });
    const gen = await generateQuestionForBlueprint(bp, node, fakeComplete(payload));
    expect(gen.question).toContain('自注意力');
    expect(gen.formats.choice?.options).toHaveLength(4);
    expect(gen.tests[0]).toEqual({ concept: 'self-attention', role: 'primary' });
  });

  it('LLM 未返回 tests 时回退到蓝图映射（保证 tests 不丢失）', async () => {
    const payload = JSON.stringify({
      question: 'x',
      difficulty: 'easy',
      formats: { choice: { type: 'single', options: ['a', 'b'], answer: [0] } },
      explanation: 'e',
    });
    const gen = await generateQuestionForBlueprint(bp, node, fakeComplete(payload));
    expect(gen.tests[0]).toEqual({ concept: 'self-attention', role: 'primary' });
  });

  it('open 蓝图 → 返回带 referenceAnswer 的 GeneratedQuestion', async () => {
    const openBp: QuestionBlueprint = { ...bp, format: 'open' };
    const payload = JSON.stringify({
      question: '请解释自注意力。',
      difficulty: 'easy',
      formats: { open: { referenceAnswer: '每个 token 通过 Q/K/V 计算注意力权重。' } },
      explanation: 'e',
      tests: [{ concept: 'self-attention', role: 'primary' }],
    });
    const gen = await generateQuestionForBlueprint(openBp, node, fakeComplete(payload));
    expect(gen.formats.open?.referenceAnswer).toContain('Q/K/V');
  });

  it('组装为正式 Question 后通过 schema 校验（含 transient 探针标记）', async () => {
    const payload = JSON.stringify({
      question: '什么是自注意力机制？',
      difficulty: 'easy',
      formats: { choice: { type: 'single', options: ['A', 'B'], answer: [0] } },
      explanation: 'e',
      tests: [{ concept: 'self-attention', role: 'primary' }],
    });
    const gen = await generateQuestionForBlueprint(bp, node, fakeComplete(payload));
    const q = buildQuestionFromGeneration(gen, bp, 'gen-1', { transient: true });
    expect(q.transient).toBe(true);
    expect(parseQuestionSafe(q).success).toBe(true);
  });
});
