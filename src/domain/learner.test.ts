// Learner Memory 纯逻辑测试：聚合 / 弱项推荐 / 会话映射 / 建议文案 / 教练定义 / 覆盖面与学习建议。

import { describe, it, expect } from 'vitest';
import {
  buildCoachDefinition,
  collectTopicRefs,
  computeCoverage,
  describeCoverageGap,
  emptyProfile,
  findCoverageGaps,
  getAngleStat,
  conceptKey,
  conceptGapsOf,
  misconceptionKey,
  missingConceptsOf,
  recommendWeakTopics,
  recommendationText,
  sessionFromQuiz,
  expandWithPrerequisites,
  suggestNextTopics,
  calculateProficiency,
  topMisconceptionsOf,
  updateLearner,
  weakAnglesOf,
} from './learner';
import { pickPrioritized } from './quiz';
import type { LearnerProfile, QuestionResult, SessionRecord } from '../schemas/learner';
import type { Question } from '../schemas/question';

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

/** 带概念级缺失证据的结果（missingConcepts 只由开放题 LLM 评估产出）。 */
function resultWithConcepts(topic: string, score: number, missingConcepts: string[], gaps: string[] = []): QuestionResult {
  return { questionId: 'q-' + topic, category: 'c', topic, format: 'open' as const, score, gaps, missingConcepts };
}

describe('updateLearner · 无有效评分的会话不入账', () => {
  it('questionResults 为空：原样返回画像，不被记成 0 分', () => {
    const base = updateLearner(emptyProfile(), session(80, [result('rag', 80)]));
    const overallBefore = base.overallScore;
    const sessionsBefore = base.sessions.length;

    const after = updateLearner(base, session(0, [])); // 整场全 null → results 为空、overall 被算成 0
    expect(after).toBe(base); // 未产生新对象，即完全没入账
    expect(after.overallScore).toBe(overallBefore);
    expect(after.sessions.length).toBe(sessionsBefore);
  });

  it('空会话不拉低最近 10 场均值（语义：没有证据 ≠ 得 0 分）', () => {
    let p = updateLearner(emptyProfile(), session(90, [result('rag', 90)]));
    p = updateLearner(p, session(0, []));
    expect(p.overallScore).toBe(90);
    expect(p.totalSessions).toBe(1);
  });

  it('部分题为 null 的会话仍然入账（只纳入已评分的题）', () => {
    const mixed: QuestionResult[] = [result('rag', 60)];
    const p = updateLearner(emptyProfile(), session(60, mixed));
    expect(p.totalSessions).toBe(1);
    expect(p.topicStats['rag'].avgScore).toBe(60);
  });
});

