// 覆盖矩阵测试：计数聚合、缺口判定、孤儿题分流、建议排序与生成提示映射。
// 纯函数测试，注入合成节点/题目，不读真实数据文件。
// angle 在 schema 层必填（ADR-043），因此本文件的 q() 助手不接受 undefined——
// 历史上「未标注题进 untagged」的分支随该字段收敛为 required 一并删除。

import { describe, expect, it } from 'vitest';
import type { KnowledgeNode } from '../schemas/knowledge';
import type { Question } from '../schemas/question';
import {
  ANGLE_GENERATION_HINTS,
  coverageSuggestions,
  formatCoverageReport,
  questionCoverageMatrix,
} from './coverage';

function node(id: string, priority: KnowledgeNode['priority'], angles: KnowledgeNode['angles']): KnowledgeNode {
  return { id, name: id, area: 'llm', topic: 'model-architecture', priority, summary: '', required: [], misconceptions: [], angles };
}

function q(topic: string, angle: NonNullable<Question['angle']>, id = topic): Question {
  return {
    id,
    category: 'c',
    topic,
    tags: [],
    difficulty: 'medium',
    question: 'q',
    explanation: '',
    angle,
    formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [0] } },
  };
}

const nodes = [
  node('routing', 'P0', ['definition', 'mechanism', 'tradeoff']),
  node('kv-cache', 'P1', ['mechanism']),
];

describe('questionCoverageMatrix', () => {
  it('按 topic × angle 聚合计数，gaps = 期望角度中计数为 0 的', () => {
    const m = questionCoverageMatrix(
      [q('routing', 'definition'), q('routing', 'definition'), q('routing', 'mechanism')],
      nodes,
    );
    const t = m.topics.find((x) => x.nodeId === 'routing')!;
    expect(t.counts).toEqual({ definition: 2, mechanism: 1 });
    expect(t.gaps).toEqual(['tradeoff']);
    expect(m.topics.find((x) => x.nodeId === 'kv-cache')!.gaps).toEqual(['mechanism']);
  });

  it('每道同角度的题各自入格，重复计数而非去重（题数即覆盖度）', () => {
    const m = questionCoverageMatrix(
      [q('routing', 'definition'), q('routing', 'definition', 'r2'), q('routing', 'definition', 'r3')],
      nodes,
    );
    const t = m.topics.find((x) => x.nodeId === 'routing')!;
    expect(t.counts).toEqual({ definition: 3 });
    expect(t.gaps).toEqual(['mechanism', 'tradeoff']);
  });

  it('topic 无节点对应的孤儿题单独计数，不进矩阵也不崩溃', () => {
    const m = questionCoverageMatrix([q('ghost-topic', 'mechanism'), q('routing', 'definition')], nodes);
    expect(m.unmappedQuestions).toBe(1);
    expect(m.topics.find((x) => x.nodeId === 'routing')!.counts).toEqual({ definition: 1 });
  });

  it('空题库 → 所有期望角度都是缺口；空节点 → 空矩阵', () => {
    const m = questionCoverageMatrix([], nodes);
    expect(m.topics.every((t) => t.gaps.length === t.expected.length)).toBe(true);
    expect(questionCoverageMatrix([q('routing', 'definition')], [])).toEqual({ topics: [], unmappedQuestions: 1 });
  });

  it('topics 按 P0 → nodeId 排序（报告稳定）', () => {
    const m = questionCoverageMatrix([], [node('zzz', 'P0', ['definition']), node('aaa', 'P1', ['definition']), node('bbb', 'P0', ['definition'])]);
    expect(m.topics.map((t) => `${t.priority}/${t.nodeId}`)).toEqual(['P0/bbb', 'P0/zzz', 'P1/aaa']);
  });
});

describe('coverageSuggestions', () => {
  it('每个缺口格一条建议，P0 优先，同节点按角度梯度序，难度/形态来自启发式', () => {
    const m = questionCoverageMatrix([], nodes);
    const s = coverageSuggestions(m);
    expect(s.map((x) => `${x.nodeId}/${x.angle}`)).toEqual([
      'routing/definition',
      'routing/mechanism',
      'routing/tradeoff',
      'kv-cache/mechanism',
    ]);
    expect(s[0]).toMatchObject({ priority: 'P0', difficulty: 'easy', format: 'choice' }); // definition
    expect(s[2]).toMatchObject({ difficulty: 'hard', format: 'open' }); // tradeoff
    // 生成提示仅表达「通常从什么形态起手写最顺」，不构成约束，故只断言其存在性。
    expect(ANGLE_GENERATION_HINTS['system-design']).toEqual({ difficulty: 'hard', format: 'open' });
  });

  it('无缺口时返回空数组', () => {
    const full: Question[] = [
      q('routing', 'definition'),
      q('routing', 'mechanism'),
      q('routing', 'tradeoff'),
      q('kv-cache', 'mechanism'),
    ];
    expect(coverageSuggestions(questionCoverageMatrix(full, nodes))).toEqual([]);
  });
});

describe('formatCoverageReport', () => {
  it('报告包含缺口标记、建议清单与汇总行', () => {
    const m = questionCoverageMatrix([q('routing', 'definition', 'r1'), q('ghost', 'definition', 'g1')], nodes);
    const text = formatCoverageReport(m, coverageSuggestions(m));
    expect(text).toContain('[routing] routing · P0');
    expect(text).toContain('definition 1✓');
    expect(text).toContain('tradeoff !');
    expect(text).not.toContain('未标注');
    expect(text).toContain('1. [P0] routing · mechanism · medium · choice');
    expect(text).toContain('未挂靠知识点的题 1');
    expect(text).toMatch(/汇总：2 知识点 · 期望格 4 · 缺口 3 · 未挂靠知识点的题 1/);
  });

  it('全覆盖时汇总缺口为 0，且建议清单标注为 0 条', () => {
    const full: Question[] = [q('routing', 'definition'), q('routing', 'mechanism'), q('routing', 'tradeoff'), q('kv-cache', 'mechanism')];
    const m = questionCoverageMatrix(full, nodes);
    const text = formatCoverageReport(m, coverageSuggestions(m));
    expect(text).toContain('建议补题（共 0 条');
    expect(text).toContain('缺口 0');
  });
});
