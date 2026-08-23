// 题型变换测试：LLM 输出全部 mock，不发网络。
// 核心断言：答案 key 由代码从原题权威字段合成（ADR-019 延伸），id 保持原题。

import { describe, expect, it } from 'vitest';
import {
  composeOpenReference,
  deriveCorrectStatement,
  deriveCorrectStatements,
  transformQuestionWith,
} from './transform';
import type { ChoiceQuestion, OpenQuestion, Question } from '../types';

const choiceQ: ChoiceQuestion = {
  id: 'q-1',
  category: 'agentic-ai',
  topic: 'memory',
  tags: ['llm'],
  difficulty: 'medium',
  type: 'single',
  question: '下列哪项是 Agent 的短期记忆？',
  options: ['上下文窗口内的对话状态', '向量数据库', '微调参数', '硬盘文件'],
  answer: [0],
  explanation: '短期记忆指上下文窗口内的工作记忆。',
};

const openQ: OpenQuestion = {
  id: 'q-2',
  category: 'agentic-ai',
  topic: 'memory',
  tags: [],
  difficulty: 'medium',
  type: 'essay',
  question: '请解释 Agent 记忆分层的设计。',
  referenceAnswer:
    '短期记忆是上下文窗口内的工作状态，随会话结束丢弃。长期记忆靠外部存储持久化。两者通过检索机制衔接。',
  explanation: '',
};

describe('composeOpenReference / deriveCorrectStatement（纯函数）', () => {
  it('参考答案 = 概念 + 解析 + 正确选项原文', () => {
    const ref = composeOpenReference({
      ...choiceQ,
      answer: [0, 1],
      options: ['A说法', 'B说法', 'C干扰', 'D干扰'],
      explanation: '这是解析。',
      reference: { concept: '记忆分层概念' },
    });
    expect(ref).toContain('记忆分层概念');
    expect(ref).toContain('这是解析。');
    expect(ref).toContain('正确说法：A说法；B说法');
  });

  it('正确表述取参考答案首个成句片段并截断到 120 字', () => {
    expect(deriveCorrectStatement(openQ)).toBe('短期记忆是上下文窗口内的工作状态，随会话结束丢弃。');
  });

  it('referenceAnswer 过短无法提取时抛错', () => {
    expect(() => deriveCorrectStatement({ ...openQ, referenceAnswer: '短' })).toThrow();
  });
});

describe('transformToOpen：选择 → 开放', () => {
  it('题干来自 LLM，referenceAnswer 由代码合成，id 不变', async () => {
    const complete = async () => '{"question":"请解释为什么 Agent 需要分层记忆设计？"}';
    const r = (await transformQuestionWith(choiceQ, 'essay', complete)) as OpenQuestion;
    expect(r.type).toBe('essay');
    expect(r.id).toBe('q-1');
    expect(r.question).toBe('请解释为什么 Agent 需要分层记忆设计？');
    expect(r.referenceAnswer).toBe(composeOpenReference(choiceQ));
    expect(r.referenceAnswer).toContain('上下文窗口内的对话状态'); // 正确选项原文进参考答案
    expect((r as unknown as ChoiceQuestion).options).toBeUndefined();
  });

  it('LLM 输出缺题干时抛错', async () => {
    const complete = async () => '{"foo":1}';
    await expect(transformQuestionWith(choiceQ, 'essay', complete)).rejects.toThrow('题干');
  });

  it('已是开放题时原样返回，不调用 LLM', async () => {
    let called = 0;
    const complete = async () => {
      called++;
      return '{}';
    };
    const r = await transformQuestionWith(openQ, 'coding', complete);
    expect(r).toBe(openQ);
    expect(called).toBe(0);
  });
});

