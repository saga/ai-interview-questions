import { describe, it, expect } from 'vitest';
import {
  learnerProfileSchema,
  persistedLearnerSchema,
  parsePersistedLearner,
  serializePersistedLearner,
} from './learner';

const validProfile = {
  totalSessions: 1,
  totalQuestions: 10,
  overallScore: 80,
  topicStats: {
    'tool-calling': {
      attempts: 5,
      avgScore: 80,
      lastScore: 85,
      trend: 'improving' as const,
      mastery: 0.8,
      commonWeaknesses: ['gap1'],
      evidence: [{ questionId: 'q1', score: 80, at: 1000 }],
      lastSeen: 1000,
    },
  },
  sessions: [
    {
      id: 'sess-1',
      startedAt: 1000,
      title: '训练',
      questionResults: [
        {
          questionId: 'q1',
          category: 'agentic-ai',
          topic: 'tool-calling',
          format: 'choice' as const,
          score: 80,
          correct: true,
          gaps: [],
        },
      ],
      overall: 80,
    },
  ],
  updatedAt: 1000,
};

describe('learnerProfileSchema', () => {
  it('accepts valid profile', () => {
    expect(() => learnerProfileSchema.parse(validProfile)).not.toThrow();
  });

  it('accepts profile without evidence', () => {
    const p = {
      ...validProfile,
      topicStats: {
        'tool-calling': {
          attempts: 1,
          avgScore: 60,
          lastScore: 60,
          trend: 'flat' as const,
          mastery: 0.6,
          commonWeaknesses: [],
          lastSeen: 1000,
        },
      },
    };
    expect(() => learnerProfileSchema.parse(p)).not.toThrow();
  });

  it('rejects missing totalSessions', () => {
    const { totalSessions: _omit, ...rest } = validProfile as Record<string, unknown> & { totalSessions: number };
    void _omit;
    expect(() => learnerProfileSchema.parse(rest)).toThrow();
  });

  it('rejects invalid mastery >1', () => {
    expect(() =>
      learnerProfileSchema.parse({
        ...validProfile,
        topicStats: {
          'tool-calling': {
            ...validProfile.topicStats['tool-calling'],
            mastery: 1.5,
          },
        },
      }),
    ).toThrow();
  });

  it('rejects score out of range', () => {
    expect(() =>
      learnerProfileSchema.parse({
        ...validProfile,
        sessions: [{ ...validProfile.sessions[0], overall: 150 }],
      }),
    ).toThrow();
  });
});

describe('persistedLearnerSchema', () => {
  it('accepts versioned wrapper', () => {
    const persisted = serializePersistedLearner(validProfile as never);
    expect(() => persistedLearnerSchema.parse(persisted)).not.toThrow();
  });

  it('rejects wrong version', () => {
    expect(() => persistedLearnerSchema.parse({ version: 2, data: validProfile })).toThrow();
  });

  it('parsePersistedLearner handles both new and legacy', () => {
    const persisted = serializePersistedLearner(validProfile as never);
    expect(parsePersistedLearner(persisted)).toEqual(validProfile);

    // legacy direct profile
    expect(parsePersistedLearner(validProfile)).toEqual(validProfile);
  });

  it('parsePersistedLearner returns null for invalid', () => {
    expect(parsePersistedLearner({ foo: 'bar' })).toBeNull();
    expect(parsePersistedLearner(null)).toBeNull();
  });
});
