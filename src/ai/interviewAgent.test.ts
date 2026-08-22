// InterviewAgent 测试：LLM 一律 mock（不发真实网络请求）。
// - 纯函数：buildEvalUser（提示词包含题目/参考答案/rubric/required 要点）
//   parseEvaluation（JSON 解析、缺 overall 时按权重聚合、空回答归零）
// - 集成：用 mock streamFn（text_delta + done 事件）驱动真实的 pi-agent-core Agent，
//   验证订阅回调把流式 delta 拼成完整文本，再经 parseEvaluation 得到结构化结果。

import { describe, it, expect } from 'vitest';
import { buildEvalUser, InterviewAgent, parseEvaluation } from './interviewAgent';
import type { OpenQuestion, ScoringRubric } from '../types';

const RUBRIC: ScoringRubric = {
  correctness: 0.4,
  completeness: 0.2,
  architecture: 0.2,
  communication: 0.2,
};

const q: OpenQuestion = {
  id: 'agentic-07',
  category: 'agentic-ai',
  topic: 'system-design',
  tags: [],
  difficulty: 'hard',
  type: 'essay',
  question: '请设计一个 agentic RAG 系统',
  referenceAnswer: '规划器 + 检索器 + 工具层 + 记忆 + 评审',
  explanation: '',
  rubric: {
    required: ['规划器', '检索器'],
    dimensions: { architecture: 0.35 },
  },
};

function makeAssistantMessage(text: string): unknown {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai',
    provider: 'openai',
    model: 'mock',
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

describe('buildEvalUser', () => {
  it('包含题目、参考答案、回答、维度说明与 required 要点', () => {
    const u = buildEvalUser(q, '我的回答', {
      rubric: RUBRIC,
      requiredPoints: q.rubric?.required,
    });
    expect(u).toContain('请设计一个 agentic RAG 系统');
    expect(u).toContain('参考答案');
    expect(u).toContain('我的回答');
    expect(u).toContain('规划器');
    expect(u).toContain('architecture');
    expect(u).toContain('correctness');
  });

  it('空回答标记为未作答', () => {
    const u = buildEvalUser(q, '   ', { rubric: RUBRIC });
    expect(u).toContain('未作答');
  });
});

describe('parseEvaluation', () => {
  it('解析四维分 + overall + 亮点/遗漏', () => {
    const raw = JSON.stringify({
      correctness: 80,
      completeness: 70,
      architecture: 60,
      communication: 90,
      overall: 75,
      feedback: '不错',
      strengths: ['提到规划器'],
      gaps: ['缺少失败重试'],
    });
    const r = parseEvaluation(raw, q, RUBRIC);
    expect(r.dimensions.correctness).toBe(80);
    expect(r.dimensions.architecture).toBe(60);
    expect(r.overall).toBe(75);
    expect(r.strengths).toEqual(['提到规划器']);
    expect(r.feedback).toBe('不错');
  });

  it('容忍 Markdown 代码块包裹', () => {
    const raw = '```json\n{"correctness": 90, "overall": 90}\n```';
    const r = parseEvaluation(raw, q, RUBRIC);
    expect(r.dimensions.correctness).toBe(90);
  });

  it('缺 overall 时按权重聚合四维', () => {
    const raw = JSON.stringify({
      correctness: 100,
      completeness: 50,
      architecture: 50,
      communication: 50,
    });
    const r = parseEvaluation(raw, q, RUBRIC);
    expect(r.overall).toBe(70); // 100*0.4 + 50*0.2*3
  });

  it('数值非法时钳制到 [0,100]', () => {
    const raw = JSON.stringify({ correctness: -5, completeness: 999, architecture: 0, communication: 0 });
    const r = parseEvaluation(raw, q, RUBRIC);
    expect(r.dimensions.correctness).toBe(0);
    expect(r.dimensions.completeness).toBe(100);
  });

  it('空输出 → 全零 + 未作答反馈', () => {
    const r = parseEvaluation('', q, RUBRIC);
    expect(r.overall).toBe(0);
    expect(r.dimensions.correctness).toBe(0);
    expect(r.feedback).toBe('未作答。');
  });

  it('referenceAnswer 始终来自原题', () => {
    const r = parseEvaluation('{"correctness": 80}', q, RUBRIC);
    expect(r.referenceAnswer).toBe(q.referenceAnswer);
  });
});

describe('InterviewAgent.evaluate（真实 Agent + mock streamFn，无网络）', () => {
  it('把流式 text_delta 拼成完整文本并解析为结构化评估', async () => {
    const json = JSON.stringify({
      correctness: 80,
      completeness: 70,
      architecture: 60,
      communication: 90,
      overall: 75,
      feedback: 'ok',
      strengths: ['s'],
      gaps: ['g'],
    });
    const text = '```json\n' + json + '\n```';

    // 按 pi-ai AssistantMessageEvent 协议产出 start → text_delta → done
    const streamFn = async function* () {
      yield { type: 'start', partial: makeAssistantMessage('') };
      yield {
        type: 'text_delta',
        contentIndex: 0,
        delta: text,
        partial: makeAssistantMessage(text),
      };
      yield { type: 'done', reason: 'stop', message: makeAssistantMessage(text) };
    };

    const agent = new InterviewAgent({} as never, streamFn as never);
    let streamed = '';
    const r = await agent.evaluate(q, '回答内容', { onDelta: (t) => (streamed += t) });

    expect(streamed).toContain('correctness');
    expect(r.overall).toBe(75);
    expect(r.dimensions.architecture).toBe(60);
    expect(r.feedback).toBe('ok');
  });

  it('空回答不调用 LLM，直接返回全零', async () => {
    const streamFn = async function* () {
      throw new Error('不应调用 LLM');
    };
    const agent = new InterviewAgent({} as never, streamFn as never);
    const r = await agent.evaluate(q, '  ', { rubric: RUBRIC });
    expect(r.overall).toBe(0);
    expect(r.dimensions.correctness).toBe(0);
  });
});
