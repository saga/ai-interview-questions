// 纯逻辑测试：开放题评估的提示词构建与结果解析。
// 分数所有权（ADR-019）：LLM 只给四维 dimensions，综合分由 domain/aggregateOverall 计算。

import { describe, expect, it } from 'vitest';
import { buildEvalUser, parseEvaluation } from './evaluate';
import type { OpenFormat, Question, ScoringRubric } from '../types';

const RUBRIC: ScoringRubric = { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 };

const q: Question = {
  id: 'q1',
  category: 'agentic-ai',
  topic: 'memory',
  tags: [],
  difficulty: 'medium',
  question: '什么是 Agent 记忆？',
  explanation: '',
  formats: {},
};

const open: OpenFormat = {
  referenceAnswer: '短期=上下文；长期=持久化知识库。',
};

describe('buildEvalUser', () => {
  it('包含题目、参考答案与候选人回答', () => {
    const s = buildEvalUser(q, open, '我的回答', { rubric: RUBRIC });
    expect(s).toContain('什么是 Agent 记忆？');
    expect(s).toContain('短期=上下文');
    expect(s).toContain('我的回答');
  });

  it('未作答时以（未作答）占位', () => {
    expect(buildEvalUser(q, open, '')).toContain('（未作答）');
  });

  it('required 要点注入提示词', () => {
    const s = buildEvalUser(q, open, 'a', { requiredPoints: ['短期记忆', '长期记忆'] });
    expect(s).toContain('- 短期记忆');
    expect(s).toContain('- 长期记忆');
  });

  // ADR-044：题目级 rubric 删除后，explanation 接替成为题目级评分锚点
  it('题目解析（explanation）作为题目级评分锚点注入提示词', () => {
    const withExplanation: Question = { ...q, explanation: '记忆分短期上下文与长期持久化两类' };
    const s = buildEvalUser(withExplanation, open, 'a');
    expect(s).toContain('题目解析');
    expect(s).toContain('记忆分短期上下文与长期持久化两类');
  });

  it('explanation 为空时不产生多余的解析段落', () => {
    const s = buildEvalUser(q, open, 'a');
    expect(s).not.toContain('题目解析');
  });
});

describe('parseEvaluation', () => {
  it('解析四维并按权重聚合 overall（忽略 LLM 的任何 overall 输出）', () => {
    const raw = JSON.stringify({
      correctness: 90,
      completeness: 80,
      architecture: 70,
      communication: 60,
      overall: 99, // LLM 直出的分数必须被忽略
      feedback: '不错',
      strengths: ['要点全'],
      gaps: ['缺例子'],
    });
    const r = parseEvaluation(raw, open, RUBRIC);
    expect(r.dimensions).toEqual({ correctness: 90, completeness: 80, architecture: 70, communication: 60 });
    expect(r.overall).toBe(90 * 0.4 + 80 * 0.2 + 70 * 0.2 + 60 * 0.2); // = 78
    expect(r.overall).not.toBe(99);
    expect(r.feedback).toBe('不错');
    expect(r.strengths).toEqual(['要点全']);
    expect(r.gaps).toEqual(['缺例子']);
  });

  it('空输入 → 全零分 + 未作答反馈', () => {
    const r = parseEvaluation('', open, RUBRIC);
    expect(r.overall).toBe(0);
    expect(r.feedback).toBe('未作答。');
    expect(r.referenceAnswer).toBe(open.referenceAnswer);
  });

  it('残缺 JSON → 缺失维度按 0 分兜底', () => {
    const r = parseEvaluation('{"correctness": 50, "feedback": "部分"}', q, RUBRIC);
    expect(r.dimensions.correctness).toBe(50);
    expect(r.dimensions.completeness).toBe(0);
    expect(r.overall).toBe(20); // 50*0.4
  });

  it('维度分越界被钳制到 [0,100]', () => {
    const r = parseEvaluation(
      JSON.stringify({ correctness: 150, completeness: -5, architecture: 0, communication: 0 }),
      q,
      RUBRIC,
    );
    expect(r.dimensions.correctness).toBe(100);
    expect(r.dimensions.completeness).toBe(0);
  });
});
