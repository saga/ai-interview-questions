import { describe, expect, it } from 'vitest';
import baseQuestions from './questions/campus-employment-300.json';
import advancedQuestions from './questions/campus-employment-200-2025-2026.json';
import knowledge from './knowledge/campus-employment.json';
import { questionSchema } from '../schemas/question';
import { LEARNING_TRACKS, CAMPUS_EMPLOYMENT_COURSE_TOPICS } from './learningTracks';
import { knowledgeForTrack, questionBankForTrack } from '../domain/learningTracks';
import { knowledgeNodes } from './knowledgeMap';
import { questionBank } from './questionBank';

const allQuestions = [...baseQuestions, ...advancedQuestions];
const courseQuestions = questionBank.questions.filter((q) => q.courseId === 'campus-employment');

describe('campus employment interview course', () => {
  it('registers as an independent learning track with 15 course themes', () => {
    const track = LEARNING_TRACKS.find((item) => item.id === 'campus-employment');
    expect(track?.topicCount).toBe(CAMPUS_EMPLOYMENT_COURSE_TOPICS.length);
    expect(CAMPUS_EMPLOYMENT_COURSE_TOPICS).toHaveLength(15);
    expect(LEARNING_TRACKS.map((item) => item.id)).toContain('campus-employment');
    expect(knowledgeForTrack(knowledgeNodes, 'campus-employment')).toHaveLength(15);
    expect(questionBankForTrack(questionBank, 'campus-employment').questions).toHaveLength(500);
  });

  it('contains 300 foundation questions and 200 2025-2026 intermediate/advanced additions', () => {
    expect(knowledge).toHaveLength(15);
    expect(baseQuestions).toHaveLength(300);
    expect(advancedQuestions).toHaveLength(200);
    expect(baseQuestions.filter((q) => q.difficulty === 'easy')).toHaveLength(180);
    expect(baseQuestions.filter((q) => q.difficulty === 'medium')).toHaveLength(120);
    expect(advancedQuestions.filter((q) => q.difficulty === 'medium')).toHaveLength(100);
    expect(advancedQuestions.filter((q) => q.difficulty === 'hard')).toHaveLength(100);
    expect(allQuestions).toHaveLength(500);
  });

  it('uses globally unique IDs and links every question to a course knowledge node', () => {
    expect(new Set(allQuestions.map((q) => q.id)).size).toBe(500);
    const nodeIds = new Set(knowledge.map((node) => node.id));
    expect(allQuestions.every((q) =>
      q.courseId === 'campus-employment' &&
      q.category === 'campus-employment' &&
      nodeIds.has(q.topic) &&
      q.knowledgeId === q.topic
    )).toBe(true);
  });

  it('keeps questions open-ended and behaviorally evaluated, not algorithm multiple-choice', () => {
    expect(allQuestions.every((q) => q.evaluationProfile === 'behavioral')).toBe(true);
    expect(allQuestions.every((q) => Boolean(q.formats.open?.referenceAnswer) && !q.formats.choice)).toBe(true);
    expect(allQuestions.every((q) => questionSchema.safeParse(q).success)).toBe(true);
  });

  it('has traceable 2025-2026 interview patterns and clearly marked practice extensions', () => {
    expect(allQuestions.every((q) => Boolean(q.source?.materialId && q.source.section))).toBe(true);
    expect(allQuestions.some((q) => q.tags.includes('field-reported-2025-2026'))).toBe(true);
    expect(allQuestions.some((q) => q.tags.includes('practice-extension'))).toBe(true);
    expect(advancedQuestions.every((q) => q.tags.includes('2025-2026-expansion'))).toBe(true);
  });

  it('covers all 15 course themes in the 200 new questions', () => {
    const covered = new Set(advancedQuestions.map((q) => knowledge.find((node) => node.id === q.topic)?.topic));
    expect(covered.size).toBe(15);
    for (const node of knowledge) {
      expect(advancedQuestions.some((q) => q.topic === node.id), `no advanced questions for ${node.id}`).toBe(true);
    }
  });
});
