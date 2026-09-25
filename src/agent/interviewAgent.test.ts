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
import type { StreamFn, BeforeToolCallContext, AgentTurnContext } from '@earendil-works/pi-agent-core';
import type { LLMProvider } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { ProviderEntry } from '../schemas/ai-config';
import type { Question } from '../schemas/question';
import { emptyProfile } from '../domain/learner';
import {
  clampAnswer,
  createInterviewAgent,
  shouldStopAfterTurn,
  beforeToolCall,
  MAX_AGENT_QUESTIONS,
  MAX_ANSWER_CHARS,
} from './interviewAgent';
import { countDelivered, countScored, createAgentSession } from './types';
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
    } as unknown as AgentTurnContext;
    expect(shouldStopAfterTurn(session, ctx)).toBe(true);
  });

  it('空 toolResults 且不达上限时不停止', () => {
    const session = createAgentSession();
    const ctx = { toolResults: [] } as unknown as AgentTurnContext;
    expect(shouldStopAfterTurn(session, ctx)).toBe(false);
  });

  it(`已交付题数达 ${MAX_AGENT_QUESTIONS} 时停止（含评分失败记为 null 的题）`, () => {
    const session = createAgentSession();
    // 全部评分失败（键值为 null）也必须计入上限，否则面试永远停不下来
    for (let i = 0; i < MAX_AGENT_QUESTIONS; i++) session.evaluations[`q${i}`] = null;
    const ctx = { toolResults: [] } as unknown as AgentTurnContext;
    expect(shouldStopAfterTurn(session, ctx)).toBe(true);
  });
});

describe('clampAnswer（答案长度上限）', () => {
  it('短答案原样返回', () => {
    expect(clampAnswer('这是一个正常长度的回答。')).toBe('这是一个正常长度的回答。');
  });

  it('超长答案被截断，并保留截断标记', () => {
    const long = 'x'.repeat(MAX_ANSWER_CHARS + 500);
    const out = clampAnswer(long) as string;
    expect(out.length).toBeLessThan(long.length);
    expect(out.startsWith('x'.repeat(MAX_ANSWER_CHARS))).toBe(true);
    expect(out).toContain('已截断');
  });

  it('恰好等于上限时不截断', () => {
    const exact = 'y'.repeat(MAX_ANSWER_CHARS);
    expect(clampAnswer(exact)).toBe(exact);
  });

  it('选择题答案（数组）不受影响', () => {
    expect(clampAnswer([0, 2])).toEqual([0, 2]);
  });
});

