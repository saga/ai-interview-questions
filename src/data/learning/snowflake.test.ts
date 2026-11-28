import { describe, expect, it } from 'vitest';
import { knowledgeNodes } from '../knowledgeMap';
import { questionBank } from '../questionBank';
import {
  SNOWFLAKE_LEARNING_ARTICLES,
  SNOWFLAKE_LEARNING_CONTENT,
  SNOWFLAKE_LEARNING_OVERVIEW,
} from './snowflake';

describe('Snowflake learning content', () => {
  const snowflakeNodes = knowledgeNodes.filter((node) =>
    node.courseId === 'snowflake' || (!node.courseId && node.area === 'data-platform'),
  );
  const snowflakeQuestions = questionBank.questions.filter((question) =>
    question.courseId === 'snowflake' ||
    snowflakeNodes.some((node) => node.id === question.topic),
  );

  it('provides the course overview and a learning roadmap', () => {
    expect(SNOWFLAKE_LEARNING_OVERVIEW.introduction.length).toBeGreaterThan(80);
    expect(SNOWFLAKE_LEARNING_OVERVIEW.objectives.length).toBeGreaterThanOrEqual(5);
    expect(SNOWFLAKE_LEARNING_OVERVIEW.roadmap.length).toBeGreaterThanOrEqual(5);
  });

  it('stores tutorials as independent Markdown files and indexes the full curriculum', () => {
    expect(SNOWFLAKE_LEARNING_ARTICLES.length).toBe(37);
    expect(new Set(SNOWFLAKE_LEARNING_ARTICLES.map((article) => article.id)).size)
      .toBe(SNOWFLAKE_LEARNING_ARTICLES.length);
    for (const article of SNOWFLAKE_LEARNING_ARTICLES) {
      expect(article.content.length, article.id).toBeGreaterThan(500);
      expect(article.estimatedMinutes, article.id).toBeGreaterThan(0);
    }
  });

  it('maps every Snowflake KnowledgeNode to at least one course tutorial', () => {
    const packByNode = new Map(SNOWFLAKE_LEARNING_CONTENT.map((pack) => [pack.nodeId, pack]));
    expect(packByNode.size).toBe(snowflakeNodes.length);
    expect(snowflakeNodes.length).toBeGreaterThanOrEqual(190);
    const uncovered = snowflakeNodes.filter((node) => {
      const pack = packByNode.get(node.id);
      return !pack || pack.articles.length === 0 || pack.references.length === 0;
    });
    expect(uncovered.map((node) => node.id)).toEqual([]);
  });

  it('covers all nine learning topics', () => {
    const topics = new Set(snowflakeNodes.map((node) => node.topic));
    for (const topic of [
      'snowflake', 'postgresql', 'data-architecture', 'data-engineering',
      'snowflake-lakehouse', 'snowflake-devops', 'snowflake-data-products',
      'snowflake-genai', 'snowflake-agent-ml',
    ]) expect(topics.has(topic)).toBe(true);
  });

  it('keeps the five original P0 nodes connected to training questions', () => {
    const required = [
      'snowflake-architecture',
      'virtual-warehouse',
      'snowflake-data-loading',
      'change-capture-processing',
      'dynamic-tables',
    ];
    for (const nodeId of required) {
      expect(snowflakeNodes.find((node) => node.id === nodeId)?.priority).toBe('P0');
      expect(snowflakeQuestions.some((question) => question.topic === nodeId), nodeId).toBe(true);
    }
  });

  it('preserves public customer cases from the original lessons', () => {
    const warehouse = SNOWFLAKE_LEARNING_CONTENT.find((pack) => pack.nodeId === 'virtual-warehouse');
    const ingestion = SNOWFLAKE_LEARNING_CONTENT.find((pack) => pack.nodeId === 'snowflake-data-loading');
    expect(warehouse?.references.some((reference) =>
      reference.type === 'case' && reference.id === 'case-orderco-workload-isolation',
    )).toBe(true);
    expect(ingestion?.references.some((reference) =>
      reference.type === 'case' && reference.id === 'case-chocolate-finance-ingestion',
    )).toBe(true);
    expect(warehouse?.articles.some((article) => article.content.includes('Order.co'))).toBe(true);
    expect(ingestion?.articles.some((article) => article.content.includes('Chocolate Finance'))).toBe(true);
  });

  it('each tutorial has verifiable references', () => {
    for (const article of SNOWFLAKE_LEARNING_ARTICLES) {
      expect(article.content.length, article.id).toBeGreaterThan(500);
    }
    const refs = SNOWFLAKE_LEARNING_CONTENT.flatMap((pack) => pack.references);
    expect(refs.length).toBeGreaterThan(0);
    for (const reference of refs) {
      expect(reference.url).toMatch(/^https:\/\//);
      expect(reference.relevance.length).toBeGreaterThan(10);
    }
  });
});
