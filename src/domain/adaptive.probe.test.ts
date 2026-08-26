// 概念优先抽题的探针信号（PR6）：当概念被选中但无对应题库题时，allowProbe 决定是否发探针信号。

import { describe, expect, it } from 'vitest';
import type { ConceptRef, Question } from '../types';
import { pickNextAdaptive, pickNextConceptAware } from './adaptive';

const FACE: ConceptRef[] = [
  { id: 'a', title: 'A', importance: 1.0 },
  { id: 'b', title: 'B', importance: 0.8 },
];

// qB 只探测概念 b；概念 a 无任何题库题
const qB: Question = {
  id: 'qB',
  category: 't',
  topic: 't',
  tags: [],
  difficulty: 'easy',
  question: 'b?',
  explanation: '',
  tests: [{ concept: 'b', role: 'primary' }],
  formats: { choice: { type: 'single', options: ['x', 'y'], answer: [0] } },
};

const ctx = { face: FACE, answered: [] };

describe('pickNextConceptAware · 探针信号', () => {
  it('allowProbe=false（默认，无 AI）：概念无题库题时回退到原自适应逻辑（向后兼容）', () => {
    const r = pickNextConceptAware([qB], [], ctx, undefined, () => 0);
    expect(r?.question?.id).toBe('qB');
    expect(r?.probeConceptId).toBeUndefined();
  });

  it('allowProbe=true（有 AI）：概念 a 被选中但无题库题 → 返回 probeConceptId，question 为 null', () => {
    const r = pickNextConceptAware([qB], [], ctx, undefined, () => 0, true);
    expect(r?.question).toBeNull();
    expect(r?.probeConceptId).toBe('a');
    expect(r?.strategy).toBe('move-on');
  });

  it('概念有题库题时无论 allowProbe 如何都正常返回题', () => {
    const r = pickNextConceptAware([qB], [], { face: [{ id: 'b', title: 'B', importance: 1 }], answered: [] }, undefined, () => 0, true);
    expect(r?.question?.id).toBe('qB');
    expect(r?.probeConceptId).toBeUndefined();
  });
});

describe('pickNextAdaptive · 透传探针信号', () => {
  it('提供 conceptCtx 且 allowProbe=true 时，无题库题的概念触发 probeConceptId', () => {
    const r = pickNextAdaptive([qB], [], undefined, () => 0, ctx, true);
    expect(r?.question).toBeNull();
    expect(r?.probeConceptId).toBe('a');
  });

  it('allowProbe=false 时不发探针信号（回退到 topic/angle 路径）', () => {
    const r = pickNextAdaptive([qB], [], undefined, () => 0, ctx, false);
    expect(r?.question?.id).toBe('qB');
    expect(r?.probeConceptId).toBeUndefined();
  });
});
