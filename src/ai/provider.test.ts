// 纯逻辑测试：题目级 rubric 与全局 rubric 的合并 + 多引擎降级链 + 配置校验。
// ADR-013 / ARCHITECTURE「评分 Rubric」：required 注入提示词，dimensions 覆盖全局权重。
// ADR-023：多引擎降级链——按配置顺序尝试，失败自动切换下一个。

import { describe, expect, it, vi } from 'vitest';
import {
  ChromeAIProvider,
  FallbackProvider,
  PiAIProvider,
  createLLMProvider,
  isConfigValid,
  isEntryValid,
  mergeQuestionRubric,
} from './provider';
import type { LLMProvider } from '../types';
import type { AIConfig, ProviderEntry } from '../schemas/ai-config';
import type { OpenFormat, Question } from '../schemas/question';
import type { ScoringRubric } from '../schemas/interview';
import { knowledgeById } from '../domain/knowledge';

const GLOBAL: ScoringRubric = { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 };

const OPEN_FMT: OpenFormat = { referenceAnswer: 'a' };

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

describe('mergeQuestionRubric', () => {
  it('topic 无知识点节点时返回全局权重（required 为 undefined）', () => {
    expect(mergeQuestionRubric(q('linear-regression'), GLOBAL)).toEqual({
      rubric: GLOBAL,
      requiredPoints: undefined,
    });
  });

  it('requiredPoints 统一来自知识点节点的 required（ADR-029 回退，ADR-044 后为唯一来源）', () => {
    const { requiredPoints } = mergeQuestionRubric(q(), GLOBAL);
    expect(requiredPoints?.length ?? 0).toBeGreaterThan(0);
  });

  it('权重统一使用全局 rubric（题目级 dimensions 覆盖已移除，ADR-044）', () => {
    // 题目不再携带 rubric，无论传什么都应原样返回全局权重
    expect(mergeQuestionRubric(q(), GLOBAL).rubric).toEqual(GLOBAL);
    expect(mergeQuestionRubric(q(), GLOBAL).rubric).not.toBe(GLOBAL); // 返回副本，不共享引用
  });

  it('requiredPoints 统一来自知识点节点的 required（单一来源，ADR-044）', () => {
    const { requiredPoints } = mergeQuestionRubric(q(), GLOBAL);
    expect(requiredPoints).toEqual(knowledgeById('memory')?.required);
    expect(requiredPoints?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('isEntryValid（按引擎区分校验）', () => {
  it('chrome 引擎无需 apiKey/model 即有效', () => {
    expect(isEntryValid(entry({ id: 'chrome', model: '', apiKey: '' }))).toBe(true);
  });

  it('local 只要求 model id，apiKey 可选', () => {
    expect(isEntryValid(entry({ id: 'local', model: '', apiKey: '' }))).toBe(false);
    expect(isEntryValid(entry({ id: 'local', model: 'unsloth/Qwen3-8B', apiKey: '' }))).toBe(true);
  });

  it('云端引擎必须有 apiKey 与 model', () => {
    expect(isEntryValid({ id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: '' })).toBe(false);
    expect(isEntryValid({ id: 'deepseek', enabled: true, model: '', apiKey: 'sk-x' })).toBe(false);
    expect(isEntryValid({ id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x' })).toBe(true);
  });

  it('openrouter / google 与其他云端同一校验规则（apiKey + model）', () => {
    expect(isEntryValid(entry({ id: 'openrouter', model: '', apiKey: 'sk-or' }))).toBe(false);
    expect(isEntryValid(entry({ id: 'openrouter', model: 'anthropic/claude-haiku-4.5', apiKey: '' }))).toBe(false);
    expect(isEntryValid(entry({ id: 'openrouter', model: 'anthropic/claude-haiku-4.5', apiKey: 'sk-or' }))).toBe(true);
    expect(isEntryValid(entry({ id: 'google', model: 'gemini-2.5-flash', apiKey: 'AIza-x' }))).toBe(true);
  });

  it('cloudflare 需要 apiKey + model + accountId 三者齐全', () => {
    const cf = { id: 'cloudflare-workers-ai' as const, enabled: true };
    expect(isEntryValid({ ...cf, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', apiKey: 'tok', accountId: '' })).toBe(false);
    expect(isEntryValid({ ...cf, model: '', apiKey: 'tok', accountId: 'acc' })).toBe(false);
    expect(isEntryValid({ ...cf, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', apiKey: '', accountId: 'acc' })).toBe(false);
    expect(isEntryValid({ ...cf, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', apiKey: 'tok', accountId: 'acc' })).toBe(true);
  });

  it('缺 id 或整个对象时无效', () => {
    expect(isEntryValid(undefined as unknown as ProviderEntry)).toBe(false);
    expect(isEntryValid(entry({ id: '' as ProviderEntry['id'] }))).toBe(false);
  });
});

describe('isConfigValid（至少一个启用且合法的引擎）', () => {
  it('空链/全停用/全非法 → 无效', () => {
    expect(isConfigValid({ providers: [] })).toBe(false);
    expect(isConfigValid({ providers: [entry({ enabled: false })] })).toBe(false);
    expect(isConfigValid(undefined)).toBe(false);
  });

  it('存在启用且合法的引擎即有效（其余可停用）', () => {
    expect(
      isConfigValid({
        providers: [entry({ enabled: false }), entry({ id: 'chrome', model: '', apiKey: '' })],
      }),
    ).toBe(true);
  });
});

describe('createLLMProvider（工厂分派）', () => {
  it('单 chrome 引擎直接返回 ChromeAIProvider', () => {
    const p = createLLMProvider({ providers: [entry({ id: 'chrome', model: '', apiKey: '' })] });
    expect(p).toBeInstanceOf(ChromeAIProvider);
    expect(p?.name).toBe('chrome');
  });

  it('单云端引擎直接返回 PiAIProvider，name 携带引擎 id', () => {
    const p = createLLMProvider({ providers: [{ id: 'deepseek', enabled: true, model: 'deepseek-v4-flash', apiKey: 'sk-x' }] });
    expect(p).toBeInstanceOf(PiAIProvider);
    expect(p?.name).toBe('pi-ai(deepseek)');
  });

  it('本地 OpenAI 兼容服务也走 PiAIProvider（buildModels 内部路由，ADR-022）', () => {
    const p = createLLMProvider({ providers: [entry({ id: 'local', model: 'unsloth/Qwen3-8B' })] });
    expect(p).toBeInstanceOf(PiAIProvider);
  });

  it('google / cloudflare 等新云端引擎同样走 PiAIProvider 并可组成降级链', () => {
    const p = createLLMProvider({
      providers: [
        entry({ id: 'google', model: 'gemini-2.5-flash', apiKey: 'AIza-x' }),
        {
          id: 'cloudflare-workers-ai',
          enabled: true,
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          apiKey: 'tok',
          accountId: 'acc',
        },
        entry({ id: 'openrouter', model: 'anthropic/claude-haiku-4.5', apiKey: 'sk-or' }),
      ],
    });
    expect(p).toBeInstanceOf(FallbackProvider);
    expect(p?.name).toBe('pi-ai(google) → pi-ai(cloudflare-workers-ai) → pi-ai(openrouter)');
  });

  it('多引擎返回降级链，只包含启用且合法的通道', () => {
    const p = createLLMProvider({
      providers: [
        entry({ id: 'chrome', model: '', apiKey: '' }),
        entry({ model: 'deepseek-v4-flash', apiKey: 'sk-x' }),
        entry({ enabled: false }), // 停用，不进链
        entry({ id: 'local', model: '' }), // 非法，被剔除
      ],
    });
    expect(p).toBeInstanceOf(FallbackProvider);
    expect(p?.name).toBe('chrome → pi-ai(deepseek)');
  });

  it('无效配置返回 null（上层退化为原题/不评分）', () => {
    expect(createLLMProvider({ providers: [] })).toBeNull();
    expect(createLLMProvider(undefined)).toBeNull();
  });
});

describe('FallbackProvider（ADR-023 降级链核心语义）', () => {
  function fake(name: string, impl: () => Promise<unknown>): LLMProvider {
    return {
      name,
      generateVariant: impl as LLMProvider['generateVariant'],
      evaluateOpenAnswer: impl as LLMProvider['evaluateOpenAnswer'],
      challengeQuestion: impl as LLMProvider['challengeQuestion'],
    };
  }

  it('首个成功时不触达后续引擎', async () => {
    const second = vi.fn(async () => 'second');
    const chain = new FallbackProvider([fake('a', async () => 'first'), fake('b', second)]);
    await expect(chain.generateVariant(q())).resolves.toBe('first');
    expect(second).not.toHaveBeenCalled();
  });

  it('失败按顺序降级，最终返回首个成功结果', async () => {
    const chain = new FallbackProvider([
      fake('a', async () => {
        throw new Error('boom-a');
      }),
      fake('b', async () => {
        throw new Error('boom-b');
      }),
      fake('c', async () => 'ok'),
    ]);
    await expect(chain.generateVariant(q())).resolves.toBe('ok');
    expect(chain.name).toBe('a → b → c');
  });

  it('全部失败时抛出最后一个错误（不吞异常）', async () => {
    const chain = new FallbackProvider([
      fake('a', async () => {
        throw new Error('boom-a');
      }),
      fake('b', async () => {
        throw new Error('boom-b');
      }),
    ]);
    await expect(chain.evaluateOpenAnswer(q(), OPEN_FMT, 'ans', GLOBAL)).rejects.toThrow('boom-b');
  });

  it('空链调用抛错', async () => {
    const chain = new FallbackProvider([]);
    await expect(chain.generateVariant(q())).rejects.toThrow('所有已启用的 AI 引擎均不可用');
  });

  it('evaluateOpenAnswer 同样享受降级语义', async () => {
    const chain = new FallbackProvider([
      fake('a', async () => {
        throw new Error('down');
      }),
      fake('b', async () => ({ overall: 90 })),
    ]);
    await expect(chain.evaluateOpenAnswer(q(), OPEN_FMT, 'ans', GLOBAL)).resolves.toEqual({ overall: 90 });
  });

  it('challengeQuestion 同样享受降级语义', async () => {
    const expected = { verdict: 'accept', summary: 'ok', issues: [] };
    const chain = new FallbackProvider([
      fake('a', async () => {
        throw new Error('down');
      }),
      fake('b', async () => expected),
    ]);
    await expect(chain.challengeQuestion(q())).resolves.toEqual(expected);
  });

  it('P0-2：首个引擎 provider 错误（callLLM 抛错）时，FallbackProvider 真实降级到下一引擎', async () => {
    // 首个引擎用真实 PiAIProvider（local），fetch 返回 500 ⇒ callLLM 抛错；
    // 修复前 callLLM 静默返回空串，FallbackProvider 永不降级（永远是「第一个引擎返回空」）。
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })));
    const failing = new PiAIProvider(entry({ id: 'local', model: 'unsloth/Qwen3-8B', apiKey: '' }));
    const ok = fake('b', async () => 'degraded-ok');
    const chain = new FallbackProvider([failing, ok]);
    await expect(chain.generateVariant(q())).resolves.toBe('degraded-ok');
  });

});

describe('ChromeAIProvider（走注入的 chromeComplete，签名接线正确）', () => {
  it('evaluateOpenAnswer 复用同一套评分编排；未作答短路不触达 LLM', async () => {
    const p = new ChromeAIProvider();
    const result = await p.evaluateOpenAnswer(q(), OPEN_FMT, '', GLOBAL);
    expect(result.overall).toBe(0);
    expect(result.feedback).toBe('未作答。');
  });
});
