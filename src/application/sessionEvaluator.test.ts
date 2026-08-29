import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../types';
import type { Question } from '../schemas/question';
import { DEFAULT_RUBRIC } from '../domain/evaluation';
import { effectiveFormats, evaluateSessionQuestion, isAnswerEmpty } from './sessionEvaluator';

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
