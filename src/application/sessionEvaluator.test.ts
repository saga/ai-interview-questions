import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../types';
import type { Question } from '../schemas/question';
import type { VariantPool, QuestionVariant } from '../schemas/variant';
import { computeVariantSourceHash, variantSourceOf } from '../schemas/variant';
import { DEFAULT_RUBRIC } from '../domain/evaluation';
import { resetUsageTelemetry, getVariantTelemetry, recordVariantRound } from '../ai/usageTelemetry';
import {
  effectiveFormats,
  evaluateSessionQuestion,
  finalizeQuestion,
  isAnswerEmpty,
} from './sessionEvaluator';

const choiceQuestion: Question = {
  id: 'choice-1',
  category: 'transformer',
  topic: 'attention',
  tags: [],
  difficulty: 'easy',
  angle: 'mechanism',
  question: 'q',
  explanation: '',
  formats: { choice: { type: 'single', options: ['缩放点积注意力以稳定梯度', '增大学习率以加速收敛'], answer: [0] } },
};

const openQuestion: Question = {
  id: 'open-1',
  category: 'transformer',
  topic: 'attention',
  tags: [],
  difficulty: 'medium',
  angle: 'mechanism',
  question: 'q',
  explanation: '',
  formats: { open: { referenceAnswer: 'reference' } },
};

