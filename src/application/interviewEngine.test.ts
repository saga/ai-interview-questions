// 引擎编排测试：useAI 开关必须门控开放形态的 LLM 评分（mock provider，不发网络）；
// 变体校验失败/调用失败回退原题；组卷按 def.formats 过滤并分配 SessionQuestion。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterviewDefinition, Question, ScoringRubric } from '../types';

let store: Record<string, string>;
beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
});

const sentinel = {
  overall: 88,
  dimensions: { correctness: 88, completeness: 88, architecture: 88, communication: 88 },
  strengths: [],
  gaps: [],
  feedback: '',
};

const evaluateOpenAnswer = vi.fn(async () => sentinel);

vi.mock('../ai/provider', () => ({
  createLLMProvider: (config?: unknown) =>
    config
      ? {
          name: 'mock',
          generateVariant: vi.fn(async (q: Question) =>
            q.id === 'bad-variant' ? { question: '' } : { question: '变体题干' },
          ),
          evaluateOpenAnswer,
        }
      : null,
}));

const { buildSession, evaluateAnswer, evaluateSession, nextAdaptiveStep } = await import('./interviewEngine');

const openQ: Question = {
  id: 'o1',
  category: 'agentic-ai',
  topic: 'memory',
  tags: [],
  difficulty: 'medium',
  question: 'q',
  explanation: '',
  formats: { open: { referenceAnswer: 'a' } },
};

const choiceQ: Question = {
  id: 'c1',
  category: 'agentic-ai',
  topic: 'tools',
  tags: [],
  difficulty: 'easy',
  question: 'qc',
  explanation: '',
  formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [0] } },
};

function def(useAI: boolean, formats: InterviewDefinition['formats'] = ['open']): InterviewDefinition {
  return {
    title: 't',
    categories: [],
    difficulties: [],
    formats,
    count: 1,
    useAI,
    scoringRubric: { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 } satisfies ScoringRubric,
  };
}

describe('evaluateAnswer 的 useAI 门控（ADR-020）', () => {
  const config = {
    providers: [{ id: 'deepseek', enabled: true, model: 'm', apiKey: 'k' }],
    generateOpenQuestions: true,
  } as const;
  const sq = { question: openQ, format: 'open' as const };

  it('useAI=false 时开放形态不调用 LLM，返回 null', async () => {
    const g = await evaluateAnswer(sq, '我的回答', def(false), { ...config });
    expect(g).toBeNull();
    expect(evaluateOpenAnswer).not.toHaveBeenCalled();
  });

  it('useAI=true 且配置有效时走 LLM 评分', async () => {
    const g = await evaluateAnswer(sq, '我的回答', def(true), { ...config });
    expect(g).toEqual(sentinel);
    expect(evaluateOpenAnswer).toHaveBeenCalledTimes(1);
    expect(evaluateOpenAnswer).toHaveBeenCalledWith(openQ, openQ.formats.open, '我的回答', expect.anything(), undefined);
  });

  it('无配置时即使 useAI=true 也返回 null（退化为未评分）', async () => {
    const g = await evaluateAnswer(sq, '我的回答', def(true), undefined);
    expect(g).toBeNull();
  });

  it('选择形态确定性判分，不依赖 AI', async () => {
    const g = await evaluateAnswer(
      { question: choiceQ, format: 'choice' },
      [0],
      def(false),
      undefined,
    );
    expect(g?.overall).toBe(100);
    const wrong = await evaluateAnswer(
      { question: choiceQ, format: 'choice' },
      [1],
      def(false),
      undefined,
    );
    expect(wrong?.overall).toBe(0);
  });
});

const dualQ = (id: string): Question => ({
  id,
  category: 'agentic-ai',
  topic: 'tools',
  tags: [],
  difficulty: 'easy',
  question: 'qd',
  explanation: '',
  formats: {
    choice: { type: 'multiple', options: ['a', 'b', 'c', 'd'], answer: [0, 1] },
    open: { referenceAnswer: 'ref' },
  },
});

