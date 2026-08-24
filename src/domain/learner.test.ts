// Learner Memory 纯逻辑测试：聚合 / 弱项推荐 / 会话映射 / 建议文案 / 教练定义 / 覆盖面与学习建议。

import { describe, it, expect } from 'vitest';
import {
  buildCoachDefinition,
  collectTopicRefs,
  computeCoverage,
  emptyProfile,
  getAngleStat,
  recommendWeakTopics,
  recommendationText,
  sessionFromQuiz,
  expandWithPrerequisites,
  suggestNextTopics,
  updateLearner,
  weakAnglesOf,
} from './learner';
import { pickPrioritized } from './quiz';
import type { LearnerProfile } from '../types';
import type { ChoiceQuestion, OpenQuestion, Question, QuestionResult, SessionRecord } from '../types';

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

const REFS = [
  { category: 'agentic-ai', topic: 'agent-fundamentals' },
  { category: 'agentic-ai', topic: 'tool-calling' },
  { category: 'agentic-ai', topic: 'agent-loop' },
  { category: 'agentic-ai', topic: 'multi-agent' },
  { category: 'llm', topic: 'rag' },
];

const choiceA = {
  question: {
    id: 'c1', category: 'machine-learning', topic: 'regularization', tags: [], difficulty: 'easy' as const,
    question: 'q', explanation: 'e',
    formats: { choice: { type: 'single' as const, options: ['a', 'b'], answer: [0] } },
  },
  format: 'choice' as const,
} satisfies SessionQuestion;
const choiceB = {
  question: {
    id: 'c2', category: 'agentic-ai', topic: 'tool-calling', tags: [], difficulty: 'medium' as const,
    question: 'q', explanation: 'e',
    formats: { choice: { type: 'single' as const, options: ['a', 'b'], answer: [1] } },
  },
  format: 'choice' as const,
} satisfies SessionQuestion;
const openA = {
  question: {
    id: 'o1', category: 'agentic-ai', topic: 'tool-calling', tags: [], difficulty: 'hard' as const,
    question: 'q', explanation: 'e',
    formats: { open: { referenceAnswer: 'a' } },
  },
  format: 'open' as const,
} satisfies SessionQuestion;

function session(overall: number, results: QuestionResult[], title = 't'): SessionRecord {
  return {
    id: 's-' + Math.random(),
    startedAt: Date.now(),
    title,
    questionResults: results,
    overall,
  };
}

function result(topic: string, score: number, gaps: string[] = [], correct?: boolean): QuestionResult {
  return { questionId: 'x', category: 'c', topic, format: 'open' as const, score, gaps, correct };
}

describe('updateLearner', () => {
  it('聚合 topic 统计：attempts / avgScore / lastScore / lastSeen', () => {
    const p = updateLearner(emptyProfile(), session(70, [result('tool-calling', 60), result('tool-calling', 80)]));
    const s = p.topicStats['tool-calling'];
    expect(s.attempts).toBe(2);
    expect(s.avgScore).toBe(70); // (60+80)/2
    expect(s.lastScore).toBe(80);
    expect(s.lastSeen).toBeGreaterThan(0);
    expect(p.totalSessions).toBe(1);
    expect(p.totalQuestions).toBe(2);
  });

  it('聚合 angleCoverage：按 topic|angle 累计逐角度证据', () => {
    const results: QuestionResult[] = [
      { questionId: 'q1', category: 'c', topic: 'transformer', format: 'open', angle: 'mechanism', score: 90, gaps: [] },
      { questionId: 'q2', category: 'c', topic: 'transformer', format: 'open', angle: 'mechanism', score: 70, gaps: [] },
      { questionId: 'q3', category: 'c', topic: 'transformer', format: 'open', angle: 'debugging', score: 40, gaps: [] },
    ];
    const p = updateLearner(emptyProfile(), session(66, results));
    expect(p.angleCoverage!['transformer|mechanism'].attempts).toBe(2);
    expect(p.angleCoverage!['transformer|mechanism'].avgScore).toBe(80);
    expect(p.angleCoverage!['transformer|debugging'].attempts).toBe(1);
    expect(p.angleCoverage!['transformer|debugging'].avgScore).toBe(40);
    // 未标注角度的题不污染逐角度证据
    const noAngle = updateLearner(emptyProfile(), session(50, [result('transformer', 50)]));
    expect(noAngle.angleCoverage).toEqual({});
  });

  it('trend：上次明显高于均分 → improving，反之 declining', () => {
    let p = updateLearner(emptyProfile(), session(70, [result('rag', 50), result('rag', 50)]));
    p = updateLearner(p, session(80, [result('rag', 85)]));
    expect(p.topicStats['rag'].trend).toBe('improving');
    p = updateLearner(p, session(60, [result('rag', 40)]));
    expect(p.topicStats['rag'].trend).toBe('declining');
  });

  it('mastery = avgScore/100，落在 [0,1]', () => {
    const p = updateLearner(emptyProfile(), session(70, Array.from({ length: 5 }, () => result('rag', 70))));
    expect(p.topicStats['rag'].mastery).toBe(0.7);
  });

  it('commonWeaknesses 按出现频率取前 3', () => {
    const gaps = ['error handling', 'error handling', 'schema validation', 'memory', 'retry'];
    const p = updateLearner(emptyProfile(), session(50, [result('tool-calling', 50, gaps)]));
    expect(p.topicStats['tool-calling'].commonWeaknesses[0]).toBe('error handling');
    expect(p.topicStats['tool-calling'].commonWeaknesses.length).toBeLessThanOrEqual(3);
  });

  it('会话列表新在前，且不超过 50 条', () => {
    let p = emptyProfile();
    for (let i = 0; i < 55; i++) {
      p = updateLearner(p, session(50, [result('rag', 50)]));
    }
    expect(p.sessions.length).toBe(50);
    expect(p.totalSessions).toBe(55);
  });
});

