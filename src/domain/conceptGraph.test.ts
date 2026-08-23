import { describe, expect, it } from 'vitest';
import type { LearnerProfile } from '../types';
import { emptyProfile } from './learner';
import {
  collectTopicRefs,
  computeCoverage,
  expandWithPrerequisites,
  prerequisiteClosure,
  relatedOf,
  suggestNextTopics,
  type TopicRef,
} from './conceptGraph';

function profileWith(stats: Record<string, { attempts: number; avgScore: number; mastery?: number }>): LearnerProfile {
  const p = emptyProfile();
  for (const [topic, s] of Object.entries(stats)) {
    p.topicStats[topic] = {
      attempts: s.attempts,
      avgScore: s.avgScore,
      lastScore: s.avgScore,
      trend: 'flat',
      mastery: s.mastery ?? s.avgScore / 100,
      commonWeaknesses: [],
      lastSeen: 0,
    };
  }
  return p;
}

const REFS: TopicRef[] = [
  { category: 'agentic-ai', topic: 'agent-fundamentals' },
  { category: 'agentic-ai', topic: 'tool-calling' },
  { category: 'agentic-ai', topic: 'react' },
  { category: 'agentic-ai', topic: 'multi-agent' },
  { category: 'llm', topic: 'rag' },
];

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

  it('collectTopicRefs 去重并保留首次出现的 category', () => {
    const refs = collectTopicRefs([
      { category: 'a', topic: 't1' },
      { category: 'a', topic: 't1' },
      { category: 'b', topic: 't2' },
    ]);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.topic).sort()).toEqual(['t1', 't2']);
  });

  it('computeCoverage：分类统计 attempted/mastered 与未学计数', () => {
    const profile = profileWith({
      'agent-fundamentals': { attempts: 3, avgScore: 90 },
      'tool-calling': { attempts: 2, avgScore: 60 },
    });
    const report = computeCoverage(REFS, profile);

    const agentic = report.categories.find((c) => c.category === 'agentic-ai');
    expect(agentic).toBeDefined();
    expect(agentic!.totalTopics).toBe(4);
    expect(agentic!.attempted).toBe(2);
    expect(agentic!.mastered).toBe(1); // agent-fundamentals 90 分达标
    expect(report.weakTopics).toContain('tool-calling');
    expect(report.unattemptedCount).toBe(3); // react / multi-agent / rag
  });

  it('computeCoverage：前置全掌握的未学主题进入 readyToLearn，否则计入 blockedCount', () => {
    // react 的前置闭包 = agent-fundamentals / tool-calling / agent-components / workflow-vs-agent
    const allMastered = profileWith({
      'agent-fundamentals': { attempts: 2, avgScore: 92 },
      'tool-calling': { attempts: 2, avgScore: 95 },
      'agent-components': { attempts: 2, avgScore: 93 },
      'workflow-vs-agent': { attempts: 2, avgScore: 91 },
    });
    const reportReady = computeCoverage(REFS, allMastered);
    expect(reportReady.readyToLearn).toContain('react');

    const prereqWeak = profileWith({ 'agent-fundamentals': { attempts: 2, avgScore: 50 } });
    const reportBlocked = computeCoverage(REFS, prereqWeak);
    expect(reportBlocked.readyToLearn).not.toContain('react');
    expect(reportBlocked.blockedCount).toBeGreaterThan(0);
  });

  it('suggestNextTopics：薄弱主题优先（按掌握度升序），再补可学的未学主题', () => {
    const profile = profileWith({
      'tool-calling': { attempts: 4, avgScore: 55 },
      'agent-fundamentals': { attempts: 3, avgScore: 75 },
      'rag': { attempts: 5, avgScore: 95 },
    });
    const suggestions = suggestNextTopics(REFS, profile, 3);
    expect(suggestions[0].topic).toBe('tool-calling'); // 掌握度最低
    expect(suggestions.map((s) => s.topic)).not.toContain('rag'); // 已掌握不推荐
  });

  it('expandWithPrerequisites：沿前置链展开且跳过已掌握主题、去重、有上限', () => {
    const profile = profileWith({
      'agent-fundamentals': { attempts: 2, avgScore: 40 },
      'tool-calling': { attempts: 2, avgScore: 95 },
    });
    const expanded = expandWithPrerequisites(['react'], profile);
    expect(expanded).toContain('react');
    expect(expanded).toContain('agent-fundamentals'); // 未掌握的前置被纳入
    expect(expanded).not.toContain('tool-calling'); // 已掌握的前置被跳过

    // 无关主题原样保留
    expect(expandWithPrerequisites(['totally-unknown'], profile)).toEqual(['totally-unknown']);

    // 环引用不会死循环（result 上限 + seen 去重保护）
    expect(expandWithPrerequisites(['agent-fundamentals'], profile).length).toBeLessThanOrEqual(10);
  });
});
