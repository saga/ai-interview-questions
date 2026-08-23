// Learner Memory 纯逻辑测试：聚合 / 弱项推荐 / 会话映射 / 建议文案 / 教练定义。

import { describe, it, expect } from 'vitest';
import {
  buildCoachDefinition,
  emptyProfile,
  recommendWeakTopics,
  recommendationText,
  sessionFromQuiz,
  updateLearner,
} from './learner';
import { pickPrioritized } from './quiz';
import type { ChoiceQuestion, OpenQuestion, Question, QuestionResult, SessionRecord } from '../types';

const choiceA: ChoiceQuestion = {
  id: 'c1', category: 'machine-learning', topic: 'regularization', tags: [], difficulty: 'easy',
  type: 'single', question: 'q', options: ['a', 'b'], answer: [0], explanation: 'e',
};
const choiceB: ChoiceQuestion = {
  id: 'c2', category: 'agentic-ai', topic: 'tool-calling', tags: [], difficulty: 'medium',
  type: 'single', question: 'q', options: ['a', 'b'], answer: [1], explanation: 'e',
};
const openA: OpenQuestion = {
  id: 'o1', category: 'agentic-ai', topic: 'tool-calling', tags: [], difficulty: 'hard',
  type: 'essay', question: 'q', referenceAnswer: 'a', explanation: 'e',
};

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
  return { questionId: 'x', category: 'c', topic, type: 'essay', score, gaps, correct };
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

  it('trend：上次明显高于均分 → improving，反之 declining', () => {
    let p = updateLearner(emptyProfile(), session(70, [result('rag', 50), result('rag', 50)]));
    p = updateLearner(p, session(80, [result('rag', 85)]));
    expect(p.topicStats['rag'].trend).toBe('improving');
    p = updateLearner(p, session(60, [result('rag', 40)]));
    expect(p.topicStats['rag'].trend).toBe('declining');
  });

  it('mastery 在 [0,1]，且尝试次数多时收敛到 avg/100', () => {
    const p = updateLearner(emptyProfile(), session(70, Array.from({ length: 5 }, () => result('rag', 70))));
    expect(p.topicStats['rag'].mastery).toBeGreaterThan(0.6);
    expect(p.topicStats['rag'].mastery).toBeLessThanOrEqual(0.7);
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
});

describe('pickPrioritized', () => {
  it('薄弱主题的题优先被抽中，剩余由其他题补齐', () => {
    const pool: Question[] = [
      { ...choiceA }, { ...choiceB }, { ...openA },
      { ...choiceA, id: 'r1', topic: 'random-1' },
      { ...choiceA, id: 'r2', topic: 'random-2' },
    ];
    const picked = pickPrioritized(pool, ['tool-calling'], 3);
    const weak = picked.filter((q) => q.topic === 'tool-calling');
    expect(weak.length).toBe(2); // 两道 tool-calling 都被优先抽出
    expect(picked.length).toBe(3);
  });

  it('count 超过题池时返回全部且不重复', () => {
    const pool: Question[] = [{ ...choiceA }, { ...choiceB }];
    const picked = pickPrioritized(pool, ['tool-calling'], 5);
    expect(picked.length).toBe(2);
    expect(new Set(picked.map((q) => q.id)).size).toBe(2);
  });

  it('无 priority 时退化为纯随机', () => {
    const pool: Question[] = [{ ...choiceA }, { ...choiceB }];
    const picked = pickPrioritized(pool, [], 2);
    expect(picked.length).toBe(2);
  });
});
