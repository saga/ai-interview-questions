import { describe, expect, it } from 'vitest';
import questions from './questions/campus-employment-300.json';
import knowledge from './knowledge/campus-employment.json';

describe('campus employment interview course', () => {
  it('contains 15 knowledge nodes and 300 questions', () => {
    expect(knowledge).toHaveLength(15);
    expect(questions).toHaveLength(300);
  });

  it('keeps the intended beginner and intermediate distribution', () => {
    expect(questions.filter((q) => q.difficulty === 'easy')).toHaveLength(180);
    expect(questions.filter((q) => q.difficulty === 'medium')).toHaveLength(120);
  });

  it('uses unique IDs and links every question to a course knowledge node', () => {
    expect(new Set(questions.map((q) => q.id)).size).toBe(300);
    const nodeIds = new Set(knowledge.map((node) => node.id));
    expect(questions.every((q) => q.courseId === 'campus-employment' && nodeIds.has(q.knowledgeId))).toBe(true);
  });

  it('uses open behavioral questions rather than algorithm multiple choice', () => {
    expect(questions.every((q) => q.evaluationProfile === 'behavioral')).toBe(true);
    expect(questions.every((q) => Boolean(q.formats.open?.referenceAnswer) && !q.formats.choice)).toBe(true);
  });

  it('distinguishes public interview-pattern paraphrases from training extensions', () => {
    expect(questions.some((q) => q.tags.includes('field-reported-2025-2026'))).toBe(true);
    expect(questions.some((q) => q.tags.includes('practice-extension'))).toBe(true);
  });
});