const provider: LLMProvider = {
  name: 'test',
  generateVariant: vi.fn(),
  evaluateOpenAnswer: vi.fn(async (_question, _open, _answer, rubric) => ({
    overall: rubric.correctness * 100,
    dimensions: { correctness: 100, completeness: 0, architecture: 0, communication: 0 },
    strengths: [],
    gaps: [],
    feedback: '',
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sessionEvaluator', () => {
  it('选择题使用确定性判分', async () => {
    const result = await evaluateSessionQuestion({ question: choiceQuestion, format: 'choice' }, [0], null);
    expect(result?.overall).toBe(100);
  });

  it('开放题委托 provider，并支持 rubric 覆盖', async () => {
    const rubric = { ...DEFAULT_RUBRIC, correctness: 0.7 };
    const result = await evaluateSessionQuestion(
      { question: openQuestion, format: 'open' },
      'answer',
      provider,
      rubric,
      'criteria',
    );
    expect(result?.overall).toBe(70);
    expect(provider.evaluateOpenAnswer).toHaveBeenCalledWith(
      openQuestion,
      openQuestion.formats.open,
      'answer',
      rubric,
      'criteria',
    );
  });

  it('未作答返回 null，且不调用 provider', async () => {
    expect(isAnswerEmpty(undefined)).toBe(true);
    expect(isAnswerEmpty(null as never)).toBe(true);
    expect(isAnswerEmpty('   ')).toBe(true);
    expect(isAnswerEmpty([])).toBe(true);
    expect(await evaluateSessionQuestion({ question: openQuestion, format: 'open' }, '   ', provider)).toBeNull();
    expect(provider.evaluateOpenAnswer).not.toHaveBeenCalled();
  });

  it('effectiveFormats 统一处理空形态和开放题开关', () => {
    expect(effectiveFormats([], true, true)).toEqual(['choice', 'open']);
    expect(effectiveFormats(['open'], false, true)).toEqual(['choice']);
    expect(effectiveFormats(['choice', 'open'], true, false)).toEqual(['choice']);
  });
});

// P2 变体可观测性：每次 finalizeQuestion 都记一条（延迟 + 回退原因），
// 用于回答「轻量变体到底省了多少 / gate 是否过严」，而不是只看「组卷几秒」。
describe('finalizeQuestion 变体遥测', () => {
  const validVariant = {
    question: 'attention 机制为什么需要缩放？',
    options: ['缩放注意力分数来稳定训练', '提高学习率以加速模型收敛'],
  };

  function providerWith(impl: () => Promise<unknown>): LLMProvider {
    return { ...provider, generateVariant: vi.fn(impl) as never };
  }

  beforeEach(() => {
    resetUsageTelemetry();
  });

  it('成功：记录延迟且无 fallbackReason', async () => {
    const sq = { question: choiceQuestion, format: 'choice' as const };
    const out = await finalizeQuestion(sq, providerWith(async () => validVariant), { runtimeVariantEnabled: true });
    expect(out.question.formats.choice?.options).toHaveLength(2);
    const t = getVariantTelemetry();
    expect(t.total).toBe(1);
    expect(t.rounds[0].questionId).toBe('choice-1');
    expect(t.rounds[0].fallbackReason).toBeUndefined();
    expect(t.fallbackRate).toBe(0);
  });

  it('校验失败：回退原题并记机器可读 code（missing-options）', async () => {
    const sq = { question: choiceQuestion, format: 'choice' as const };
    // 缺少 options → validateVariant 拒绝，并把 code 透传给遥测（便于按原因统计 fallback 率）
    const out = await finalizeQuestion(sq, providerWith(async () => ({ question: 'attention new' })), { runtimeVariantEnabled: true });
    expect(out).toBe(sq);
    const t = getVariantTelemetry();
    expect(t.total).toBe(1);
    expect(t.rounds[0].fallbackReason).toBe('missing-options');
    expect(t.fallbackRate).toBe(100);
  });

  it('长度泄题：由 validateVariant 拒绝并记 option-length-bias（不再由 LLM 层抛错）', async () => {
    // 第五轮：长度泄题检查从 ai/variant 移入 domain/variant.validateVariant，
    // 因此它走的是「校验失败」这条回退路径，而不是「生成异常」。
    const biasQuestion: Question = {
      ...choiceQuestion,
      id: 'bias-1',
      formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [0] } },
    };
    const sq = { question: biasQuestion, format: 'choice' as const };
    const out = await finalizeQuestion(
      sq,
      providerWith(async () => ({
        question: 'attention 机制为什么需要缩放？',
        options: [
          '缩放点积注意力通过除以根号 d_k 来避免点积方差过大导致 softmax 饱和，从而稳定梯度并改善收敛',
          'A',
          'B',
          'C',
        ],
      })),
      { runtimeVariantEnabled: true },
    );
    expect(out).toBe(sq);
    expect(getVariantTelemetry().rounds[0].fallbackReason).toBe('option-length-bias');
  });

  it('漂移软信号（warning）不阻断：变体仍被采用，不计入 fallback，只落一条告警日志', async () => {
    // ADR-068：字面锚点未命中只是 warning，已不是语义闸门。这条用例锁死
    // 「warning ≠ 拒绝」——否则降级会在重构中被悄悄退回成硬门槛，重新误杀换场景的合法变体。
    const sq = { question: choiceQuestion, format: 'choice' as const };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = await finalizeQuestion(
        sq,
        providerWith(async () => ({
          question: '下面哪个说法是对的？',
          options: ['缩放注意力分数来稳定训练', '提高学习率以加速模型收敛'],
        })),
        { runtimeVariantEnabled: true },
      );
      expect(out).not.toBe(sq);
      expect(out.question.question).toBe('下面哪个说法是对的？');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('variant stem has no lexical anchor'));
    } finally {
      warn.mockRestore();
    }
    const t = getVariantTelemetry();
    expect(t.rounds[0].fallbackReason).toBeUndefined();
    expect(t.fallbackRate).toBe(0);
  });

  it('生成异常（LLM 调用失败）：记 generation-error', async () => {
    await finalizeQuestion(
      { question: choiceQuestion, format: 'choice' },
      providerWith(async () => {
        throw new Error('network down');
      }),
      { runtimeVariantEnabled: true },
    );
    const t = getVariantTelemetry();
    expect(t.rounds[0].fallbackReason).toBe('generation-error');
    expect(t.fallbackRate).toBe(100);
  });

  it('统计口径：avg / p95 延迟与 fallback 率', () => {
    recordVariantRound({ questionId: 'a', latencyMs: 1000 });
    recordVariantRound({ questionId: 'b', latencyMs: 2000 });
    recordVariantRound({ questionId: 'c', latencyMs: 3000, fallbackReason: 'option-length-bias' });
    recordVariantRound({ questionId: 'd', latencyMs: 4000 });
    const t = getVariantTelemetry();
    expect(t.total).toBe(4);
    expect(t.fallbackCount).toBe(1);
    expect(t.fallbackRate).toBe(25);
    expect(t.avgLatencyMs).toBe(2500);
    expect(t.p95LatencyMs).toBe(4000);
  });
});

