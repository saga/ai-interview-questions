// 会话级学习状态（P0-1）：验证「历史画像 + 本轮 evaluations → 有效画像」的叠加语义。
// 关键契约：工具/兜底读取的画像必须反映本轮表现，而不是冻结在面试开始前的快照。

import { describe, expect, it } from 'vitest';
import { emptyProfile, misconceptionKey } from '../domain/learner';
import { gradeChoice, DEFAULT_RUBRIC } from '../domain/evaluation';
import type { EvaluationResult } from '../schemas/evaluation';
import type { Question } from '../schemas/question';
import type { SessionQuestion } from '../schemas/session';
import { effectiveProfileFor } from './sessionState';
import { createAgentSession, type InterviewAgentSession } from './types';

/** 带 misconceptionMap 的选择题（选项 1 = 干扰项，映射到误解 0）。 */
const choiceQ: Question = {
  id: 'c1', category: 'agentic-ai', topic: 'rag', tags: [], difficulty: 'medium',
  question: 'RAG 中检索与重排的关系？', explanation: 'e',
  misconceptions: ['以为向量检索可全面取代关键词检索'],
  formats: {
    choice: { type: 'single', options: ['a', 'b'], answer: [0], misconceptionMap: [null, 0] },
  },
};

const openQ: Question = {
  id: 'o1', category: 'agentic-ai', topic: 'rag', tags: [], difficulty: 'medium',
  question: '混合检索为什么有用？', explanation: 'e',
  formats: { open: { referenceAnswer: 'x' } },
};

function openEval(overall: number, missingConcepts: string[] = []): EvaluationResult {
  const v = overall;
  return {
    overall: v,
    dimensions: { correctness: v, completeness: v, architecture: v, communication: v },
    levels: { correctness: 2, completeness: 2, architecture: 2, communication: 2 },
    evidence: { correctness: '', completeness: '', architecture: '', communication: '' },
    strengths: [],
    gaps: ['缺深度'],
    missingConcepts,
    feedback: '',
  };
}

function sessionWith(evaluations: Record<string, EvaluationResult | null>): InterviewAgentSession {
  return { ...createAgentSession(), evaluations };
}

describe('effectiveProfileFor（会话级学习状态）', () => {
  it('本轮 40 分立即反映进有效画像，而非冻结的历史快照', () => {
    // 历史：rag 已掌握（95 分）
    const base = emptyProfile();
    base.topicStats['rag'] = {
      attempts: 3, avgScore: 95, lastScore: 95, trend: 'flat', mastery: 0.95, commonWeaknesses: [], lastSeen: 0,
    };
    // 本轮：开放题 40 分
    const session = sessionWith({ o1: openEval(40) });
    const effective = effectiveProfileFor(session, [openQ], base);
    // 加权后均分明显低于历史 95 —— 若读冻结快照仍是 95，P0-1 的 bug 就复现了
    expect(effective.topicStats['rag'].avgScore).toBeLessThan(95);
    expect(effective.topicStats['rag'].attempts).toBe(4);
  });

  it('选择题答错命中误解 → misconceptionHits 叠加进有效画像', () => {
    const base = emptyProfile();
    const wrong = gradeChoice(choiceQ.formats.choice!, [1], DEFAULT_RUBRIC, choiceQ.misconceptions);
    const session = sessionWith({ c1: wrong });
    const effective = effectiveProfileFor(session, [choiceQ], base);
    expect(effective.misconceptionHits?.[misconceptionKey('rag', '以为向量检索可全面取代关键词检索')]?.hits).toBe(1);
  });

  it('选择题答对不产生误解命中', () => {
    const right = gradeChoice(choiceQ.formats.choice!, [0], DEFAULT_RUBRIC, choiceQ.misconceptions);
    const effective = effectiveProfileFor(sessionWith({ c1: right }), [choiceQ], emptyProfile());
    expect(Object.keys(effective.misconceptionHits ?? {})).toHaveLength(0);
  });

  it('null 评分不入账：有效画像原样返回基准（不伪造 0 分）', () => {
    const base = emptyProfile();
    base.topicStats['rag'] = {
      attempts: 1, avgScore: 90, lastScore: 90, trend: 'flat', mastery: 0.9, commonWeaknesses: [], lastSeen: 0,
    };
    const effective = effectiveProfileFor(sessionWith({ o1: null }), [openQ], base);
    expect(effective).toBe(base); // updateLearner 无有效结果时返回同一对象
    expect(effective.totalSessions).toBe(0);
  });

  it('纯函数：不修改传入的基准画像（历史快照保持原样）', () => {
    const base = emptyProfile();
    base.topicStats['rag'] = {
      attempts: 1, avgScore: 80, lastScore: 80, trend: 'flat', mastery: 0.8, commonWeaknesses: [], lastSeen: 0,
    };
    effectiveProfileFor(sessionWith({ o1: openEval(40) }), [openQ], base);
    expect(base.topicStats['rag'].avgScore).toBe(80);
    expect(base.topicStats['rag'].attempts).toBe(1);
  });

  it('呈现形态还原：有 choice 的题按 choice 记录（开放题按 open）', () => {
    const both: Question = {
      ...choiceQ, id: 'both1',
      formats: { choice: choiceQ.formats.choice, open: { referenceAnswer: 'x' } },
    };
    const wrong = gradeChoice(both.formats.choice!, [1], DEFAULT_RUBRIC, both.misconceptions);
    const session = sessionWith({ both1: wrong, o1: openEval(60) });
    const effective = effectiveProfileFor(session, [both, openQ], emptyProfile());
    expect(effective.totalQuestions).toBe(2);
    expect(effective.misconceptionHits?.[misconceptionKey('rag', '以为向量检索可全面取代关键词检索')]?.hits).toBe(1);
  });

  it('会话中已交付但未出现在 evaluations 的题不计入（口径与 updateLearner 一致）', () => {
    const session = createAgentSession();
    session.answers['c1'] = [1];
    // 有 answer 无 evaluation → 未评分，不入账
    const effective = effectiveProfileFor(session, [choiceQ], emptyProfile());
    expect(effective.totalQuestions).toBe(0);
  });
});
