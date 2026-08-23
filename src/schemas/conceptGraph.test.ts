import { describe, it, expect } from 'vitest';
import { conceptGraphSchema } from './conceptGraph';

describe('conceptGraphSchema', () => {
  it('accepts valid graph', () => {
    expect(() =>
      conceptGraphSchema.parse({
        edges: [
          { from: 'a', to: 'b', type: 'prerequisite' },
          { from: 'b', to: 'c', type: 'related' },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects invalid edge type', () => {
    expect(() =>
      conceptGraphSchema.parse({
        edges: [{ from: 'a', to: 'b', type: 'invalid' }],
      }),
    ).toThrow();
  });

  it('rejects missing edges', () => {
    expect(() => conceptGraphSchema.parse({})).toThrow();
  });

  it('rejects empty from', () => {
    expect(() =>
      conceptGraphSchema.parse({
        edges: [{ from: '', to: 'b', type: 'prerequisite' }],
      }),
    ).toThrow();
  });
});
