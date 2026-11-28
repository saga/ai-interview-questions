import { describe, expect, it } from 'vitest';
import { knowledgeNodes } from '../knowledgeMap';
import {
  SNOWFLAKE_LEARNING_ARTICLES,
  SNOWFLAKE_LEARNING_CONTENT,
  SNOWFLAKE_LEARNING_OVERVIEW,
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
      expect(article.content).toContain('## 本节要解决的问题');
      expect(article.content).toContain('## 核心知识');
      expect(article.content).toContain('## 常见误区');
      expect(article.content).toContain('## 自测');
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
