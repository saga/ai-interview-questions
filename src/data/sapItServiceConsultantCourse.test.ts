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
    expect(SAP_IT_SERVICE_COURSE_TOPICS).toHaveLength(21);
    expect(SAP_COURSERA_COURSE_TOPICS).toHaveLength(10);
    expect(SAP_JUNIOR_PRACTICE_TOPICS).toHaveLength(10);
    expect(new Set(SAP_IT_SERVICE_COURSE_TOPICS.map((topic) => topic.id)).size).toBe(21);
    expect(knowledgeForTrack(knowledgeNodes, courseId)).toHaveLength(41);
    expect(questionBankForTrack(questionBank, courseId, knowledgeNodes).questions).toHaveLength(640);
  });

  it('has valid source-linked knowledge nodes and questions for every topic', () => {
    expect(nodes).toHaveLength(41);
    expect(questions).toHaveLength(640);
    expect(nodes.every((node) => knowledgeNodeSchema.safeParse(node).success && node.area === 'sap-consulting')).toBe(true);
    expect(questions.every((question) => questionSchema.safeParse(question).success)).toBe(true);
    for (const node of nodes) {
      const nodeQuestions = questions.filter((question) => question.topic === node.id);
      expect(nodeQuestions.length).toBeGreaterThanOrEqual(10);
      expect(nodeQuestions.every((question) => question.knowledgeId === node.id && ['sap-official-learning-and-product-documentation', 'coursera-sap-technology-consultant-professional-certificate', 'sap-apac-junior-consultant-practice-cases', 'sap-business-ai-official-documentation'].includes(question.source?.materialId ?? ''))).toBe(true);
    }
    expect(new Set(questions.map((question) => question.id)).size).toBe(640);
    const juniorPractice = questions.filter((question) => Number(question.id.slice(-3)) >= 601 && Number(question.id.slice(-3)) <= 800);
    expect(juniorPractice).toHaveLength(200);
    expect(juniorPractice.filter((question) => question.difficulty === 'easy')).toHaveLength(80);
    expect(juniorPractice.filter((question) => question.difficulty === 'medium')).toHaveLength(120);
    expect(juniorPractice.every((question) => question.source?.materialId === 'sap-apac-junior-consultant-practice-cases')).toBe(true);
    const supplemental = questions.filter((question) => Number(question.id.slice(-3)) >= 201 && Number(question.id.slice(-3)) <= 400 && Number(question.id.slice(-3)) <= 400);
    expect(supplemental).toHaveLength(200);
    expect(supplemental.every((question) => ['easy', 'medium'].includes(question.difficulty))).toBe(true);
    const businessAi = questions.filter((question) => Number(question.id.slice(-3)) >= 801 && Number(question.id.slice(-3)) <= 840);
    expect(businessAi).toHaveLength(40);
    expect(businessAi.filter((question) => question.difficulty === 'easy')).toHaveLength(20);
    expect(businessAi.filter((question) => question.difficulty === 'medium')).toHaveLength(20);
    expect(new Set(businessAi.map((question) => question.formats.choice?.answer?.[0])).size).toBe(4);
    expect(businessAi.every((question) => question.source?.materialId === 'sap-business-ai-official-documentation')).toBe(true);
    expect(questions.every((question) => question.formats.choice?.type === 'single')).toBe(true);
    expect(questions.every((question) => !/(你是刚加入|作为实习生|Junior Consultant)/.test(question.question))).toBe(true);
    expect(questions.every((question) => question.formats.choice?.options.every((option) => !/[。！？]，(?:并|便于|同时|方便)/.test(option)))).toBe(true);
    expect(nodes.find((node) => node.id === 'sap-business-ai')?.required.join(' ')).toContain('Joule Studio');
    const juniorRoleNoise = /你是刚加入项目|毕业生实习生或 Junior Consultant|对初级顾问而言|把资深顾问或项目负责人的决策职责误当成实习生应独立承担的工作/;
    expect(questions.every((question) => !juniorRoleNoise.test([
      question.question,
      question.explanation,
      ...question.misconceptions,
    ].join(' ')))).toBe(true);
    expect(nodes.every((node) => !juniorRoleNoise.test([
      node.summary,
      ...node.required,
      ...node.misconceptions,
    ].join(' ')))).toBe(true);
    const japanSilenceQuestion = juniorPractice.find((question) => question.id === 'sap-itc-636');
    expect(japanSilenceQuestion?.question).toBe('日本客户会议中出现较长沉默，你准备继续讲完所有幻灯片。 下一步最合适的做法是什么？（单选题）');
  });
});