describe('transformToChoice：开放 → 选择（单选 / 多选）', () => {
  const correct = deriveCorrectStatement(openQ);
  const singlePayload =
    '{"question":"以下关于 Agent 记忆的说法，正确的是？","distractors":["长期记忆随会话结束丢弃","短期记忆存在向量库里","记忆分层无法检索"]}';
  const multiPayload =
    '{"question":"以下关于 Agent 记忆的说法，正确的有哪些？（多选）","distractors":["长期记忆随会话结束丢弃","短期记忆存在向量库里","记忆分层无法检索"]}';

  it('单选：正确选项由代码合成，answer 索引在洗牌后仍指向它，id 不变', async () => {
    // rng 固定 0.9 → 洗牌确定；验证 answer 与 options 对齐即可
    const r = (await transformQuestionWith(openQ, 'single', async () => singlePayload, () => 0.1)) as ChoiceQuestion;
    expect(r.type).toBe('single');
    expect(r.id).toBe('q-2');
    expect(r.options).toHaveLength(4);
    expect([...new Set(r.options)]).toHaveLength(4); // 无重复
    expect(r.answer).toHaveLength(1);
    expect(r.options[r.answer[0]]).toBe(correct); // 关键：答案 key 指向代码合成的正确表述
    expect(r.options.filter((o) => o === correct)).toHaveLength(1);
  });

  it('多选：参考答案多个成句片段各成一个正确项，answer 指向全部正确选项', async () => {
    const corrects = deriveCorrectStatements(openQ); // 参考答案有 3 个成句片段
    expect(corrects.length).toBeGreaterThanOrEqual(2);
    const r = (await transformQuestionWith(openQ, 'multiple', async () => multiPayload, () => 0.3)) as ChoiceQuestion;
    expect(r.type).toBe('multiple');
    expect(r.id).toBe('q-2');
    expect(r.answer.length).toBe(corrects.length);
    for (const i of r.answer) {
      expect(corrects).toContain(r.options[i]); // 每个答案索引都指向权威正确表述
    }
    // 正确项不重复出现
    for (const c of corrects) {
      expect(r.options.filter((o) => o === c)).toHaveLength(1);
    }
  });

  it('多选请求但参考答案只能提取 1 个表述时回退为单选', async () => {
    const thin: OpenQuestion = { ...openQ, referenceAnswer: '唯一正确的句子在这里没有别的了。' };
    const r = (await transformQuestionWith(thin, 'multiple', async () => singlePayload, () => 0.3)) as ChoiceQuestion;
    expect(r.type).toBe('single');
    expect(r.answer).toHaveLength(1);
  });

  it('干扰项与正确表述重复时被剔除；全部无效则抛错', async () => {
    const withDup = JSON.stringify({
      question: 'x',
      distractors: [correct, correct, '另一个错误', '再一个错误'],
    });
    const r = (await transformQuestionWith(openQ, 'single', async () => withDup, () => 0.5)) as ChoiceQuestion;
    expect(r.options.filter((o) => o === correct)).toHaveLength(1);

    const allDup = JSON.stringify({ question: 'x', distractors: [correct, correct] });
    await expect(transformQuestionWith(openQ, 'single', async () => allDup)).rejects.toThrow('干扰项');
  });

  it('已是选择题时原样返回，不调用 LLM', async () => {
    let called = 0;
    const complete = async () => {
      called++;
      return '{}';
    };
    const r = await transformQuestionWith(choiceQ, 'multiple', complete);
    expect(r).toBe(choiceQ);
    expect(called).toBe(0);
  });

  it('非法 JSON 抛错（extractJSON 兜底失败路径）', async () => {
    await expect(transformQuestionWith(openQ, 'single', async () => '完全不是 JSON')).rejects.toThrow();
  });

  it('变换结果不残留来源题型专属字段（字段卫生）', async () => {
    const toOpen = (await transformQuestionWith(choiceQ, 'essay', async () => '{"question":"为什么需要记忆分层？"}')) as OpenQuestion;
    expect(toOpen.referenceAnswer.length).toBeGreaterThan(0);
    expect('options' in toOpen).toBe(false);
    expect('answer' in toOpen).toBe(false);

    const toChoice = (await transformQuestionWith(openQ, 'multiple', async () => multiPayload, () => 0.3)) as ChoiceQuestion;
    expect('referenceAnswer' in toChoice).toBe(false);
    expect('language' in toChoice).toBe(false);
  });
});

describe('安全边界：LLM 不接触答案数据', () => {
  it('选择→开放时 prompt 只含题干与主题，不含 options/answer/referenceAnswer', async () => {
    let seenSystem = '';
    let seenUser = '';
    await transformQuestionWith(choiceQ, 'essay', async (system, user) => {
      seenSystem = system;
      seenUser = user;
      return '{"question":"改写后的开放题"}';
    });
    for (const opt of choiceQ.options) expect(seenUser).not.toContain(opt);
    expect(seenUser).not.toContain(choiceQ.explanation);
    expect(seenUser).toContain(choiceQ.question);
    expect(seenUser).toContain(choiceQ.topic);
    // referenceAnswer 由代码合成自权威字段，不经 LLM
    expect(composeOpenReference(choiceQ)).toContain(choiceQ.options[choiceQ.answer[0]]);
    void seenSystem;
  });

  it('coding 目标不被支持：原样返回且不调用 LLM（不冒充编程题）', async () => {
    let called = 0;
    const complete = async () => {
      called++;
      return '{}';
    };
    const r = await transformQuestionWith(openQ, 'coding', complete);
    const rc = await transformQuestionWith(choiceQ, 'coding', complete);
    expect(r).toBe(openQ);
    expect(rc).toBe(choiceQ);
    expect(called).toBe(0);
  });
});

describe('变换后题目可继续走变体管线（结构兼容）', () => {
  it('变换产物满足 Question 结构且 aiGenerated 标记为 true', async () => {
    const complete = async () =>
      '{"question":"以下关于记忆的说法正确的是？","distractors":["错误一","错误二","错误三"]}';
    const r = (await transformQuestionWith(openQ, 'single', complete)) as Question;
    expect(r.aiGenerated).toBe(true);
    expect(r.category).toBe(openQ.category);
    expect(r.topic).toBe(openQ.topic);
    expect(r.difficulty).toBe(openQ.difficulty);
  });
});
