// 工具层测试（Phase 1）：断言 AgentTool 薄包装正确委托现有 domain / learner / evaluation，
// 并复用上一轮修复的「选择题 gap 不污染」契约——选择题评分返回 gaps: []（绝不伪造 gap）。

import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { Question } from '../schemas/question';
import { emptyProfile } from '../domain/learner';
import { createAgentTools } from './tools';
import { createAgentSession } from './types';
import type { AgentToolDeps } from './tools';

function makeChoiceQuestion(): Question {
  return {
    id: 'q-choice-1',
    category: 'transformer',
    topic: 'attention',
    tags: [],
    difficulty: 'easy',
    question: 'Transformer 中 multi-head attention 的作用？',
    explanation: '多头并行捕捉不同子空间关系。',
    formats: {
      choice: {
        type: 'single',
        options: ['并行捕捉不同子空间表示', '减少参数量', '加速推理'],
        answer: [0],
      },
    },
  };
}

function makeOpenQuestion(): Question {
  return {
    id: 'q-open-1',
    category: 'rag-agent',
    topic: 'rag',
    tags: [],
    difficulty: 'medium',
    question: 'RAG 与 fine-tuning 的区别？',
    explanation: 'RAG 注入外部知识，fine-tuning 更新参数。',
    formats: {
      open: {
        referenceAnswer: 'RAG 检索外部知识，fine-tuning 更新模型参数。',
      },
    },
  };
}

/** 造一道指定 id / topic 的选择题，便于构造「同一主题多道题」的重复出题场景。 */
function makeQuestion(over: Partial<Question> & { id: string }): Question {
  return {
    category: 'transformer',
    topic: 'attention',
    tags: [],
    difficulty: 'easy',
    question: `题干 ${over.id}`,
    explanation: '解析',
    formats: {
      choice: {
        type: 'single',
        options: ['正确项', '干扰项一', '干扰项二'],
        answer: [0],
      },
    },
    ...over,
  };
}

function fakeOpenResult(overall = 50): EvaluationResult {
  return {
    overall,
    dimensions: { correctness: overall, completeness: overall, architecture: overall, communication: overall },
    levels: { correctness: 2, completeness: 2, architecture: 2, communication: 2 },
    evidence: { correctness: '', completeness: '', architecture: '', communication: '' },
    strengths: ['答到要点'],
    gaps: ['未展开推理成本'],
    missingConcepts: [],
    feedback: '基本正确。',
  };
}

function makeProvider(): LLMProvider & { evaluateOpenAnswer: ReturnType<typeof vi.fn> } {
  return {
    name: 'fake',
    generateVariant: vi.fn(async (q: Question) => ({ question: `${q.topic} 变体题干` })),
    evaluateOpenAnswer: vi.fn(async () => fakeOpenResult(50)),
  };
}

function deps(bank: Question[], profile = emptyProfile()): AgentToolDeps {
  return {
    bank,
    profile,
    provider: makeProvider(),
    session: createAgentSession(),
  };
}

