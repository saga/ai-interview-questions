// 题库数据完整性测试：替代人工核对，防止坏数据进入运行时。
// 覆盖：id 唯一、类目与文件一致、双形态数据合法（ADR-027 数据契约）、
// rubric 权重合法、conceptGraph 前置节点都有题目支撑。纯静态校验，无 LLM/网络。

import { describe, expect, it } from 'vitest';
import { EVAL_DIMENSIONS } from '../types';
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

  it('每道题至少携带一种形态（formats.choice 或 formats.open）', () => {
    for (const q of qs) {
      const hasChoice = !!q.formats.choice;
      const hasOpen = !!q.formats.open;
      expect(hasChoice || hasOpen, `${q.id} 无任何可用形态`).toBe(true);
    }
  });

  it('choice 形态：options 非空、answer 索引合法；single 恰好一个答案', () => {
    for (const q of qs) {
      const cf = q.formats.choice;
      if (!cf) continue;
      expect(cf.options.length, q.id).toBeGreaterThan(1);
      expect(new Set(cf.options).size, `${q.id} options 有重复项`).toBe(cf.options.length);
      expect(cf.answer.length, q.id).toBeGreaterThan(0);
      for (const i of cf.answer) {
        expect(i, q.id).toBeGreaterThanOrEqual(0);
        expect(i, q.id).toBeLessThan(cf.options.length);
      }
      if (cf.type === 'single') expect(cf.answer, q.id).toHaveLength(1);
      if (cf.type === 'multiple') expect(new Set(cf.answer).size, q.id).toBe(cf.answer.length);
    }
  });

  it('open 形态：referenceAnswer 非空', () => {
    for (const q of qs) {
      const of = q.formats.open;
      if (!of) continue;
      expect(of.referenceAnswer.trim().length, q.id).toBeGreaterThan(0);
    }
  });

  it('difficulty 取值合法、topic 非空', () => {
    const difficulties = new Set(['easy', 'medium', 'hard']);
    for (const q of qs) {
      expect(difficulties.has(q.difficulty), `${q.id} difficulty=${q.difficulty}`).toBe(true);
      expect(q.topic.trim().length, q.id).toBeGreaterThan(0);
      expect(q.question.trim().length, q.id).toBeGreaterThan(0);
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
