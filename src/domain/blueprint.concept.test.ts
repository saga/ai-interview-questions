// 概念优先蓝图（PR5 生成管线前移）纯逻辑测试。
// 覆盖：blueprintFromConcept / conceptBlueprintsFromGaps（均衡）/ testsFromBlueprint / buildQuestionFromGeneration。

import { describe, expect, it } from 'vitest';
import type { ConceptRef, KnowledgeNode, QuestionBlueprint } from '../types';
import {
  blueprintFromConcept,
  buildQuestionFromGeneration,
  conceptBlueprintsFromGaps,
  testsFromBlueprint,
} from './blueprint';
import { parseQuestionSafe } from '../schemas/question';

const node: KnowledgeNode = {
  id: 'transformer',
  name: 'Transformer',
  area: 'llm',
  topic: 'architecture',
  priority: 'P0',
  summary: '...',
  required: ['self-attention', '残差连接'],
  misconceptions: [],
  angles: ['definition', 'mechanism', 'comparison'],
  concepts: [
    { id: 'self-attention', title: 'Self-Attention', importance: 1.0 },
    { id: 'ffn', title: 'FFN', importance: 0.6 },
    { id: 'residual', title: 'Residual', importance: 0.7 },
  ],
};

describe('blueprintFromConcept', () => {
  it('以目标概念为主、同节点其它概念为支撑，总数 ≤3', () => {
    const bp = blueprintFromConcept({ id: 'self-attention', title: 'Self-Attention', importance: 1.0 }, node);
    expect(bp.topic).toBe('transformer');
    expect(bp.expectedConcepts[0]).toBe('self-attention');
    expect(bp.expectedConcepts.length).toBeLessThanOrEqual(3);
    expect(bp.expectedConcepts).toContain('ffn');
    expect(bp.purpose).toContain('Self-Attention');
  });

  it('尊重传入的 angle / difficulty / format', () => {
    const bp = blueprintFromConcept({ id: 'ffn', title: 'FFN', importance: 0.6 }, node, {
      angle: 'mechanism',
      difficulty: 'hard',
      format: 'open',
    });
    expect(bp.angle).toBe('mechanism');
    expect(bp.difficulty).toBe('hard');
    expect(bp.format).toBe('open');
  });
});

describe('conceptBlueprintsFromGaps（均衡分布）', () => {
  const face: ConceptRef[] = [
    { id: 'self-attention', title: 'Self-Attention', importance: 1.0 },
    { id: 'ffn', title: 'FFN', importance: 0.6 },
    { id: 'residual', title: 'Residual', importance: 0.7 },
  ];
  const gaps: ConceptRef[] = [...face];

  it('消灭「5 题全问同一概念」：count=5 但只有 3 个 gap → 仍只产 3 张（每概念 1 张）', () => {
    const out = conceptBlueprintsFromGaps(face, gaps, [node], { count: 5, maxPerConcept: 1 });
    expect(out).toHaveLength(3);
    const conceptIds = out.map((o) => o.concept.id);
    expect(new Set(conceptIds).size).toBe(3); // 无重复概念
  });

  it('按 importance 降序优先补高权重概念（self-attention 先于 ffn）', () => {
    const out = conceptBlueprintsFromGaps(face, gaps, [node], { count: 3 });
    expect(out[0].concept.id).toBe('self-attention');
    expect(out[1].concept.id).toBe('residual');
    expect(out[2].concept.id).toBe('ffn');
  });

  it('orphan 概念（无节点归属）被跳过', () => {
    const orphanFace: ConceptRef[] = [{ id: 'ghost', title: 'Ghost', importance: 1.0 }, ...face];
    const out = conceptBlueprintsFromGaps(orphanFace, [{ id: 'ghost', title: 'Ghost', importance: 1.0 }, ...gaps], [node], {
      count: 10,
    });
    expect(out.every((o) => o.concept.id !== 'ghost')).toBe(true);
  });
});

describe('testsFromBlueprint', () => {
  it('expectedConcepts[0] 为 primary，其余为 supporting（≤2）', () => {
    const bp: QuestionBlueprint = { topic: 't', angle: 'definition', difficulty: 'easy', format: 'choice', purpose: '', expectedConcepts: ['a', 'b', 'c'] };
    expect(testsFromBlueprint(bp)).toEqual([
      { concept: 'a', role: 'primary' },
      { concept: 'b', role: 'supporting' },
      { concept: 'c', role: 'supporting' },
    ]);
  });

  it('无 expectedConcepts 时返回空（不抛错）', () => {
    const bp: QuestionBlueprint = { topic: 't', angle: 'definition', difficulty: 'easy', format: 'choice', purpose: '', expectedConcepts: [] };
    expect(testsFromBlueprint(bp)).toEqual([]);
  });
});

describe('buildQuestionFromGeneration', () => {
  const bp: QuestionBlueprint = { topic: 'transformer', angle: 'definition', difficulty: 'easy', format: 'choice', purpose: '', expectedConcepts: ['self-attention', 'ffn'] };

  it('组装出 schema 合法的 Question（transient 标记生效）', () => {
    const gen = {
      question: '什么是自注意力？',
      angle: 'definition' as const,
      difficulty: 'easy' as const,
      formats: { choice: { type: 'single' as const, options: ['A', 'B'], answer: [0] } },
      explanation: '...',
      tests: [{ concept: 'self-attention', role: 'primary' as const }],
    };
    const q = buildQuestionFromGeneration(gen, bp, 'gen-1', { transient: true });
    expect(q.transient).toBe(true);
    expect(q.tests?.[0]).toEqual({ concept: 'self-attention', role: 'primary' });
    const parsed = parseQuestionSafe(q);
    expect(parsed.success).toBe(true);
  });

  it('生成结果缺 tests 时回退到蓝图映射', () => {
    const gen = {
      question: 'x',
      difficulty: 'easy' as const,
      formats: { choice: { type: 'single' as const, options: ['A', 'B'], answer: [0] } },
      explanation: 'e',
    };
    const q = buildQuestionFromGeneration(gen, bp, 'gen-2');
    expect(q.tests?.[0]).toEqual({ concept: 'self-attention', role: 'primary' });
  });
});