describe('createAgentTools', () => {
  it('searchQuestions 按主题筛选并返回精简摘要', async () => {
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()]);
    const tools = createAgentTools(d);
    const search = tools.find((t) => t.name === 'searchQuestions')!;
    const r = await search.execute('call', { topic: 'attention', limit: 5 });
    const items = r.details as { id: string; topic: string }[];
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('q-choice-1');
    expect(items[0].topic).toBe('attention');
  });

  it('searchQuestions 文本结果必须包含真实题号，否则 LLM 拿不到 id 会卡死（修复：content 不再只是数量）', async () => {
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()]);
    const tools = createAgentTools(d);
    const search = tools.find((t) => t.name === 'searchQuestions')!;
    const r = await search.execute('call', {});
    const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join('');
    // 关键契约：content 文本里必须出现真实 id，LLM 才能据此调用 getQuestion
    expect(text).toContain('q-choice-1');
    expect(text).toContain('q-open-1');
    // 且不能再只回一句数量的话
    expect(text).not.toMatch(/^找到 \d+ 道候选题$/);
  });

  it('getQuestion 选中题目并写入会话 currentQuestion', async () => {
    const d = deps([makeChoiceQuestion()]);
    const tools = createAgentTools(d);
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const r = await getQ.execute('call', { id: 'q-choice-1' });
    expect(d.session.currentQuestion?.question.id).toBe('q-choice-1');
    expect(d.session.currentQuestion?.format).toBe('choice');
    expect(d.provider.generateVariant).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-choice-1' }));
    expect(d.session.currentQuestion?.question.question).toBe('attention 变体题干');
    expect((r.details as { id: string }).id).toBe('q-choice-1');
  });

  it('getQuestion 找不到题目时优雅返回而非崩溃', async () => {
    const d = deps([makeChoiceQuestion()]);
    const tools = createAgentTools(d);
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const r = await getQ.execute('call', { id: 'nope' });
    expect((r.details as { error: string }).error).toBe('not_found');
    expect(d.session.currentQuestion).toBeNull();
  });

  it('getQuestion not_found 回带可用题号（self-correcting），Agent 无需记忆即可挑真 id', async () => {
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()]);
    const tools = createAgentTools(d);
    const search = tools.find((t) => t.name === 'searchQuestions')!;
    await search.execute('call', {}); // 先 search 写入 lastSearchIds
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const r = await getQ.execute('call', { id: 'nope' });
    const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join('');
    expect((r.details as { error: string }).error).toBe('not_found');
    // 关键契约：not_found 直接列出可用题号，替代 prompt「回到列表挑真 id」约束
    expect(text).toContain('q-choice-1');
    expect(text).toContain('q-open-1');
    expect((r.details as { validIds: string[] }).validIds).toEqual(['q-choice-1', 'q-open-1']);
  });

  it('searchQuestions 重复调用幂等复用缓存列表并写入 lastSearchIds（消除反复调用动机）', async () => {
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()]);
    const tools = createAgentTools(d);
    const search = tools.find((t) => t.name === 'searchQuestions')!;
    const r1 = await search.execute('call', {});
    expect(d.session.lastSearchIds).toEqual(['q-choice-1', 'q-open-1']);
    const text1 = (r1.content as { type: string; text: string }[]).map((c) => c.text).join('');
    expect(text1).toContain('找到 2 道候选题');
    // 重复调用（相同参数）→ 复用缓存、明确提示无需再调
    const r2 = await search.execute('call', {});
    const text2 = (r2.content as { type: string; text: string }[]).map((c) => c.text).join('');
    expect(text2).toContain('复用上次的候选列表');
    expect(text2).toContain('q-choice-1');
    expect(d.session.lastSearchIds).toEqual(['q-choice-1', 'q-open-1']);
  });

  it('getQuestion 传入 topic 而非 id 时按主题兜底选题（修复 D）', async () => {
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()]);
    const tools = createAgentTools(d);
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    // LLM 把 topic('attention') 当题号传入——应退化为该主题下一道题，而非 not_found
    const r = await getQ.execute('call', { id: 'attention' });
    expect((r.details as { error?: string }).error).toBeUndefined();
    expect(d.session.currentQuestion?.question.id).toBe('q-choice-1');
    expect((r.details as { matchedBy?: string }).matchedBy).toBe('topic');
    // 兜底同时回带正确 id 示例，教 Agent「应直接传真实 id」
    const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join('');
    expect(text).toContain('q-choice-1');
  });

  it('evaluateAnswer（选择题正确）返回 100 分且 gaps 为空（不伪造 gap）', async () => {
    const d = deps([makeChoiceQuestion()]);
    d.session.currentQuestion = { question: makeChoiceQuestion(), format: 'choice' };
    d.session.answers['q-choice-1'] = [0]; // 选中正确答案
    const tools = createAgentTools(d);
    const evalTool = tools.find((t) => t.name === 'evaluateAnswer')!;
    const r = await evalTool.execute('call', {});
    const result = r.details as EvaluationResult;
    expect(result.overall).toBe(100);
    expect(result.gaps).toEqual([]);
    expect(d.session.evaluations['q-choice-1']?.overall).toBe(100);
  });

  it('evaluateAnswer（选择题错误）返回 0 分且 gaps 仍为空', async () => {
    const d = deps([makeChoiceQuestion()]);
    d.session.currentQuestion = { question: makeChoiceQuestion(), format: 'choice' };
    d.session.answers['q-choice-1'] = [1]; // 选错
    const tools = createAgentTools(d);
    const evalTool = tools.find((t) => t.name === 'evaluateAnswer')!;
    const r = await evalTool.execute('call', {});
    const result = r.details as EvaluationResult;
    expect(result.overall).toBe(0);
    // 关键契约：选择题判分不知道用户漏了哪个知识点，绝不放假 gap 污染 Learner Memory
    expect(result.gaps).toEqual([]);
  });

  it('evaluateAnswer（开放题）委托 LLMProvider 并返回其结果', async () => {
    const provider = makeProvider();
    const d = deps([makeOpenQuestion()], emptyProfile());
    d.provider = provider;
    d.session.currentQuestion = { question: makeOpenQuestion(), format: 'open' };
    d.session.answers['q-open-1'] = 'RAG 检索外部知识来回答。';
    const tools = createAgentTools(d);
    const evalTool = tools.find((t) => t.name === 'evaluateAnswer')!;
    const r = await evalTool.execute('call', {});
    const result = r.details as EvaluationResult;
    expect(result.overall).toBe(50);
    expect(provider.evaluateOpenAnswer).toHaveBeenCalledTimes(1);
  });

  it('getUserWeaknesses 读取 profile 的薄弱主题', async () => {
    const profile = emptyProfile();
    profile.topicStats['attention'] = {
      attempts: 3,
      avgScore: 40,
      lastScore: 40,
      trend: 'flat',
      mastery: 0.4,
      commonWeaknesses: ['未理解 QKV'],
      evidence: [],
      lastSeen: Date.now(),
    };
    const d = deps([makeChoiceQuestion()], profile);
    const tools = createAgentTools(d);
    const weak = tools.find((t) => t.name === 'getUserWeaknesses')!;
    const r = await weak.execute('call', {});
    const details = r.details as { weakTopics: string[] };
    expect(details.weakTopics).toContain('attention');
  });

  it('finishInterview 置状态为 finished 并返回摘要', async () => {
    const d = deps([makeChoiceQuestion()]);
    d.session.evaluations['q-choice-1'] = {
      overall: 80,
      dimensions: { correctness: 80, completeness: 80, architecture: 80, communication: 80 },
      levels: { correctness: 3, completeness: 3, architecture: 3, communication: 3 },
      evidence: { correctness: '', completeness: '', architecture: '', communication: '' },
      strengths: [],
      gaps: [],
      missingConcepts: [],
      feedback: '',
    };
    const tools = createAgentTools(d);
    const finish = tools.find((t) => t.name === 'finishInterview')!;
    const r = await finish.execute('call', {});
    expect(d.session.status).toBe('finished');
    const summary = r.details as { questionsAsked: number; overall: number };
    expect(summary.questionsAsked).toBe(1);
    expect(summary.overall).toBe(80);
  });
});

