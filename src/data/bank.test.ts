// 题库数据完整性测试：拆分文件后替代人工核对，防止坏数据进入运行时。
// 覆盖：id 唯一、类目与文件一致、选择题 answer 合法、开放题有参考答案、
// rubric 权重合法、conceptGraph 前置节点都有题目支撑。纯静态校验，无 LLM/网络。

import { describe, expect, it } from 'vitest';
import { EVAL_DIMENSIONS, type ChoiceQuestion, type Question } from '../types';
import { questionBank } from './questionBank';
import { conceptGraph } from '../domain/conceptGraph';

const qs = questionBank.questions;

describe('题库数据完整性', () => {
  it('非空且有 id，id 全局唯一', () => {
    expect(qs.length).toBeGreaterThan(0);
    const ids = qs.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个文件的 category 与文件名一致，categories 列表与之吻合', () => {
    for (const q of qs) {
      expect(questionBank.categories).toContain(q.category);
    }
    const fileCats = new Set(qs.map((q) => q.category));
    // categories 由文件名生成，不应包含没有任何题目的类目
    expect(new Set(questionBank.categories)).toEqual(fileCats);
  });

  it('选择题：options 非空且 answer 索引全部合法', () => {
    for (const q of qs.filter((x): x is ChoiceQuestion => x.type === 'single' || x.type === 'multiple')) {
      expect(q.options.length, q.id).toBeGreaterThan(0);
      expect(q.answer.length, q.id).toBeGreaterThan(0);
      for (const i of q.answer) {
        expect(i, q.id).toBeGreaterThanOrEqual(0);
        expect(i, q.id).toBeLessThan(q.options.length);
      }
      if (q.type === 'single') expect(q.answer, q.id).toHaveLength(1);
    }
  });

  it('开放题：referenceAnswer 非空', () => {
    for (const q of qs.filter((x): x is Question & { referenceAnswer: string } => x.type === 'essay' || x.type === 'coding')) {
      expect(q.referenceAnswer.trim().length, q.id).toBeGreaterThan(0);
    }
  });

  it('difficulty 与 type 取值都在类型枚举内', () => {
    const difficulties = new Set(['easy', 'medium', 'hard']);
    const types = new Set(['single', 'multiple', 'essay', 'coding']);
    for (const q of qs) {
      expect(difficulties.has(q.difficulty), `${q.id} difficulty=${q.difficulty}`).toBe(true);
      expect(types.has(q.type), `${q.id} type=${q.type}`).toBe(true);
      expect(q.topic.trim().length, q.id).toBeGreaterThan(0);
    }
  });

  it('rubric：dimensions 键合法且权重和不超过 1', () => {
    for (const q of qs) {
      if (!q.rubric?.dimensions) continue;
      const entries = Object.entries(q.rubric.dimensions);
      for (const [k, w] of entries) {
        expect(EVAL_DIMENSIONS, `${q.id} 维度 ${k}`).toContain(k);
        expect(w!, q.id).toBeGreaterThan(0);
      }
      const sum = entries.reduce((acc, [, w]) => acc + (w ?? 0), 0);
      expect(sum, q.id).toBeLessThanOrEqual(1.0001);
    }
  });

  it('conceptGraph 的前置边两端 topic 都有题目支撑（无悬空节点）', () => {
    const topics = new Set(qs.map((q) => q.topic));
    for (const e of conceptGraph.edges) {
      expect(topics.has(e.from), `缺 from 题目: ${e.from}`).toBe(true);
      expect(topics.has(e.to), `缺 to 题目: ${e.to}`).toBe(true);
    }
  });
});
