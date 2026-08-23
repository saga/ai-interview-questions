// 题型变换测试：LLM 输出全部 mock，不发网络。
// 核心断言（ADR-024 修订版分工）：内容交给 LLM（开放→选择时 LLM 产出完整选择题），
// 结构交给代码（洗牌后按文本匹配重算 answer 索引、校验输出格式），id 保持原题。

import { describe, expect, it } from 'vitest';
import { composeOpenReference, transformQuestionWith } from './transform';
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

describe('composeOpenReference（纯函数）', () => {
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
});

describe('transformToOpen：选择 → 开放', () => {
  it('题干来自 LLM，referenceAnswer 由代码合成，id 不变', async () => {
    const complete = async () => '{"question":"请解释为什么 Agent 需要分层记忆设计？"}';
    const r = (await transformQuestionWith(choiceQ, 'essay', complete)) as OpenQuestion;
    expect(r.type).toBe('essay');
    expect(r.id).toBe('q-1');
    expect(r.transformedFrom).toBe('single'); // 溯源字段：形态来自单选题
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

describe('transformToChoice：开放 → 选择（LLM 产出完整选择题，代码保结构）', () => {
  // mock LLM 输出：options 数组 + correct 序号标注（LLM 自己的顺序）
  const singlePayload = JSON.stringify({
    question: '以下关于 Agent 记忆的说法，正确的是？',
    options: ['长期记忆随会话结束丢弃', '短期记忆是上下文窗口内的工作状态', '记忆分层无法检索', '短期记忆存在向量库里'],
    correct: [1],
  });
  const multiPayload = JSON.stringify({
    question: '以下关于 Agent 记忆的说法，正确的有哪些？（多选）',
    options: [
      '短期记忆是上下文窗口内的工作状态',
      '长期记忆靠外部存储持久化',
      '两者通过检索机制衔接',
      '记忆分层已被证明无用',
    ],
    correct: [0, 2, 3],
  });

  it('单选：answer 索引在洗牌后仍指向 LLM 标注的正确项文本，id 不变', async () => {
    const r = (await transformQuestionWith(openQ, 'single', async () => singlePayload, () => 0.1)) as ChoiceQuestion;
    expect(r.type).toBe('single');
    expect(r.id).toBe('q-2');
    expect(r.transformedFrom).toBe('essay'); // 溯源字段：形态来自开放题
    expect(r.options).toHaveLength(4);
    expect([...new Set(r.options)]).toHaveLength(4); // 无重复
    expect(r.answer).toHaveLength(1);
    expect(r.options[r.answer[0]]).toBe('短期记忆是上下文窗口内的工作状态'); // 文本匹配重算索引
  });

  it('多选：answer 指向全部正确项且升序排列', async () => {
    const correctTexts = ['短期记忆是上下文窗口内的工作状态', '两者通过检索机制衔接', '记忆分层已被证明无用'];
    const r = (await transformQuestionWith(openQ, 'multiple', async () => multiPayload, () => 0.3)) as ChoiceQuestion;
    expect(r.type).toBe('multiple');
    expect(r.answer.length).toBe(3);
    for (let i = 1; i < r.answer.length; i++) expect(r.answer[i]).toBeGreaterThan(r.answer[i - 1]); // 升序
    for (const i of r.answer) expect(correctTexts).toContain(r.options[i]);
    for (const c of correctTexts) expect(r.options.filter((o) => o === c)).toHaveLength(1);
  });

  it('多选请求但 LLM 只标 1 个正确项时降级为单选', async () => {
    const oneCorrect = JSON.stringify({
      question: 'x',
      options: ['对的说法', '错误一', '错误二', '错误三'],
      correct: [0],
    });
    const r = (await transformQuestionWith(openQ, 'multiple', async () => oneCorrect, () => 0.3)) as ChoiceQuestion;
    expect(r.type).toBe('single');
    expect(r.answer).toHaveLength(1);
    expect(r.options[r.answer[0]]).toBe('对的说法');
  });

  it('正确项序号越界/缺失时抛错；单选标注多个正确项也抛错', async () => {
    const outOfRange = JSON.stringify({ question: 'x', options: ['a', 'b', 'c', 'd'], correct: [9] });
    await expect(transformQuestionWith(openQ, 'single', async () => outOfRange)).rejects.toThrow();
    const none = JSON.stringify({ question: 'x', options: ['a', 'b', 'c', 'd'], correct: [] });
    await expect(transformQuestionWith(openQ, 'single', async () => none)).rejects.toThrow();
    const manyForSingle = JSON.stringify({ question: 'x', options: ['a', 'b', 'c', 'd'], correct: [0, 1] });
    await expect(transformQuestionWith(openQ, 'single', async () => manyForSingle)).rejects.toThrow('恰好 1 个');
  });

  it('重复选项被去重；去重后数量不足则抛错', async () => {
    const withDup = JSON.stringify({
      question: 'x',
      options: ['甲', '乙', '乙', '丙'],
      correct: [0],
    });
    const r = (await transformQuestionWith(openQ, 'single', async () => withDup, () => 0.5)) as ChoiceQuestion;
    const chosen = r.options[r.answer[0]]; // 先取值，避免下方 sort 断言污染数组
    expect(chosen).toBe('甲');
    expect([...r.options].sort()).toEqual(['丙', '甲', '乙'].sort()); // 去重后 3 个

    const tooFew = JSON.stringify({ question: 'x', options: ['甲', '甲', '乙'], correct: [0] });
    await expect(transformQuestionWith(openQ, 'single', async () => tooFew)).rejects.toThrow('选项数量');
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

describe('prompt 边界与不支持的目标', () => {
  it('开放→选择时 prompt 包含题目与参考答案（LLM 据此出完整选择题）', async () => {
    let seenUser = '';
    await transformQuestionWith(openQ, 'multiple', async (_s, user) => {
      seenUser = user;
      return JSON.stringify({ question: 'x', options: ['a', 'b', 'c', 'd'], correct: [0] });
    }, () => 0.5);
    expect(seenUser).toContain(openQ.question);
    expect(seenUser).toContain('参考答案');
    expect(seenUser).toContain('检索机制'); // 参考答案原文进 prompt
  });

  it('选择→开放时 prompt 只含题干与主题，不含 options/answer/referenceAnswer', async () => {
    let seenUser = '';
    await transformQuestionWith(choiceQ, 'essay', async (_s, user) => {
      seenUser = user;
      return '{"question":"改写后的开放题"}';
    });
    for (const opt of choiceQ.options) expect(seenUser).not.toContain(opt);
    expect(seenUser).not.toContain(choiceQ.explanation);
    expect(seenUser).toContain(choiceQ.question);
    expect(seenUser).toContain(choiceQ.topic);
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
      JSON.stringify({ question: '以下关于记忆的说法正确的是？', options: ['对', '错一', '错二', '错三'], correct: [0] });
    const r = (await transformQuestionWith(openQ, 'single', complete)) as Question;
    expect(r.aiGenerated).toBe(true);
    expect(r.category).toBe(openQ.category);
    expect(r.topic).toBe(openQ.topic);
    expect(r.difficulty).toBe(openQ.difficulty);
  });
});
