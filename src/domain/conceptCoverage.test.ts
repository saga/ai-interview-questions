// Concept-coverage（PR1–PR4）单元测试：概念级覆盖函数 + 概念优先抽题 + 数据不变量。
// 纯逻辑，无 LLM/网络。CI 中同步守护 validate:questions 的约束。

import { describe, expect, it } from 'vitest';
import type { ConceptRef, ConceptStats, Question, QuestionTest } from '../types';
import {
  buildConceptStats,
  computeConceptCoverage,
  conceptFaceOf,
  getConceptStatus,
  getCoverageGaps,
  rankConcepts,
} from './coverage';
import { findQuestionForConcept, pickNextConceptAware, selectNextConcept } from './adaptive';
import { knowledgeNodes } from '../data/knowledgeMap';
import { questionBank } from '../data/questionBank';

const FACE: ConceptRef[] = [
  { id: 'a', title: 'A', importance: 1.0 },
  { id: 'b', title: 'B', importance: 0.8 },
  { id: 'c', title: 'C', importance: 0.5 },
];

function mkQ(id: string, tests: QuestionTest[]): Question {
  return {
    id,
    category: 'transformer',
    topic: 'transformer',
    difficulty: 'medium',
    question: 'q',
    explanation: 'e',
    formats: { choice: { type: 'single', options: ['x', 'y'], answer: [0] } },
    tests,
  } as unknown as Question;
}

describe('buildConceptStats', () => {
  it('聚合 attempts / 滚动 avg / best', () => {
    const s = buildConceptStats([
      { concept: 'a', score: 80 },
      { concept: 'a', score: 60 },
      { concept: 'a', score: 100 },
    ]);
    expect(s.a.attempts).toBe(3);
    expect(s.a.avgScore).toBeCloseTo((80 + 60 + 100) / 3);
    expect(s.a.bestScore).toBe(100);
  });
});

describe('computeConceptCoverage', () => {
  it('加权：已尝试概念 importance 占比', () => {
    const stats: Record<string, ConceptStats> = { a: { attempts: 1, avgScore: 90, bestScore: 90 } };
    expect(computeConceptCoverage(FACE, stats)).toBeCloseTo(1.0 / (1.0 + 0.8 + 0.5));
  });
  it('空面 = 0', () => expect(computeConceptCoverage([], {})).toBe(0));
});

describe('getConceptStatus', () => {
  it('阈值：unseen / weak(<60) / partial(<85) / strong', () => {
    expect(getConceptStatus(undefined)).toBe('unseen');
    expect(getConceptStatus({ attempts: 0, avgScore: 0, bestScore: 0 })).toBe('unseen');
    expect(getConceptStatus({ attempts: 1, avgScore: 50, bestScore: 50 })).toBe('weak');
    expect(getConceptStatus({ attempts: 1, avgScore: 70, bestScore: 70 })).toBe('partial');
    expect(getConceptStatus({ attempts: 1, avgScore: 90, bestScore: 90 })).toBe('strong');
  });
});

describe('getCoverageGaps / rankConcepts', () => {
  it('gaps = 未尝试概念', () => {
    const stats: Record<string, ConceptStats> = { a: { attempts: 1, avgScore: 90, bestScore: 90 } };
    expect(getCoverageGaps(FACE, stats).map((g) => g.id)).toEqual(['b', 'c']);
  });
  it('rank：unseen 高 importance 排前；strong 排后', () => {
    const stats: Record<string, ConceptStats> = {
      a: { attempts: 1, avgScore: 95, bestScore: 95 },
      b: { attempts: 0, avgScore: 0, bestScore: 0 },
    };
    const ranked = rankConcepts(FACE, stats).map((r) => r.id);
    expect(ranked[0]).toBe('b');
    expect(ranked[ranked.length - 1]).toBe('a');
  });
});

describe('conceptFaceOf', () => {
  it('无 concepts 的节点返回空数组', () => {
    expect(conceptFaceOf(undefined)).toEqual([]);
    const node = knowledgeNodes.find((n) => !n.concepts);
    if (node) expect(conceptFaceOf(node)).toEqual([]);
  });
  it('transformer 节点有概念面且含 ffn/causal-mask 等（概念独立于知识节点）', () => {
    const tf = knowledgeNodes.find((n) => n.id === 'transformer');
    const ids = conceptFaceOf(tf).map((c) => c.id);
    expect(ids).toContain('ffn');
    expect(ids).toContain('causal-mask');
  });
});

describe('PR4 概念优先抽题', () => {
  const qA = mkQ('qA', [{ concept: 'a', role: 'primary' }]);
  const qB = mkQ('qB', [{ concept: 'b', role: 'primary' }]);
  const qC = mkQ('qC', [{ concept: 'c', role: 'primary' }]);
  const qOther = mkQ('qOther', []);

  it('selectNextConcept 优先选 unseen 高 importance 概念', () => {
    const stats: Record<string, ConceptStats> = { a: { attempts: 1, avgScore: 95, bestScore: 95 } };
    expect(selectNextConcept(FACE, stats)?.id).toBe('b');
  });

  it('findQuestionForConcept 优先 primary 角色', () => {
    const supporting = mkQ('qAs', [{ concept: 'a', role: 'supporting' }]);
    const got = findQuestionForConcept('a', [supporting, qA], () => 0);
    expect(got?.id).toBe('qA');
  });

  it('pickNextConceptAware：未测概念先被探测（move-on）', () => {
    const r = pickNextConceptAware([qA, qB, qC], [], { face: FACE, answered: [] }, undefined, () => 0);
    expect(r?.question.id).toBe('qA');
    expect(r?.strategy).toBe('move-on');
  });

  it('pickNextConceptAware：已掌握概念降到低优先，转测未掌握概念', () => {
    const answered = [{ id: 'qA', tests: [{ concept: 'a', role: 'primary' }], score: 95 }];
    const r = pickNextConceptAware([qA, qB, qC], [], { face: FACE, answered }, undefined, () => 0);
    expect(r?.question.id).toBe('qB');
  });

  it('pickNextConceptAware：池无对应概念题时回退到原有自适应逻辑', () => {
    const r = pickNextConceptAware([qOther], [], { face: FACE, answered: [] }, undefined, () => 0);
    expect(r?.question.id).toBe('qOther');
    expect(r?.strategy).toBe('move-on');
  });
});

describe('题目 tests 数据不变量（CI 守护 validate:questions）', () => {
  it('所有带 tests 的题：概念存在、≤3 个、primary 唯一', () => {
    const conceptIds = new Set<string>();
    for (const n of knowledgeNodes) for (const c of n.concepts ?? []) conceptIds.add(c.id);
    for (const q of questionBank.questions) {
      const tests = q.tests ?? [];
      for (const t of tests) expect(conceptIds.has(t.concept), `${q.id} -> ${t.concept}`).toBe(true);
      expect(tests.length, `${q.id} tests 数量`).toBeLessThanOrEqual(3);
      const primaries = tests.filter((t) => t.role === 'primary');
      expect(primaries.length, `${q.id} primary 数`).toBeLessThanOrEqual(1);
    }
  });
});
