// 逐题反馈领域投影的单测（纯逻辑）。
// 关注点不是「评分对不对」（那是 evaluation.test.ts 的职责），而是：
// 评分结果 → 用户可读反馈 的**映射契约**是否稳定，尤其是「不适用维度」与「关键知识点回落」。

import { describe, it, expect } from 'vitest';
import { buildInterviewFeedback, feedbackBand, optionLetter, resolveAnswerText } from './interviewFeedback';
import type { EvaluationResult } from '../schemas/evaluation';
import type { Question } from '../schemas/question';

/** 构造一份评分结果，只覆盖断言关心的字段。 */
function evalResult(over: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    overall: 75,
    dimensions: { correctness: 75, completeness: 75, architecture: 75, communication: 75 },
    levels: { correctness: 3, completeness: 3, architecture: 3, communication: 3 },
    evidence: { correctness: '结论成立', completeness: '覆盖主要要点', architecture: '结构清晰', communication: '表达清楚' },
    strengths: ['答到了核心机制'],
    gaps: ['未展开容量估算'],
    missingConcepts: [],
    feedback: '整体不错。',
    ...over,
  };
}

/** topic = kv-cache：知识点层有 required，用于验证「关键知识点取自知识点层」。 */
function openQuestion(): Question {
  return {
    id: 'q-open',
    category: 'llm',
    topic: 'kv-cache',
    tags: ['fallback-tag'],
    difficulty: 'medium',
    angle: 'mechanism',
    question: 'KV Cache 的显存占用如何估算？',
    explanation: '按层数 × KV 头数 × head_dim 估算。',
    formats: { open: { referenceAnswer: '参考答案正文。' } },
  };
}

/** topic 在知识点层不存在，用于验证 tags 回落。 */
function unknownTopicQuestion(): Question {
  return {
    id: 'q-choice',
    category: 'x',
    topic: '__no_such_topic__',
    tags: ['tag-a', 'tag-b'],
    difficulty: 'easy',
    angle: 'definition',
    question: '以下哪个说法正确？',
    explanation: '解释。',
    formats: { choice: { type: 'single', options: ['选项一', '选项二', '选项三', '选项四'], answer: [0] } },
  };
}

describe('feedbackBand', () => {
  it('按 80 / 60 两档切分为三档', () => {
    expect(feedbackBand(100)).toEqual({ label: '优秀', tone: 'strong' });
    expect(feedbackBand(80)).toEqual({ label: '优秀', tone: 'strong' });
    expect(feedbackBand(79)).toEqual({ label: '基本合格', tone: 'fair' });
    expect(feedbackBand(60)).toEqual({ label: '基本合格', tone: 'fair' });
    expect(feedbackBand(59)).toEqual({ label: '需要加强', tone: 'weak' });
    expect(feedbackBand(0)).toEqual({ label: '需要加强', tone: 'weak' });
  });
});

describe('optionLetter', () => {
  it('下标 → 字母，与全站既有约定一致', () => {
    expect(optionLetter(0)).toBe('A');
    expect(optionLetter(1)).toBe('B');
    expect(optionLetter(5)).toBe('F');
  });
});

describe('resolveAnswerText', () => {
  it('选择题渲染为「A. 选项文本」，多选用「；」连接', () => {
    const q = unknownTopicQuestion();
    expect(resolveAnswerText(q, 'choice', [0])).toBe('A. 选项一');
    expect(resolveAnswerText(q, 'choice', [0, 2])).toBe('A. 选项一；C. 选项三');
  });

  it('选择题下标越界时忽略该下标而非抛错（脏数据不得打崩反馈卡）', () => {
    const q = unknownTopicQuestion();
    expect(resolveAnswerText(q, 'choice', [0, 99])).toBe('A. 选项一');
  });

  it('开放题原样返回文本', () => {
    const q = openQuestion();
    expect(resolveAnswerText(q, 'open', '我的回答')).toBe('我的回答');
  });
});

