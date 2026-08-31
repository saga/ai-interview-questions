// Copilot 通道测试（ADR-065）：AnswerContext 注入 + Learner 弱项推导。
// 用注入的 fake chat 捕获 system prompt，验证个性化教练依据确实进入 prompt。

import { describe, expect, it } from 'vitest';
import { deriveLearnerContext, runCopilotTurn, type AnswerContext } from './copilot';
import type { LearnerProfile } from '../../schemas/learner';
import type { Question } from '../../schemas/question';
import type { EvaluationResult } from '../../schemas/evaluation';

const question: Question = {
  id: 'q-x-1',
  category: 'llm',
  topic: 'kv-cache',
  tags: [],
  difficulty: 'medium',
  angle: 'mechanism',
  question: 'KV Cache 是什么？',
  explanation: '复用历史 K/V。',
  formats: { choice: { type: 'single', options: ['A', 'B', 'C', 'D'], answer: [1] } },
};

const evaluation: EvaluationResult = {
  overall: 50,
  dimensions: { correctness: 50, completeness: 50, architecture: 50, communication: 50 },
  levels: { correctness: 2, completeness: 2, architecture: 2, communication: 2 },
  evidence: { correctness: '', completeness: '', architecture: '', communication: '' },
  strengths: [],
  gaps: ['漏了显存'],
  missingConcepts: [],
  misconceptionIds: [],
  feedback: '部分正确',
};

describe('deriveLearnerContext（ADR-065 P1-2）', () => {
  it('从 topicStats / angleCoverage 推导弱项，已掌握项不进候选', () => {
    const profile: LearnerProfile = {
      totalSessions: 1,
      totalQuestions: 2,
      overallScore: 60,
      topicStats: {
        'kv-cache': { attempts: 2, avgScore: 60, lastScore: 60, trend: 'flat', mastery: 0.6, commonWeaknesses: [], lastSeen: 1 },
        rag: { attempts: 1, avgScore: 90, lastScore: 90, trend: 'flat', mastery: 0.95, commonWeaknesses: [], lastSeen: 1 },
      },
      angleCoverage: {
        'kv-cache|mechanism': { attempts: 2, avgScore: 55, lastScore: 55, lastAskedAt: 1 },
        'rag|comparison': { attempts: 1, avgScore: 90, lastScore: 90, lastAskedAt: 1 },
      },
      conceptEvidence: {},
      misconceptionHits: {},
      sessions: [],
      updatedAt: 1,
    };
    const ctx = deriveLearnerContext(profile, 'kv-cache');
    expect(ctx.weakTopics).toContain('kv-cache');
    expect(ctx.weakTopics).not.toContain('rag');
    expect(ctx.weakAngles).toContain('mechanism');
    expect(ctx.weakAngles).not.toContain('comparison');
  });

  it('空画像返回空候选', () => {
    expect(deriveLearnerContext(null)).toEqual({ weakTopics: [], weakAngles: [] });
  });
});

describe('runCopilotTurn 注入 AnswerContext（ADR-065 P0-2）', () => {
  it('把用户作答与诊断渲染进 system prompt', async () => {
    const answerContext: AnswerContext = { answer: [1], evaluation };
    let captured = '';
    const chat = async (system: string): Promise<string> => {
      captured = system;
      return 'ok';
    };
    await runCopilotTurn(
      { chat },
      { message: '为什么我选错了', history: [], profile: null, activeQuestion: question, session: null, answerContext },
    );
    expect(captured).toContain('用户作答与诊断');
    expect(captured).toContain('选项 B'); // 用户选了 B（下标 1）
    expect(captured).toContain('漏了显存'); // 薄弱点进入诊断段
  });

  it('无 answerContext 时不渲染诊断段', async () => {
    let captured = '';
    const chat = async (system: string): Promise<string> => {
      captured = system;
      return 'ok';
    };
    await runCopilotTurn(
      { chat },
      { message: '什么是 KV Cache', history: [], profile: null, activeQuestion: null, session: null },
    );
    expect(captured).not.toContain('用户作答与诊断');
  });
});
