// Agent 面试 ↔ Copilot 桥接上下文的单测（纯逻辑）。
// 关注点是**契约**：结构化上下文必须无损转成 Copilot 唯一的 `AnswerContext`，
// 尤其是「题干」与「反馈节奏」这两个 Agent 侧独有、Copilot 侧无法自行推导的字段——
// 一旦漏转，Copilot 会退化成泛泛而谈，且不报错（静默劣化），故必须用测试锁住。

import { describe, it, expect } from 'vitest';
import {
  toAnswerContext,
  interviewRoutingContext,
  ASK_COPILOT_ABOUT_FEEDBACK,
  type ActiveInterviewContext,
} from './interviewContext';
import { routeUserMessage } from './commandDetector';
import { initialConversationContext } from './conversationSession';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { Question } from '../../schemas/question';
import type { SessionQuestion } from '../../schemas/session';

const question: Question = {
  id: 'q-open-1',
  category: 'llm',
  topic: 'kv-cache',
  tags: ['inference'],
  difficulty: 'medium',
  angle: 'mechanism',
  question: 'KV Cache 为什么能省算力？',
  explanation: '复用历史 K/V。',
  formats: { open: { referenceAnswer: '因为 K/V 可复用，避免重复计算。' } },
};

const sessionQuestion: SessionQuestion = { question, format: 'open' };

const evaluation: EvaluationResult = {
  overall: 72,
  dimensions: { correctness: 80, completeness: 60, architecture: 70, communication: 78 },
  levels: { correctness: 3, completeness: 2, architecture: 3, communication: 3 },
  evidence: { correctness: '机制说对了', completeness: '漏了显存', architecture: '', communication: '' },
  strengths: ['抓到了复用'],
  gaps: ['未提显存增长'],
  missingConcepts: [],
  feedback: '基本正确。',
};

function activeCtx(over: Partial<ActiveInterviewContext> = {}): ActiveInterviewContext {
  return {
    feedbackMode: 'immediate',
    question: sessionQuestion,
    answer: '因为 K/V 可以复用，不用重算。',
    evaluation,
    deliveredCount: 3,
    ...over,
  };
}

describe('toAnswerContext（Agent 面试 → Copilot 桥接）', () => {
  it('透传作答与评分，并把 SessionQuestion 拆成裸 Question', () => {
    const ctx = toAnswerContext(activeCtx());
    expect(ctx.answer).toBe('因为 K/V 可以复用，不用重算。');
    expect(ctx.evaluation).toBe(evaluation);
    // 关键：给的是 question.question（裸题面对象），不是包装层——Copilot 侧类型即 Question。
    expect(ctx.question).toBe(question);
    expect(ctx.question?.id).toBe('q-open-1');
  });

  it('透传 feedbackMode（Copilot 据此调整讲解深度）', () => {
    expect(toAnswerContext(activeCtx({ feedbackMode: 'immediate' })).feedbackMode).toBe('immediate');
    expect(toAnswerContext(activeCtx({ feedbackMode: 'standard' })).feedbackMode).toBe('standard');
  });

  it('选择题作答（索引数组）原样透传，不在桥接层改写形状', () => {
    const ctx = toAnswerContext(activeCtx({ answer: [0, 2] }));
    expect(ctx.answer).toEqual([0, 2]);
  });

  it('不携带 deliveredCount（进度属 Agent 侧状态，Copilot 上下文契约不含它）', () => {
    const ctx = toAnswerContext(activeCtx({ deliveredCount: 7 }));
    expect(ctx).not.toHaveProperty('deliveredCount');
  });
});

describe('ASK_COPILOT_ABOUT_FEEDBACK', () => {
  it('只表达意图，不复述题干与评分（避免与结构化字段重复、随字段演进过期）', () => {
    expect(ASK_COPILOT_ABOUT_FEEDBACK).toContain('详细讲解');
    expect(ASK_COPILOT_ABOUT_FEEDBACK).not.toContain(question.question);
    expect(ASK_COPILOT_ABOUT_FEEDBACK).not.toContain(String(evaluation.overall));
  });
});

// 端到端断言（比只测字段更关键）：派生的 context 必须真的让「A」走答案通道。
// 面试模式下侧栏不再维护 pendingAction/currentQuestionId，若忘记派生，
// shouldSubmitAsAnswer 会判定「没有待作答题」→ 「A」被当成提问 → 面试卡死。
describe('interviewRoutingContext（面试进行中的消息路由）', () => {
  it('派生后「A」走答案通道（不派生就会退化成 Copilot 提问）', () => {
    const derived = interviewRoutingContext(initialConversationContext(), sessionQuestion, false);
    expect(derived.currentQuestionId).toBe(question.id);
    expect(derived.pendingAction).toBe('answer');
    expect(routeUserMessage('A', derived, question).kind).toBe('answer');
  });

  it('停在反馈上时答案通道关闭：同一输入退化为 Copilot（此刻当前题已评分，重复提交必被拒）', () => {
    const derived = interviewRoutingContext(initialConversationContext(), sessionQuestion, true);
    expect(derived.pendingAction).toBe('feedback');
    expect(routeUserMessage('A', derived, question).kind).toBe('copilot');
  });

  it('无当前题（未开场 / 已收尾）时原样返回，不注入面试语义', () => {
    const base = initialConversationContext();
    expect(interviewRoutingContext(base, null, false)).toBe(base);
  });

  it('保留基底 context 的其它字段（只覆盖路由相关的三项）', () => {
    const base = { ...initialConversationContext(), activeKnowledgeIds: ['kv-cache'], endedAt: 123 };
    const derived = interviewRoutingContext(base, sessionQuestion, false);
    expect(derived.activeKnowledgeIds).toEqual(['kv-cache']);
    expect(derived.endedAt).toBe(123);
    expect(derived.mode).toBe('interview');
  });
});