// 双模式 Variant：Pool-first（离线资产，零 LLM）+ Runtime fallback（Pool miss + 开关开 + provider）。
describe('finalizeQuestion 双模式 Pool-first + Runtime fallback', () => {
  // 与 choiceQuestion（2 选项）对齐的、可通过 validateVariant 的离线变体
  const poolVariant: QuestionVariant = {
    id: 'choice-1__surface-options__0',
    kind: 'surface-options',
    question: 'attention 为什么要对点积做缩放？',
    options: ['通过缩放点积注意力来稳定训练梯度', '提高学习率以加快收敛速度'],
    generatedAt: 1700000000000,
    generator: 'offline',
    promptVersion: 'v3',
    sourceHash: computeVariantSourceHash(variantSourceOf(choiceQuestion)),
  };
  const pool: VariantPool = {
    version: 1,
    generatedAt: 1700000000000,
    promptVersion: 'v3',
    variants: { 'choice-1': [poolVariant] },
  };

  function providerWith(impl: () => Promise<unknown>): LLMProvider {
    return { ...provider, generateVariant: vi.fn(impl) as never };
  }

  beforeEach(() => {
    resetUsageTelemetry();
  });

  it('Pool 命中 → 零 LLM 直接落地，且不调用 provider', async () => {
    const sq = { question: choiceQuestion, format: 'choice' as const };
    const gen = vi.fn(async () => ({ question: '不应被调用', options: ['x', 'y'] }));
    const p = { ...provider, generateVariant: gen as never };
    const out = await finalizeQuestion(sq, p, { variantPool: pool, runtimeVariantEnabled: false });
    expect(gen).not.toHaveBeenCalled();
    expect(out).not.toBe(sq);
    expect(out.question.question).toBe('attention 为什么要对点积做缩放？');
    // 选项经程序重排，集合不变（答案仍指向原题正确项）
    expect(new Set(out.question.formats.choice!.options)).toEqual(
      new Set(['通过缩放点积注意力来稳定训练梯度', '提高学习率以加快收敛速度']),
    );
    const t = getVariantTelemetry();
    expect(t.rounds[0].fallbackReason).toBeUndefined();
    expect(t.rounds[0].latencyMs).toBe(0); // 零 LLM
  });

  it('Pool miss + 开关关（默认）→ 零 LLM 回退原题，不调用 provider', async () => {
    const sq = { question: choiceQuestion, format: 'choice' as const };
    const gen = vi.fn(async () => ({ question: '不应被调用', options: ['x', 'y'] }));
    const p = { ...provider, generateVariant: gen as never };
    const out = await finalizeQuestion(sq, p, { variantPool: null, runtimeVariantEnabled: false });
    expect(gen).not.toHaveBeenCalled();
    expect(out).toBe(sq);
  });

  it('Pool miss + 开关关 + 即使有 provider 也不生成（开关优先）', async () => {
    const sq = { question: choiceQuestion, format: 'choice' as const };
    const gen = vi.fn(async () => ({ question: '不应被调用', options: ['x', 'y'] }));
    const p = { ...provider, generateVariant: gen as never };
    const emptyPool: VariantPool = { version: 1, generatedAt: 0, promptVersion: 'v3', variants: {} };
    const out = await finalizeQuestion(sq, p, { variantPool: emptyPool, runtimeVariantEnabled: false });
    expect(gen).not.toHaveBeenCalled();
    expect(out).toBe(sq);
  });

  it('Pool miss + 开关开 + provider → 1 次 LLM 运行时生成', async () => {
    const sq = { question: choiceQuestion, format: 'choice' as const };
    const emptyPool: VariantPool = { version: 1, generatedAt: 0, promptVersion: 'v3', variants: {} };
    const out = await finalizeQuestion(
      sq,
      providerWith(async () => ({
        question: '运行时改写题干',
        options: ['通过缩放点积注意力来稳定训练梯度', '提高学习率以加快收敛速度'],
      })),
      { variantPool: emptyPool, runtimeVariantEnabled: true },
    );
    expect(out.question.question).toBe('运行时改写题干');
    expect(getVariantTelemetry().rounds[0].fallbackReason).toBeUndefined();
  });

  it('Pool 命中但校验不过（canonical 已变 → stale）→ 回退，记 pool-validation-failed', async () => {
    // 池中变体基于「2 选项」生成；若原题被改成「3 选项」，变体选项数不匹配 → validateVariant 拒绝，
    // 落入 fallback 分支（此处开关关 → 回退原题）。
    const changed: Question = {
      ...choiceQuestion,
      formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] } },
    };
    const sq = { question: changed, format: 'choice' as const };
    const out = await finalizeQuestion(sq, providerWith(async () => ({ question: 'x', options: ['y', 'z'] })), {
      variantPool: pool,
      runtimeVariantEnabled: false,
    });
    expect(out).toBe(sq);
    expect(getVariantTelemetry().rounds[0].fallbackReason).toBe('option-count-mismatch');
  });
});
