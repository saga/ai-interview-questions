import { describe, expect, it } from 'vitest';
import type { KnowledgeNode } from '../schemas/knowledge';
import type { Question } from '../schemas/question';
import { blueprintFromSuggestion, validateAgainstBlueprint } from './blueprint';

const courseNode: KnowledgeNode = {
  id: 'snowflake-architecture',
  courseId: 'snowflake',
  name: 'Snowflake 平台分层与计算存储分离',
  area: 'data-platform',
  topic: 'snowflake',
  priority: 'P0',
  summary: '计算与存储分离的架构模型。',
  required: ['virtual warehouse', 'storage'],
  misconceptions: ['warehouse 是存储层'],
  angles: ['architecture'],
};

const suggestion = {
  nodeId: courseNode.id,
  name: courseNode.name,
  priority: courseNode.priority,
  angle: 'architecture',
  difficulty: 'hard',
  format: 'open',
} as const;

describe('course question blueprint identity', () => {
  it('keeps Question.topic as the exact node ID and emits courseId / knowledgeId', () => {
    const blueprint = blueprintFromSuggestion(suggestion, [courseNode]);
    expect(blueprint).toMatchObject({
      topic: 'snowflake-architecture',
      courseId: 'snowflake',
      knowledgeId: 'snowflake-architecture',
    });
  });

  it('rejects a generated question that drops the exact course node mapping', () => {
    const blueprint = blueprintFromSuggestion(suggestion, [courseNode])!;
    const question = {
      topic: 'snowflake-architecture',
      courseId: 'snowflake',
      knowledgeId: 'snowflake-architecture',
      angle: 'architecture',
      difficulty: 'hard',
      formats: { open: { referenceAnswer: '计算与存储分离。' } },
    } as Question;
    expect(validateAgainstBlueprint(question, blueprint)).toEqual({ ok: true });
    expect(validateAgainstBlueprint({ ...question, topic: 'snowflake' }, blueprint).ok).toBe(false);
    expect(validateAgainstBlueprint({ ...question, knowledgeId: undefined }, blueprint).ok).toBe(false);
    expect(validateAgainstBlueprint({ ...question, courseId: 'other' }, blueprint).ok).toBe(false);
  });
});
