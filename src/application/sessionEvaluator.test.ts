import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../types';
import type { Question } from '../schemas/question';
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
  question: 'q',
  explanation: '',
  formats: { choice: { type: 'single', options: ['a', 'b'], answer: [0] } },
};

const openQuestion: Question = {
  id: 'open-1',
  category: 'transformer',
  topic: 'attention',
  tags: [],
  difficulty: 'medium',
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
  const validVariant = { question: 'attention 机制为什么需要缩放？', options: ['x', 'y'] };

  function providerWith(impl: () => Promise<unknown>): LLMProvider {
    return { ...provider, generateVariant: vi.fn(impl) as never };
  }

  beforeEach(() => {
    resetUsageTelemetry();
  });

  it('成功：记录延迟且无 fallbackReason', async () => {
    const sq = { question: choiceQuestion, format: 'choice' as const };
    const out = await finalizeQuestion(sq, providerWith(async () => validVariant));
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
    const out = await finalizeQuestion(sq, providerWith(async () => ({ question: 'attention new' })));
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
    );
    expect(out).toBe(sq);
    expect(getVariantTelemetry().rounds[0].fallbackReason).toBe('option-length-bias');
  });

  it('生成异常（LLM 调用失败）：记 generation-error', async () => {
    await finalizeQuestion(
      { question: choiceQuestion, format: 'choice' },
      providerWith(async () => {
        throw new Error('network down');
      }),
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
