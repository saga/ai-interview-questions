// Chrome Agent 运行时测试：mock globalThis.LanguageModel，不发任何真实调用。
// 覆盖：① 模型返回合法 JSON 工具调用 → 转换为 toolcall 事件流 + done(toolUse)；
//       ② 模型返回非 JSON 文本 → 退化为文本消息 done(stop)；
//       ③ chrome 不可用时（抛出）→ 编码为 error 事件而非拒绝；
//       ④ 工具名不在允许集合 → 回落为文本；⑤ 占位 model 字段。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChromeAgentRuntime } from './chromeAgent';
import type { Context, Tool } from '@earendil-works/pi-ai';

function stubLanguageModel(reply: string, opts?: { createThrows?: boolean }) {
  const lm = {
    availability: async () => 'available',
    create: opts?.createThrows
      ? async () => {
          throw new Error('boom');
        }
      : async () => ({
          // clone 返回独立克隆 session（prompt 行为同基准），供 ChromeAIExecutor 使用
          clone: async () => ({ prompt: vi.fn(async () => reply), destroy: vi.fn() }),
          prompt: vi.fn(async () => reply),
          destroy: vi.fn(),
        }),
  };
  (globalThis as { LanguageModel?: unknown }).LanguageModel = lm;
  return lm;
}

afterEach(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
});

const SAMPLE_TOOL: Tool = {
  name: 'getQuestion',
  description: '获取下一题',
  // 仅用于注入提示词；不依赖真实 TypeBox 校验
  parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } as Tool['parameters'],
};

function makeContext(replyTool = 'getQuestion'): Context {
  return {
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: '开始面试', timestamp: Date.now() }],
    tools: [SAMPLE_TOOL, { ...SAMPLE_TOOL, name: 'finishInterview', description: '结束' }],
  };
}

async function collect(stream: AsyncIterable<unknown>): Promise<any[]> {
  const events: any[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

describe('buildChromeAgentRuntime', () => {
  it('返回 chrome 占位 model', () => {
    const { model } = buildChromeAgentRuntime();
    expect(model.id).toBe('chrome-builtin');
    expect(model.provider).toBe('chrome');
  });

  it('把模型返回的 JSON 工具调用转换为 toolcall 事件流 + done(toolUse)', async () => {
    stubLanguageModel(JSON.stringify({ tool: 'getQuestion', args: { topic: 'react' } }));
    const { streamFn } = buildChromeAgentRuntime();
    const events = await collect(streamFn({} as any, makeContext()));
    const start = events.find((e) => e.type === 'start');
    const tcEnd = events.find((e) => e.type === 'toolcall_end');
    const done = events.find((e) => e.type === 'done');
    expect(start).toBeTruthy();
    expect(tcEnd).toBeTruthy();
    expect(tcEnd.toolCall.name).toBe('getQuestion');
    expect(tcEnd.toolCall.arguments).toEqual({ topic: 'react' });
    expect(done.reason).toBe('toolUse');
    expect(done.message.stopReason).toBe('toolUse');
    expect(done.message.content[0].name).toBe('getQuestion');
  });

  it('模型返回非 JSON 文本时以文本消息结束本轮（stop）', async () => {
    stubLanguageModel('抱歉，我暂时无法调用工具。');
    const { streamFn } = buildChromeAgentRuntime();
    const events = await collect(streamFn({} as any, makeContext()));
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeTruthy();
    expect(done.reason).toBe('stop');
  });

  it('工具名不在允许集合时回落为文本（stop）', async () => {
    stubLanguageModel(JSON.stringify({ tool: 'hackEverything', args: {} }));
    const { streamFn } = buildChromeAgentRuntime();
    const events = await collect(streamFn({} as any, makeContext()));
    const done = events.find((e) => e.type === 'done');
    expect(done.reason).toBe('stop');
  });

  it('chrome 不可用时（抛出）编码为 error 事件而非拒绝', async () => {
    stubLanguageModel('', { createThrows: true });
    const { streamFn } = buildChromeAgentRuntime();
    const events = await collect(streamFn({} as any, makeContext()));
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeTruthy();
    expect(err.reason).toBe('error');
    expect(err.error.errorMessage).toContain('boom');
  });
});
