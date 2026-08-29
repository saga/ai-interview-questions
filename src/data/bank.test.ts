// 题库数据完整性测试：替代人工核对，防止坏数据进入运行时。
// 覆盖：id 唯一、类目与文件一致、双形态数据合法（ADR-027 数据契约）、
// explanation 非空（ADR-044 后为题目级评分锚点）、conceptGraph 前置节点都有题目支撑。
// 纯静态校验，无 LLM/网络。

import { describe, expect, it } from 'vitest';
import { questionBank } from './questionBank';
import { conceptGraph } from '../domain/conceptGraph';
import { knowledgeNodes } from './knowledgeMap';

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
      if (cf.type === 'multiple') {
        expect(cf.answer.length, q.id).toBeGreaterThanOrEqual(2);
        expect(new Set(cf.answer).size, q.id).toBe(cf.answer.length);
      }
      if (cf.question !== undefined) {
        expect(cf.question.trim().length, `${q.id} choice 场景题干为空`).toBeGreaterThan(0);
      }
    }
  });

  it('open 形态：referenceAnswer 非空', () => {
    for (const q of qs) {
      const of = q.formats.open;
      if (!of) continue;
      expect(of.referenceAnswer.trim().length, q.id).toBeGreaterThan(0);
    }
  });

  it('choice/open 双形态的正确答案一致，且没有明显占位选项', () => {
    const placeholderPatterns = [/参见解析/, /上述方法/, /原题中/, /本文提到/];
    for (const q of qs) {
      const choice = q.formats.choice;
      if (!choice) continue;
      for (const option of choice.options) {
        expect(placeholderPatterns.some((pattern) => pattern.test(option)), `${q.id} 存在占位或原题指代选项`).toBe(false);
      }
      const open = q.formats.open;
      if (!open) continue;
      const answerMatch = open.referenceAnswer.match(/正确答案\s*([A-Z](?:\s*[,、和]\s*[A-Z])*)/i);
      if (answerMatch) {
        const expected = choice.answer.map((index) => String.fromCharCode(65 + index)).sort();
        const actual = (answerMatch[1].match(/[A-Z]/gi) ?? []).map((label) => label.toUpperCase()).sort();
        expect(actual, `${q.id} open 参考答案与 choice 答案不一致`).toEqual(expected);
      }
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

  // ADR-044：题目级 rubric 已删除，explanation 接替成为题目级评分锚点，故它必须非空
  it('explanation 非空（评分锚点依赖它）', () => {
    for (const q of qs) {
      expect(q.explanation?.trim().length ?? 0, `${q.id} explanation 为空`).toBeGreaterThan(0);
    }
  });

  it('conceptGraph 的前置边两端 topic 都有题目支撑（无悬空节点）', () => {
    const topics = new Set(qs.map((q) => q.topic));
    for (const e of conceptGraph.edges) {
      expect(topics.has(e.from), `缺 from 题目: ${e.from}`).toBe(true);
      expect(topics.has(e.to), `缺 to 题目: ${e.to}`).toBe(true);
    }
  });

  it('每个题目的 topic 都能映射到知识节点 id（防孤儿漂移）', () => {
    const nodeIds = new Set(knowledgeNodes.map((n) => n.id));
    for (const q of qs) {
      expect(nodeIds.has(q.topic), `${q.id} topic "${q.topic}" 未映射到任何知识节点 id`).toBe(true);
    }
  });
});
