import { describe, expect, it } from 'vitest';
import { knowledgeNodes } from '../knowledgeMap';
import {
  SNOWFLAKE_LEARNING_ARTICLES,
  SNOWFLAKE_LEARNING_CONTENT,
  SNOWFLAKE_LEARNING_OVERVIEW,
  SNOWFLAKE_INTEGRATED_TUTORIALS,
} from './snowflake';

describe('Snowflake one-to-one course tutorials', () => {
  const courseNodes = knowledgeNodes.filter((node) =>
    node.courseId === 'snowflake' || (!node.courseId && node.area === 'data-platform'),
  );

  it('provides a course overview and an actionable learning path', () => {
    expect(SNOWFLAKE_LEARNING_OVERVIEW.introduction.length).toBeGreaterThan(50);
    expect(SNOWFLAKE_LEARNING_OVERVIEW.objectives.length).toBeGreaterThanOrEqual(4);
    expect(SNOWFLAKE_LEARNING_OVERVIEW.roadmap.length).toBeGreaterThanOrEqual(4);
  });

  it('has exactly one independent Markdown article for every KnowledgeNode', () => {
    expect(courseNodes).toHaveLength(194);
    expect(SNOWFLAKE_LEARNING_ARTICLES).toHaveLength(courseNodes.length);
    expect(SNOWFLAKE_LEARNING_CONTENT).toHaveLength(courseNodes.length);

    const nodeIds = new Set(courseNodes.map((node) => node.id));
    const articleIds = new Set(SNOWFLAKE_LEARNING_ARTICLES.map((article) => article.id));
    const articleNodeIds = new Set(SNOWFLAKE_LEARNING_ARTICLES.map((article) => article.nodeId));

    expect(articleIds.size).toBe(194);
    expect(articleNodeIds.size).toBe(194);
    expect([...articleIds].sort()).toEqual([...nodeIds].sort());
    expect([...articleNodeIds].sort()).toEqual([...nodeIds].sort());
  });

  it('binds article id, node id and KnowledgeNode id one-to-one', () => {
    const nodeById = new Map(courseNodes.map((node) => [node.id, node]));
    for (const article of SNOWFLAKE_LEARNING_ARTICLES) {
      expect(article.id).toBe(article.nodeId);
      expect(nodeById.has(article.nodeId), article.nodeId).toBe(true);
      expect(article.title).toBe(nodeById.get(article.nodeId)?.name);
      expect(article.content.length, article.id).toBeGreaterThan(900);
      expect(article.content).toMatch(/^#\s+\S/m);
      const headings = [...article.content.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)]
        .map((match) => match[1].trim());
      expect(headings.length, article.id).toBeGreaterThanOrEqual(5);
      expect(
        headings.some((heading) => /本节要解决的问题|先|从.*说起|问题|为什么|判断/.test(heading)),
      ).toBe(true);
      expect(
        headings.some((heading) => /常见误区|容易|失败|故障|风险|边界|排查|代价|限制|失守|误判/.test(heading)),
      ).toBe(true);
      expect(
        headings.some((heading) => /自测|练习|思考|回顾|演练/.test(heading)),
      ).toBe(true);
      const genericHeadings = new Set([
        '本节要解决的问题', '核心知识', '工程实施步骤', '场景分析',
        '常见误区', '完成标准', '自测', '参考资料',
      ]);
      expect(headings.some((heading) => !genericHeadings.has(heading))).toBe(true);
    }
  });

  it('creates exactly one article in each KnowledgeNode learning pack', () => {
    const packByNode = new Map(SNOWFLAKE_LEARNING_CONTENT.map((pack) => [pack.nodeId, pack]));
    expect(packByNode.size).toBe(194);
    for (const node of courseNodes) {
      const pack = packByNode.get(node.id);
      expect(pack, node.id).toBeDefined();
      expect(pack?.articles).toHaveLength(1);
      expect(pack?.articles[0].id).toBe(node.id);
      expect(pack?.references.length).toBeGreaterThan(0);
    }
  });

  it('covers all nine curriculum topics', () => {
    const topics = new Set(courseNodes.map((node) => node.topic));
    for (const topic of [
      'snowflake', 'postgresql', 'data-architecture', 'data-engineering',
      'snowflake-lakehouse', 'snowflake-devops', 'snowflake-data-products',
      'snowflake-genai', 'snowflake-agent-ml',
    ]) expect(topics.has(topic)).toBe(true);
  });

  it('each tutorial has references with valid URLs', () => {
    for (const pack of SNOWFLAKE_LEARNING_CONTENT) {
      expect(pack.references.length).toBeGreaterThan(0);
      for (const reference of pack.references) {
        expect(reference.url).toMatch(/^https:\/\//);
        expect(reference.relevance.length).toBeGreaterThan(10);
      }
    }
  });
});


describe('Snowflake integrated engineering tutorials', () => {
  it('keeps eight end-to-end tutorials separate from the 194 one-to-one node tutorials', () => {
    expect(SNOWFLAKE_INTEGRATED_TUTORIALS).toHaveLength(8);
    expect(SNOWFLAKE_LEARNING_ARTICLES).toHaveLength(194);
    expect(SNOWFLAKE_LEARNING_CONTENT).toHaveLength(194);
    expect(new Set(SNOWFLAKE_INTEGRATED_TUTORIALS.map((tutorial) => tutorial.id)).size).toBe(8);

    const knownNodeIds = new Set(knowledgeNodes
      .filter((node) => node.courseId === 'snowflake' || (!node.courseId && node.area === 'data-platform'))
      .map((node) => node.id));

    for (const tutorial of SNOWFLAKE_INTEGRATED_TUTORIALS) {
      expect(tutorial.id).toMatch(/^integrated-/);
      expect(tutorial.content.length, tutorial.id).toBeGreaterThan(1200);
      for (const heading of ['## 场景与目标', '## 架构与数据流', '## 实施步骤', '## 关键取舍', '## 验收清单', '## 关联知识点', '## 参考资料']) {
        expect(tutorial.content, tutorial.id).toContain(heading);
      }
      expect(tutorial.linkedKnowledgeNodeIds.length).toBeGreaterThan(0);
      expect(new Set(tutorial.linkedKnowledgeNodeIds).size).toBe(tutorial.linkedKnowledgeNodeIds.length);
      for (const nodeId of tutorial.linkedKnowledgeNodeIds) expect(knownNodeIds.has(nodeId), nodeId).toBe(true);
      expect(tutorial.references.length).toBeGreaterThan(0);
      for (const reference of tutorial.references) expect(reference.url.startsWith('https://')).toBe(true);
    }
  });
});
