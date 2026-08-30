// Agent 运行时测试（Phase 2）：用 mock streamFn 脚本化驱动完整面试 loop
// 选 → 评 → 追问(选下一题) → 评 → 结束，断言会话状态与停止条件。
// 不触碰真实网络/模型：runtimeOverride 注入脚本化 streamFn 与占位 model。

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
import type { StreamFn, BeforeToolCallContext, ShouldStopAfterTurnContext } from '@earendil-works/pi-agent-core';
import type { LLMProvider } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { ProviderEntry } from '../schemas/ai-config';
import type { Question } from '../schemas/question';
import { emptyProfile } from '../domain/learner';
import { createInterviewAgent, shouldStopAfterTurn, beforeToolCall, MAX_AGENT_QUESTIONS } from './interviewAgent';
import { createAgentSession } from './types';
import type { InterviewAgentSession } from './types';

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
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

/** 按调用顺序返回预设的 assistant 响应，驱动多轮 loop。 */
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

function fakeProvider(): LLMProvider {
  return {
    name: 'fake',
    generateVariant: vi.fn(async () => ({ question: 'x' })),
    evaluateOpenAnswer: vi.fn(async (): Promise<EvaluationResult> => ({
      overall: 50,
      dimensions: { correctness: 50, completeness: 50, architecture: 50, communication: 50 },
      strengths: ['答到要点'],
      gaps: ['未展开推理成本'],
      feedback: '基本正确。',
    })),
  };
}

const VALID_ENTRY: ProviderEntry = { id: 'local', model: 'fake', apiKey: '' };

// 脚本化响应：开场选 q1 并提问（2 条）；随后选择题回合走确定性快路径（不消费 LLM）；
// 开放题回合由 LLM 评估并结束（2 条）。共 4 条，与确定性选择题快路径对齐。
function scriptedResponses(): AssistantMessage[] {
  return [
    makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-choice-1' } }], 'toolUse'),
    makeMsg([{ type: 'text', text: '请回答：Transformer 中 multi-head attention 的作用？' }], 'stop'),
    makeMsg([{ type: 'toolCall', id: 'c4', name: 'evaluateAnswer', arguments: {} }], 'toolUse'),
    makeMsg([{ type: 'toolCall', id: 'c5', name: 'finishInterview', arguments: {} }], 'toolUse'),
  ];
}

describe('shouldStopAfterTurn', () => {
  it('finishInterview 被调用时停止', () => {
    const session = createAgentSession();
    const ctx = {
      toolResults: [{ toolName: 'finishInterview', role: 'toolResult', toolCallId: 'x', content: [], isError: false, timestamp: 0 }],
    } as unknown as ShouldStopAfterTurnContext;
    expect(shouldStopAfterTurn(session, ctx)).toBe(true);
  });

  it('空 toolResults 且不达上限时不停止', () => {
    const session = createAgentSession();
    const ctx = { toolResults: [] } as unknown as ShouldStopAfterTurnContext;
    expect(shouldStopAfterTurn(session, ctx)).toBe(false);
  });

  it(`已评题数达 ${MAX_AGENT_QUESTIONS} 时停止`, () => {
    const session = createAgentSession();
    for (let i = 0; i < MAX_AGENT_QUESTIONS; i++) session.evaluations[`q${i}`] = null;
    const ctx = { toolResults: [] } as unknown as ShouldStopAfterTurnContext;
    expect(shouldStopAfterTurn(session, ctx)).toBe(true);
  });
});

describe('beforeToolCall', () => {
  it('开放题评估在无有效引擎配置时被拦截', () => {
    const entry: ProviderEntry = { id: 'local', model: '', apiKey: '' }; // local 需要 model，故无效
    const session: InterviewAgentSession = createAgentSession();
    session.currentQuestion = { question: openQuestion(), format: 'open' };
    const ctx = {
      toolCall: { type: 'toolCall', id: 'x', name: 'evaluateAnswer', arguments: {} },
    } as unknown as BeforeToolCallContext;
    const r = beforeToolCall(entry, session, ctx);
    expect(r?.block).toBe(true);
  });

  it('选择题评估不被拦截（确定性判分无需 LLM）', () => {
    const session: InterviewAgentSession = createAgentSession();
    session.currentQuestion = { question: choiceQuestion(), format: 'choice' };
    const ctx = {
      toolCall: { type: 'toolCall', id: 'x', name: 'evaluateAnswer', arguments: {} },
    } as unknown as BeforeToolCallContext;
    const r = beforeToolCall(VALID_ENTRY, session, ctx);
    expect(r).toBeUndefined();
  });
});

