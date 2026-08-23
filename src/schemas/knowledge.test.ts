import { describe, it, expect } from 'vitest';
import { knowledgeNodeSchema, knowledgeBankSchema } from './knowledge';

const validNode = {
  id: 'tool-calling',
  name: 'Tool Calling',
  area: 'rag-agent' as const,
  priority: 'P0' as const,
  summary: '概要',
  required: ['要点1', '要点2'],
  misconceptions: ['误解1'],
  angles: ['definition' as const, 'tradeoff' as const],
};

describe('knowledgeNodeSchema', () => {
  it('accepts valid node', () => {
    expect(() => knowledgeNodeSchema.parse(validNode)).not.toThrow();
  });

  it('rejects unknown area', () => {
    expect(() => knowledgeNodeSchema.parse({ ...validNode, area: 'unknown' })).toThrow();
  });

  it('rejects missing id', () => {
    const { id, ...rest } = validNode as Record<string, unknown> & { id: string };
    expect(() => knowledgeNodeSchema.parse(rest)).toThrow();
  });

  it('rejects invalid priority', () => {
    expect(() => knowledgeNodeSchema.parse({ ...validNode, priority: 'P3' })).toThrow();
  });

  it('accepts empty misconceptions', () => {
    expect(() =>
      knowledgeNodeSchema.parse({ ...validNode, misconceptions: [] }),
    ).not.toThrow();
  });

  it('validates array bank', () => {
    expect(() => knowledgeBankSchema.parse([validNode, validNode])).not.toThrow();
    expect(() => knowledgeBankSchema.parse(validNode)).toThrow();
  });
});