describe('recommendWeakTopics', () => {
  it('按掌握度升序返回，且只推荐练过的薄弱主题', () => {
    let p = emptyProfile();
    p = updateLearner(p, session(60, [result('tool-calling', 50), result('rag', 90)]));
    const weak = recommendWeakTopics(p, 3);
    expect(weak[0]).toBe('tool-calling');
    expect(weak).not.toContain('rag'); // mastery 0.9 ≥ 0.85 不推荐
  });
});

describe('buildCoachDefinition', () => {
  it('把薄弱主题写入 topicPriorities，mode 标记正确', () => {
    let p = emptyProfile();
    p = updateLearner(p, session(60, [result('tool-calling', 50)]));
    const def = buildCoachDefinition(p, { title: '快速训练', timeLimitSec: 600, mode: 'quick' });
    expect(def.topicPriorities).toContain('tool-calling');
    expect(def.mode).toBe('quick');
    expect(def.timeLimitSec).toBe(600);
    expect(def.useAI).toBe(true);
  });
});

describe('recommendationText', () => {
  it('无历史时给出引导文案', () => {
    expect(recommendationText(emptyProfile())).toContain('完成一次训练后');
  });

  it('有薄弱主题时给出优先练习建议并提及遗漏要点', () => {
    let p = emptyProfile();
    p = updateLearner(
      p,
      session(60, [result('tool-calling', 50, ['error handling', 'error handling'])]),
    );
    const text = recommendationText(p);
    expect(text).toContain('tool-calling');
    expect(text).toContain('error handling');
  });
});

