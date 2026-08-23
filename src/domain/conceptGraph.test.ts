// 知识图谱纯逻辑测试：只测图关系（边查询 / 闭包 / 拓扑序）。
// 掌握度策略与推荐展开的学习状态测试在 learner.test.ts（ADR-030 职责分离）。

import { describe, expect, it } from 'vitest';
import { prerequisiteClosure, relatedOf, topoRankOf } from './conceptGraph';

describe('conceptGraph', () => {
  it('边查询：存在的 key 返回列表，缺失返回空数组', () => {
    expect(relatedOf('tool-calling')).toContain('mcp');
    expect(relatedOf('nonexistent-topic')).toEqual([]);
    expect(prerequisiteClosure('react')).toContain('agent-fundamentals');
    expect(prerequisiteClosure('nonexistent-topic')).toEqual([]);
  });

  it('前置闭包：沿 DAG 传递上溯（tradeoff-planner ← react ← 基础）', () => {
    const closure = prerequisiteClosure('tradeoff-planner');
    expect(closure).toContain('react'); // 直接前置
    expect(closure).toContain('agent-fundamentals'); // 经 react 传递
    expect(closure).not.toContain('tradeoff-planner'); // 不含自身
  });

  it('topoRankOf：前置主题排名更靠前；不在图中的主题返回 Infinity', () => {
    expect(topoRankOf('agent-fundamentals')).toBeLessThan(topoRankOf('react'));
    expect(topoRankOf('nonexistent-topic')).toBe(Infinity);
  });
});
