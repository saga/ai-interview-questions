// 知识图谱纯逻辑测试：只测图关系（边查询 / 闭包 / 拓扑序）。
// 掌握度策略与推荐展开的学习状态测试在 learner.test.ts（ADR-030 职责分离）。

import { describe, expect, it } from 'vitest';
import { prerequisiteClosure, relatedOf, topoRankOf } from './conceptGraph';

describe('conceptGraph', () => {
  it('边查询：存在的 key 返回列表，缺失返回空数组', () => {
    expect(relatedOf('tool-calling')).toContain('mcp');
    expect(relatedOf('nonexistent-topic')).toEqual([]);
    expect(prerequisiteClosure('agent-loop')).toContain('agent-fundamentals');
    expect(prerequisiteClosure('nonexistent-topic')).toEqual([]);
  });

  it('前置闭包：沿 DAG 传递上溯（planning ← agent-loop ← 基础）', () => {
    const closure = prerequisiteClosure('planning');
    expect(closure).toContain('agent-loop'); // 直接前置
    expect(closure).toContain('agent-fundamentals'); // 经 agent-loop 传递
    expect(closure).not.toContain('planning'); // 不含自身
  });

  it('topoRankOf：前置主题排名更靠前；不在图中的主题返回 Infinity', () => {
    expect(topoRankOf('agent-fundamentals')).toBeLessThan(topoRankOf('agent-loop'));
    expect(topoRankOf('nonexistent-topic')).toBe(Infinity);
  });
});
