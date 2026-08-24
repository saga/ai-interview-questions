// Agent → Learner 持久化桥接测试：验证 InterviewAgentSession 能正确转化为可落库的
// SessionRecord，并复用 sessionFromQuiz 的选择题 gap 截断契约与 overall 聚合。

import { describe, it, expect } from 'vitest';
import type { EvaluationResult, SessionQuestion } from '../types';
import { averageOverall, createAgentSession, sessionRecordFromAgent } from './types';

function sq(id: string, topic: string, format: 'choice' | 'open'): SessionQuestion {
  return {
    question: {
      id, category: 'machine-learning', topic, tags: [], difficulty: 'easy',
      question: 'q', explanation: 'e',
      formats:
        format === 'choice'
          ? { choice: { type: 'single', options: ['a', 'b'], answer: [0] } }
          : { open: { referenceAnswer: 'r' } },
    },
    format,
  } satisfies SessionQuestion;
}

function evalWith(overall: number, format: 'choice' | 'open'): EvaluationResult {
  return {
    overall,
    dimensions: { correctness: overall, completeness: overall, architecture: overall, communication: overall },
    strengths: [],
    gaps: format === 'open' ? ['遗漏要点'] : [],
    feedback: '',
  };
}

describe('sessionRecordFromAgent', () => {
  it('把 Agent 会话映射为 mode="agent" 的 SessionRecord', () => {
    const session = createAgentSession();
    const q = sq('c1', 'regularization', 'choice');
    session.answers['c1'] = [0];
    session.evaluations['c1'] = evalWith(100, 'choice');

    const record = sessionRecordFromAgent(session, [q], 'Agent 面试', 42);
    expect(record.mode).toBe('agent');
    expect(record.title).toBe('Agent 面试');
    expect(record.durationSec).toBe(42);
    expect(record.overall).toBe(100);
    expect(record.questionResults).toHaveLength(1);
    // 选择题 gap 不污染 Learner Memory（契约复用 sessionFromQuiz）
    expect(record.questionResults[0].gaps).toEqual([]);
  });

  it('保留开放题 gap，并排除未评估的选题', () => {
    const session = createAgentSession();
    const open = sq('o1', 'rag', 'open');
    const choice = sq('c1', 'regularization', 'choice');
    // 只评了 open；choice 已呈现但用户未作答 / 未评估，不应作为 0 分污染记录
    session.evaluations['o1'] = evalWith(60, 'open');

    const record = sessionRecordFromAgent(session, [open, choice], 'Agent 面试', 10);
    expect(record.questionResults).toHaveLength(1);
    expect(record.questionResults[0].gaps).toEqual(['遗漏要点']);
    expect(record.overall).toBe(60);
  });

  it('averageOverall 在无评分时返回 0', () => {
    expect(averageOverall(createAgentSession())).toBe(0);
  });
});
