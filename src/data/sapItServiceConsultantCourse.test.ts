import { describe, expect, it } from 'vitest';
import { LEARNING_TRACKS, SAP_IT_SERVICE_COURSE_TOPICS, SAP_COURSERA_COURSE_TOPICS, SAP_JUNIOR_PRACTICE_TOPICS } from './learningTracks';
import { knowledgeNodes } from './knowledgeMap';
import { questionBank } from './questionBank';
import { questionSchema } from '../schemas/question';
import { knowledgeNodeSchema } from '../schemas/knowledge';
import { knowledgeForTrack, questionBankForTrack } from '../domain/learningTracks';

describe('SAP IT Service Consultant course', () => {
  const courseId = 'sap-it-service-consultant';
  const nodes = knowledgeNodes.filter((node) => node.courseId === courseId);
  const questions = questionBank.questions.filter((question) => question.courseId === courseId);

  it('registers as an independent learning track', () => {
    const track = LEARNING_TRACKS.find((item) => item.id === courseId);
    expect(track?.topicCount).toBe(SAP_IT_SERVICE_COURSE_TOPICS.length + SAP_COURSERA_COURSE_TOPICS.length + SAP_JUNIOR_PRACTICE_TOPICS.length);
    expect(SAP_IT_SERVICE_COURSE_TOPICS).toHaveLength(20);
    expect(SAP_COURSERA_COURSE_TOPICS).toHaveLength(10);
    expect(SAP_JUNIOR_PRACTICE_TOPICS).toHaveLength(10);
    expect(new Set(SAP_IT_SERVICE_COURSE_TOPICS.map((topic) => topic.id)).size).toBe(20);
    expect(knowledgeForTrack(knowledgeNodes, courseId)).toHaveLength(40);
    expect(questionBankForTrack(questionBank, courseId, knowledgeNodes).questions).toHaveLength(600);
  });

  it('has valid source-linked knowledge nodes and questions for every topic', () => {
    expect(nodes).toHaveLength(40);
    expect(questions).toHaveLength(400);
    expect(nodes.every((node) => knowledgeNodeSchema.safeParse(node).success && node.area === 'sap-consulting')).toBe(true);
    expect(questions.every((question) => questionSchema.safeParse(question).success)).toBe(true);
    for (const node of nodes) {
      const nodeQuestions = questions.filter((question) => question.topic === node.id);
      expect(nodeQuestions.length).toBeGreaterThanOrEqual(10);
      expect(nodeQuestions.every((question) => question.knowledgeId === node.id && ['sap-official-learning-and-product-documentation', 'coursera-sap-technology-consultant-professional-certificate'].includes(question.source?.materialId ?? ''))).toBe(true);
    }
    expect(new Set(questions.map((question) => question.id)).size).toBe(600);
    const juniorPractice = questions.filter((question) => question.id.startsWith('sap-itc-6'));
    expect(juniorPractice).toHaveLength(200);
    expect(juniorPractice.filter((question) => question.difficulty === 'easy')).toHaveLength(80);
    expect(juniorPractice.filter((question) => question.difficulty === 'medium')).toHaveLength(120);
    expect(juniorPractice.every((question) => question.source?.materialId === 'sap-apac-junior-consultant-practice-cases')).toBe(true);
    const supplemental = questions.filter((question) => Number(question.id.slice(-3)) >= 201);
    expect(supplemental).toHaveLength(200);
    expect(supplemental.every((question) => ['easy', 'medium'].includes(question.difficulty))).toBe(true);
    expect(questions.every((question) => question.formats.choice?.type === 'single')).toBe(true);
  });
});
