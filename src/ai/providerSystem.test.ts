// 评分 / 变体协议不可变测试（ADR-036 安全模型）：
// 用户配置只允许 `agentInstructions`（偏好层）与 `agentOpening`，绝不能覆盖评分协议（EVAL_SYSTEM）
// 与题库完整性协议（VARIANT_SYSTEM）。本测试 mock 底层 one-shot 补全，校验传入的 system 参数
// 始终是内置不可变常量，而非任何用户内容。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAIProvider, ChromeAIProvider } from './provider';
import { EVAL_SYSTEM } from './evaluate';
import { VARIANT_SYSTEM } from './variant';
import { callLLM } from './pi';
import { chromeComplete } from './chrome';
import type { ProviderEntry } from '../schemas/ai-config';
import type { OpenFormat, Question } from '../schemas/question';
import type { ScoringRubric } from '../schemas/interview';

// 用 mock 替换底层补全，捕获 system 参数。注意：这会让整个文件里的 callLLM/chromeComplete 都走 mock——
// 与 provider.test.ts 的 P0-2（依赖真实 fetch）隔离，故独立成文件。
// 用 partial mock 保留 extractJSON 等其余导出，仅替换补全函数。
vi.mock('./pi', async () => {
  const actual = await vi.importActual<typeof import('./pi')>('./pi');
  return { ...actual, callLLM: vi.fn() };
});
vi.mock('./chrome', async () => {
  const actual = await vi.importActual<typeof import('./chrome')>('./chrome');
  return { ...actual, chromeComplete: vi.fn() };
});

const GLOBAL: ScoringRubric = { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 };
const OPEN_FMT: OpenFormat = { referenceAnswer: 'a' };

// 每个用例前清空 mock 调用记录，避免跨用例累积（否则 calls[0] 会是上一个用例的调用）。
beforeEach(() => {
  vi.clearAllMocks();
});

function q(topic = 'memory'): Question {
  return {
    id: 'q1',
    category: 'agentic-ai',
    topic,
    tags: [],
    difficulty: 'medium',
    question: 'q',
    explanation: '',
    formats: {},
  };
}

function entry(partial: Partial<ProviderEntry>): ProviderEntry {
  return { id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: '', ...partial };
}

function mockEval(level = 4): string {
  const dim = { level, evidence: 'ok' };
  return JSON.stringify({
    correctness: dim,
    completeness: dim,
    architecture: dim,
    communication: dim,
    feedback: 'good',
  });
}

describe('评分协议不可变（EVAL_SYSTEM）', () => {
  it('PiAIProvider.evaluateOpenAnswer 以不可变 EVAL_SYSTEM 调用 callLLM（不读任何用户 system）', async () => {
    vi.mocked(callLLM).mockResolvedValue(mockEval());
    const p = new PiAIProvider(entry({ id: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-x' }));
    await p.evaluateOpenAnswer(q(), OPEN_FMT, 'some answer', GLOBAL);
    expect(callLLM).toHaveBeenCalled();
    // callLLM 签名：(entry, system, user, options) —— system 是第 2 个参数
    const systemArg = vi.mocked(callLLM).mock.calls[0][1];
    expect(systemArg).toBe(EVAL_SYSTEM);
  });

  it('ChromeAIProvider.evaluateOpenAnswer 同样以不可变 EVAL_SYSTEM 调用 chromeComplete', async () => {
    vi.mocked(chromeComplete).mockResolvedValue(mockEval(3));
    const p = new ChromeAIProvider();
    await p.evaluateOpenAnswer(q(), OPEN_FMT, 'some answer', GLOBAL);
    expect(chromeComplete).toHaveBeenCalled();
    const systemArg = vi.mocked(chromeComplete).mock.calls[0][0];
    expect(systemArg).toBe(EVAL_SYSTEM);
  });
});

describe('变体协议不可变（VARIANT_SYSTEM）', () => {
  // 用无知识点节点的 topic，使变体校验不被 requiredCoverage 卡住；题干含 topic 即可通过最小证据校验。
  const variantJson = JSON.stringify({ question: 'Explain linear-regression and its key assumptions in detail.' });

  it('PiAIProvider.generateVariant 以不可变 VARIANT_SYSTEM 调用 callLLM', async () => {
    vi.mocked(callLLM).mockResolvedValue(variantJson);
    const p = new PiAIProvider(entry({ id: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-x' }));
    await p.generateVariant(q('linear-regression'), 'open');
    expect(callLLM).toHaveBeenCalled();
    const systemArg = vi.mocked(callLLM).mock.calls[0][1];
    expect(systemArg).toBe(VARIANT_SYSTEM);
  });

  it('ChromeAIProvider.generateVariant 同样以不可变 VARIANT_SYSTEM 调用 chromeComplete', async () => {
    vi.mocked(chromeComplete).mockResolvedValue(variantJson);
    const p = new ChromeAIProvider();
    await p.generateVariant(q('linear-regression'), 'open');
    expect(chromeComplete).toHaveBeenCalled();
    const systemArg = vi.mocked(chromeComplete).mock.calls[0][0];
    expect(systemArg).toBe(VARIANT_SYSTEM);
  });
});