describe('buildInterviewFeedback', () => {
  it('关键知识点取自知识点层 required（而非题目 tags）', () => {
    const fb = buildInterviewFeedback(openQuestion(), 'open', '我的回答', evalResult());
    expect(fb.keyPoints).toEqual([
      '单 token 占用 = 2(K和V) × 层数 × KV头数 × head_dim × 每元素字节数',
      '缓存规模 ∝ 序列长度且随并发数相乘——容量规划的一阶变量',
    ]);
    expect(fb.keyPoints).not.toContain('fallback-tag');
  });

  it('知识点层查不到该 topic 时回落到题目 tags', () => {
    const fb = buildInterviewFeedback(unknownTopicQuestion(), 'choice', [0], evalResult({ overall: 0 }));
    expect(fb.keyPoints).toEqual(['tag-a', 'tag-b']);
  });

  it('四维映射：不适用维度标记 applicable=false，且不伪装成 0 分', () => {
    const fb = buildInterviewFeedback(
      openQuestion(),
      'open',
      '答',
      evalResult({
        dimensions: { correctness: 75, completeness: 75, architecture: 0, communication: 75 },
        applicable: { correctness: true, completeness: true, architecture: false, communication: true },
      }),
    );
    const arch = fb.dimensions.find((d) => d.key === 'architecture')!;
    expect(arch.applicable).toBe(false);
    // 关键：分数保留原始 0，但 applicable=false 让 UI 有据可依地显示「本题不适用」
    expect(arch.score).toBe(0);
    expect(arch.label).toBe('架构');
    // 其余维度仍适用
    expect(fb.dimensions.filter((d) => d.applicable).map((d) => d.key)).toEqual([
      'correctness',
      'completeness',
      'communication',
    ]);
  });

  it('applicable 缺省（历史数据）时视为四维全部适用', () => {
    const fb = buildInterviewFeedback(openQuestion(), 'open', '答', evalResult());
    expect(fb.dimensions.every((d) => d.applicable)).toBe(true);
  });

  it('透传 strengths / gaps / missingConcepts / 误解命中 / 评语 / 参考答案', () => {
    const fb = buildInterviewFeedback(
      openQuestion(),
      'open',
      '答',
      evalResult({
        strengths: ['s1'],
        gaps: ['g1'],
        missingConcepts: ['m1'],
        misconceptionIds: ['误以为 KV Cache 与序列长度无关'],
        feedback: '评语正文',
        referenceAnswer: '参考答案正文。',
      }),
    );
    expect(fb.strengths).toEqual(['s1']);
    expect(fb.gaps).toEqual(['g1']);
    expect(fb.missingConcepts).toEqual(['m1']);
    expect(fb.misconceptionIds).toEqual(['误以为 KV Cache 与序列长度无关']);
    expect(fb.comment).toBe('评语正文');
    // 参考答案进入投影，但**是否展示**由卡片控制（默认收起）
    expect(fb.referenceAnswer).toBe('参考答案正文。');
  });

  it('misconceptionIds 缺省时归一化为空数组（UI 无需判空）', () => {
    const fb = buildInterviewFeedback(openQuestion(), 'open', '答', evalResult());
    expect(fb.misconceptionIds).toEqual([]);
  });

  it('题干与作答回显：暂停后仍能看清「答的是哪道题、答了什么」', () => {
    const fb = buildInterviewFeedback(unknownTopicQuestion(), 'choice', [2], evalResult({ overall: 0 }));
    expect(fb.questionText).toBe('以下哪个说法正确？');
    expect(fb.format).toBe('choice');
    expect(fb.answerText).toBe('C. 选项三');
    expect(fb.answer).toEqual([2]);
    expect(fb.questionId).toBe('q-choice');
    expect(fb.band).toEqual({ label: '需要加强', tone: 'weak' });
  });
});
