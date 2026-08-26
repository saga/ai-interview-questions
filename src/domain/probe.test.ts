// Dynamic Probe（PR6）纯逻辑测试：探针频率统计、晋升阈值判定、探针蓝图构建。

import { describe, expect, it } from 'vitest';
import type { ConceptRef, KnowledgeNode, Question } from '../types';
import { buildProbeBlueprint, probeFrequency, shouldPromoteProbe, PROBE_PROMOTION_THRESHOLD } from './probe';

const node: KnowledgeNode = {
  id: 'transformer',
  name: 'Transformer',
  area: 'llm',
  topic: 'architecture',
  priority: 'P0',
  summary: '...',
  required: [],
  misconceptions: [],
  angles: ['definition', 'mechanism'],
  concepts: [{ id: 'ffn', title: 'FFN', importance: 0.6 }],
};

const concept: ConceptRef = { id: 'ffn', title: 'FFN', importance: 0.6 };

const probe = (conceptId: string): Question => ({
  id: `probe-${conceptId}`,
  category: 'transformer',
  topic: 'transformer',
  tags: [conceptId],
  difficulty: 'easy',
  question: '?',
  explanation: '',
  transient: true,
  tests: [{ concept: conceptId, role: 'primary' }],
  formats: { choice: { type: 'single', options: ['a', 'b'], answer: [0] } },
});

const bankQ = (): Question => ({
  id: 'bank-1',
  category: 'transformer',
  topic: 'transformer',
  tags: ['ffn'],
  difficulty: 'easy',
  question: '?',
  explanation: '',
  tests: [{ concept: 'ffn', role: 'primary' }],
  formats: { choice: { type: 'single', options: ['a', 'b'], answer: [0] } },
});

describe('probeFrequency', () => {
  it('只统计 transient 且 primary 命中该概念的题', () => {
    const asked = [probe('ffn'), bankQ(), probe('kv-cache')];
    expect(probeFrequency('ffn', asked)).toBe(1);
    expect(probeFrequency('kv-cache', asked)).toBe(1);
    expect(probeFrequency('other', asked)).toBe(0);
  });
});

describe('shouldPromoteProbe', () => {
  it('达到阈值（默认 3）才晋升', () => {
    expect(shouldPromoteProbe('ffn', [probe('ffn'), probe('ffn')])).toBe(false);
    expect(shouldPromoteProbe('ffn', [probe('ffn'), probe('ffn'), probe('ffn')])).toBe(true);
    expect(shouldPromoteProbe('ffn', [probe('ffn'), probe('ffn'), probe('ffn')], 2)).toBe(true);
  });

  it('阈值常量为 3', () => {
    expect(PROBE_PROMOTION_THRESHOLD).toBe(3);
  });
});

describe('buildProbeBlueprint', () => {
  it('首次探测 unseen 概念用易定义题建立认知', () => {
    const bp = buildProbeBlueprint(concept, node);
    expect(bp.topic).toBe('transformer');
    expect(bp.angle).toBe('definition');
    expect(bp.difficulty).toBe('easy');
    expect(bp.format).toBe('choice');
    expect(bp.expectedConcepts[0]).toBe('ffn');
  });
});
