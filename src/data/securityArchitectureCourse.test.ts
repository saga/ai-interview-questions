import { describe, expect, it } from 'vitest';
import { LEARNING_TRACKS, SECURITY_ARCHITECTURE_COURSE_TOPICS } from './learningTracks';
import { knowledgeNodes } from './knowledgeMap';
import { questionBank } from './questionBank';
import { questionSchema } from '../schemas/question';

describe('Security Architecture course', () => {
  const track = LEARNING_TRACKS.find((item) => item.id === 'security-architecture');
  const nodes = knowledgeNodes.filter((node) => node.courseId === 'security-architecture');
  const questions = questionBank.questions.filter((question) => question.courseId === 'security-architecture');

  it('registers as a peer to AI and Snowflake with independent themes', () => {
    expect(LEARNING_TRACKS.map((item) => item.id)).toEqual(['ai', 'snowflake', 'security-architecture']);
    expect(track?.topicCount).toBe(SECURITY_ARCHITECTURE_COURSE_TOPICS.length);
    expect(new Set(SECURITY_ARCHITECTURE_COURSE_TOPICS.map((topic) => topic.id)).size).toBe(SECURITY_ARCHITECTURE_COURSE_TOPICS.length);
  });

  it('maps every knowledge node to a course theme and source-backed questions', () => {
    const themeIds = new Set(SECURITY_ARCHITECTURE_COURSE_TOPICS.map((topic) => topic.id));
    expect(nodes).toHaveLength(12);
    expect(nodes.every((node) => node.area === 'security-architecture')).toBe(true);
    expect(nodes.every((node) => themeIds.has(node.topic))).toBe(true);
    for (const node of nodes) {
      const nodeQuestions = questions.filter((question) => question.topic === node.id);
      expect(nodeQuestions.length, `missing questions for ${node.id}`).toBeGreaterThanOrEqual(2);
      expect(nodeQuestions.every((question) => Boolean(question.source?.materialId))).toBe(true);
    }
  });

  it('uses valid dual-form questions and prioritizes architecture decisions', () => {
    expect(questions).toHaveLength(24);
    expect(questions.every((question) => questionSchema.safeParse(question).success)).toBe(true);
    expect(questions.every((question) => question.formats.choice && question.formats.open)).toBe(true);
    expect(questions.every((question) => ['design','system-design','tradeoff','scenario','architecture','mechanism','diagnosis'].includes(question.angle))).toBe(true);
    const multipleCount = questions.filter((question) => question.formats.choice?.type === 'multiple').length;
    expect(multipleCount / questions.length).toBeGreaterThanOrEqual(2 / 3);
    expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
  });
});
