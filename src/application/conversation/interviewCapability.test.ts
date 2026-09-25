// Chat 面试驱动测试（plan0831_5 §P0-1/P0-2）：验证 startChatInterview 把 Chat 面试
// 真正接到 createInterviewAgent（pi-agent-core），并把它包成「拉取式」Promise 驱动：
// 首题 → 提交答案 → 下一题 → 结束。复用 interviewAgent.test.ts 的脚本化 streamFn 模式。
// 不触碰真实网络/模型：runtimeOverride 注入 mock streamFn 与占位 model。

import { describe, it, expect, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type StopReason,
  type TextContent,
  type ToolCall,
  type Usage,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { LLMProvider } from '../../types';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { ProviderEntry } from '../../schemas/ai-config';
import type { Question } from '../../schemas/question';
import { emptyProfile } from '../../domain/learner';
import { startChatInterview, rehydrateInterviewAgent } from './interviewCapability';
import type { ConversationSession } from './conversationSession';

const EMPTY_USAGE: Usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeMsg(content: (TextContent | ToolCall)[], stopReason: StopReason): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'openai',
    model: 'mock',
    usage: EMPTY_USAGE,
    stopReason,
    timestamp: Date.now(),
  };
}

function buildStream(msg: AssistantMessage): AssistantMessageEventStream {
  const s = createAssistantMessageEventStream();
  s.push({ type: 'start', partial: msg });
  msg.content.forEach((c, idx) => {
    if (c.type === 'text') {
      s.push({ type: 'text_start', contentIndex: idx, partial: msg });
      s.push({ type: 'text_delta', contentIndex: idx, delta: c.text, partial: msg });
      s.push({ type: 'text_end', contentIndex: idx, content: c.text, partial: msg });
    } else {
      s.push({ type: 'toolcall_start', contentIndex: idx, partial: msg });
      s.push({ type: 'toolcall_end', contentIndex: idx, toolCall: c, partial: msg });
    }
  });
  s.push({ type: 'done', reason: msg.stopReason === 'toolUse' ? 'toolUse' : 'stop', message: msg });
  s.end(msg);
  return s;
}

function makeMockStreamFn(responses: AssistantMessage[]): StreamFn {
  let i = 0;
  return () => {
    const msg = responses[i++] ?? makeMsg([{ type: 'text', text: '（结束）' }], 'stop');
    return buildStream(msg);
  };
}

function choiceQuestion(): Question {
  return {
    id: 'q-choice-1',
    category: 'transformer',
    topic: 'attention',
    tags: [],
    difficulty: 'easy',
    question: 'Transformer 中 multi-head attention 的作用？',
    explanation: '多头并行捕捉不同子空间关系。',
    formats: { choice: { type: 'single', options: ['A', 'B', 'C'], answer: [0] } },
  };
}

function openQuestion(): Question {
  return {
    id: 'q-open-1',
    category: 'rag-agent',
    topic: 'rag',
    tags: [],
    difficulty: 'medium',
    question: 'RAG 与 fine-tuning 的区别？',
    explanation: 'RAG 注入外部知识，fine-tuning 更新参数。',
    formats: { open: { referenceAnswer: 'RAG 检索外部知识，fine-tuning 更新模型参数。' } },
  };
}

function choiceQuestion2(): Question {
  return {
    id: 'q-choice-2',
    category: 'transformer',
    topic: 'attention',
    tags: [],
    difficulty: 'easy',
    question: 'LayerNorm 在 Transformer 中的作用？',
    explanation: '稳定隐层分布，加速收敛。',
    formats: { choice: { type: 'single', options: ['A', 'B', 'C'], answer: [0] } },
  };
}

function fakeProvider(): LLMProvider {
  return {
    name: 'fake',
    generateVariant: vi.fn(async () => ({ question: 'x' })),
    evaluateOpenAnswer: vi.fn(async (): Promise<EvaluationResult> => ({
      overall: 50,
      dimensions: { correctness: 50, completeness: 50, architecture: 50, communication: 50 },
      levels: { correctness: 2, completeness: 2, architecture: 2, communication: 2 },
      evidence: { correctness: '', completeness: '', architecture: '', communication: '' },
      strengths: ['答到要点'],
      gaps: ['未展开推理成本'],
      missingConcepts: [],
      feedback: '基本正确。',
    })),
  };
}

const VALID_ENTRY: ProviderEntry = { id: 'local', model: 'fake', apiKey: '' };