describe('getQuestion 尊重 generateOpenQuestions 开关（修复：Agent 不绕过全局开关）', () => {
  it('关闭时不交付纯开放题', async () => {
    const session = createAgentSession();
    const tools = createAgentTools({
      bank: [makeOpenQuestion()],
      profile: emptyProfile(),
      provider: makeProvider(),
      session,
      generateOpenQuestions: false,
    });
    const getQuestion = tools.find((t) => t.name === 'getQuestion')!;
    const res = await getQuestion.execute('x', { id: 'q-open-1' });
    expect((res.details as { error: string }).error).toBe('open_disabled');
    expect(session.currentQuestion).toBeNull();
  });

  it('关闭时仍可正常交付选择题', async () => {
    const session = createAgentSession();
    const tools = createAgentTools({
      bank: [makeChoiceQuestion()],
      profile: emptyProfile(),
      provider: makeProvider(),
      session,
      generateOpenQuestions:  false,
    });
    const getQuestion = tools.find((t) => t.name === 'getQuestion')!;
    const res = await getQuestion.execute('x', { id: 'q-choice-1' });
    expect((res.details as { format: string }).format).toBe('choice');
    expect(session.currentQuestion?.format).toBe('choice');
  });

  it('开启时纯开放题正常交付', async () => {
    const session = createAgentSession();
    const tools = createAgentTools({
      bank: [makeOpenQuestion()],
      profile: emptyProfile(),
      provider: makeProvider(),
      session,
      generateOpenQuestions: true,
    });
    const getQuestion = tools.find((t) => t.name === 'getQuestion')!;
    const res = await getQuestion.execute('x', { id: 'q-open-1' });
    expect((res.details as { format: string }).format).toBe('open');
  });
});

