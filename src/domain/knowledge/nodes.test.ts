// 知识点层数据完整性测试：id 唯一、字段合法、无悬空节点（每个知识点都有题目支撑）、
// 覆盖度统计正确。纯静态校验，无 LLM/网络。

import { describe, expect, it } from 'vitest';
import type { KnowledgeNode } from '../../schemas/knowledge';
import type { Question } from '../../schemas/question';
import { knowledgeNodes } from '../../data/knowledgeMap';
import { questionBank } from '../../data/questionBank';
import { KNOWLEDGE_AREA_LABELS, knowledgeById, knowledgeCoverage, requiredPointsFor } from './nodes';

const AREAS = Object.keys(KNOWLEDGE_AREA_LABELS);
const PRIORITIES = ['P0', 'P1', 'P2'];
// 角度白名单须与 questionAngleSchema（ADR-037 起为 10 角度）保持一致：definition / fundamental /
// mechanism / comparison / calculation / tradeoff / scenario / debugging / system-design / design。
const ANGLES = ['definition', 'fundamental', 'mechanism', 'comparison', 'calculation', 'tradeoff', 'scenario', 'debugging', 'system-design', 'design'];

describe('知识点层数据完整性', () => {
  it('非空且 id 全局唯一、kebab-case 格式', () => {
    expect(knowledgeNodes.length).toBeGreaterThan(0);
    const ids = knowledgeNodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('字段取值合法：area / priority / angles 在白名单内', () => {
    for (const n of knowledgeNodes) {
      expect(AREAS, `${n.id} area=${n.area}`).toContain(n.area);
      expect(PRIORITIES, `${n.id} priority=${n.priority}`).toContain(n.priority);
      expect(n.angles.length, n.id).toBeGreaterThan(0);
      for (const a of n.angles) expect(ANGLES, `${n.id} angle=${a}`).toContain(a);
      expect(new Set(n.angles).size, `${n.id} angles 有重复`).toBe(n.angles.length);
    }
  });

  it('修饰素材齐备：summary / required / misconceptions 非空', () => {
    for (const n of knowledgeNodes) {
      expect(n.name.trim().length, n.id).toBeGreaterThan(0);
      expect(n.summary.trim().length, n.id).toBeGreaterThan(0);
      expect(n.required.length, n.id).toBeGreaterThan(0);
      for (const r of n.required) expect(r.trim().length, `${n.id} required 项为空`).toBeGreaterThan(0);
      expect(n.misconceptions.length, n.id).toBeGreaterThan(0);
      for (const m of n.misconceptions) expect(m.trim().length, `${n.id} misconception 为空`).toBeGreaterThan(0);
    }
  });

  it('无悬空节点：每个知识点的 topic 都有题目支撑（与 conceptGraph 同规则）', () => {
    const topics = new Set(questionBank.questions.map((q) => q.topic));
    for (const n of knowledgeNodes) {
      expect(topics.has(n.id), `知识点 ${n.id} 缺少任何题目支撑`).toBe(true);
    }
  });

  it('题目 angle 标注合法：取值在六角度白名单内（ADR-032）', () => {
    for (const q of questionBank.questions) {
      if (q.angle !== undefined) expect(ANGLES, `${q.id} angle=${q.angle}`).toContain(q.angle);
    }
  });
});

describe('knowledgeById / requiredPointsFor', () => {
  it('按 id 查找节点；未知 id 返回 undefined', () => {
    expect(knowledgeById('kv-cache')?.name).toBeTruthy();
    expect(knowledgeById('no-such-topic')).toBeUndefined();
  });

  it('评分要点统一来自知识点节点（题目级 rubric 已移除，ADR-044）', () => {
    const q = { topic: 'kv-cache' } as Question;
    expect(requiredPointsFor(q)).toEqual(knowledgeById('kv-cache')?.required);
    expect(requiredPointsFor(q)?.length ?? 0).toBeGreaterThan(0);
  });

  it('topic 无知识点节点时返回 undefined', () => {
    expect(requiredPointsFor({ topic: 'no-such-topic' } as Question)).toBeUndefined();
  });
});

describe('knowledgeCoverage', () => {
  const fixture: KnowledgeNode[] = [
    { id: 'a', name: 'A', area: 'ai-engineering', topic: 'transformer', priority: 'P0', summary: 's', required: ['r'], misconceptions: ['m'], angles: ['definition'] },
    { id: 'b', name: 'B', area: 'llm', topic: 'model-architecture', priority: 'P0', summary: 's', required: ['r'], misconceptions: ['m'], angles: ['mechanism'] },
    { id: 'c', name: 'C', area: 'llm', topic: 'model-architecture', priority: 'P1', summary: 's', required: ['r'], misconceptions: ['m'], angles: ['tradeoff'] },
  ];
  const questions = [{ topic: 'a' }, { topic: 'a' }, { topic: 'x' }] as Question[];

  it('统计 P0 覆盖数并把无题目支撑的节点列为 gap', () => {
    const c = knowledgeCoverage(questions, fixture);
    expect(c.total).toBe(3);
    expect(c.p0Total).toBe(2);
    expect(c.p0Covered).toBe(1);
    // gaps 列出所有无题目支撑的节点（不分优先级）= 题库建设路线图
    expect(c.gaps.map((g) => g.id)).toEqual(['b', 'c']);
    expect(c.gaps[0]).toMatchObject({ name: 'B', domain: 'llm', priority: 'P0' });
  });
});
