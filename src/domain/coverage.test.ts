// 覆盖矩阵测试：计数聚合、缺口判定、未标注/孤儿题分流、建议排序与启发式映射。
// 纯函数测试，注入合成节点/题目，不读真实数据文件。

import { describe, expect, it } from 'vitest';
import type { KnowledgeNode, Question } from '../types';
import {
  ANGLE_SUGGESTIONS,
  coverageSuggestions,
  formatCoverageReport,
  questionCoverageMatrix,
} from './coverage';

function node(id: string, priority: KnowledgeNode['priority'], angles: KnowledgeNode['angles']): KnowledgeNode {
  return { id, name: id, area: 'moe', priority, summary: '', required: [], misconceptions: [], angles };
}

function q(topic: string, angle?: Question['angle'], id = topic): Question {
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

  it('未标注 angle 的题进 untagged，不计入任何格子', () => {
    const m = questionCoverageMatrix([q('routing'), q('routing', undefined, 'r2'), q('routing', 'definition')], nodes);
    const t = m.topics.find((x) => x.nodeId === 'routing')!;
    expect(t.untagged).toBe(2);
    expect(t.counts).toEqual({ definition: 1 });
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
    expect(questionCoverageMatrix([q('routing')], [])).toEqual({ topics: [], unmappedQuestions: 1 });
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
    expect(ANGLE_SUGGESTIONS['system-design'].format).toBe('open');
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
  it('报告包含缺口标记、未标注警告、建议清单与汇总行', () => {
    const m = questionCoverageMatrix([q('routing'), q('ghost', 'definition', 'g1')], nodes);
    const text = formatCoverageReport(m, coverageSuggestions(m));
    expect(text).toContain('[routing] routing · P0');
    expect(text).toContain('tradeoff !');
    expect(text).toContain('⚠ 1 题未标注 angle');
    expect(text).toContain('1. [P0] routing · definition · easy · choice');
    expect(text).toContain('未挂靠知识点的题 1');
    expect(text).toMatch(/汇总：2 知识点 · 期望格 4 · 缺口 4 · 未标注题 1 · 未挂靠知识点的题 1/);
  });

  it('全覆盖时汇总缺口为 0，且建议清单标注为 0 条', () => {
    const full: Question[] = [q('routing', 'definition'), q('routing', 'mechanism'), q('routing', 'tradeoff'), q('kv-cache', 'mechanism')];
    const m = questionCoverageMatrix(full, nodes);
    const text = formatCoverageReport(m, coverageSuggestions(m));
    expect(text).toContain('建议补题（共 0 条');
    expect(text).toContain('缺口 0');
  });
});
