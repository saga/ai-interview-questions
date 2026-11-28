import { describe, expect, it } from 'vitest';
import { validateBlueprintKnowledgeIdentity } from './convert-blueprint-helpers';

describe('blueprint KnowledgeNode identity', () => {
  it('accepts a shared topic when knowledgeId identifies the exact course node', () => {
    expect(validateBlueprintKnowledgeIdentity({
      id: 'sf-architecture-q1',
      courseId: 'snowflake',
      topic: 'snowflake',
      knowledgeId: 'snowflake-architecture',
      blueprintKnowledgeId: 'snowflake-architecture',
    })).toEqual([]);
  });

  it('rejects a course question without knowledgeId', () => {
    expect(validateBlueprintKnowledgeIdentity({
      id: 'sf-architecture-q1',
      courseId: 'snowflake',
      topic: 'snowflake',
      blueprintKnowledgeId: 'snowflake-architecture',
    })).toContain('sf-architecture-q1: 课程题缺少精确 knowledgeId');
  });

  it('rejects disagreement between Blueprint and final Question identity', () => {
    expect(validateBlueprintKnowledgeIdentity({
      id: 'sf-architecture-q1',
      courseId: 'snowflake',
      topic: 'snowflake',
      knowledgeId: 'virtual-warehouse',
      blueprintKnowledgeId: 'snowflake-architecture',
    })).toContain('sf-architecture-q1: blueprintKnowledgeId "snowflake-architecture" 与 knowledgeId "virtual-warehouse" 不一致');
  });

  it('does not require a non-course legacy topic to be copied into knowledgeId', () => {
    expect(validateBlueprintKnowledgeIdentity({
      id: 'legacy-q1',
      topic: 'rag',
      blueprintKnowledgeId: 'rag',
    })).toEqual([]);
  });
});
