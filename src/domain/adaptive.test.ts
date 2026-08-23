import { describe, expect, it } from 'vitest';
import type { LearnerProfile, Question } from '../types';
import { decideStrategy, pickNextAdaptive, type AnswerSignal } from './adaptive';

function q(id: string, topic: string, difficulty: Question['difficulty'] = 'medium', type: Question['type'] = 'single'): Question {
  return {
    id,
    category: 'agentic-ai',
    topic,
    tags: [],
    type,
    difficulty,
    question: `Q ${id}`,
    options: ['a', 'b'],
    answer: [0],
    explanation: '',
  };
}

const POOL = [
  q('loop-1', 'agent-fundamentals', 'easy'),
  q('loop-2', 'agent-fundamentals', 'medium'),
  q('tc-easy', 'tool-calling', 'easy'),
  q('tc-hard', 'tool-calling', 'hard'),
  q('mcp-1', 'mcp', 'medium'),
  q('react-1', 'react', 'hard'),
  q('idem-1', 'idempotency', 'hard'),
];

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe('decideStrategy', () => {
  const strong: AnswerSignal = { topic: 'tool-calling', score: 90, difficulty: 'medium' };
  const mid: AnswerSignal = { topic: 'tool-calling', score: 70, difficulty: 'medium' };
  const weak: AnswerSignal = { topic: 'tool-calling', score: 40, difficulty: 'hard' };

  it('答得好且有相关主题 → broaden', () => {
    expect(decideStrategy(strong, { sameTopicAvailable: true, relatedAvailable: true })).toBe('broaden');
  });

  it('答得好但无相关主题 → deep-dive 同主题', () => {
    expect(decideStrategy(strong, { sameTopicAvailable: true, relatedAvailable: false })).toBe('deep-dive');
  });

  it('答得差 → gap-probe；同主题无题则 move-on', () => {
    expect(decideStrategy(weak, { sameTopicAvailable: true, relatedAvailable: true })).toBe('gap-probe');
    expect(decideStrategy(weak, { sameTopicAvailable: false, relatedAvailable: true })).toBe('move-on');
  });

  it('中等表现 → 有同主题题就 deep-dive，否则 move-on', () => {
    expect(decideStrategy(mid, { sameTopicAvailable: true, relatedAvailable: true })).toBe('deep-dive');
    expect(decideStrategy(mid, { sameTopicAvailable: false, relatedAvailable: true })).toBe('move-on');
  });
});

describe('pickNextAdaptive', () => {
  const sig = (topic: string, score: number, difficulty: AnswerSignal['difficulty']): AnswerSignal => ({
    topic,
    score,
    difficulty,
  });

  it('首轮（无信号）返回 move-on 的题且不依赖上一主题', () => {
    const r = pickNextAdaptive(POOL, [], undefined, rngSeq([0]));
    expect(r).not.toBeNull();
    expect(r!.strategy).toBe('move-on');
    expect(POOL.map((x) => x.id)).toContain(r!.question.id);
  });

  it('broaden：答得好 → 从相关主题选题，不重复同主题', () => {
    // tool-calling 相关 = [mcp, routing]；池中有 mcp
    const r = pickNextAdaptive(POOL, [sig('tool-calling', 95, 'medium')], undefined, rngSeq([0, 0]));
    expect(r!.strategy).toBe('broaden');
    expect(r!.question.topic).toBe('mcp');
  });

  it('deep-dive：中等表现 → 同主题更高难度优先', () => {
    const r = pickNextAdaptive(POOL.filter((x) => x.id !== 'mcp-1'), [sig('tool-calling', 70, 'medium')], undefined, rngSeq([0]));
    // mcp 被移除后 broaden 无候选 → deep-dive；同主题 hard 优先
    expect(r!.strategy).toBe('deep-dive');
    expect(r!.question.topic).toBe('tool-calling');
    expect(r!.question.difficulty).toBe('hard');
  });

  it('gap-probe：答得差 → 先降难度，再退前置主题', () => {
    // tool-calling 答 hard 挂了 → 同主题 easy
    const r1 = pickNextAdaptive(POOL, [sig('tool-calling', 30, 'hard')], undefined, rngSeq([0]));
    expect(r1!.strategy).toBe('gap-probe');
    expect(r1!.question.difficulty).toBe('easy');

    // 无更简单题时沿前置闭包回退：tool-calling 的前置是 agent-fundamentals
    const poolNoEasy = POOL.filter((x) => x.id !== 'tc-easy' && x.id !== 'mcp-1');
    const rFb = pickNextAdaptive(poolNoEasy, [sig('tool-calling', 30, 'medium')], undefined, rngSeq([0]));
    expect(rFb!.strategy).toBe('gap-probe');
    expect(rFb!.question.topic).toBe('agent-fundamentals');

    // 前置主题存在时退到前置（react 的前置 = agent-fundamentals / tool-calling）
    const r2 = pickNextAdaptive(poolNoEasy, [sig('react', 30, 'hard')], undefined, rngSeq([0, 0]));
    expect(r2!.strategy).toBe('gap-probe');
    expect(['agent-fundamentals', 'tool-calling']).toContain(r2!.question.topic);
  });

  it('已问过的题不会再次出现（由调用方过滤题池保证）', () => {
    const asked = new Set(['mcp-1']);
    const pool = POOL.filter((x) => !asked.has(x.id));
    const r = pickNextAdaptive(pool, [sig('tool-calling', 95, 'medium')], undefined, rngSeq([0, 0, 0]));
    expect(Object.keys(asked)).not.toContain(r!.question.id);
  });

  it('move-on：传入 profile 时优先薄弱主题', () => {
    // 上一主题在池中无同主题/相关题 → move-on；画像中 idempotency 薄弱，应被优先选中
    const profile: LearnerProfile = {
      totalSessions: 1,
      totalQuestions: 2,
      overallScore: 40,
      topicStats: {
        'idempotency': { attempts: 2, avgScore: 30, lastScore: 30, trend: 'flat', mastery: 0.3, commonWeaknesses: [], lastSeen: 0 },
        'agent-fundamentals': { attempts: 5, avgScore: 95, lastScore: 95, trend: 'flat', mastery: 0.95, commonWeaknesses: [], lastSeen: 0 },
      },
      sessions: [],
      updatedAt: 0,
    };
    const r = pickNextAdaptive(POOL, [sig('nonexistent-topic', 95, 'medium')], profile, rngSeq([0]));
    expect(r!.strategy).toBe('move-on');
    expect(r!.question.topic).toBe('idempotency'); // 薄弱项优先，而非已掌握的 agent-fundamentals
  });

  it('空池返回 null', () => {
    expect(pickNextAdaptive([], [])).toBeNull();
  });
});