describe('buildSession 组卷与变体处理', () => {
  // 题池两种形态都有，planComposition 才会做配比调整（domain/quiz.ts）；
  // count=4 → 开放配额 1：唯一纯开放题 o1 恰好占满配额，四道题全部保留。
  const bank = { categories: ['agentic-ai'], questions: [openQ, choiceQ, dualQ('d1'), dualQ('d2')] };
  const cfg = {
    providers: [{ id: 'deepseek', enabled: true, model: 'm', apiKey: 'k' }],
    generateOpenQuestions: true,
  };

  it('按 def.formats 过滤题池：只允许 choice 时纯开放题不入卷', async () => {
    const session = await buildSession(bank, { ...def(true, ['choice']), count: 4 }, cfg);
    expect(session.questions.map((sq) => sq.question.id)).not.toContain('o1');
    expect(session.questions.length).toBe(3); // c1/d1/d2 都具备 choice 形态
    expect(session.questions.every((sq) => sq.format === 'choice')).toBe(true);
  });

  it('每道题产出 SessionQuestion（question + format），开放形态不超过配额', async () => {
    const session = await buildSession({ ...bank, questions: [...bank.questions] }, { ...def(true, ['choice', 'open']), count: 4 }, cfg);
    expect(session.questions).toHaveLength(4);
    expect(new Set(session.questions.map((sq) => sq.question.id))).toEqual(
      new Set(['o1', 'c1', 'd1', 'd2']),
    );
    // 唯一纯开放题保持 open；双形态题在配额已满时全部出选择
    expect(session.questions.find((sq) => sq.question.id === 'o1')?.format).toBe('open');
    expect(
      session.questions.filter((sq) => sq.question.id !== 'o1').every((sq) => sq.format === 'choice'),
    ).toBe(true);
  });

  it('useAI=true 时生成变体快照（题干替换），答案数据不动；校验失败抛错（无兜底，ADR-036）', async () => {
    const goodBank = { categories: ['x'], questions: [{ ...choiceQ }] };
    const session = await buildSession(goodBank, { ...def(true, ['choice']) }, cfg);
    expect(session.questions[0].question.question).toBe('变体题干');
    expect(session.questions[0].question.formats.choice).toEqual(choiceQ.formats.choice);

    const badBank = {
      categories: ['x'],
      questions: [{ ...choiceQ, id: 'bad-variant' }],
    };
    await expect(buildSession(badBank, { ...def(true, ['choice']) }, cfg)).rejects.toThrow(/变体校验失败/);
  });

  it('useAI=false 时直接使用原题（无变体快照）', async () => {
    const oneQBank = { categories: [], questions: [{ ...choiceQ }] };
    const session = await buildSession(oneQBank, { ...def(false, ['choice']) }, cfg);
    expect(session.questions[0].question.question).toBe('qc');
  });

  it('evaluateSession 批量评估：选择题判分、开放题走 LLM', async () => {
    const session = await buildSession(
      { ...bank, questions: [...bank.questions] },
      { ...def(true, ['choice', 'open']), count: 4 },
      cfg,
    );
    const grades = await evaluateSession(
      session,
      { c1: [0], d1: [0], d2: [2], o1: '我的回答' },
      cfg,
    );
    expect(new Set(Object.keys(grades))).toEqual(new Set(['c1', 'd1', 'd2', 'o1']));
    expect(grades.c1?.overall).toBe(100); // 正确
    expect(grades.d1?.overall).toBe(0); // 多选只选一个 → 错
    expect(grades.d2?.overall).toBe(0); // 错选
    expect(grades.o1).toEqual(sentinel);
  });
});

describe('generateOpenQuestions 门控（ADR-031）', () => {
  const baseCfg = { providers: [{ id: 'deepseek', enabled: true, model: 'm', apiKey: 'k' }] };
  const dualBank = { categories: [], questions: [dualQ('d1'), dualQ('d2'), { ...openQ }] };

  it('关闭（默认）时不生成开放题：纯开放题不入卷，双形态题一律出选择', async () => {
    const session = await buildSession(dualBank, { ...def(true, ['choice', 'open']), count: 3 }, baseCfg);
    expect(session.questions.map((sq) => sq.question.id)).not.toContain('o1');
    expect(session.questions).toHaveLength(2); // 纯开放题被剔除
    expect(session.questions.every((sq) => sq.format === 'choice')).toBe(true);
  });

  it('config 未传同样视为关闭（默认值 false）', async () => {
    const session = await buildSession(dualBank, { ...def(true, []), count: 3 });
    expect(session.questions.every((sq) => sq.format === 'choice')).toBe(true);
  });

  it('定义只选了 open 而全局关闭时退化为 choice（不产生空会话）', async () => {
    const session = await buildSession(dualBank, { ...def(true, ['open']), count: 3 }, baseCfg);
    expect(session.questions.length).toBeGreaterThan(0);
    expect(session.questions.every((sq) => sq.format === 'choice')).toBe(true);
  });

  it('开启时恢复组卷配额：纯开放题入卷并占满开放配额', async () => {
    const bank = { categories: [], questions: [dualQ('d1'), dualQ('d2'), { ...openQ }, { ...choiceQ }] };
    const session = await buildSession(bank, { ...def(true, ['choice', 'open']), count: 4 }, {
      ...baseCfg,
      generateOpenQuestions: true,
    });
    expect(session.questions).toHaveLength(4);
    expect(session.questions.find((sq) => sq.question.id === 'o1')?.format).toBe('open');
  });

  it('自适应模式：关闭时下一步不出开放形态', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // 开着也必然命中开放，这里验证门控优先
    const bank = { categories: [], questions: [dualQ('d1'), dualQ('d2')] };
    const first = await buildSession(bank, { ...def(true, ['choice', 'open']), count: 2, adaptive: true }, baseCfg);
    const step = await nextAdaptiveStep(bank, first, []);
    expect(step).not.toBeNull();
    expect(step!.question.format).toBe('choice');
    randomSpy.mockRestore();
  });

  it('自适应模式：开启且随机命中时分配开放形态', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const bank = { categories: [], questions: [dualQ('d1'), dualQ('d2')] };
    const first = await buildSession(
      bank,
      { ...def(true, ['choice', 'open']), count: 2, adaptive: true },
      { ...baseCfg, generateOpenQuestions: true },
    );
    const step = await nextAdaptiveStep(bank, first, [], undefined, { ...baseCfg, generateOpenQuestions: true });
    expect(step).not.toBeNull();
    expect(step!.question.format).toBe('open');
    randomSpy.mockRestore();
  });
});