describe('createInterviewAgent 完整 loop', () => {
  it('选 → 评 → 追问 → 评 → 结束，会话状态正确', async () => {
    const bank = [choiceQuestion(), openQuestion()];
    const provider = fakeProvider();
    const session = createAgentSession();
    const streamFn = makeMockStreamFn(scriptedResponses());

    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider,
      generateOpenQuestions: true, // 测试场景需开放题：显式开启，不依赖默认（全局默认 false）
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
    });

    // 开场：Agent 选 q1 并提问
    await handle.start('请开始一次 AI 面试。');
    expect(session.currentQuestion?.question.id).toBe('q-choice-1');

    // 用户作答（选择题，选对）→ Agent 评估 → 追问选 q2
    await handle.submitAnswer([0]);
    expect(session.evaluations['q-choice-1']).toBeDefined();
    expect(session.evaluations['q-choice-1']!.overall).toBe(100);
    expect(session.evaluations['q-choice-1']!.gaps).toEqual([]); // 选择题 gap 契约
    expect(session.currentQuestion?.question.id).toBe('q-open-1');

    // 用户作答（开放题）→ Agent 评估 → 结束
    await handle.submitAnswer('RAG 检索外部知识来回答，fine-tuning 更新模型参数。');
    expect(session.status).toBe('finished');
    expect(session.evaluations['q-open-1']).toBeDefined();
    expect(session.evaluations['q-open-1']!.overall).toBe(50); // 委托 fake provider
    expect(Object.keys(session.evaluations).length).toBe(2);
  });

  it('Agent 首轮文本收尾未选题 → 确定性兜底交付首题（修复 A/C）', async () => {
    const bank = [choiceQuestion()]; // 单题题库：兜底必选 q-choice-1（避免随机性）
    const provider = fakeProvider();
    const session = createAgentSession();
    // LLM 只回了一句文本，没有调用 getQuestion → 历史上会卡在「选题中」
    const streamFn = makeMockStreamFn([makeMsg([{ type: 'text', text: '我先看看你的薄弱点…' }], 'stop')]);

    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider,
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
    });

    await handle.start('请开始一次 AI 面试。');
    // 兜底应已交付一道来自题库的题，而非无限「选题中」
    expect(session.currentQuestion?.question.id).toBe('q-choice-1');
    // 兜底接管后，自驱评估当前题（选择题确定性判分）
    await handle.submitAnswer([0]);
    expect(session.evaluations['q-choice-1']).toBeDefined();
    expect(session.evaluations['q-choice-1']!.overall).toBe(100);
    // 题库已空 → 兜底优雅收尾（无更多题可出）
    expect(Object.keys(session.evaluations).length).toBe(1);
  });

  it('Agent 中段 stall（评完 q1 却不再选 q2）→ 兜底补出 q2（修复 A/C）', async () => {
    const bank = [choiceQuestion(), openQuestion()];
    const provider = fakeProvider();
    const session = createAgentSession();
    // 选 q1 → 文本 → 评 q1 → 文本收尾（不调 getQuestion q2）
    const streamFn = makeMockStreamFn([
      makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-choice-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '请回答。' }], 'stop'),
      makeMsg([{ type: 'toolCall', id: 'c2', name: 'evaluateAnswer', arguments: {} }], 'toolUse'),
      makeMsg([{ type: 'text', text: '好的。' }], 'stop'),
    ]);

    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider,
      generateOpenQuestions: true, // 测试场景需开放题：显式开启，不依赖默认（全局默认 false）
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
    });

    await handle.start('请开始一次 AI 面试。');
    expect(session.currentQuestion?.question.id).toBe('q-choice-1');

    await handle.submitAnswer([0]);
    // q1 已评，且兜底补出了 q2（q-open-1），而非卡死
    expect(session.evaluations['q-choice-1']!.overall).toBe(100);
    expect(session.currentQuestion?.question.id).toBe('q-open-1');
  });
});
