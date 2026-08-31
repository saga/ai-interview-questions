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

  it('空画像返回空候选（focusTopic 缺省）', () => {
    const ctx = deriveLearnerContext(null);
    expect(ctx.weakTopics).toEqual([]);
    expect(ctx.weakAngles).toEqual([]);
    expect(ctx.focusTopic).toBeUndefined();
  });

  it('P1：focusTopic 只作锚点，不并进 weakTopics（避免把"当前问的 topic"误当"长期弱项"）', () => {
    const profile: LearnerProfile = {
      totalSessions: 1,
      totalQuestions: 2,
      overallScore: 60,
      topicStats: {
        'kv-cache': { attempts: 2, avgScore: 60, lastScore: 60, trend: 'flat', mastery: 0.6, commonWeaknesses: [], lastSeen: 1 },
        rag: { attempts: 1, avgScore: 90, lastScore: 90, trend: 'flat', mastery: 0.95, commonWeaknesses: [], lastSeen: 1 },
      },
      angleCoverage: {},
      conceptEvidence: {},
      misconceptionHits: {},
      sessions: [],
      updatedAt: 1,
    };
    const ctx = deriveLearnerContext(profile, 'rag');
    expect(ctx.weakTopics).toContain('kv-cache'); // 真实弱项来自 Profile
    expect(ctx.weakTopics).not.toContain('rag'); // focusTopic 不应混入弱项
    expect(ctx.focusTopic).toBe('rag'); // 但作为锚点透传
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

describe('runCopilotTurn 检索范围决策（ADR-065 P0-2 解耦）', () => {
  it('有当前题(kv-cache)时问另一个知识点 → 不被当前题 topic 限制', async () => {
    const chat = async (): Promise<string> => 'ok';
    const res = await runCopilotTurn(
      { chat },
      { message: 'GQA 和 MQA 有什么区别', history: [], profile: null, activeQuestion: question, session: null },
    );
    expect(res.evidence?.scope).toBe('topic');
    expect(res.evidence?.seeds).toContain('gqa');
    expect(res.evidence?.seeds).not.toContain('kv-cache');
  });

  it('有当前题求提示 → current_question 范围', async () => {
    const chat = async (): Promise<string> => 'ok';
    const res = await runCopilotTurn(
      { chat },
      { message: '给我一点提示，但不要直接给答案', history: [], profile: null, activeQuestion: question, session: null },
    );
    expect(res.evidence?.scope).toBe('current_question');
  });

  it('有当前题的普通 follow-up（上一轮是 Copilot 知识问题）→ 不被当前题 topic 限制', async () => {
    const chat = async (): Promise<string> => 'ok';
    const res = await runCopilotTurn(
      { chat },
      {
        message: '为什么',
        history: [{ role: 'user', content: 'KV Cache 是什么' }, { role: 'assistant', content: 'x' }],
        profile: null,
        activeQuestion: question,
        session: null,
      },
    );
    expect(res.evidence?.scope).toBe('global');
  });

  it('P1：上一轮知识锚点（activeKnowledgeIds）接成 follow-up 的 graph 种子', async () => {
    const chat = async (): Promise<string> => 'ok';
    const res = await runCopilotTurn(
      { chat },
      {
        message: '那显存呢',
        history: [{ role: 'user', content: '讲讲 KV Cache' }, { role: 'assistant', content: 'x' }],
        profile: null,
        activeQuestion: null,
        session: null,
        context: { version: 1, mode: 'chat', activeKnowledgeIds: ['kv-cache'] },
      },
    );
    expect(res.evidence?.seeds).toContain('kv-cache');
  });
});