describe('countDelivered / countScored 语义分离', () => {
  const scoredResult = (overall: number) =>
    ({
      overall,
      dimensions: { correctness: overall, completeness: overall, architecture: overall, communication: overall },
      levels: { correctness: 4, completeness: 4, architecture: 4, communication: 4 },
      evidence: { correctness: '', completeness: '', architecture: '', communication: '' },
      strengths: [],
      gaps: [],
      missingConcepts: [],
      feedback: '',
      referenceAnswer: '',
    }) as unknown as EvaluationResult;

  it('null 计入已交付、但不计入已评分', () => {
    const session = createAgentSession();
    session.evaluations['q1'] = scoredResult(100);
    session.evaluations['q2'] = null; // 评分失败
    expect(countDelivered(session)).toBe(2);
    expect(countScored(session)).toBe(1);
  });

  it('全为 null 时：已交付非 0、已评分为 0（null 不计入成绩）', () => {
    const session = createAgentSession();
    session.evaluations['q1'] = null;
    session.evaluations['q2'] = null;
    expect(countDelivered(session)).toBe(2);
    expect(countScored(session)).toBe(0);
  });

  it('空会话两者均为 0', () => {
    const session = createAgentSession();
    expect(countDelivered(session)).toBe(0);
    expect(countScored(session)).toBe(0);
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
    // 兜底 telemetry（P1 第 4 项）：首次兜底记录原因与次数，且原因应为 agent_no_action
    expect(session.fallbackReason).toBe('agent_no_action');
    expect(session.fallbackCount).toBe(1);
    expect(session.log.some((e) => e.kind === 'event' && e.summary.startsWith('兜底出题接管'))).toBe(true);
    // 兜底接管后，自驱评估当前题（选择题确定性判分）
    await handle.submitAnswer([0]);
    expect(session.evaluations['q-choice-1']).toBeDefined();
    expect(session.evaluations['q-choice-1']!.overall).toBe(100);
    // 题库已空 → 兜底优雅收尾（无更多题可出）
    expect(Object.keys(session.evaluations).length).toBe(1);
  });

  it('模型流式报错 → 兜底原因记为 model_error（而非恒为 agent_no_action）', async () => {
    const bank = [choiceQuestion()];
    const provider = fakeProvider();
    const session = createAgentSession();
    const errors: string[] = [];
    // LLM 流式返回错误：既没选题也没显式结束 → 走 agent_end 兜底分支
    const errMsg: AssistantMessage = {
      ...makeMsg([{ type: 'text', text: '' }], 'error'),
      errorMessage: 'upstream 500',
    };
    const streamFn = makeMockStreamFn([errMsg]);

    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider,
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
      handlers: { onError: (m) => errors.push(m) },
    });

    await handle.start('请开始一次 AI 面试。');
    // 回归重点：修复前 lastErrorMessage 在 onError 后被清空，
    // 导致 ensureQuestionDelivered 永远收到 'agent_no_action'，model_error 从不入账。
    expect(session.fallbackReason).toBe('model_error');
    expect(session.fallbackCount).toBe(1);
    expect(errors.some((m) => m.includes('upstream 500'))).toBe(true);
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

// ── 逐题反馈（immediate 模式）：暂停 / 继续 ──────────────────────────────
// 这是本特性的核心契约：immediate 下「评分」与「推进下一题」必须解耦。
// 关键验证点：暂停期间 currentQuestion 不得被换掉（否则用户看不到刚答的题），
// 且暂停必须靠 finishTurn 的**优雅收尾**实现（不得走 abort —— 那会被记为 model_error）。
describe('immediate 模式：评分后暂停、确认后继续', () => {
  it('开放题（LLM 路径）：评分后停在反馈上，同轮的 getQuestion 被闸住；继续后才出下一题', async () => {
    const bank = [openQuestion(), choiceQuestion()];
    const provider = fakeProvider();
    const session = createAgentSession('immediate');
    const seen: Array<{ id: string; overall: number }> = [];
    const statuses: string[] = [];
    const errors: string[] = [];
    const streamFn = makeMockStreamFn([
      // 开场：选开放题
      makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-open-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '请作答。' }], 'stop'),
      // 提交后：先评估，再在同一轮里**试图**出下一题 —— 必须被暂停闸拦住
      makeMsg(
        [
          { type: 'toolCall', id: 'c2', name: 'evaluateAnswer', arguments: {} },
          { type: 'toolCall', id: 'c3', name: 'getQuestion', arguments: { id: 'q-choice-1' } },
        ],
        'toolUse',
      ),
      makeMsg([{ type: 'text', text: '评估完成。' }], 'stop'),
      // 用户点「继续」后：Agent 决定下一题
      makeMsg([{ type: 'toolCall', id: 'c4', name: 'getQuestion', arguments: { id: 'q-choice-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '下一题。' }], 'stop'),
    ]);

    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider,
      generateOpenQuestions: true,
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
      handlers: {
        onEvaluation: (q, _a, ev) => seen.push({ id: q.question.id, overall: ev.overall }),
        onStatus: (s) => statuses.push(s),
        onError: (m) => errors.push(m),
      },
    });

    await handle.start('请开始一次 AI 面试。');
    expect(session.currentQuestion?.question.id).toBe('q-open-1');

    await handle.submitAnswer('RAG 检索外部知识，fine-tuning 更新参数。');

    // 1) 已评分，且反馈回调已触发
    expect(session.evaluations['q-open-1']!.overall).toBe(50);
    expect(seen).toEqual([{ id: 'q-open-1', overall: 50 }]);
    // 2) 停在反馈上，**没有**推进到下一题（这是暂停的核心断言）
    expect(session.status).toBe('awaiting_feedback');
    expect(session.currentQuestion?.question.id).toBe('q-open-1');
    expect(session.evaluations['q-choice-1']).toBeUndefined();
    // 3) 状态回调可驱动 UI 切到反馈卡
    expect(statuses).toContain('awaiting_feedback');
    // 4) 优雅收尾，不得被记为模型错误（abort 会污染 model_error telemetry）
    expect(errors).toEqual([]);
    expect(session.fallbackReason).toBeUndefined();
    expect(session.fallbackCount).toBe(0);

    // 5) 用户确认继续 → 回到 running，由 Agent 决定下一题
    await handle.continueAfterFeedback();
    expect(session.status).toBe('running');
    expect(session.currentQuestion?.question.id).toBe('q-choice-1');
    expect(statuses).toContain('running');

    // 6) 幂等：非暂停态再调一次不得重复推进
    await handle.continueAfterFeedback();
    expect(session.currentQuestion?.question.id).toBe('q-choice-1');

    handle.dispose();
  });

  it('选择题（确定性路径）：评分后暂停且不换题；继续后交付下一题（题库仅一题则收尾）', async () => {
    const bank = [choiceQuestion()];
    const session = createAgentSession('immediate');
    const streamFn = makeMockStreamFn([
      makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-choice-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '请作答。' }], 'stop'),
    ]);
    const statuses: string[] = [];
    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider: fakeProvider(),
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
      handlers: { onStatus: (s) => statuses.push(s) },
    });

    await handle.start('请开始一次 AI 面试。');
    expect(session.currentQuestion?.question.id).toBe('q-choice-1');

    await handle.submitAnswer([0]);
    expect(session.evaluations['q-choice-1']!.overall).toBe(100);
    expect(session.status).toBe('awaiting_feedback');
    // 选择题判分是确定性的，暂停期间**不得**换题
    expect(session.currentQuestion?.question.id).toBe('q-choice-1');
    expect(statuses).toContain('awaiting_feedback');

    await handle.continueAfterFeedback();
    // 题库只有一题 → 确定性路径优雅收尾。
    // 注意：运行时只通过 onStatus('finished') 通知收尾，**不**自行改写 session.status
    // （终局由 UI 层 finalize() 落定，这是既有契约，见 useAgentInterview）。
    expect(statuses).toContain('finished');
    expect(statuses).toContain('awaiting_feedback'); // immediate：确实经历过暂停
    expect(session.currentQuestion?.question.id).toBe('q-choice-1');

    handle.dispose();
  });

  it('standard 模式（默认）：评分后直接推进，绝不进入 awaiting_feedback', async () => {
    const bank = [choiceQuestion()];
    const session = createAgentSession(); // 缺省 standard
    const streamFn = makeMockStreamFn([
      makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-choice-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '请作答。' }], 'stop'),
    ]);
    const statuses: string[] = [];
    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider: fakeProvider(),
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
      handlers: { onStatus: (s) => statuses.push(s) },
    });

    await handle.start('请开始一次 AI 面试。');
    await handle.submitAnswer([0]);

    expect(session.feedbackMode).toBe('standard');
    expect(statuses).not.toContain('awaiting_feedback');
    // 单题题库 → 评分后直接通知收尾，与改动前行为完全一致
    expect(statuses).toContain('finished');
    // 且全程没有产生「暂停后需要继续」的中间态
    expect(session.evaluations['q-choice-1']!.overall).toBe(100);

    handle.dispose();
  });

  it('评分失败（evaluation=null）：不得伪造反馈、不得暂停', async () => {
    const bank = [openQuestion(), choiceQuestion()];
    // 开放题评分抛错 → evaluateSessionQuestion 兜底为 null
    const provider = fakeProvider();
    provider.evaluateOpenAnswer = vi.fn(async () => {
      throw new Error('引擎不可用');
    });
    const session = createAgentSession('immediate');
    const seen: string[] = [];
    const streamFn = makeMockStreamFn([
      makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-open-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '请作答。' }], 'stop'),
      makeMsg([{ type: 'toolCall', id: 'c2', name: 'evaluateAnswer', arguments: {} }], 'toolUse'),
      makeMsg([{ type: 'text', text: '无法评估。' }], 'stop'),
    ]);
    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider,
      generateOpenQuestions: true,
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
      handlers: { onEvaluation: (q) => seen.push(q.question.id) },
    });

    await handle.start('请开始一次 AI 面试。');
    await handle.submitAnswer('随便答一句。');

    // 评分失败：记为 null（不计入成绩），且**不**产生反馈、**不**暂停
    expect(session.evaluations['q-open-1']).toBeNull();
    expect(seen).toEqual([]);
    expect(session.status).not.toBe('awaiting_feedback');

    handle.dispose();
  });

  // ── onEvaluation 的 awaitingFeedback 标志（P0 回归）──
  // standard 模式**也会**评分，故 onEvaluation 必然触发。UI 若拿「回调触发」当「已暂停」，
  // 就会在「评分完成 → 下一题交付」的窗口里错误弹出反馈卡（开放题下窗口长达数秒）。
  // 因此运行时必须显式告诉消费方「这次评分后是否停下」，且**标志与 status 必须同源**
  // ——不能出现「标志说没暂停、status 却是 awaiting_feedback」。两种模式共用这一条不变式。
  it.each([
    ['standard', false, 'running'],
    ['immediate', true, 'awaiting_feedback'],
  ] as const)('%s 模式：onEvaluation 携带 awaitingFeedback=%s，回调时 status=%s', async (mode, awaiting, status) => {
    const bank = [openQuestion(), choiceQuestion()];
    const session = createAgentSession(mode);
    const flags: boolean[] = [];
    const statusAtCallback: string[] = [];
    const streamFn = makeMockStreamFn([
      makeMsg([{ type: 'toolCall', id: 'c1', name: 'getQuestion', arguments: { id: 'q-open-1' } }], 'toolUse'),
      makeMsg([{ type: 'text', text: '请作答。' }], 'stop'),
      makeMsg([{ type: 'toolCall', id: 'c2', name: 'evaluateAnswer', arguments: {} }], 'toolUse'),
      makeMsg([{ type: 'text', text: '评估完成。' }], 'stop'),
      // standard 不停：继续交付下一题，这正是「回调已触发但还没暂停」的窗口。
      ...(awaiting
        ? []
        : [
            makeMsg([{ type: 'toolCall', id: 'c3', name: 'getQuestion', arguments: { id: 'q-choice-1' } }], 'toolUse'),
            makeMsg([{ type: 'text', text: '下一题。' }], 'stop'),
          ]),
    ]);
    const handle = createInterviewAgent({
      session,
      profile: emptyProfile(),
      entry: VALID_ENTRY,
      bank,
      provider: fakeProvider(),
      generateOpenQuestions: true,
      runtimeOverride: { streamFn, model: { id: 'mock' } as any },
      handlers: {
        onEvaluation: (_q, _a, _ev, awaitingFeedback) => {
          flags.push(awaitingFeedback);
          statusAtCallback.push(session.status);
        },
      },
    });

    await handle.start('请开始一次 AI 面试。');
    await handle.submitAnswer('RAG 检索外部知识。');

    expect(flags).toEqual([awaiting]);
    expect(statusAtCallback).toEqual([status]);

    handle.dispose();
  });
});