function scriptedResponses(): AssistantMessage[] {
  return [
    makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-choice-1' } }], 'toolUse'),
    makeMsg([{ type: 'text', text: '请回答：Transformer 中 multi-head attention 的作用？' }], 'stop'),
    makeMsg([{ type: 'toolCall', id: 'c4', name: 'evaluateAnswer', arguments: {} }], 'toolUse'),
    makeMsg([{ type: 'toolCall', id: 'c5', name: 'finishInterview', arguments: {} }], 'toolUse'),
  ];
}

describe('startChatInterview（Chat 面试走 pi-agent-core）', () => {
  it('首题 → 提交答案 → 下一题 → 结束，完整 loop 正确', async () => {
    const bank = [choiceQuestion(), openQuestion()];
    const provider = fakeProvider();
    const res = await startChatInterview({
      bank,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider,
      generateOpenQuestions: true,
      runtimeOverride: { streamFn: makeMockStreamFn(scriptedResponses()), model: { id: 'mock' } as any },
    });
    expect(res.firstQuestion?.question.id).toBe('q-choice-1');
    expect(res.finished).toBe(false);

    // 提交 q-choice-1 答案（选择题确定性判分）→ 交付 q-open-1
    const step1 = await res.controller.submit([0]);
    expect(step1.finished).toBe(false);
    expect(step1.question?.question.id).toBe('q-open-1');
    // 评分已写入运行时会话（与 Agent Interview 共用同一份状态，plan0831_5 §P1-2）
    expect(res.controller.session.evaluations['q-choice-1']).toBeDefined();
    expect(res.controller.session.evaluations['q-choice-1']!.overall).toBe(100);

    // 提交 q-open-1 答案 → 结束
    const step2 = await res.controller.submit('RAG 检索外部知识来回答，fine-tuning 更新模型参数。');
    expect(step2.finished).toBe(true);
    expect(res.controller.session.evaluations['q-open-1']).toBeDefined();
    expect(Object.keys(res.controller.session.evaluations).length).toBe(2);

    res.controller.dispose();
  });

  it('Agent 首轮未选题 → 确定性兜底交付首题（与 Agent Interview 一致）', async () => {
    const bank = [choiceQuestion()];
    const provider = fakeProvider();
    const res = await startChatInterview({
      bank,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider,
      runtimeOverride: { streamFn: makeMockStreamFn([makeMsg([{ type: 'text', text: '我先看看你的薄弱点…' }], 'stop')]), model: { id: 'mock' } as any },
    });
    expect(res.firstQuestion?.question.id).toBe('q-choice-1');
    expect(res.controller.session.fallbackReason).toBe('agent_no_action');
    expect(res.controller.session.fallbackCount).toBe(1);
    res.controller.dispose();
  });

  it('skip() 跳过当前题（不计分）并交付下一题', async () => {
    const bank = [choiceQuestion(), openQuestion()];
    const provider = fakeProvider();
    const res = await startChatInterview({
      bank,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider,
      generateOpenQuestions: true,
      runtimeOverride: { streamFn: makeMockStreamFn(scriptedResponses()), model: { id: 'mock' } as any },
    });
    expect(res.firstQuestion?.question.id).toBe('q-choice-1');
    // 跳过 q-choice-1（不计分）→ 交付 q-open-1
    const step = await res.controller.skip();
    expect(step.question?.question.id).toBe('q-open-1');
    // 跳过的题标记为「已处理但未评分」：evaluations 建键但为 null
    expect(res.controller.session.evaluations['q-choice-1']).toBeNull();
    res.controller.dispose();
  });

  it('刷新恢复：rehydrateInterviewAgent + resumeSession 跳过开场、接回当前题并继续（plan0831_6 P0-1）', async () => {
    const q1 = choiceQuestion();
    const q2 = choiceQuestion2();
    const bank = [q1, q2];
    const provider = fakeProvider();

    // 模拟「上一次面试」已交付并答完 q1，当前停在 q2（已交付、未答）。
    const session: ConversationSession = {
      id: 's-resume',
      startedAt: Date.now() - 1000,
      context: { version: 1, mode: 'interview', sessionId: 's-resume', pendingAction: 'answer', questionHistory: ['q-choice-1'], currentQuestionId: 'q-choice-2', questionCount: 2, messageTurnCount: 2 },
      messages: [],
      questions: [{ question: q1, format: 'choice' }, { question: q2, format: 'choice' }],
      answers: { 'q-choice-1': [0] },
      evaluations: { 'q-choice-1': { overall: 100, dimensions: { correctness: 100, completeness: 100, architecture: 100, communication: 100 }, levels: { correctness: 3, completeness: 3, architecture: 3, communication: 3 }, evidence: { correctness: '', completeness: '', architecture: '', communication: '' }, strengths: [], gaps: [], missingConcepts: [], feedback: '' }, 'q-choice-2': null },
      questionCount: 2,
      messageTurnCount: 2,
      feedbackMode: 'standard',
    };

    const resumeSession = rehydrateInterviewAgent(session);
    expect(resumeSession.currentQuestion?.question.id).toBe('q-choice-2');
    expect(resumeSession.answers['q-choice-1']).toEqual([0]);

    // 恢复：不重新开场（无 LLM loop），直接以已恢复的题目为首题；choice 路径走确定性 choiceAdvance。
    const res = await startChatInterview({
      bank,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider,
      runtimeOverride: { streamFn: makeMockStreamFn([]), model: { id: 'mock' } as any },
      resumeSession,
    });
    expect(res.firstQuestion?.question.id).toBe('q-choice-2');
    expect(res.finished).toBe(false);

    // 提交 q2 答案 → 确定性判分 → 无更多选择题 → 结束。
    const step = await res.controller.submit([0]);
    expect(step.finished).toBe(true);
    expect(res.controller.session.evaluations['q-choice-2']).toBeDefined();
    expect(res.controller.session.evaluations['q-choice-2']!.overall).toBe(100);
    res.controller.dispose();
  });

  it('并发保护：busy 期间重复 submit 被拒绝，不覆盖 resolver（plan0831_6 P1-4）', async () => {
    const bank = [choiceQuestion(), choiceQuestion2()];
    const provider = fakeProvider();
    const res = await startChatInterview({ bank, profile: emptyProfile(), entry: VALID_ENTRY, provider });
    expect(res.firstQuestion?.question.id).toBeDefined();

    // 两次 submit 同步发起：第一次在途（choice 路径异步判分），期间第二次 submit 应被拒，避免覆盖 resolver。
    const p1 = res.controller.submit([0]);
    const p2 = res.controller.submit([1]);
    await expect(p1).resolves.toBeDefined();
    await expect(p2).rejects.toThrow('BUSY');
    res.controller.dispose();
  });
});