describe('conceptEvidence（概念级缺失证据层）', () => {
  it('按 topic|concept 累计 misses，并记录最近一次得分', () => {
    const p = updateLearner(
      emptyProfile(),
      session(55, [
        resultWithConcepts('rag', 50, ['混合检索', '重排']),
        resultWithConcepts('rag', 40, ['混合检索']),
      ]),
    );
    expect(p.conceptEvidence?.[conceptKey('rag', '混合检索')]?.misses).toBe(2);
    // lastScore 取最近一次（40），用于衡量缺失严重度
    expect(p.conceptEvidence?.[conceptKey('rag', '混合检索')]?.lastScore).toBe(40);
    expect(p.conceptEvidence?.[conceptKey('rag', '重排')]?.misses).toBe(1);
  });

  it('跨会话累计（misses 递增而非覆盖）', () => {
    let p = updateLearner(emptyProfile(), session(50, [resultWithConcepts('rag', 50, ['重排'])]));
    p = updateLearner(p, session(60, [resultWithConcepts('rag', 60, ['重排'])]));
    expect(p.conceptEvidence?.[conceptKey('rag', '重排')]?.misses).toBe(2);
  });

  it('概念名归一化：大小写与空白不产生重复计数', () => {
    const p = updateLearner(
      emptyProfile(),
      session(50, [resultWithConcepts('rag', 50, [' 混合检索 ', '混合检索'])]),
    );
    const keys = Object.keys(p.conceptEvidence ?? {}).filter((k) => k.startsWith('rag|'));
    expect(keys).toHaveLength(1);
    expect(p.conceptEvidence?.[keys[0]]?.misses).toBe(2);
  });

  it('不并入 commonWeaknesses（两层证据刻意分离）', () => {
    const p = updateLearner(
      emptyProfile(),
      session(50, [resultWithConcepts('rag', 50, ['混合检索'])]),
    );
    // gaps 为空 → commonWeaknesses 不应凭 missingConcepts 产生内容
    expect(p.topicStats['rag'].commonWeaknesses).toEqual([]);
    // 但概念级证据已单独累计
    expect(p.conceptEvidence?.[conceptKey('rag', '混合检索')]?.misses).toBe(1);
  });

  it('missingConceptsOf 按 misses 降序返回该 topic 的薄弱概念', () => {
    const p = updateLearner(
      emptyProfile(),
      session(50, [
        resultWithConcepts('rag', 50, ['重排']),
        resultWithConcepts('rag', 50, ['混合检索', '重排']),
        resultWithConcepts('rag', 50, ['混合检索', '重排']),
      ]),
    );
    expect(missingConceptsOf(p, 'rag')).toEqual(['重排', '混合检索']);
    expect(missingConceptsOf(p, 'rag', 1)).toEqual(['重排']);
  });

  it('missingConceptsOf 不跨 topic 泄漏', () => {
    const p = updateLearner(
      emptyProfile(),
      session(50, [resultWithConcepts('rag', 50, ['重排']), resultWithConcepts('rlhf', 50, ['PPO'])]),
    );
    expect(missingConceptsOf(p, 'rag')).toEqual(['重排']);
    // 大小写敏感的专有名词要保留原始写法（key 归一化去重，但展示用 label）
    expect(missingConceptsOf(p, 'rlhf')).toEqual(['PPO']);
    expect(missingConceptsOf(p, 'transformer')).toEqual([]);
  });

  it('emptyProfile 自带空概念证据层', () => {
    expect(emptyProfile().conceptEvidence).toEqual({});
    expect(missingConceptsOf(emptyProfile(), 'rag')).toEqual([]);
  });
});

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

  it('熟练度结合得分与证据量，落在 [0,1]', () => {
    const p = updateLearner(emptyProfile(), session(70, Array.from({ length: 5 }, () => result('rag', 70))));
    expect(p.topicStats['rag'].mastery).toBe(calculateProficiency(70, 5, 1));
  });

  it('单题一次满分不会直接代表 100% 熟练', () => {
    const p = updateLearner(emptyProfile(), session(100, [result('rag', 100)]));
    expect(p.topicStats['rag'].mastery).toBe(0.35);
    expect(p.topicStats['rag'].mastery).toBeLessThan(1);
    expect(p.topicStats['rag'].practiceSessions).toBe(1);
  });

  it('题目数量和训练次数增加时，熟练度提高', () => {
    const oneQuestion = updateLearner(emptyProfile(), session(100, [result('rag', 100)]));
    const moreQuestions = updateLearner(emptyProfile(), session(100, Array.from({ length: 5 }, () => result('rag', 100))));
    const morePractice = updateLearner(oneQuestion, session(100, [result('rag', 100)]));
    expect(moreQuestions.topicStats['rag'].mastery).toBeGreaterThan(oneQuestion.topicStats['rag'].mastery);
    expect(morePractice.topicStats['rag'].mastery).toBeGreaterThan(oneQuestion.topicStats['rag'].mastery);
  });

  it('同一训练会话的多道同主题题只增加一次训练次数', () => {
    const p = updateLearner(emptyProfile(), session(100, [result('rag', 100), result('rag', 80)]));
    expect(p.topicStats['rag'].attempts).toBe(2);
    expect(p.topicStats['rag'].practiceSessions).toBe(1);
  });

  it('开放题对 topic 均分的权重是选择题的 5 倍', () => {
    const p = updateLearner(emptyProfile(), session(50, [
      { ...result('rag', 0), format: 'choice' },
      { ...result('rag', 100), format: 'open' },
    ]));
    expect(p.topicStats['rag'].attempts).toBe(2);
    expect(p.topicStats['rag'].scoreWeightTotal).toBe(6);
    expect(p.topicStats['rag'].avgScore).toBe(83.3);
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
    p = updateLearner(p, session(90, [result('rag', 90)]));
    const def = buildCoachDefinition(p, { title: '快速训练', timeLimitSec: 600, mode: 'quick' });
    expect(def.topicPriorities).toContain('tool-calling');
    expect(def.mode).toBe('quick');
    expect(def.timeLimitSec).toBe(600);
    expect(def.useAI).toBe(true);
  });

  it('最近一轮练过的薄弱主题进入冷却，不再集中优先抽取', () => {
    let p = emptyProfile();
    p = updateLearner(p, session(75, [result('google-genai-leader', 75), result('rag', 90)]));
    const def = buildCoachDefinition(p, { title: '快速训练', mode: 'quick' });
    expect(def.topicPriorities ?? []).not.toContain('google-genai-leader');
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

  it('刚练过薄弱主题时说明冷却，而不是误报为已经掌握', () => {
    let p = emptyProfile();
    p = updateLearner(p, session(70, [result('google-genai-leader', 70)]));
    const text = recommendationText(p);
    expect(text).toContain('仍低于掌握线');
    expect(text).toContain('暂不集中重复');
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

  it('完整保留原题快照（含 AI 变体）供历史会话复现', () => {
    const grades = {} as never;
    const rec = sessionFromQuiz(
      { questions: [choiceA, openA], startedAt: 123, definition: { title: 't', mode: 'quick' } },
      grades,
    );
    expect(rec.questions).toBeDefined();
    expect(rec.questions).toHaveLength(2);
    expect(rec.questions?.[0].question).toBe(choiceA.question);
    // 变体改写后（aiGenerated）的文本也应原样落库，而非仅存 id
    expect(rec.questions?.[0].question).not.toBe('__stub__');
  });

  it('落库同时保留用户作答（选择题索引 / 开放题文本）供回放与分析', () => {
    const grades = {} as never;
    const answers = { [choiceA.question.id]: [1], [openA.question.id]: '我的解答文本' } as Record<string, never>;
    const rec = sessionFromQuiz(
      { questions: [choiceA, openA], startedAt: 123, definition: { title: 't', mode: 'quick' } },
      grades,
      undefined,
      answers,
    );
    expect(rec.answers).toBeDefined();
    expect(rec.answers?.[choiceA.question.id]).toEqual([1]);
    expect(rec.answers?.[openA.question.id]).toBe('我的解答文本');
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
    expect(JSON.stringify(profile)).not.toContain(' 答案不正确，请参见解析');
  });

  it('未评估（grades 为 null）的题目不计入画像，避免误记 0 分', () => {
    // grades 缺 o1：等效于开放题未作答/评估失败；不应被记成 0 分拉低画像
    const grades = {
      c1: { overall: 100, dimensions: { correctness: 100, completeness: 100, architecture: 100, communication: 100 }, strengths: [], gaps: [], feedback: '' },
    } as never;
    const rec = sessionFromQuiz(
      { questions: [choiceA, openA], startedAt: Date.now(), definition: { title: 't', mode: 'quick' } },
      grades,
      300,
    );
    // 仅已评分的 c1 进入结果；未评估的 o1 不被记入（不为 0 分污染）
    expect(rec.questionResults).toHaveLength(1);
    expect(rec.questionResults[0].questionId).toBe(choiceA.question.id);
    expect(rec.overall).toBe(100);
    const profile = updateLearner(emptyProfile(), rec);
    // topicStats 只含被评分的 topic，且均分不被未评估题拉低
    expect(profile.totalQuestions).toBe(1);
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

// findCoverageGaps：覆盖缺口（「没练到」），与 recommendWeakTopics（「练得不好」）职责不重叠。
// 用例里的 topic-a/b/c 是概念图中不存在的合成 topic（前置闭包为空），用于隔离 uncovered 逻辑；
// prerequisite 用例复用真实图边 agent-fundamentals -> tool-calling。
describe('findCoverageGaps（覆盖缺口 · coverage discovery）', () => {
  const flatRefs = (...topics: string[]) => topics.map((t) => ({ category: 'test', topic: t }));
  const MASTERED = { attempts: 3, avgScore: 90 };
  const WEAK = { attempts: 3, avgScore: 50 };

  it('Case 1：题库 A B C，只练过 A → B、C 为 uncovered', () => {
    const gaps = findCoverageGaps(flatRefs('topic-a', 'topic-b', 'topic-c'), profileWith({ 'topic-a': MASTERED }));
    expect(gaps).toEqual([
      { topic: 'topic-b', reason: 'uncovered' },
      { topic: 'topic-c', reason: 'uncovered' },
    ]);
  });

  it('Case 2：题库 A B C 全部练过并掌握 → 无缺口', () => {
    const gaps = findCoverageGaps(
      flatRefs('topic-a', 'topic-b', 'topic-c'),
      profileWith({ 'topic-a': MASTERED, 'topic-b': MASTERED, 'topic-c': MASTERED }),
    );
    expect(gaps).toEqual([]);
  });

  it('Case 3：前置已掌握、本体未练 → 本体为 uncovered（而非 prerequisite）', () => {
    // tool-calling 的前置闭包（在题库内的部分）= agent-fundamentals
    const refs = flatRefs('agent-fundamentals', 'tool-calling');
    const gaps = findCoverageGaps(refs, profileWith({ 'agent-fundamentals': MASTERED }));
    expect(gaps).toEqual([{ topic: 'tool-calling', reason: 'uncovered' }]);
  });

  it('Case 4：前置未练、本体已练但未掌握 → 前置 uncovered，本体 prerequisite（前置缺口排在前）', () => {
    const refs = flatRefs('agent-fundamentals', 'tool-calling');
    const gaps = findCoverageGaps(refs, profileWith({ 'tool-calling': WEAK }));
    expect(gaps).toEqual([
      { topic: 'tool-calling', reason: 'prerequisite', prerequisites: ['agent-fundamentals'] },
      { topic: 'agent-fundamentals', reason: 'uncovered' },
    ]);
  });

  it('不与 recommendWeakTopics 重叠：已练但未掌握、前置完备的 topic 不算覆盖缺口', () => {
    const refs = flatRefs('topic-a', 'topic-b');
    const profile = profileWith({ 'topic-a': MASTERED, 'topic-b': WEAK });
    // topic-b 是薄弱项 —— 但它的缺口类型是 mastery 而非 coverage
    expect(recommendWeakTopics(profile, 5)).toEqual(['topic-b']);
    expect(findCoverageGaps(refs, profile)).toEqual([]);
  });

  it('已掌握的 topic 即使前置缺失也不算缺口（否则会为已会的内容刷屏）', () => {
    const refs = flatRefs('agent-fundamentals', 'tool-calling');
    const gaps = findCoverageGaps(refs, profileWith({ 'tool-calling': MASTERED }));
    expect(gaps).toEqual([{ topic: 'agent-fundamentals', reason: 'uncovered' }]);
  });

  it('只统计题库中存在的前置：题库外的前置不构成缺口', () => {
    // tool-calling 的完整闭包含 agent-guardrails，但它不在本次 topicRefs 里
    const gaps = findCoverageGaps(flatRefs('tool-calling'), emptyProfile());
    expect(gaps).toEqual([{ topic: 'tool-calling', reason: 'uncovered' }]);
  });

  it('limit 截断生效（按前置优先 + 拓扑序，不是按输入顺序）', () => {
    const refs = flatRefs('topic-a', 'topic-b', 'topic-c');
    expect(findCoverageGaps(refs, emptyProfile())).toHaveLength(3);
    expect(findCoverageGaps(refs, emptyProfile(), { limit: 2 })).toEqual([
      { topic: 'topic-a', reason: 'uncovered' },
      { topic: 'topic-b', reason: 'uncovered' },
    ]);
  });

  it('describeCoverageGap：区分「未练习」「前置未掌握」「未练习+前置未掌握」', () => {
    const refs = flatRefs('agent-fundamentals', 'tool-calling');

    // 本体未练 → "未练习"
    const blank = emptyProfile();
    const gaps = findCoverageGaps(refs, blank);
    expect(gaps.map((g) => g.topic)).toEqual(['tool-calling', 'agent-fundamentals']);
    expect(describeCoverageGap(gaps[1], blank)).toBe('未练习');

    // 本体未练但前置也未掌握 → reason 仍是 prerequisite（前置缺口优先），描述带上"未练习"
    expect(describeCoverageGap(gaps[0], blank)).toBe('未练习，前置 agent-fundamentals 尚未掌握');

    // 本体已练（未掌握）+ 前置未练 → 只说前置缺失，不说"未练习"（本体练过）
    const practiced = profileWith({ 'tool-calling': WEAK });
    const [prereqGap] = findCoverageGaps(refs, practiced);
    expect(prereqGap).toEqual({ topic: 'tool-calling', reason: 'prerequisite', prerequisites: ['agent-fundamentals'] });
    expect(describeCoverageGap(prereqGap, practiced)).toBe('前置 agent-fundamentals 尚未掌握');
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

describe('misconceptionHits（选择题反证证据层）', () => {
  const misResult = (topic: string, score: number, misconceptionIds: string[]): QuestionResult => ({
    questionId: 'q-' + topic, category: 'c', topic, format: 'choice' as const, score, gaps: [], misconceptionIds,
  });

  it('按 topic|误解 累计 hits，label 保留首次原文', () => {
    const p = updateLearner(emptyProfile(), session(0, [
      misResult('rag', 0, ['以为向量检索可全面取代关键词检索']),
      misResult('rag', 0, ['以为向量检索可全面取代关键词检索', '以为融合顺序与归一化无关紧要']),
    ]));
    expect(p.misconceptionHits?.[misconceptionKey('rag', '以为向量检索可全面取代关键词检索')]?.hits).toBe(2);
    expect(p.misconceptionHits?.[misconceptionKey('rag', '以为融合顺序与归一化无关紧要')]?.hits).toBe(1);
  });

  it('跨会话累计', () => {
    let p = updateLearner(emptyProfile(), session(0, [misResult('rag', 0, ['误解A'])]));
    p = updateLearner(p, session(0, [misResult('rag', 0, ['误解A'])]));
    expect(p.misconceptionHits?.[misconceptionKey('rag', '误解A')]?.hits).toBe(2);
  });

  it('空 misconceptionIds 不产生条目', () => {
    const p = updateLearner(emptyProfile(), session(0, [misResult('rag', 0, [])]));
    expect(Object.keys(p.misconceptionHits ?? {})).toHaveLength(0);
  });

  it('topMisconceptionsOf 按 hits 降序返回该 topic 命中的误解', () => {
    const p = updateLearner(emptyProfile(), session(0, [
      misResult('rag', 0, ['误解B']),
      misResult('rag', 0, ['误解A', '误解B']),
      misResult('rag', 0, ['误解A', '误解B']),
    ]));
    expect(topMisconceptionsOf(p, 'rag')).toEqual(['误解B', '误解A']);
    expect(topMisconceptionsOf(p, 'rag', 1)).toEqual(['误解B']);
    // 不跨 topic 泄漏
    expect(topMisconceptionsOf(p, 'attention')).toEqual([]);
  });

  it('emptyProfile 自带空误解层', () => {
    expect(emptyProfile().misconceptionHits).toEqual({});
    expect(topMisconceptionsOf(emptyProfile(), 'rag')).toEqual([]);
  });
});

describe('conceptGapsOf（coverage 第二层：必考点证据）', () => {
  it('已练且必考点答错过 → missed（带 misses 计数）', () => {
    const p = updateLearner(emptyProfile(), session(50, [
      { questionId: 'a', category: 'c', topic: 'rag', format: 'open', score: 40, gaps: [], missingConcepts: ['混合检索'] },
    ]));
    const gaps = conceptGapsOf(p, 'rag', ['混合检索', '重排']);
    expect(gaps).toEqual([{ topic: 'rag', point: '混合检索', status: 'missed', misses: 1 }]);
  });

  it('从未练过 → 全部必考点 unprobed', () => {
    const gaps = conceptGapsOf(emptyProfile(), 'rag', ['混合检索', '重排']);
    expect(gaps).toEqual([
      { topic: 'rag', point: '混合检索', status: 'unprobed', misses: 0 },
      { topic: 'rag', point: '重排', status: 'unprobed', misses: 0 },
    ]);
  });

  it('已练但无缺失证据的必考点不列为缺口（不制造虚假缺口）', () => {
    const p = updateLearner(emptyProfile(), session(80, [
      { questionId: 'a', category: 'c', topic: 'rag', format: 'open', score: 80, gaps: [], missingConcepts: [] },
    ]));
    expect(conceptGapsOf(p, 'rag', ['混合检索'])).toEqual([]);
  });

  it('required 为空时返回空数组', () => {
    expect(conceptGapsOf(emptyProfile(), 'rag', [])).toEqual([]);
  });
});