describe('getQuestion 绝不重复出题（修复：topic 兜底不得回退到已考察的题）', () => {
  /** 取工具返回的文本，LLM 只能读到 content。 */
  const textOf = (r: { content: unknown }) =>
    (r.content as { type: string; text: string }[]).map((c) => c.text).join('');
  const getQ = (d: AgentToolDeps) => createAgentTools(d).find((t) => t.name === 'getQuestion')!;
  const twoInSameTopic = () => [makeQuestion({ id: 'a1' }), makeQuestion({ id: 'a2' })];

  it('topic 内所有题都已考察过 → topic_exhausted，且不把任何已考察的题再次设为当前题', async () => {
    const bank = twoInSameTopic();
    const d = deps(bank);
    d.session.evaluations['a1'] = fakeOpenResult(80);
    d.session.evaluations['a2'] = fakeOpenResult(60);
    const r = await getQ(d).execute('call', { id: 'attention' });
    expect((r.details as { error: string }).error).toBe('topic_exhausted');
    // 关键契约：宁可不出题，也绝不重复交付
    expect(d.session.currentQuestion).toBeNull();
    expect(textOf(r)).toContain('已全部考察过');
  });

  it('原题 bug 回归：兜底不再落回该主题第一道（已考察）题，而是指向未考察的题', async () => {
    // 修复前：unasked 为空时执行 `unasked[0] ?? byTopic[0]`，会把已考察的 a1 再交一遍
    const d = deps([makeQuestion({ id: 'a1' }), makeQuestion({ id: 'a2' }), makeQuestion({ id: 'b1', topic: 'rag' })]);
    d.session.evaluations['a1'] = fakeOpenResult(80);
    d.session.evaluations['a2'] = fakeOpenResult(60);
    const r = await getQ(d).execute('call', { id: 'attention' });
    // 绝不重复交付已考察过的题（宁可不出题）
    expect(d.session.currentQuestion).toBeNull();
    expect((r.details as { error: string }).error).toBe('topic_exhausted');
    // 但要把唯一还没考察过的 b1 指给 Agent，让它能立刻接着问
    expect((r.details as { validIds: string[] }).validIds).toEqual(['b1']);
  });

  it('评分为 null（未作答 / 评估失败）也算已考察，不重复交付', async () => {
    const bank = twoInSameTopic();
    const d = deps(bank);
    d.session.evaluations['a1'] = null; // 已呈现过，只是没拿到分数
    const r = await getQ(d).execute('call', { id: 'attention' });
    expect(d.session.currentQuestion?.question.id).toBe('a2');
    expect((r.details as { matchedBy?: string }).matchedBy).toBe('topic');
  });

  it('已作答但尚未评分的题也算已考察', async () => {
    const bank = twoInSameTopic();
    const d = deps(bank);
    d.session.answers['a1'] = [0];
    await getQ(d).execute('call', { id: 'attention' });
    expect(d.session.currentQuestion?.question.id).toBe('a2');
  });

  it('重复传入同一 topic 会依次给出未考察的题，不会停留在同一道', async () => {
    const bank = twoInSameTopic();
    const d = deps(bank);
    await getQ(d).execute('call', { id: 'attention' });
    expect(d.session.currentQuestion?.question.id).toBe('a1');
    // a1 是当前题 → 再次传入 topic 必须给 a2，而不是把 a1 再交一遍
    await getQ(d).execute('call', { id: 'attention' });
    expect(d.session.currentQuestion?.question.id).toBe('a2');
  });

  it('not_found 自纠正只回带未考察的题号，不会把 Agent 指回刚问过的题', async () => {
    const bank = [makeQuestion({ id: 'a1' }), makeQuestion({ id: 'a2' }), makeQuestion({ id: 'a3' })];
    const d = deps(bank);
    d.session.currentQuestion = { question: bank[0], format: 'choice' }; // a1 正在答
    const r = await getQ(d).execute('call', { id: 'nope' });
    expect((r.details as { error: string }).error).toBe('not_found');
    expect((r.details as { validIds: string[] }).validIds).toEqual(['a2', 'a3']);
  });

  it('题库全部考察完时提示结束面试，而不是回退重复出题', async () => {
    const bank = [makeQuestion({ id: 'a1' })];
    const d = deps(bank);
    d.session.evaluations['a1'] = fakeOpenResult(70);
    const r = await getQ(d).execute('call', { id: 'attention' });
    expect((r.details as { validIds: string[] }).validIds).toEqual([]);
    expect(textOf(r)).toContain('finishInterview');
    expect(d.session.currentQuestion).toBeNull();
  });
});
