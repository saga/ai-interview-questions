import { describe, expect, it } from 'vitest';
import { knowledgeNodes } from '../knowledgeMap';
import { questionBank } from '../questionBank';
import { SNOWFLAKE_LEARNING_CONTENT, SNOWFLAKE_LEARNING_OVERVIEW } from './snowflake';

describe('Snowflake learning content', () => {
  const snowflakeNodes = knowledgeNodes.filter((node) => node.courseId === 'snowflake');
  const snowflakeQuestions = questionBank.questions.filter((question) =>
    question.courseId === 'snowflake' ||
    snowflakeNodes.some((node) => node.id === question.topic),
  );

  it('provides the course overview and a learning roadmap', () => {
    expect(SNOWFLAKE_LEARNING_OVERVIEW.introduction.length).toBeGreaterThan(80);
    expect(SNOWFLAKE_LEARNING_OVERVIEW.objectives.length).toBeGreaterThanOrEqual(4);
    expect(SNOWFLAKE_LEARNING_OVERVIEW.roadmap.length).toBeGreaterThanOrEqual(4);
  });

  it('every learning pack points to a Snowflake KnowledgeNode', () => {
    const nodeIds = new Set(snowflakeNodes.map((node) => node.id));
    expect(SNOWFLAKE_LEARNING_CONTENT.length).toBeGreaterThanOrEqual(5);
    expect(new Set(SNOWFLAKE_LEARNING_CONTENT.map((pack) => pack.nodeId)).size)
      .toBe(SNOWFLAKE_LEARNING_CONTENT.length);
    for (const pack of SNOWFLAKE_LEARNING_CONTENT) {
      expect(nodeIds.has(pack.nodeId), pack.nodeId).toBe(true);
      expect(pack.articles.length).toBeGreaterThan(0);
    }
  });

  it('core articles cover the five P0 platform and data-engineering nodes', () => {
    const covered = new Set(SNOWFLAKE_LEARNING_CONTENT.map((pack) => pack.nodeId));
    const required = [
      'snowflake-architecture',
      'virtual-warehouse',
      'snowflake-data-loading',
      'change-capture-processing',
      'dynamic-tables',
    ];
    for (const nodeId of required) {
      expect(covered.has(nodeId), nodeId).toBe(true);
    }
    for (const nodeId of required) {
      expect(snowflakeNodes.find((node) => node.id === nodeId)?.priority).toBe('P0');
    }
  });

  it('article ids are unique and every reference has a usable URL and reason', () => {
    const articles = SNOWFLAKE_LEARNING_CONTENT.flatMap((pack) => pack.articles);
    expect(new Set(articles.map((article) => article.id)).size).toBe(articles.length);
    for (const article of articles) {
      expect(article.content.length).toBeGreaterThan(500);
      expect(article.estimatedMinutes).toBeGreaterThan(0);
    }
    for (const pack of SNOWFLAKE_LEARNING_CONTENT) {
      expect(pack.references.length).toBeGreaterThan(0);
      for (const reference of pack.references) {
        expect(reference.url).toMatch(/^https:\/\//);
        expect(reference.relevance.length).toBeGreaterThan(10);
      }
    }
  });

  it('includes public customer cases where operational examples add value', () => {
    const warehouse = SNOWFLAKE_LEARNING_CONTENT.find((pack) => pack.nodeId === 'virtual-warehouse');
    const ingestion = SNOWFLAKE_LEARNING_CONTENT.find((pack) => pack.nodeId === 'snowflake-data-loading');
    expect(warehouse?.references.some((reference) =>
      reference.type === 'case' && reference.id === 'case-orderco-workload-isolation',
    )).toBe(true);
    expect(ingestion?.references.some((reference) =>
      reference.type === 'case' && reference.id === 'case-chocolate-finance-ingestion',
    )).toBe(true);
  });

  it('every POC knowledge node is connected to at least one exam question', () => {
    for (const pack of SNOWFLAKE_LEARNING_CONTENT) {
      expect(
        snowflakeQuestions.some((question) => question.topic === pack.nodeId),
        pack.nodeId,
      ).toBe(true);
    }
  });
});
