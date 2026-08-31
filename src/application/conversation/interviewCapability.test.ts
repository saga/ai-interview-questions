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
import { startChatInterview } from './interviewCapability';

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
});