// ── 逐题反馈（immediate 模式）：Chat 侧 ──────────────────────────────────
// 与独立 Agent 面试页共用同一运行时，但包装层是「拉取式」的 ChatInterviewStep，
// 因此必须验证：暂停态能否作为 step 交付给 UI、以及 continueAfterFeedback 能否接回循环。
describe('Chat 面试 · immediate 模式（逐题反馈）', () => {
  const scored = (overall: number): EvaluationResult => ({
    overall,
    dimensions: { correctness: overall, completeness: overall, architecture: overall, communication: overall },
    levels: { correctness: 4, completeness: 4, architecture: 4, communication: 4 },
    evidence: { correctness: '', completeness: '', architecture: '', communication: '' },
    strengths: [],
    gaps: [],
    missingConcepts: [],
    feedback: '',
  });

  it('选择题：submit 返回「停在反馈上」的 step；continueAfterFeedback 后交付下一题', async () => {
    const bank = [choiceQuestion(), choiceQuestion2()];
    const res = await startChatInterview({
      bank,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider: fakeProvider(),
      feedbackMode: 'immediate',
      runtimeOverride: { streamFn: makeMockStreamFn([]), model: { id: 'mock' } as any },
    });
    const controller = res.controller;
    expect(controller.session.feedbackMode).toBe('immediate');
    // 首题由确定性兜底选出（两道题同主题，pickNextAdaptive 顺序不确定）
    // → 断言「相对关系」而非硬编码 id，否则测试会随选题随机性偶发失败。
    const first = res.firstQuestion!.question.id;
    const other = first === 'q-choice-1' ? 'q-choice-2' : 'q-choice-1';

    // 提交选择题 → 确定性判分 → 暂停
    const step1 = await controller.submit([0]);
    expect(step1.awaitingFeedback).toBe(true);
    expect(step1.finished).toBe(false);
    // 关键：step.question 是**刚作答的那道题**，而不是下一题
    expect(step1.question?.question.id).toBe(first);
    expect(step1.evaluation?.overall).toBe(100);
    expect(controller.session.status).toBe('awaiting_feedback');
    expect(controller.session.currentQuestion?.question.id).toBe(first);

    // 用户确认继续 → 确定性交付下一题
    const step2 = await controller.continueAfterFeedback();
    expect(step2.awaitingFeedback).toBeFalsy();
    expect(step2.finished).toBe(false);
    expect(step2.question?.question.id).toBe(other);
    expect(controller.session.status).toBe('running');

    // 第二题再次暂停
    const step3 = await controller.submit([0]);
    expect(step3.awaitingFeedback).toBe(true);
    expect(step3.question?.question.id).toBe(other);

    // 题库已空 → 继续后优雅收尾
    const step4 = await controller.continueAfterFeedback();
    expect(step4.finished).toBe(true);
    controller.dispose();
  });

  it('开放题：走 LLM 工具评分后暂停；continueAfterFeedback 由 Agent 决定下一题', async () => {
    const bank = [openQuestion(), choiceQuestion()];
    const streamFn = makeMockStreamFn([
      makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-open-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '请作答。' }], 'stop'),
      makeMsg([{ type: 'toolCall', id: 'c2', name: 'evaluateAnswer', arguments: {} }], 'toolUse'),
      makeMsg([{ type: 'text', text: '评估完成。' }], 'stop'),
      // continueAfterFeedback 之后：Agent 决定下一题
      makeMsg([{ type: 'toolCall', id: 'c3', name: 'getQuestion', arguments: { id: 'q-choice-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '下一题。' }], 'stop'),
    ]);
    const res = await startChatInterview({
      bank,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider: fakeProvider(),
      generateOpenQuestions: true,
      feedbackMode: 'immediate',
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
    });
    const controller = res.controller;
    expect(res.firstQuestion?.question.id).toBe('q-open-1');

    const step1 = await controller.submit('RAG 检索外部知识，fine-tuning 更新参数。');
    expect(step1.awaitingFeedback).toBe(true);
    expect(step1.question?.question.id).toBe('q-open-1');
    expect(step1.evaluation?.overall).toBe(50); // 委托 fakeProvider
    expect(controller.session.status).toBe('awaiting_feedback');

    const step2 = await controller.continueAfterFeedback();
    expect(step2.question?.question.id).toBe('q-choice-1');
    expect(step2.awaitingFeedback).toBeFalsy();
    controller.dispose();
  });

  it('standard 模式（默认）：submit 直接交付下一题，不产生反馈态', async () => {
    const bank = [choiceQuestion(), choiceQuestion2()];
    const res = await startChatInterview({
      bank,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider: fakeProvider(),
      runtimeOverride: { streamFn: makeMockStreamFn([]), model: { id: 'mock' } as any },
    });
    expect(res.controller.session.feedbackMode).toBe('standard');
    const first = res.firstQuestion!.question.id;
    const step = await res.controller.submit([0]);
    expect(step.awaitingFeedback).toBeFalsy();
    // 标准模式：直接推进到**另一道题**（不是停在原题上等反馈）
    expect(step.question?.question.id).not.toBe(first);
    res.controller.dispose();
  });

  it('非暂停态调用 continueAfterFeedback：立即返回当前状态，不挂起（防永久 await）', async () => {
    const bank = [choiceQuestion(), choiceQuestion2()];
    const res = await startChatInterview({
      bank,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider: fakeProvider(),
      feedbackMode: 'immediate',
      runtimeOverride: { streamFn: makeMockStreamFn([]), model: { id: 'mock' } as any },
    });
    // 此时是「等待作答」，并非停在反馈上
    const first = res.firstQuestion!.question.id;
    const step = await res.controller.continueAfterFeedback();
    expect(step.finished).toBe(false);
    // 非暂停态是 no-op：必须立即返回**当前这道题**，不能换题也不能挂起。
    expect(step.question?.question.id).toBe(first);
    res.controller.dispose();
  });

  it('刷新恢复：pendingAction=feedback 时还原暂停态，首步即 awaitingFeedback', async () => {
    const q1 = openQuestion();
    const session: ConversationSession = {
      id: 's-feedback',
      startedAt: Date.now() - 1000,
      context: {
        version: 1,
        mode: 'interview',
        sessionId: 's-feedback',
        pendingAction: 'feedback',
        questionHistory: ['q-open-1'],
        currentQuestionId: 'q-open-1',
        questionCount: 1,
        messageTurnCount: 1,
      },
      messages: [],
      questions: [{ question: q1, format: 'open' }],
      answers: { 'q-open-1': '我的回答' },
      evaluations: { 'q-open-1': scored(50) },
      questionCount: 1,
      messageTurnCount: 1,
      feedbackMode: 'immediate',
    };

    const resumeSession = rehydrateInterviewAgent(session, session.feedbackMode);
    // 暂停态必须被还原，否则 UI 会显示一道「已答完却无法提交」的题
    expect(resumeSession.status).toBe('awaiting_feedback');
    expect(resumeSession.feedbackMode).toBe('immediate');

    const res = await startChatInterview({
      bank: [q1],
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      provider: fakeProvider(),
      runtimeOverride: { streamFn: makeMockStreamFn([]), model: { id: 'mock' } as any },
      resumeSession,
    });
    expect(res.awaitingFeedback).toBe(true);
    expect(res.firstQuestion?.question.id).toBe('q-open-1');
    expect(res.evaluation?.overall).toBe(50);
    res.controller.dispose();
  });
});