describe('sessionFromQuiz', () => {
  it('选择题记录 correct 标志，开放题记录 gaps，overall 为各题均分', () => {
    const grades = {
      c1: { overall: 100, dimensions: { correctness: 100, completeness: 100, architecture: 100, communication: 100 }, strengths: [], gaps: [], feedback: '' },
      o1: { overall: 60, dimensions: { correctness: 60, completeness: 60, architecture: 60, communication: 60 }, strengths: [], gaps: ['缺 retry'], feedback: '' },
    } as never;
    const rec = sessionFromQuiz(
      { questions: [choiceA, openA], startedAt: 123, definition: { title: 't', mode: 'quick' } },
      grades,
      300,
    );
    expect(rec.overall).toBe(80); // (100+60)/2
    expect(rec.questionResults[0].correct).toBe(true);
    expect(rec.questionResults[1].correct).toBeUndefined();
    expect(rec.questionResults[1].gaps).toEqual(['缺 retry']);
    expect(rec.durationSec).toBe(300);
    expect(rec.mode).toBe('quick');
  });

  it('选择题答对：correct=true 且不写 gaps', () => {
    const grades = {
      c1: { overall: 100, dimensions: { correctness: 100, completeness: 100, architecture: 100, communication: 100 }, strengths: ['选择正确'], gaps: [], feedback: '' },
    } as never;
    const rec = sessionFromQuiz(
      { questions: [choiceA], startedAt: 123, definition: { title: 't', mode: 'quick' } },
      grades,
      300,
    );
    expect(rec.questionResults[0].correct).toBe(true);
    expect(rec.questionResults[0].gaps).toEqual([]);
  });

  it('选择题答错：correct=false 且丢弃判分假 gap，不污染 Learner Memory', () => {
    const grades = {
      c1: { overall: 0, dimensions: { correctness: 0, completeness: 0, architecture: 0, communication: 0 }, strengths: [], gaps: ['答案不正确，请参见解析'], feedback: '' },
    } as never;
    const rec = sessionFromQuiz(
      { questions: [choiceA], startedAt: 123, definition: { title: 't', mode: 'quick' } },
      grades,
      300,
    );
    expect(rec.questionResults[0].correct).toBe(false);
    expect(rec.questionResults[0].gaps).toEqual([]);
  });

  it('开放题：gaps 原样保留（用于 Learner Memory 的薄弱要点）', () => {
    const grades = {
      o1: { overall: 60, dimensions: { correctness: 60, completeness: 60, architecture: 60, communication: 60 }, strengths: [], gaps: ['没有解释 KV cache 对 decode latency 的影响'], feedback: '' },
    } as never;
    const rec = sessionFromQuiz(
      { questions: [openA], startedAt: 123, definition: { title: 't', mode: 'quick' } },
      grades,
      300,
    );
    expect(rec.questionResults[0].gaps).toEqual(['没有解释 KV cache 对 decode latency 的影响']);
  });

  it('全链路：错误选择题不会让假 gap 进入 Learner Profile', () => {
    const grades = {
      c1: { overall: 0, dimensions: { correctness: 0, completeness: 0, architecture: 0, communication: 0 }, strengths: [], gaps: ['答案不正确，请参见解析'], feedback: '' },
    } as never;
    const rec = sessionFromQuiz(
      { questions: [choiceA], startedAt: Date.now(), definition: { title: 't', mode: 'quick' } },
      grades,
      300,
    );
    const profile = updateLearner(emptyProfile(), rec);
    expect(JSON.stringify(profile)).not.toContain('答案不正确，请参见解析');
  });
});

describe('pickPrioritized', () => {
  it('薄弱主题的题优先被抽中，剩余由其他题补齐', () => {
    const pool: Question[] = [
      { ...choiceA.question }, { ...choiceB.question }, { ...openA.question },
      { ...choiceA.question, id: 'r1', topic: 'random-1' },
      { ...choiceA.question, id: 'r2', topic: 'random-2' },
    ];
    const picked = pickPrioritized(pool, ['tool-calling'], 3);
    const weak = picked.filter((q) => q.topic === 'tool-calling');
    expect(weak.length).toBe(2); // 两道 tool-calling 都被优先抽出
    expect(picked.length).toBe(3);
  });

  it('count 超过题池时返回全部且不重复', () => {
    const pool: Question[] = [{ ...choiceA.question }, { ...choiceB.question }];
    const picked = pickPrioritized(pool, ['tool-calling'], 5);
    expect(picked.length).toBe(2);
    expect(new Set(picked.map((q) => q.id)).size).toBe(2);
  });

  it('无 priority 时退化为纯随机', () => {
    const pool: Question[] = [{ ...choiceA.question }, { ...choiceB.question }];
    const picked = pickPrioritized(pool, [], 2);
    expect(picked.length).toBe(2);
  });
});

