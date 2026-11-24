import { describe, expect, it } from 'vitest';
import { LEARNING_TRACKS, SAP_IT_SERVICE_COURSE_TOPICS } from './learningTracks';
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
    expect(track?.topicCount).toBe(SAP_IT_SERVICE_COURSE_TOPICS.length);
    expect(SAP_IT_SERVICE_COURSE_TOPICS).toHaveLength(20);
    expect(new Set(SAP_IT_SERVICE_COURSE_TOPICS.map((topic) => topic.id)).size).toBe(20);
    expect(knowledgeForTrack(knowledgeNodes, courseId)).toHaveLength(20);
    expect(questionBankForTrack(questionBank, courseId, knowledgeNodes).questions).toHaveLength(200);
  });

  it('has valid source-linked knowledge nodes and questions for every topic', () => {
    expect(nodes).toHaveLength(20);
    expect(questions).toHaveLength(200);
    expect(nodes.every((node) => knowledgeNodeSchema.safeParse(node).success && node.area === 'sap-consulting')).toBe(true);
    expect(questions.every((question) => questionSchema.safeParse(question).success)).toBe(true);
    for (const node of nodes) {
      const nodeQuestions = questions.filter((question) => question.topic === node.id);
      expect(nodeQuestions).toHaveLength(10);
      expect(nodeQuestions.every((question) => question.knowledgeId === node.id && question.source?.materialId === 'sap-official-learning-and-product-documentation')).toBe(true);
    }
    expect(new Set(questions.map((question) => question.id)).size).toBe(200);
    expect(questions.every((question) => question.formats.choice?.type === 'single')).toBe(true);
  });
});
