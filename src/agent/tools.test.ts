// 工具层测试（Phase 1）：断言 AgentTool 薄包装正确委托现有 domain / learner / evaluation，
// 并复用上一轮修复的「选择题 gap 不污染」契约——选择题评分返回 gaps: []（绝不伪造 gap）。

import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { Question } from '../schemas/question';
import { emptyProfile } from '../domain/learner';
import { buildUserPrompt } from '../ai/chromeAgent';
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
        // 选项长度刻意均衡（11 / 7 / 7 字）：否则会被 validateVariant 的长度泄题门槛判为
        // 「正确项全局最长 + 存在过短干扰项（≥1.8×）」而回退原题，本用例关心的工具接线行为就测不到了。
        options: ['并行捕捉不同子空间表示', '减少模型参数量', '改用更大的批次'],
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
    // 轻量变体契约：choice 形态一并返回逐项改写后的 options（此处用同文本模拟改写）
    generateVariant: vi.fn(async (q: Question, format?: string) => {
      const question = `${q.topic} 变体题干`;
      if (format === 'open' || !q.formats.choice) return { question };
      return { question, options: q.formats.choice.options };
    }),
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

/** 取工具返回的文本——LLM 只能读到 content，看不到 details，所以措辞上的坑都在这里。 */
function textOf(r: { content: unknown }): string {
  return (r.content as { type: string; text: string }[]).map((c) => c.text).join('');
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
    const d = { ...deps([makeChoiceQuestion()]), runtimeVariantEnabled: true };
    const tools = createAgentTools(d);
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const r = await getQ.execute('call', { id: 'q-choice-1' });
    expect(d.session.currentQuestion?.question.id).toBe('q-choice-1');
    expect(d.session.currentQuestion?.format).toBe('choice');
    expect(d.provider.generateVariant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q-choice-1' }),
      'choice',
    );
    expect(d.session.currentQuestion?.question.question).toBe('attention 变体题干');
    expect((r.details as { id: string }).id).toBe('q-choice-1');
  });

  it('getQuestion 不回传题干/答案，只回 id + format（工具只说「选好了哪道」，不说「题是什么」）', async () => {
    const d = deps([makeChoiceQuestion()]);
    const tools = createAgentTools(d);
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const r = await getQ.execute('call', { id: 'q-choice-1' });
    const text = textOf(r);
    // 结构不变：details 里只有这三个字段，题干/选项/答案/解析一律不进 Agent 上下文
    expect(Object.keys(r.details as object).sort()).toEqual(['format', 'id', 'matchedBy']);
    expect(text).not.toContain(makeChoiceQuestion().question);
    expect(text).not.toContain('多头并行捕捉不同子空间关系'); // explanation
  });

  it('getQuestion 与 searchQuestions 都不再命令模型「呈现」题目（C1 的根因就在这些措辞里）', async () => {
    const d = deps([makeChoiceQuestion()]);
    const tools = createAgentTools(d);
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const search = tools.find((t) => t.name === 'searchQuestions')!;

    // 工具结果正文：不能再说「请呈现给用户」——题目正文不在上下文里，这句话等于让模型编题干
    const picked = textOf(await getQ.execute('call', { id: 'q-choice-1' }));
    expect(picked).not.toContain('请呈现给用户');
    expect(picked).toContain('已由界面呈现');

    const listed = textOf(await search.execute('call', {}));
    expect(listed).not.toContain('呈现给用户');

    // 工具描述同样会进入 prompt（Chrome 路径）与 API 的 tools 参数（DeepSeek 路径），必须一致
    const getQTool = tools.find((t) => t.name === 'getQuestion')!;
    expect(getQTool.description).not.toContain('并呈现给用户');
    expect(getQTool.description).toContain('你不需要也不应该复述');
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
    // 候选顺序由统一排序（rankCandidatePool：拓扑/薄弱/角度/证据）决定，不再等于题库原始顺序——
    // 这里只断言「两个真实 id 都在」，顺序语义由专门的排序测试覆盖。
    expect((r.details as { validIds: string[] }).validIds).toEqual(expect.arrayContaining(['q-choice-1', 'q-open-1']));
  });

  it('C4 回归：未先搜索就传入错误 id 时，not_found 不把全题库题号灌进 context，而是引导用 searchQuestions', async () => {
    const bank = Array.from({ length: 8 }, (_, i) => makeQuestion({ id: `c4-${i}` }));
    const d = deps(bank);
    const tools = createAgentTools(d);
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const r = await getQ.execute('call', { id: 'attnetion' }); // 拼写错误，且未搜索
    expect((r.details as { error: string }).error).toBe('not_found');
    const text = textOf(r);
    // 关键：任何题库 id 都不应出现在结果文本里（不再回退全题库）
    for (const q of bank) expect(text).not.toContain(q.id);
    // 应引导 Agent 主动搜索，而非列出题号
    expect(text).toContain('searchQuestions');
    // details 也不应携带全量题号
    expect((r.details as { validIds: string[] }).validIds).toEqual([]);
  });

  it('C4 回归：最近一次搜索结果很多时，not_found 只列出有限候选（≤5），不整段回贴', async () => {
    const bank = Array.from({ length: 8 }, (_, i) => makeQuestion({ id: `c5-${i}` }));
    const d = deps(bank);
    const tools = createAgentTools(d);
    const search = tools.find((t) => t.name === 'searchQuestions')!;
    await search.execute('call', {}); // lastSearchIds = 8 个 id
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const r = await getQ.execute('call', { id: 'nope' });
    const text = textOf(r);
    const listed = (text.match(/id=/g) ?? []).length;
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBeLessThanOrEqual(5);
  });

  it('searchQuestions 重复调用幂等复用缓存列表并写入 lastSearchIds（消除反复调用动机）', async () => {
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()]);
    const tools = createAgentTools(d);
    const search = tools.find((t) => t.name === 'searchQuestions')!;
    const r1 = await search.execute('call', {});
    // 顺序由统一排序决定（两个真实 id 都在即可，具体序见排序契约测试）
    expect(d.session.lastSearchIds).toEqual(expect.arrayContaining(['q-choice-1', 'q-open-1']));
    expect(d.session.lastSearchIds).toHaveLength(2);
    const text1 = (r1.content as { type: string; text: string }[]).map((c) => c.text).join('');
    expect(text1).toContain('找到 2 道候选题');
    // 重复调用（相同参数）→ 复用缓存、明确提示无需再调
    const r2 = await search.execute('call', {});
    const text2 = (r2.content as { type: string; text: string }[]).map((c) => c.text).join('');
    expect(text2).toContain('复用上次的候选列表');
    expect(text2).toContain('q-choice-1');
    expect(d.session.lastSearchIds).toEqual(expect.arrayContaining(['q-choice-1', 'q-open-1']));
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

  it('getCoverageGaps 报出题组合有、但用户没练过的 topic（uncovered）', async () => {
    // 题库含 attention / rag 两个 topic，profile 为空 → 两个都是覆盖缺口
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()]);
    const tools = createAgentTools(d);
    const gapsTool = tools.find((t) => t.name === 'getCoverageGaps')!;
    const r = await gapsTool.execute('call', {});
    const { gaps } = r.details as { gaps: { topic: string; reason: string }[] };
    expect(gaps.map((g) => g.topic).sort()).toEqual(['attention', 'rag']);
    expect(gaps.every((g) => g.reason === 'uncovered')).toBe(true);
    expect(r.content[0].text).toContain('attention');
  });

  it('getCoverageGaps 与 getUserWeaknesses 不重叠：已练但薄弱的 topic 不算覆盖缺口', async () => {
    const profile = emptyProfile();
    profile.topicStats['attention'] = {
      attempts: 3, avgScore: 40, lastScore: 40, trend: 'flat', mastery: 0.4,
      commonWeaknesses: ['未理解 QKV'], evidence: [], lastSeen: Date.now(),
    };
    profile.topicStats['rag'] = {
      attempts: 3, avgScore: 90, lastScore: 90, trend: 'flat', mastery: 0.9,
      commonWeaknesses: [], evidence: [], lastSeen: Date.now(),
    };
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()], profile);
    const tools = createAgentTools(d);

    // mastery-based：attention 薄弱 → 报出来
    const weakTopics = ((await tools.find((t) => t.name === 'getUserWeaknesses')!.execute('call', {})).details as { weakTopics: string[] }).weakTopics;
    expect(weakTopics).toEqual(['attention']);

    // coverage-based：两个 topic 都练过且前置不缺 → 没有覆盖缺口
    const { gaps } = (await tools.find((t) => t.name === 'getCoverageGaps')!.execute('call', {})).details as { gaps: unknown[] };
    expect(gaps).toEqual([]);
  });

  it('getCoverageGaps 报出前置缺口（prerequisite），且排在 uncovered 之前', async () => {
    // 真实概念图：tool-calling 的前置是 agent-fundamentals
    const bank = [
      makeQuestion({ id: 'q-fund', topic: 'agent-fundamentals' }),
      makeQuestion({ id: 'q-tool', topic: 'tool-calling' }),
    ];
    const profile = emptyProfile();
    profile.topicStats['tool-calling'] = {
      attempts: 2, avgScore: 50, lastScore: 50, trend: 'flat', mastery: 0.5,
      commonWeaknesses: [], evidence: [], lastSeen: Date.now(),
    };
    const d = deps(bank, profile);
    const tools = createAgentTools(d);
    const r = await tools.find((t) => t.name === 'getCoverageGaps')!.execute('call', {});
    const { gaps } = r.details as { gaps: { topic: string; reason: string; prerequisites?: string[] }[] };

    expect(gaps[0]).toEqual({ topic: 'tool-calling', reason: 'prerequisite', prerequisites: ['agent-fundamentals'] });
    expect(gaps[1]).toEqual({ topic: 'agent-fundamentals', reason: 'uncovered' });
    // 文案要让 Agent 看得懂「为什么不能上这道题」
    expect(r.content[0].text).toContain('前置 agent-fundamentals 尚未掌握');
  });

  it('getCoverageGaps 把缺口写入 session.log，供 UI 透明化', async () => {
    const d = deps([makeChoiceQuestion()]);
    const tools = createAgentTools(d);
    await tools.find((t) => t.name === 'getCoverageGaps')!.execute('call', {});
    const entry = d.session.log.find((e) => e.tool === 'getCoverageGaps');
    expect(entry).toBeDefined();
    expect((entry!.details as { gaps: unknown[] }).gaps).toHaveLength(1);
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

  it('C4 后：topic 全部考察完且无搜索结果时，不再回退全题库列出其它题，而是引导 Agent 用 searchQuestions', async () => {
    // 修复前：unasked 为空时执行 `unasked[0] ?? byTopic[0]`，会把已考察的 a1 再交一遍
    const d = deps([makeQuestion({ id: 'a1' }), makeQuestion({ id: 'a2' }), makeQuestion({ id: 'b1', topic: 'rag' })]);
    d.session.evaluations['a1'] = fakeOpenResult(80);
    d.session.evaluations['a2'] = fakeOpenResult(60);
    const r = await getQ(d).execute('call', { id: 'attention' });
    // 绝不重复交付已考察过的题（宁可不出题）
    expect(d.session.currentQuestion).toBeNull();
    expect((r.details as { error: string }).error).toBe('topic_exhausted');
    // C4 修复：没有 searchQuestions 结果时不回退全题库（b1 不应被列出），改为引导 Agent 主动搜索
    expect((r.details as { validIds: string[] }).validIds).toEqual([]);
    expect(textOf(r)).toContain('searchQuestions');
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

  it('not_found 自纠正只回带最近搜索中未考察的题号，不会把 Agent 指回刚问过的题（C4 后：必须来自 lastSearchIds，不再回退全题库）', async () => {
    const bank = [makeQuestion({ id: 'a1' }), makeQuestion({ id: 'a2' }), makeQuestion({ id: 'a3' })];
    const d = deps(bank);
    d.session.currentQuestion = { question: bank[0], format: 'choice' }; // a1 正在答（视为已交付）
    const tools = createAgentTools(d);
    const search = tools.find((t) => t.name === 'searchQuestions')!;
    await search.execute('call', {}); // 写入 lastSearchIds
    const getQ = tools.find((t) => t.name === 'getQuestion')!;
    const r = await getQ.execute('call', { id: 'nope' });
    expect((r.details as { error: string }).error).toBe('not_found');
    // 关键契约：只从最近一次搜索结果里回带「未考察」的题号，且不把正在答的 a1 指回去
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

// Chrome 走「工具清单注入 prompt」的路径，没有原生 function calling 可用。
// 工具 schema 越长，Chrome 每轮重发的 prompt 越大，挤占的正是对话历史的空间。
// 这组断言用**真实**工具定义做门禁：任何人给工具加字段导致清单膨胀，都会在这里被拦下。
describe('工具定义注入 Chrome prompt 的体积', () => {
  it('7 个真实工具的紧凑清单显著小于完整 JSON Schema，且每个工具名都在', () => {
    const tools = createAgentTools(deps([makeChoiceQuestion(), makeOpenQuestion()]));
    const prompt = buildUserPrompt({ systemPrompt: 'sys', messages: [], tools: tools as never });
    const section = prompt.slice(prompt.indexOf('## Available tools'));

    const asJson = tools.map((t) => `- ${t.name}: ${JSON.stringify(t.parameters)} — ${t.description}`).join('\n');
    // 实测基线：完整 schema 1312 字符 → 紧凑签名 947 字符（schema 部分 513 → 0，净省 28%）。
    // 相对阈值 0.8 足以拦住「又有人把 schema 塞回来」（那样两边都是 1312，直接失败）；
    // 绝对上限 1100 则防的是工具描述逐条变长这种温水式膨胀。
    expect(section.length).toBeLessThan(asJson.length * 0.8);
    expect(section.length).toBeLessThan(1100);
    // 体积降了，但工具名一个都不能少——少一个工具模型就调不到它
    for (const t of tools) expect(section).toContain(t.name);
  });

  it('getQuestion 的签名必须保留 id 必填与 format 联合字面量', () => {
    const tools = createAgentTools(deps([makeChoiceQuestion()]));
    const prompt = buildUserPrompt({ systemPrompt: 'sys', messages: [], tools: tools as never });
    expect(prompt).toContain('getQuestion(id: string, format?: "choice" | "open")');
  });

  it('无参工具不产生空括号以外的内容', () => {
    const tools = createAgentTools(deps([makeChoiceQuestion()]));
    const prompt = buildUserPrompt({ systemPrompt: 'sys', messages: [], tools: tools as never });
    expect(prompt).toContain('- finishInterview()');
    expect(prompt).toContain('- evaluateAnswer()');
  });
});

// ── P0 回归：会话级学习状态 / 候选排序 / 误解命中 / 必考点覆盖 ───────────────
describe('P0-1 会话级学习状态（有效画像，非冻结快照）', () => {
  it('本轮答错后 getUserWeaknesses 立即报出该主题（无需等 finishInterview 落库）', async () => {
    const d = deps([makeChoiceQuestion()]);
    d.session.currentQuestion = { question: makeChoiceQuestion(), format: 'choice' };
    d.session.answers['q-choice-1'] = [1]; // 答错 → 0 分
    const tools = createAgentTools(d);
    await tools.find((t) => t.name === 'evaluateAnswer')!.execute('call', {});
    const r = await tools.find((t) => t.name === 'getUserWeaknesses')!.execute('call', {});
    const { weakTopics } = r.details as { weakTopics: string[] };
    // 修复前：getUserWeaknesses 读创建工具时的空画像 → 报不出 attention
    expect(weakTopics).toContain('attention');
  });

  it('本轮答对 100 分不把主题误判为薄弱（有效画像与历史画像叠加）', async () => {
    const d = deps([makeChoiceQuestion()]);
    d.session.currentQuestion = { question: makeChoiceQuestion(), format: 'choice' };
    d.session.answers['q-choice-1'] = [0]; // 答对 → 100
    const tools = createAgentTools(d);
    await tools.find((t) => t.name === 'evaluateAnswer')!.execute('call', {});
    const r = await tools.find((t) => t.name === 'getUserWeaknesses')!.execute('call', {});
    const { weakTopics } = r.details as { weakTopics: string[] };
    expect(weakTopics).not.toContain('attention');
  });

  it('getWeakAngles 同样读有效画像：本轮答错的角度立即进入薄弱列表', async () => {
    const q = { ...makeChoiceQuestion(), angle: 'mechanism' as const };
    const d = deps([q]);
    d.session.currentQuestion = { question: q, format: 'choice' };
    d.session.answers['q-choice-1'] = [1];
    const tools = createAgentTools(d);
    await tools.find((t) => t.name === 'evaluateAnswer')!.execute('call', {});
    const r = await tools.find((t) => t.name === 'getWeakAngles')!.execute('call', { topic: 'attention' });
    const { weakAngles } = r.details as { weakAngles: string[] };
    expect(weakAngles).toContain('mechanism');
  });
});

describe('P0-2/P0-3 候选排序与已交付过滤（统一 rankCandidatePool 策略）', () => {
  const weakProfile = () => {
    const p = emptyProfile();
    p.topicStats['attention'] = {
      attempts: 3, avgScore: 40, lastScore: 40, trend: 'flat', mastery: 0.4,
      commonWeaknesses: [], evidence: [], lastSeen: 0,
    };
    p.topicStats['rag'] = {
      attempts: 3, avgScore: 95, lastScore: 95, trend: 'flat', mastery: 0.95,
      commonWeaknesses: [], evidence: [], lastSeen: 0,
    };
    return p;
  };

  it('薄弱主题的题排在前，已掌握主题最后（不再按题库原始顺序截取前 N）', async () => {
    const d = deps([makeOpenQuestion(), makeChoiceQuestion()], weakProfile());
    const tools = createAgentTools(d);
    const r = await tools.find((t) => t.name === 'searchQuestions')!.execute('call', {});
    // attention 薄弱（tier 0）→ 必须排在 rag（已掌握 tier 2）之前
    expect((r.details as { id: string; topic: string }[]).map((x) => x.topic)).toEqual([
      'attention',
      'rag',
    ]);
  });

  it('已交付的题从候选池剔除：问过的题不再出现，候选随本轮推进动态前移', async () => {
    const d = deps([makeChoiceQuestion(), makeOpenQuestion()]);
    const tools = createAgentTools(d);
    const search = tools.find((t) => t.name === 'searchQuestions')!;
    await search.execute('call', {});
    const first = [...d.session.lastSearchIds];
    expect(first).toContain('q-choice-1');
    expect(first).toContain('q-open-1');
    // 交付 q-choice-1 并评分（写入 evaluations）后重新搜索：只剩 q-open-1
    d.session.evaluations['q-choice-1'] = fakeOpenResult(80);
    const r2 = await search.execute('call', {});
    expect(d.session.lastSearchIds).toEqual(['q-open-1']);
    const text = textOf(r2);
    expect(text).not.toContain('q-choice-1');
    expect(text).toContain('q-open-1');
  });

  it('范围内题目全部考察完时给出「已全部考察过」提示，而非空列表', async () => {
    const d = deps([makeChoiceQuestion()]);
    d.session.evaluations['q-choice-1'] = fakeOpenResult(80);
    const tools = createAgentTools(d);
    const r = await tools.find((t) => t.name === 'searchQuestions')!.execute('call', {});
    expect(d.session.lastSearchIds).toEqual([]);
    expect(textOf(r)).toContain('均已考察过');
  });

  it('getQuestion topic 兜底同样走统一排序（薄弱主题优先）', async () => {
    const d = deps([makeOpenQuestion(), makeChoiceQuestion()], weakProfile());
    const tools = createAgentTools(d);
    // 直接传 topic 而非 id：应从 attention（薄弱）里选，而不是题库顺序的 rag
    const r = await tools.find((t) => t.name === 'getQuestion')!.execute('call', { id: 'attention' });
    expect((r.details as { id: string }).id).toBe('q-choice-1');
  });
});

describe('P0-5 选择题误解命中（misconceptionMap → 结构化反证证据）', () => {
  const misconceptionQuestion = (): Question => ({
    id: 'mis-q',
    category: 'rag',
    topic: 'rag',
    tags: [],
    difficulty: 'medium',
    question: '混合检索的两路分数应如何融合？',
    explanation: '需先归一化再加权融合。',
    misconceptions: ['以为向量检索可全面取代关键词检索', '以为融合顺序与归一化无关紧要'],
    formats: {
      choice: {
        type: 'single',
        options: ['先归一化再做加权融合', '直接拼接 Top-K 即可', '纯向量检索足够，无需关键词'],
        answer: [0],
        misconceptionMap: [null, 1, 0], // 选项1→误解[1]，选项2→误解[0]（与 options 等长索引对齐）
      },
    },
  });

  it('答错时按 misconceptionMap 命中对应误解，答对时不产生', async () => {
    const q = misconceptionQuestion();
    const d = deps([q]);
    d.session.currentQuestion = { question: q, format: 'choice' };
    d.session.answers['mis-q'] = [2]; // 选中「纯向量检索足够」→ 误解[0]
    const tools = createAgentTools(d);
    const r = await tools.find((t) => t.name === 'evaluateAnswer')!.execute('call', {});
    const result = r.details as EvaluationResult;
    expect(result.overall).toBe(0);
    expect(result.misconceptionIds).toEqual(['以为向量检索可全面取代关键词检索']);
    // 摘要文本把误解带进 Agent 上下文（details 不进上下文，正文必须可见）
    expect(textOf(r)).toContain('命中误解');
    expect(textOf(r)).toContain('以为向量检索可全面取代关键词检索');

    // 答对 → 无误解命中
    d.session.currentQuestion = { question: q, format: 'choice' };
    d.session.answers['mis-q'] = [0];
    const r2 = await tools.find((t) => t.name === 'evaluateAnswer')!.execute('call', {});
    expect((r2.details as EvaluationResult).misconceptionIds).toEqual([]);
    expect(textOf(r2)).not.toContain('命中误解');
  });

  it('未标注 misconceptionMap 的题目答错不产生误解信号（宁缺毋滥）', async () => {
    const d = deps([makeChoiceQuestion()]);
    d.session.currentQuestion = { question: makeChoiceQuestion(), format: 'choice' };
    d.session.answers['q-choice-1'] = [1];
    const tools = createAgentTools(d);
    const r = await tools.find((t) => t.name === 'evaluateAnswer')!.execute('call', {});
    const result = r.details as EvaluationResult;
    expect(result.overall).toBe(0);
    expect(result.misconceptionIds ?? []).toEqual([]);
  });
});

describe('P0-5 coverage 第二层：必考点证据缺口', () => {
  it('薄弱主题的必考点「已答错 N 次」被报出（angle 有题 ≠ 知识点被覆盖）', async () => {
    const d = deps([makeOpenQuestion()]); // rag 主题
    const profile = d.profile;
    profile.topicStats['rag'] = {
      attempts: 3, avgScore: 40, lastScore: 40, trend: 'flat', mastery: 0.4,
      commonWeaknesses: [], evidence: [], lastSeen: 0,
    };
    profile.conceptEvidence = {
      'rag|rag 解决知识问题而非理解问题：答案质量受检索质量上限制约': {
        misses: 2, lastScore: 25, lastSeenAt: 0,
        label: 'RAG 解决知识问题而非理解问题：答案质量受检索质量上限制约',
      },
    };
    const tools = createAgentTools(d);
    const r = await tools.find((t) => t.name === 'getCoverageGaps')!.execute('call', {});
    const { conceptGaps } = r.details as { conceptGaps: { point: string; status: string; misses: number }[] };
    expect(conceptGaps.length).toBeGreaterThan(0);
    const missed = conceptGaps.find((g) => g.status === 'missed');
    expect(missed).toBeDefined();
    expect(missed!.misses).toBe(2);
    expect(textOf(r)).toContain('已答错 2 次');
  });

  it('从未练过的主题：必考点标为「从未探测」', async () => {
    const d = deps([makeOpenQuestion()]); // rag 主题，空画像
    const tools = createAgentTools(d);
    const r = await tools.find((t) => t.name === 'getCoverageGaps')!.execute('call', {});
    const { conceptGaps } = r.details as { conceptGaps: { status: string }[] };
    expect(conceptGaps.length).toBeGreaterThan(0);
    expect(conceptGaps.every((g) => g.status === 'unprobed')).toBe(true);
    expect(textOf(r)).toContain('从未探测');
  });
});