describe('覆盖面与学习建议（学习策略，图查询在 conceptGraph）', () => {
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
    expect(report.unattemptedCount).toBe(3); // agent-loop / multi-agent / rag
  });

  it('computeCoverage：前置全掌握的未学主题进入 readyToLearn，否则计入 blockedCount', () => {
    // agent-loop 的前置闭包 = agent-fundamentals / tool-calling / agent-guardrails
    const allMastered = profileWith({
      'agent-fundamentals': { attempts: 2, avgScore: 92 },
      'tool-calling': { attempts: 2, avgScore: 95 },
      'agent-guardrails': { attempts: 2, avgScore: 93 },
    });
    const reportReady = computeCoverage(REFS, allMastered);
    expect(reportReady.readyToLearn).toContain('agent-loop');

    const prereqWeak = profileWith({ 'agent-fundamentals': { attempts: 2, avgScore: 50 } });
    const reportBlocked = computeCoverage(REFS, prereqWeak);
    expect(reportBlocked.readyToLearn).not.toContain('agent-loop');
    expect(reportBlocked.blockedCount).toBeGreaterThan(0);
  });

  it('suggestNextTopics：薄弱主题优先（按掌握度升序），再补可学的未学主题', () => {
    const profile = profileWith({
      'tool-calling': { attempts: 4, avgScore: 55 },
      'agent-fundamentals': { attempts: 3, avgScore: 75 },
      rag: { attempts: 5, avgScore: 95 },
    });
    const suggestions = suggestNextTopics(REFS, profile, 3);
    expect(suggestions[0].topic).toBe('tool-calling'); // 掌握度最低
    expect(suggestions.map((s) => s.topic)).not.toContain('rag'); // 已掌握不推荐
  });

  it('suggestNextTopics：无可推荐薄弱项时按拓扑序给出 readyToLearn 建议', () => {
    const masteredAll = profileWith({
      'agent-fundamentals': { attempts: 2, avgScore: 92 },
      'tool-calling': { attempts: 2, avgScore: 95 },
      'agent-guardrails': { attempts: 2, avgScore: 93 },
    });
    const suggestions = suggestNextTopics(REFS, masteredAll, 5);
    expect(suggestions.map((s) => s.topic)).toContain('agent-loop');
    // 基础主题（rag 无前置）应排在 agent-loop 之前或并列可学——至少都在建议里且理由是前置已具备
    for (const s of suggestions) expect(s.reason).toBe('前置知识已具备，适合开始学习');
  });
});

describe('掌握度策略与题库边界（自 conceptGraph 迁入，ADR-030）', () => {
  it('collectTopicRefs 去重并保留首次出现的 category', () => {
    const refs = collectTopicRefs([
      { category: 'a', topic: 't1' },
      { category: 'a', topic: 't1' },
      { category: 'b', topic: 't2' },
    ]);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.topic).sort()).toEqual(['t1', 't2']);
  });

  it('expandWithPrerequisites：沿前置链展开且跳过已掌握主题、去重、有上限', () => {
    const profile = profileWith({
      'agent-fundamentals': { attempts: 2, avgScore: 40 },
      'tool-calling': { attempts: 2, avgScore: 95 },
    });
    const expanded = expandWithPrerequisites(['agent-loop'], profile);
    expect(expanded).toContain('agent-loop');
    expect(expanded).toContain('agent-fundamentals'); // 未掌握的前置被纳入
    expect(expanded).not.toContain('tool-calling'); // 已掌握的前置被跳过

    // 无关主题原样保留
    expect(expandWithPrerequisites(['totally-unknown'], profile)).toEqual(['totally-unknown']);

    // 环引用不会死循环（result 上限 + seen 去重保护）
    expect(expandWithPrerequisites(['agent-fundamentals'], profile).length).toBeLessThanOrEqual(10);
  });
});

describe('Concept×Angle 弱角判定', () => {
  it('getAngleStat 返回 (topic,angle) 证据；未练过为 undefined', () => {
    const p = updateLearner(
      emptyProfile(),
      session(70, [
        { questionId: 'a', category: 'c', topic: 'kv-cache', format: 'open', angle: 'mechanism', score: 90, gaps: [] },
        { questionId: 'b', category: 'c', topic: 'kv-cache', format: 'open', angle: 'tradeoff', score: 50, gaps: [] },
      ]),
    );
    expect(getAngleStat(p, 'kv-cache', 'mechanism')?.avgScore).toBe(90);
    expect(getAngleStat(p, 'kv-cache', 'debugging')).toBeUndefined();
  });

  it('weakAnglesOf 优先返回未练与低分角度，已掌握不列入', () => {
    const p = updateLearner(emptyProfile(), session(66, [
      { questionId: 'a', category: 'c', topic: 'kv-cache', format: 'open', angle: 'mechanism', score: 90, gaps: [] },
      { questionId: 'b', category: 'c', topic: 'kv-cache', format: 'open', angle: 'tradeoff', score: 50, gaps: [] },
    ]));
    const weak = weakAnglesOf(p, 'kv-cache', ['mechanism', 'tradeoff', 'debugging', 'scenario']);
    expect(weak).toContain('debugging');
    expect(weak).toContain('scenario');
    expect(weak).toContain('tradeoff');
    expect(weak).not.toContain('mechanism'); // 已掌握的不列入
    expect(weak.indexOf('debugging')).toBeLessThan(weak.indexOf('tradeoff')); // 未练排在低分前
  });
});
